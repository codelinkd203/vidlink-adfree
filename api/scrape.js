const chromium = require('@sparticuz/chromium-min');
const puppeteer = require('puppeteer-core');

// Chromium binary is downloaded at runtime — keeps the npm package tiny for Vercel builds.
const CHROMIUM_REMOTE_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v147.0.2/chromium-v147.0.2-pack.x64.tar';

const BASE_URL = process.env.BASE_URL || 'https://vidnest.fun';
if (!BASE_URL) throw new Error('BASE_URL environment variable is required');

function buildUrl(candidate, base) {
  try { return new URL(candidate, base).toString(); } catch { return null; }
}

// Cache the executable path across warm Lambda invocations to skip re-downloading.
let _executablePath = null;
async function getExecutablePath() {
  if (!_executablePath) {
    _executablePath = await chromium.executablePath(CHROMIUM_REMOTE_URL);
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
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
    );

    const mediaUrl = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 30000);

      page.on('request', req => {
        const url = req.url();

        const type = req.resourceType();

        const valid =
          type === 'media' ||
          /\.m3u8(\?|$)/i.test(url) ||
          /\.mp4(\?|$)/i.test(url) ||
          /\.m4s(\?|$)/i.test(url);

        if (valid) {
          clearTimeout(timer);
          resolve(url);
        }
      });

      page.goto(pageUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      }).catch(() => {});
    });

    return mediaUrl;

  } finally {
    if (browser) await browser.close();
  }
}

async function getCaptions(type, id, s, e) {
  if (type === 'anime') return [];

  try {
    let url;

    if (type === 'movie') {
      url = `https://sub.vdrk.site/v2/movie/${encodeURIComponent(id)}`;
    } else if (type === 'tv') {
      url = `https://sub.vdrk.site/v2/tv/${encodeURIComponent(id)}/${encodeURIComponent(s)}/${encodeURIComponent(e)}`;
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

module.exports = async function handler(req, res) {
  try {
    const { type, id, s, e, t } = req.query;
    if (!type || !id) {
      return res.status(400).json({ error: 'Missing required type or id' });
    }

    let pagePath;

if (type === 'movie') {
  pagePath = `/movie/${encodeURIComponent(id)}/`;

} else if (type === 'tv') {
  if (!s || !e) {
    return res.status(400).json({ error: 'Missing s or e for tv type' });
  }

  pagePath = `/tv/${encodeURIComponent(id)}/${encodeURIComponent(s)}/${encodeURIComponent(e)}/`;

} else if (type === 'anime') {
  if (!e || !t) {
    return res.status(400).json({ error: 'Missing e or t for anime type' });
  }

  pagePath = `/anime/${encodeURIComponent(id)}/${encodeURIComponent(e)}/${encodeURIComponent(t)}/`;
  
} else {
  return res.status(400).json({
    error: 'Invalid type; expected movie, tv, or anime'
  });
}

    const pageUrl = buildUrl(pagePath, BASE_URL);
    if (!pageUrl) return res.status(500).json({ error: 'Failed to build page URL' });

    const mediaUrl = await getMediaUrlFromNetwork(pageUrl);

if (!mediaUrl) {
  return res.status(502).json({
    error: 'Could not locate media URL'
  });
}

const captions = await getCaptions(type, id, s, e);

    return res.json({
      streams: {
        corsAllowed: true,
        qualities: [
          {
            quality: "auto",
            url: mediaUrl
          }
        ]
      },
      captions: {
        corsAllowed: true,
        tracks: captions
      },
      sourceUrl: mediaUrl
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
};
