// Tiny static server for local preview: node serve.mjs  →  http://localhost:5173
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const cors = {
  'access-control-allow-origin': 'https://soulsremnant.wiki.gg',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-private-network': 'true',
};

createServer(async (req, res) => {
  // Icon upload used when collecting sprites from the wiki tab: POST /upload?dir=monsters&name=slime.png, body = raw image bytes.
  if (req.url.startsWith('/upload')) {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
    const q = new URL(req.url, 'http://x').searchParams;
    const dir = q.get('dir') === 'items' ? 'items' : 'monsters';
    const name = (q.get('name') || '').replace(/[^a-z0-9.-]/gi, '');
    if (!/^[a-z0-9-]+\.(png|gif|webp)$/i.test(name)) { res.writeHead(400, cors).end('bad name'); return; }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    await mkdir(join(root, 'assets', dir), { recursive: true });
    await writeFile(join(root, 'assets', dir, name), Buffer.concat(chunks));
    res.writeHead(200, cors).end('ok');
    return;
  }
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(5173, () => console.log('http://localhost:5173'));
