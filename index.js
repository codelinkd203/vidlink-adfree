const fs = require('fs');
const path = require('path');
const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const port = process.env.PORT || 3000;

const envPath = path.join(__dirname, 'env.txt');
const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const baseUrl = envText.split(/\r?\n/)[0].trim();

const TMDB_API_KEY = '34928409ba993b18e5692ff675303cdf';
const ALLOWED_TMDB_HOST = 'api.themoviedb.org';

if (!baseUrl) {
  throw new Error('env.txt must contain a base URL on the first line');
}

const publicFolder = path.join(__dirname, 'public');
app.use(express.static(publicFolder));

app.get(['/movie/:id', '/movie/:id/'], (req, res) => {
  res.sendFile(path.join(publicFolder, 'player.html'));
});

app.get(['/tv/:id/:s/:e', '/tv/:id/:s/:e/'], (req, res) => {
  res.sendFile(path.join(publicFolder, 'player.html'));
});

function buildUrl(candidate, base) {
  try {
    return new URL(candidate, base).toString();
  } catch (error) {
    return null;
  }
}

async function getApiBUrlFromNetwork(pageUrl) {
  let browser;
  let apiUrl = null;

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    });

    page.on('request', (request) => {
      const url = request.url();
      if (/\/api\/b\//i.test(url)) {
        apiUrl = url;
      }
    });

    await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    if (!apiUrl) {
      const requests = await page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
      );
      apiUrl = requests.find((url) => /\/api\/b\//i.test(url)) || null;
    }
  } catch (error) {
    throw new Error(`Puppeteer navigation failed: ${error.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  return apiUrl;
}

function normalizeQualityKey(key) {
  if (/^\d+$/.test(key)) {
    return `${key}p`;
  }
  return key;
}

function cleanTracks(captions) {
  if (!Array.isArray(captions)) {
    return [];
  }
  return captions
    .filter((item) => item && item.url)
    .map((item) => ({
      language: item.language || item.lang || item.label || 'unknown',
      url: item.url,
    }));
}

app.get('/api/tmdb', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'Missing required url parameter' });
    }

    let targetUrl;
    try {
      targetUrl = new URL(url);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    if (targetUrl.protocol !== 'https:' || targetUrl.hostname !== ALLOWED_TMDB_HOST) {
      return res.status(400).json({ error: 'Only TMDB API requests are allowed' });
    }

    targetUrl.searchParams.set('api_key', TMDB_API_KEY);

    const tmdbResp = await fetch(targetUrl.toString(), {
      headers: {
        Accept: 'application/json',
      },
    });

    const body = await tmdbResp.text();
    if (!tmdbResp.ok) {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = { error: 'TMDB request failed' };
      }
      return res.status(tmdbResp.status).json(parsed);
    }

    const data = JSON.parse(body);
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

app.get('/api/proxy', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'Missing required url parameter' });
    }

    let targetUrl;
    try {
      targetUrl = new URL(url);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return res.status(400).json({ error: 'Proxy only supports http(s) URLs' });
    }

    const proxyResp = await fetch(targetUrl.toString(), {
      headers: {
        Accept: '*/*',
        'User-Agent': 'Mozilla/5.0 (Node.js)',
      },
    });

    res.status(proxyResp.status);
    for (const [name, value] of proxyResp.headers) {
      const lower = name.toLowerCase();
      if (
        ['transfer-encoding', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'upgrade'].includes(lower)
      ) {
        continue;
      }
      res.setHeader(name, value);
    }

    const buffer = Buffer.from(await proxyResp.arrayBuffer());
    return res.send(buffer);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

function transformData(raw) {
  const stream = raw.stream || raw;
  const captions = stream.captions || raw.captions || [];
  const flags = Array.isArray(raw.flags) ? raw.flags : Array.isArray(stream.flags) ? stream.flags : [];
  const corsAllowed = flags.includes('cors-allowed');

  let qualities = [];
  if (stream.qualities && typeof stream.qualities === 'object') {
    qualities = Object.entries(stream.qualities)
      .map(([key, value]) => ({
        quality: normalizeQualityKey(key),
        url: value && value.url ? value.url : null,
      }))
      .filter((item) => item.url)
      .sort((a, b) => {
        const numA = parseInt(a.quality, 10) || 0;
        const numB = parseInt(b.quality, 10) || 0;
        return numA - numB;
      });
  } else if (stream.url) {
    qualities = [
      {
        quality: stream.type === 'hls' ? 'hls' : 'auto',
        url: stream.url,
      },
    ];
  }

  return {
    streams: {
      corsAllowed,
      qualities,
    },
    captions: {
      corsAllowed,
      tracks: cleanTracks(captions),
    },
  };
}

app.get('/api/scrape', async (req, res) => {
  try {
    const { type, id, s, e } = req.query;
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
    } else {
      return res.status(400).json({ error: 'Invalid type; expected movie or tv' });
    }

    const pageUrl = buildUrl(pagePath, baseUrl);
    if (!pageUrl) {
      return res.status(500).json({ error: 'Failed to build page URL' });
    }

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
      const text = await apiResp.text();
      return res.status(apiResp.status).send(text);
    }

    const json = await apiResp.json();
    const data = transformData(json);
    data.sourceUrl = apiUrl;
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.clear();
const PORT = process.env.PORT || 3000;
const url = `http://localhost:${PORT}`;

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
};

// real clickable terminal link (Ctrl/Cmd + click)
function link(text, href) {
  return `\x1b]8;;${href}\x07${text}\x1b]8;;\x07`;
}

function clear() {
  process.stdout.write("\x1b[2J\x1b[H");
}

function render() {
  clear();

  const title = `${C.green}✔${C.reset} Server running`;
  const local = `${C.cyan}➜${C.reset} Local   ${link(url, url)}`;
  const port = `${C.cyan}➜${C.reset} Port    ${PORT}`;
  const hint = `${C.dim}Ctrl+C to stop${C.reset}`;

  console.log();
  console.log("  " + title);
  console.log();
  console.log("  " + local);
  console.log("  " + port);
  console.log();
  console.log("  " + hint);
  console.log();
}

process.on("SIGINT", () => {
  clear();
  console.log(`${C.green}✔${C.reset} Server stopped.`);
  process.exit(0);
});

process.stdout.on("resize", render);

render();
});
