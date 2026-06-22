const http = require('http');
const fs   = require('fs');
const path = require('path');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript',
    '.css':  'text/css',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.wasm': 'application/wasm',
    '.json': 'application/json; charset=utf-8',
};

http.createServer((req, res) => {
    // COOP + COEP: requerido para SharedArrayBuffer en todos los navegadores modernos
    res.setHeader('Cross-Origin-Opener-Policy',   'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

    const urlPath  = req.url.split('?')[0].split('#')[0];
    const filePath = path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath);
    const ext      = path.extname(filePath).toLowerCase();

    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    });
}).listen(3131, () =>
    console.log('From Schedule ▶  http://localhost:3131  (COOP+COEP activo — SharedArrayBuffer habilitado)')
);
