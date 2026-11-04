import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

// Minimal JSON router plus static files. routes: { 'GET /path': async (body) => result }
export function serve(port, routes, staticDir) {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const handler = routes[`${req.method} ${path}`];
    if (handler) return respond(res, handler, req);
    if (staticDir && req.method === 'GET') return sendFile(res, staticDir, path);
    res.writeHead(404).end();
  });
  server.listen(port, () => console.log(`listening on http://localhost:${port}`));
  return server;
}

async function respond(res, handler, req) {
  try {
    const result = await handler(await readBody(req));
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(result));
  } catch (err) {
    console.error(err);
    res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: err.message }));
  }
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function sendFile(res, dir, path) {
  const file = normalize(join(dir, path === '/' ? 'index.html' : path));
  if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}
