const BLOCKED_HEADERS = new Set([
  'transfer-encoding',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'upgrade',
]);

module.exports = async function handler(req, res) {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ error: "Missing url" });
    }

    const targetUrl = new URL(url);

    const proxyResp = await fetch(targetUrl.toString(), {
      headers: {
        Accept: "*/*",
        "User-Agent": "Mozilla/5.0",
      }
    });

    const contentType = proxyResp.headers.get("content-type") || "";

    res.status(proxyResp.status);

    for (const [name, value] of proxyResp.headers) {
      if (!BLOCKED_HEADERS.has(name.toLowerCase())) {
        res.setHeader(name, value);
      }
    }


    if (
      contentType.includes("mpegurl") ||
      targetUrl.pathname.endsWith(".m3u8")
    ) {
      let text = await proxyResp.text();

      text = text
        .split("\n")
        .map(line => {
          line = line.trim();

          if (
            line &&
            !line.startsWith("#") &&
            !line.startsWith("http")
          ) {
            line = new URL(line, targetUrl).href;
          }

          return line;
        })
        .join("\n");

      res.setHeader("content-type", "application/vnd.apple.mpegurl");

      return res.send(text);
    }


    return res.send(Buffer.from(await proxyResp.arrayBuffer()));

  } catch (err) {
    return res.status(500).json({
      error: err.message
    });
  }
};
