const TMDB_API_KEY = process.env.TMDB_API_KEY || '34928409ba993b18e5692ff675303cdf';
const ALLOWED_TMDB_HOST = 'api.themoviedb.org';

module.exports = async function handler(req, res) {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'Missing required url parameter' });
    }

    let targetUrl;
    try {
      targetUrl = new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    if (targetUrl.protocol !== 'https:' || targetUrl.hostname !== ALLOWED_TMDB_HOST) {
      return res.status(400).json({ error: 'Only TMDB API requests are allowed' });
    }

    targetUrl.searchParams.set('api_key', TMDB_API_KEY);

    const tmdbResp = await fetch(targetUrl.toString(), {
      headers: { Accept: 'application/json' },
    });

    const body = await tmdbResp.text();
    if (!tmdbResp.ok) {
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = { error: 'TMDB request failed' }; }
      return res.status(tmdbResp.status).json(parsed);
    }

    return res.json(JSON.parse(body));
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
