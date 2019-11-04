const { join } = require('path');
const express = require('express');
const next = require('next');
const cache = require('lru-cache'); // for using least-recently-used based caching
const https = require('https');
const { parse } = require('url');
const { readFileSync } = require('fs');

const PORT = 8000;
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const ssrCache = new cache({
  max: 20, // not more than 20 results will be cached
  maxAge: 1000 * 60 * 5, // 5 mins
});

const httpsOptions = {
  key: readFileSync('./certificates/server.key'),
  cert: readFileSync('./certificates/server.crt')
};

app.prepare().then(() => {
  // const server = createServer(httpsOptions)
  // const server = https.createServer(httpsOptions, (req, res) => {
  //   const parsedUrl = parse(req.url, true);
  //   handle(req, res, parsedUrl);
  // })
  const server = express();
  const httpsServer = https.createServer(httpsOptions, server)

  server.get('/', (req, res) => {
    renderAndCache(req, res, '/');
  });

  server.get('/movie/:id', (req, res) => {
    const queryParams = { id: req.params.id };
    renderAndCache(req, res, '/movie', queryParams);
  });

  server.get('*', (req, res) => {
    if (req.url.includes('/sw')) {
      const filePath = join(__dirname, 'static', 'workbox', 'sw.js');
      app.serveStatic(req, res, filePath);
    } else if (req.url.startsWith('static/workbox/')) {
      app.serveStatic(req, res, join(__dirname, req.url));
    } else {
      handle(req, res, req.url);
    }
  });

  httpsServer.listen(PORT, err => {
    if (err) throw err;
    console.log(`> Live @ https://localhost:${PORT}`);
  });
});

async function renderAndCache(req, res, pagePath, queryParams) {
  const key = req.url;

  // if page is in cache, server from cache
  if (ssrCache.has(key)) {
    res.setHeader('x-cache', 'HIT');
    res.send(ssrCache.get(key));
    return;
  }

  try {
    // if not in cache, render the page into HTML
    const html = await app.renderToHTML(req, res, pagePath, queryParams);

    // if something wrong with the request, let's skip the cache
    if (res.statusCode !== 200) {
      res.send(html);
      return;
    }

    ssrCache.set(key, html);

    res.setHeader('x-cache', 'MISS');
    res.send(html);
  } catch (err) {
    app.renderError(err, req, res, pagePath, queryParams);
  }
}
