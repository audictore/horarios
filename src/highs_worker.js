/* Web Worker: resuelve el horario con HiGHS (WASM) en un hilo aparte, para que la
 * página no se congele durante los ~40s del solver. Rutas relativas a /src/.
 * Mensaje de entrada: los `datos` ({ventanas, docentes, cargas}).
 * Mensaje de salida:  { ok, status, colocadas, total, horario, ms } o { ok:false, error }. */
importScripts('../lib/highs/highs.js');   // define self.Module (factory de Emscripten/HiGHS)
importScripts('highs_solver.js');         // define self.HighsSolver

// Cargar el WASM una sola vez (locateFile apunta al .wasm vendorizado).
const highsReady = Module({ locateFile: (f) => '../lib/highs/' + f });

self.onmessage = async (e) => {
  try {
    const highs = await highsReady;
    const r = self.HighsSolver.resolver(highs, e.data);
    self.postMessage(Object.assign({ ok: true }, r));
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
};
