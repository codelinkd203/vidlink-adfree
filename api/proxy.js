const BLOCKED_HEADERS = new Set([
  'transfer-encoding', 'connection', 'keep-alive',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'upgrade',
]);

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

    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return res.status(400).json({ error: 'Proxy only supports http(s) URLs' });
    }

    const proxyResp = await fetch(targetUrl.toString(), {
      headers: { Accept: '*/*', 'User-Agent': 'Mozilla/5.0 (Node.js)' },
    });

    res.status(proxyResp.status);
    for (const [name, value] of proxyResp.headers) {
      if (!BLOCKED_HEADERS.has(name.toLowerCase())) {
        res.setHeader(name, value);
      }
    }

    return res.send(Buffer.from(await proxyResp.arrayBuffer()));
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
