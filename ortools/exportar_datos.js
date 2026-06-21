'use strict';
/**
 * Exporta la plantilla real (Carga Académica + Disponibilidades) a datos_horarios.json
 * para alimentar el modelo CP-SAT (ortools/cp_horarios.py).
 *
 * Uso:
 *   node ortools/exportar_datos.js [rutaCarga.xlsx] [rutaDisponibilidad.xlsx]
 * Sin argumentos usa las rutas por defecto del usuario en el Escritorio.
 * Reusa el mismo parseo que la app (tools/cargarReales.js → tools/leerXlsx.js).
 */
const path = require('path');
const fs = require('fs');
const { cargarDatos } = require(path.join(__dirname, '..', 'tools', 'cargarReales.js'));

const RC = process.argv[2] || 'C:/Users/Alonzo/Desktop/Horarios/Carga Académica mayo-agosto 2026.xlsx';
const RD = process.argv[3] || 'C:/Users/Alonzo/Desktop/Horarios/Disponibilidades de horarios.xlsx';

const d = cargarDatos(RC, RD);

// Carga total por docente (base del escalón de días de los PA).
const cargaDoc = {};
for (const c of d.cargas) cargaDoc[c.docente] = (cargaDoc[c.docente] || 0) + c.horas;
// maxDias de un PA = escalón institucional (≤9h→2, ≤20→3, 21+→4) subiendo 1 día si el
// peor día del top-N no cubre la carga media + 1h de holgura (tope 4). Replica
// calcularMaxDias() + el ajuste de calcularDiasDocentes() del index.html.
function maxDiasPA(carga, sizes) {
  let md = carga <= 9 ? 2 : carga <= 20 ? 3 : 4;
  const ord = sizes.slice().sort((a, b) => b - a);
  const conDisp = ord.filter(n => n > 0).length;
  while (conDisp > md && md < 4) {
    if (ord[md - 1] >= Math.ceil(carga / md) + 1) break;
    md++;
  }
  return md;
}

const docentes = {};
for (const [nombre, info] of Object.entries(d.docentes)) {
  const disp = {};
  for (let dia = 0; dia < 6; dia++) disp[dia] = [...(info.disponibilidad[dia] || [])].sort((a, b) => a - b);
  let maxDias = null; // PTC / Inglés: sin límite de días (solo su disponibilidad)
  if (info.tipo === 2) { // PA: límite por escalón ajustado
    const sizes = [0, 1, 2, 3, 4, 5].map(dia => (info.disponibilidad[dia] || []).length);
    maxDias = maxDiasPA(cargaDoc[nombre] || 0, sizes);
  }
  docentes[nombre] = { tipo: info.tipo, maxDias, disponibilidad: disp };
}
const salida = {
  ventanas: { matutino: [7, 17], vespertino: [12, 21] },
  grupos: d.grupos,
  docentes,
  cargas: d.cargas,
};
const out = path.join(__dirname, 'datos_horarios.json');
fs.writeFileSync(out, JSON.stringify(salida, null, 1));
const ing = d.cargas.filter(c => c.sync).length;
console.log(`Exportado ${out}`);
console.log(`  ${Object.keys(salida.grupos).length} grupos, ${Object.keys(docentes).length} docentes, ${d.cargas.length} cargas (${ing} con inglés sync), ${d.cargas.reduce((s, c) => s + c.horas, 0)}h.`);
