const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  const relative = path.normalize(pathname.replace(/^[/\\]+/, '')) || 'index.html';
  const file = path.resolve(root, relative);
  const check = path.relative(root, file);
  if (check.startsWith('..') || path.isAbsolute(check)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file.endsWith(path.sep) ? path.join(file, 'index.html') : file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const contentType = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.end(data);
  });
});
const port = Number(process.argv[2] || 4173);
server.listen(port, '127.0.0.1', () => console.log(`ALU Gallery at http://localhost:${port}`));
