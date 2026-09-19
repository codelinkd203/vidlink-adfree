const chromium = require('@sparticuz/chromium-min');
const puppeteer = require('puppeteer-core');

const CHROMIUM_REMOTE_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v147.0.2/chromium-v147.0.2-pack.x64.tar';

const VIDNEST_BASE_URL =
  process.env.BASE_URL || 'https://vidnest.fun';

const CIN_SRC_BASE_URL =
  process.env.CINESRC_BASE_URL || 'https://cinesrc.st';

const STREAM_TYPES = {
  hls: new Set([
    'application/vnd.apple.mpegurl',
    'application/x-mpegurl',
    'audio/mpegurl',
    'audio/x-mpegurl'
  ]),

  dash: new Set([
    'application/dash+xml'
  ])
};

function buildUrl(candidate, base) {
  try {
    return new URL(candidate, base).toString();
  } catch {
    return null;
  }
}

let _executablePath = null;

async function getExecutablePath() {
  if (!_executablePath) {
    _executablePath =
      await chromium.executablePath(CHROMIUM_REMOTE_URL);
  }

  return _executablePath;
}

async function getMediaUrlFromNetwork(pageUrl) {
  let browser = null;

  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await getExecutablePath(),
      headless: chromium.headless
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 Chrome/120 Safari/537.36'
    );

    let pageOrigin;

    try {
      pageOrigin = new URL(pageUrl).origin;
    } catch {
      return null;
    }

    let stream = null;

    page.on('response', response => {
      if (stream) return;

      const responseUrl = response.url();
      const request = response.request();
      const headers = request.headers();

      const contentType = (
        response.headers()['content-type'] || ''
      )
        .split(';')[0]
        .trim()
        .toLowerCase();

      let type = null;

      // Detect by MIME type first.
      if (STREAM_TYPES.hls.has(contentType)) {
        type = 'hls';
      } else if (STREAM_TYPES.dash.has(contentType)) {
        type = 'dash';
      }

      // Fall back to the manifest extension.
      if (!type) {
        if (/\.m3u8(?:[?#]|$)/i.test(responseUrl)) {
          type = 'hls';
        } else if (/\.mpd(?:[?#]|$)/i.test(responseUrl)) {
          type = 'dash';
        }
      }

      if (!type) return;

      const origin = headers.origin || pageOrigin;

      stream = {
        stream: responseUrl,
        origin,
        type,
        mime: contentType
      };

      console.log('Found stream:');
      console.log('Stream:', responseUrl);
      console.log('Origin:', origin);
      console.log('Type:', type);
      console.log('MIME:', contentType);
    });

    await page.goto(pageUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    }).catch(() => {});

    const start = Date.now();

    while (!stream && Date.now() - start < 15000) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return stream;

  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

async function getCaptions(type, id, s, e) {
  if (type === 'anime') return [];

  try {
    let url;

    if (type === 'movie') {
      url =
        `https://sub.vdrk.site/v2/movie/` +
        `${encodeURIComponent(id)}`;

    } else if (type === 'tv') {
      url =
        `https://sub.vdrk.site/v2/tv/` +
        `${encodeURIComponent(id)}/` +
        `${encodeURIComponent(s)}/` +
        `${encodeURIComponent(e)}`;
    } else {
      return [];
    }

    const resp = await fetch(url);

    if (!resp.ok) return [];

    const data = await resp.json();

    return Array.isArray(data)
      ? data
          .filter(sub => sub.file)
          .map(sub => ({
            language: sub.label || 'Unknown',
            url: sub.file
          }))
      : [];

  } catch {
    return [];
  }
}

function getSourcePage(type, id, s, e, t) {
  if (type === 'movie') {
    return buildUrl(
      `/embed/movie/${encodeURIComponent(id)}`,
      CIN_SRC_BASE_URL
    );
  }

  if (type === 'tv') {
    if (!s || !e) return null;

    return buildUrl(
      `/embed/tv/${encodeURIComponent(id)}` +
      `?s=${encodeURIComponent(s)}` +
      `&e=${encodeURIComponent(e)}`,
      CIN_SRC_BASE_URL
    );
  }

  if (type === 'anime') {
    if (!e || !t) return null;

    return buildUrl(
      `/anime/${encodeURIComponent(id)}/` +
      `${encodeURIComponent(e)}/` +
      `${encodeURIComponent(t)}/`,
      VIDNEST_BASE_URL
    );
  }

  return null;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({
        error: 'Method Not Allowed'
      });
    }

    const { type, id, s, e, t } = req.query;

    if (!type || !id) {
      return res.status(400).json({
        error: 'Missing required type or id'
      });
    }

    if (!['movie', 'tv', 'anime'].includes(type)) {
      return res.status(400).json({
        error: 'Invalid type; expected movie, tv, or anime'
      });
    }

    if (type === 'tv' && (!s || !e)) {
      return res.status(400).json({
        error: 'Missing s or e for tv type'
      });
    }

    if (type === 'anime' && (!e || !t)) {
      return res.status(400).json({
        error: 'Missing e or t for anime type'
      });
    }

    const pageUrl = getSourcePage(
      type,
      id,
      s,
      e,
      t
    );

    if (!pageUrl) {
      return res.status(500).json({
        error: 'Failed to build page URL'
      });
    }

    console.log('Loading source:', pageUrl);

    const media = await getMediaUrlFromNetwork(pageUrl);

    if (!media) {
      return res.status(502).json({
        error: 'Could not locate HLS or DASH media URL'
      });
    }

    const captions =
      await getCaptions(type, id, s, e);

    return res.json({
      streams: {
        corsAllowed: true,

        qualities: [
          {
            quality: 'auto',
            url: media.stream,
            type: media.type,
            mime: media.mime,
            origin: media.origin
          }
        ]
      },

      captions: {
        corsAllowed: true,
        tracks: captions
      },

      sourceUrl: media.stream,
      origin: media.origin,
      type: media.type,
      mime: media.mime
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
};
