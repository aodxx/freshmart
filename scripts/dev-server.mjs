import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const host = process.env.HOST || '127.0.0.1';
const port = Number.parseInt(process.env.PORT || '4173', 10);

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.webp', 'image/webp']
]);

function localPath(requestUrl) {
  try {
    const pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
    const candidate = resolve(root, `.${normalize(pathname)}`);
    return candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : null;
  } catch {
    return null;
  }
}

async function existingFile(candidate) {
  try {
    const details = await stat(candidate);
    if (details.isDirectory()) {
      const indexFile = join(candidate, 'index.html');
      return (await stat(indexFile)).isFile() ? indexFile : null;
    }
    return details.isFile() ? candidate : null;
  } catch {
    return null;
  }
}

const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method || '')) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method Not Allowed');
    return;
  }

  const candidate = localPath(request.url || '/');
  const target = candidate ? await existingFile(candidate) : null;

  if (!target) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
    return;
  }

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': contentTypes.get(extname(target).toLowerCase()) || 'application/octet-stream'
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  createReadStream(target).pipe(response);
});

server.listen(port, host, () => {
  console.log(`FreshMart development server: http://${host}:${port}`);
  console.log(`Admin PWA: http://${host}:${port}/admin/`);
});
