// Production server: serves the built app from dist/ and the API from one process.
// Railway: set a volume (DATA_DIR or RAILWAY_VOLUME_MOUNT_PATH) so consults and photos survive deploys.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './api.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const api = await createApi();

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://local');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(root, `.${rel}`);
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  let stat = await fsp.stat(file).catch(() => null);
  let target = file;
  if (!stat || !stat.isFile()) {
    target = path.join(root, 'index.html'); // single-page app fallback
    stat = await fsp.stat(target).catch(() => null);
    if (!stat) {
      res.writeHead(404).end('Not built yet. Run npm run build.');
      return;
    }
  }
  const ext = path.extname(target);
  const immutable = rel.startsWith('/assets/') && /-[\w-]{8,}\./.test(rel);
  const range = req.headers.range;
  const headers = {
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : ext === '.html' || rel === '/sw.js' ? 'no-cache' : 'public, max-age=86400',
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff',
  };
  if (range && /^bytes=\d*-\d*$/.test(range)) {
    // Safari needs byte ranges to play video.
    const [s, e] = range.slice(6).split('-');
    const start = s ? Number(s) : stat.size - Number(e);
    const end = s && e ? Math.min(Number(e), stat.size - 1) : stat.size - 1;
    if (start >= stat.size || start > end) {
      res.writeHead(416, { 'content-range': `bytes */${stat.size}` }).end();
      return;
    }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': end - start + 1 });
    fs.createReadStream(target, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'content-length': stat.size });
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(target).pipe(res);
}

http
  .createServer(async (req, res) => {
    if (await api.handle(req, res)) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    await serveStatic(req, res);
  })
  .listen(port, host, () => console.log(`Ink Consult on http://${host}:${port}`));
