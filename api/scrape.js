const chromium = require('@sparticuz/chromium-min');
const puppeteer = require('puppeteer-core');

const CHROMIUM_REMOTE_URL =
    'https://github.com/Sparticuz/chromium/releases/download/v147.0.2/chromium-v147.0.2-pack.x64.tar';

const VIDNEST_URL = process.env.BASE_URL || 'https://vidnest.fun';
const CINESRC_URL = 'https://cinesrc.st';

function buildUrl(path, base) {
    try {
        return new URL(path, base).toString();
    } catch {
        return null;
    }
}

let executablePath = null;

async function getExecutablePath() {
    if (!executablePath) {
        executablePath = await chromium.executablePath(
            CHROMIUM_REMOTE_URL
        );
    }

    return executablePath;
}

async function scrapeStream(pageUrl) {
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
            'AppleWebKit/537.36 (KHTML, like Gecko) ' +
            'Chrome/120.0.0.0 Safari/537.36'
        );

        const result = await new Promise(resolve => {
            let finished = false;

            const finish = value => {
                if (finished) return;

                finished = true;
                clearTimeout(timeout);
                resolve(value);
            };

            const timeout = setTimeout(() => {
                finish(null);
            }, 30000);

            /*
             * Catch the request itself.
             *
             * This is intentionally done before page.goto(), so we
             * don't miss the first manifest request.
             */
            page.on('request', request => {
                if (finished) return;

                const url = request.url();

                if (/\.m3u8(?:[?#]|$)/i.test(url)) {
                    const headers = request.headers();

                    let pageOrigin;

                    try {
                        pageOrigin = new URL(pageUrl).origin;
                    } catch {
                        pageOrigin = pageUrl;
                    }

                    finish({
                        stream: url,
                        origin: headers.origin || pageOrigin,
                        type: 'hls',
                        mime: 'application/vnd.apple.mpegurl'
                    });
                }
            });

            /*
             * Also watch responses as a fallback.
             */
            page.on('response', response => {
                if (finished) return;

                const url = response.url();

                const contentType = (
                    response.headers()['content-type'] || ''
                )
                    .split(';')[0]
                    .trim()
                    .toLowerCase();

                const isHlsMime =
                    contentType === 'application/vnd.apple.mpegurl' ||
                    contentType === 'application/x-mpegurl' ||
                    contentType === 'audio/mpegurl' ||
                    contentType === 'audio/x-mpegurl';

                if (isHlsMime) {
                    const headers = response.request().headers();

                    let pageOrigin;

                    try {
                        pageOrigin = new URL(pageUrl).origin;
                    } catch {
                        pageOrigin = pageUrl;
                    }

                    finish({
                        stream: url,
                        origin: headers.origin || pageOrigin,
                        type: 'hls',
                        mime: contentType
                    });
                }
            });

            page.goto(pageUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            }).catch(() => {});
        });

        return result;

    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
}

async function getCaptions(type, id, s, e) {
    if (type === 'anime') {
        return [];
    }

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

        const response = await fetch(url);

        if (!response.ok) {
            return [];
        }

        const data = await response.json();

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
    if (req.method !== 'GET') {
        return res.status(405).json({
            error: 'Method Not Allowed'
        });
    }

    try {
        const { type, id, s, e, t } = req.query;

        if (!type || !id) {
            return res.status(400).json({
                error: 'Missing required type or id'
            });
        }

        let pageUrl;

        /*
         * MOVIE + TV
         * -------------------------
         * These come from CineSrc.
         */
        if (type === 'movie') {
            pageUrl = buildUrl(
                `/embed/movie/${encodeURIComponent(id)}`,
                CINESRC_URL
            );

        } else if (type === 'tv') {
            if (!s || !e) {
                return res.status(400).json({
                    error: 'Missing s or e for tv type'
                });
            }

            pageUrl = buildUrl(
                `/embed/tv/${encodeURIComponent(id)}` +
                `?s=${encodeURIComponent(s)}` +
                `&e=${encodeURIComponent(e)}`,
                CINESRC_URL
            );

        /*
         * ANIME
         * -------------------------
         * These come from VidNest.
         */
        } else if (type === 'anime') {
            if (!e || !t) {
                return res.status(400).json({
                    error: 'Missing e or t for anime type'
                });
            }

            pageUrl = buildUrl(
                `/anime/${encodeURIComponent(id)}/` +
                `${encodeURIComponent(e)}/` +
                `${encodeURIComponent(t)}/`,
                VIDNEST_URL
            );

        } else {
            return res.status(400).json({
                error: 'Invalid type; expected movie, tv, or anime'
            });
        }

        if (!pageUrl) {
            return res.status(500).json({
                error: 'Failed to build page URL'
            });
        }

        const media = await scrapeStream(pageUrl);

        if (!media) {
            return res.status(502).json({
                error: 'Could not locate HLS stream'
            });
        }

        const captions = await getCaptions(type, id, s, e);

        return res.json({
            streams: {
                corsAllowed: true,
                qualities: [
                    {
                        quality: 'auto',
                        url: media.stream
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
