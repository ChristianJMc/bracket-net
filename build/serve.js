// Minimal static server for previewing site/ locally.
const http = require('http'), fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'site');
http.createServer((req, res) => {
  const f = path.join(dir, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/preview.html'));
  if (!f.startsWith(dir) || !fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(+process.env.PORT || 5173, () => console.log("listening"));
