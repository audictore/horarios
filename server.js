const http = require('http');
const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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

const ORTOOLS = path.join(__dirname, 'ortools');
// Ruta Windows → ruta WSL:  C:\a\b  →  /mnt/c/a/b
const toWSL = (p) => '/mnt/' + p[0].toLowerCase() + p.slice(2).replace(/\\/g, '/');

const json = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
};

/** Ejecuta CP-SAT (OR-Tools) en WSL sobre datos_horarios.json y responde con horario_cp.json. */
function ejecutarCPSAT(datos, res) {
    let datosCP;
    try {
        // El navegador envía { ventanas, grupos, docentes, cargas } listos para el modelo.
        datosCP = JSON.stringify(datos, null, 1);
    } catch (e) { return json(res, 400, { ok: false, error: 'Datos inválidos: ' + e.message }); }

    try { fs.writeFileSync(path.join(ORTOOLS, 'datos_horarios.json'), datosCP, 'utf8'); }
    catch (e) { return json(res, 500, { ok: false, error: 'No se pudo escribir datos_horarios.json: ' + e.message }); }

    const outJson = path.join(ORTOOLS, 'horario_cp.json');
    try { fs.unlinkSync(outJson); } catch (e) { /* no existía: ok */ }

    const mt = datos && datos.maxTime ? 'CP_MAX_TIME=' + parseInt(datos.maxTime, 10) + ' ' : '';
    const cmd = "cd '" + toWSL(ORTOOLS) + "' && " + mt + 'python3 cp_horarios.py';
    const child = spawn('wsl', ['bash', '-lc', cmd], { windowsHide: true });

    let err = '';
    child.stdout.on('data', (d) => process.stdout.write(d));            // log al servidor
    child.stderr.on('data', (d) => { err += d; process.stderr.write(d); });
    child.on('error', (e) =>
        json(res, 500, { ok: false, error: 'No se pudo iniciar WSL/CP-SAT (¿WSL instalado?): ' + e.message }));
    child.on('close', (code) => {
        fs.readFile(outJson, 'utf8', (e, data) => {
            if (e) return json(res, 500, { ok: false, error: 'CP-SAT no generó resultado (código ' + code + ').\n' + err.slice(-800) });
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(data);   // ya es el JSON {ok,colocadas,total,horario,...} de cp_horarios.py
        });
    });
}

const server = http.createServer((req, res) => {
    // COOP + COEP: requerido para SharedArrayBuffer (motor metaheurístico en Workers).
    res.setHeader('Cross-Origin-Opener-Policy',   'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

    const urlPath = req.url.split('?')[0].split('#')[0];

    // ── API: motor ÓPTIMO local (CP-SAT) ─────────────────────────────────────
    if (urlPath === '/api/health') return json(res, 200, { ok: true, motor: 'cp-sat' });
    if (urlPath === '/api/optimo' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 5e7) req.destroy(); });
        req.on('end', () => {
            let datos; try { datos = JSON.parse(body); } catch (e) { return json(res, 400, { ok: false, error: 'JSON inválido' }); }
            ejecutarCPSAT(datos, res);
        });
        return;
    }

    // ── Estáticos ────────────────────────────────────────────────────────────
    const filePath = path.join(__dirname, urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath));
    const ext = path.extname(filePath).toLowerCase();
    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    });
});

// El solve CP-SAT puede tardar ~5 min: desactivar timeouts que cortarían la petición.
server.requestTimeout = 0;
server.timeout = 0;
server.headersTimeout = 0;

server.listen(3131, () =>
    console.log('From Schedule ▶  http://localhost:3131  (COOP+COEP · motor ÓPTIMO CP-SAT en /api/optimo)')
);
