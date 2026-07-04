const chromium = require('@sparticuz/chromium-min');
const puppeteer = require('puppeteer-core');

// Chromium binary is downloaded at runtime — keeps the npm package tiny for Vercel builds.
const CHROMIUM_REMOTE_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v147.0.2/chromium-v147.0.2-pack.x64.tar';

const BASE_URL = process.env.BASE_URL || 'https://vidlink.pro';
if (!BASE_URL) throw new Error('BASE_URL environment variable is required');

function buildUrl(candidate, base) {
  try { return new URL(candidate, base).toString(); } catch { return null; }
}

function normalizeQualityKey(key) {
  return /^\d+$/.test(key) ? `${key}p` : key;
}

function cleanTracks(captions) {
  if (!Array.isArray(captions)) return [];
  return captions
    .filter((item) => item && item.url)
    .map((item) => ({
      language: item.language || item.lang || item.label || 'unknown',
      url: item.url,
    }));
}

function transformData(raw) {
  const stream = raw.stream || raw;
  const captions = stream.captions || raw.captions || [];
  const flags = Array.isArray(raw.flags)
    ? raw.flags
    : Array.isArray(stream.flags) ? stream.flags : [];
  const corsAllowed = flags.includes('cors-allowed');

  let qualities = [];
  if (stream.qualities && typeof stream.qualities === 'object') {
    qualities = Object.entries(stream.qualities)
      .map(([key, value]) => ({
        quality: normalizeQualityKey(key),
        url: value && value.url ? value.url : null,
      }))
      .filter((item) => item.url)
      .sort((a, b) => (parseInt(a.quality, 10) || 0) - (parseInt(b.quality, 10) || 0));
  } else if (stream.url) {
    qualities = [{ quality: stream.type === 'hls' ? 'hls' : 'auto', url: stream.url }];
  }

  return {
    streams: { corsAllowed, qualities },
    captions: { corsAllowed, tracks: cleanTracks(captions) },
  };
}

// Cache the executable path across warm Lambda invocations to skip re-downloading.
let _executablePath = null;
async function getExecutablePath() {
  if (!_executablePath) {
    _executablePath = await chromium.executablePath(CHROMIUM_REMOTE_URL);
  }
  return _executablePath;
}

// Resource types that add no value to finding the /api/b/ URL.
const BLOCKED_TYPES = new Set(['image', 'media', 'font', 'stylesheet', 'other', 'ping', 'manifest']);

async function getApiBUrlFromNetwork(pageUrl) {
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
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Intercept every request so we can block junk and bail early.
    await page.setRequestInterception(true);

    const apiUrl = await new Promise((resolve, reject) => {
      // Hard ceiling — don't let a slow page hang the function forever.
      const timer = setTimeout(() => resolve(null), 25000);

      page.on('request', (req) => {
        const url = req.url();

        // Found it — capture and abort the request (we'll fetch it ourselves).
        if (/\/api\/b\//i.test(url)) {
          clearTimeout(timer);
          req.abort();
          resolve(url);
          return;
        }

        // Drop everything that can't contain the API call.
        if (BLOCKED_TYPES.has(req.resourceType())) {
          req.abort();
        } else {
          req.continue();
        }
      });

      // Use domcontentloaded — we don't need the page to fully settle.
      page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 25000 })
        .catch(() => {}); // navigation "errors" are expected when we abort requests
    });

    return apiUrl;
  } catch (error) {
    throw new Error(`Puppeteer navigation failed: ${error.message}`);
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = async function handler(req, res) {
  try {
    const { type, id, s, e } = req.query;
    if (!type || !id) {
      return res.status(400).json({ error: 'Missing required type or id' });
    }

    let pagePath;
    if (type === 'movie') {
      pagePath = `/movie/${encodeURIComponent(id)}/`;
    } else if (type === 'tv') {
      if (!s || !e) return res.status(400).json({ error: 'Missing s or e for tv type' });
      pagePath = `/tv/${encodeURIComponent(id)}/${encodeURIComponent(s)}/${encodeURIComponent(e)}/`;
    } else {
      return res.status(400).json({ error: 'Invalid type; expected movie or tv' });
    }

    const pageUrl = buildUrl(pagePath, BASE_URL);
    if (!pageUrl) return res.status(500).json({ error: 'Failed to build page URL' });

    const apiUrl = await getApiBUrlFromNetwork(pageUrl);
    if (!apiUrl) {
      return res.status(502).json({ error: 'Could not locate /api/b/ endpoint from network requests' });
    }

    const apiResp = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Node.js)',
        Accept: 'application/json, text/plain, */*',
      },
    });

    if (!apiResp.ok) {
      return res.status(apiResp.status).send(await apiResp.text());
    }

    const data = transformData(await apiResp.json());
    data.sourceUrl = apiUrl;
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
