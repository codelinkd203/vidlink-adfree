const chromium = require('@sparticuz/chromium-min');
const puppeteer = require('puppeteer-core');

const CHROMIUM_REMOTE_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v147.0.2/chromium-v147.0.2-pack.x64.tar';

const VIDNEST_BASE_URL =
  process.env.BASE_URL || 'https://vidnest.fun';

const CINESRC_BASE_URL =
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

let executablePathCache = null;

async function getExecutablePath() {
  if (!executablePathCache) {
    executablePathCache =
      await chromium.executablePath(CHROMIUM_REMOTE_URL);
  }

  return executablePathCache;
}

function buildUrl(path, base) {
  try {
    return new URL(path, base).toString();
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
      const requestHeaders = request.headers();

      const contentType = (
        response.headers()['content-type'] || ''
      )
        .split(';')[0]
        .trim()
        .toLowerCase();

      let type = null;

      if (STREAM_TYPES.hls.has(contentType)) {
        type = 'hls';
      } else if (STREAM_TYPES.dash.has(contentType)) {
        type = 'dash';
      }

      if (!type && /\.m3u8(?:[?#]|$)/i.test(responseUrl)) {
        type = 'hls';
      }

      if (!type && /\.mpd(?:[?#]|$)/i.test(responseUrl)) {
        type = 'dash';
      }

      if (!type) return;

      stream = {
        stream: responseUrl,
        origin: requestHeaders.origin || pageOrigin,
        type,
        mime: contentType
      };
    });

    // Don't let page navigation prevent the scraper from continuing.
    await page.goto(pageUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    }).catch(() => {});

    // Give the embedded player time to initialize.
    const started = Date.now();

    while (!stream && Date.now() - started < 15000) {
      await sleep(100);
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
      CINESRC_BASE_URL
    );
  }

  if (type === 'tv') {
    if (!s || !e) return null;

    return buildUrl(
      `/embed/tv/${encodeURIComponent(id)}` +
      `?s=${encodeURIComponent(s)}` +
      `&e=${encodeURIComponent(e)}`,
      CINESRC_BASE_URL
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

    const media = await getMediaUrlFromNetwork(pageUrl);

    if (!media) {
      return res.status(502).json({
        error: 'Could not locate HLS or DASH manifest'
      });
    }

    const captions = await getCaptions(
      type,
      id,
      s,
      e
    );

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

      sourceUrl: media.stream
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
};
