const http = require('node:http');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.webp': 'image/webp',
};

async function findFile(root, target) {
  try {
    const file = await fs.realpath(path.join(root, target));
    const relative = path.relative(root, file);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return null;
    }
    const stat = await fs.stat(file);
    return stat.isFile() ? { file, size: stat.size } : null;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code)) return null;
    throw error;
  }
}

async function serve(root, req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  let target;
  try {
    // Read the raw request path, before URL normalization can erase dot segments.
    target = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (!target.startsWith('/') || /[\\\x00-\x1f\x7f]/.test(target) || target.split('/').includes('..')) {
    res.writeHead(403).end();
    return;
  }
  const asset = target.startsWith('/assets/');
  let file = await findFile(root, target);
  if (!file && !Object.hasOwn(mimeTypes, path.extname(target).toLowerCase())) {
    file = await findFile(root, 'index.html');
  }
  if (!file) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': mimeTypes[path.extname(file.file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': file.size,
    'Cache-Control': file.file === path.join(root, 'index.html')
      ? 'no-cache'
      : asset ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') res.end();
  else await pipeline(createReadStream(file.file), res);
}

async function startStaticServer(webDistDir) {
  const root = await fs.realpath(webDistDir);
  if (!await findFile(root, 'index.html')) throw new Error(`No desktop web build in ${webDistDir}.`);
  const server = http.createServer((req, res) => {
    serve(root, req, res).catch(() => {
      if (!res.headersSent && !res.destroyed) res.writeHead(500).end();
      else res.destroy();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  let closing;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close() {
      closing ??= new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
      return closing;
    },
  };
}

module.exports = { startStaticServer };
