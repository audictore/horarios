/**
 * Exporta tools/horario.json (salida del motor CP) a un .xlsx con una hoja por grupo (rejilla
 * HORA × días), igual que el horario de la app. Uso:
 *   node tools/exportarHorario.js [salida.xlsx]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { escribirXlsx } = require('./escribirXlsx.js');

const DIAS = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'];
const salida = process.argv[2] || path.join(__dirname, 'Horario_CP.xlsx');

const { grupos, bloques, ventanas } = JSON.parse(fs.readFileSync(path.join(__dirname, 'horario.json'), 'utf8'));

const hojas = {};
for (const g of Object.keys(grupos).sort()) {
  const turno = grupos[g].turno;
  const [h0, h1] = ventanas[turno];
  const propios = bloques.filter((b) => b.grupo === g);
  const filas = [['HORA', ...DIAS]];
  for (let h = h0; h < h1; h++) {
    const fila = [`${h}:00 - ${h + 1}:00`];
    for (let dia = 0; dia < 6; dia++) {
      const b = propios.find((x) => x.dia === dia && x.inicio <= h && h < x.inicio + x.duracion);
      fila.push(b ? `${b.materia} (${b.docente})` : '');
    }
    filas.push(fila);
  }
  // Resumen por materia al pie.
  filas.push([]);
  filas.push(['MATERIA', 'DOCENTE', 'HORAS']);
  const porMateria = new Map();
  propios.forEach((b) => { const k = b.materia + '|' + b.docente; porMateria.set(k, (porMateria.get(k) || 0) + b.duracion); });
  [...porMateria.entries()].sort().forEach(([k, hrs]) => { const [m, doc] = k.split('|'); filas.push([m, doc, `${hrs}h`]); });
  const totalH = propios.reduce((s, b) => s + b.duracion, 0);
  filas.push(['TOTAL', '', `${totalH}h`]);
  hojas[g] = filas;
}

escribirXlsx(salida, hojas);
console.log(`✓ ${Object.keys(hojas).length} hojas escritas en ${salida}`);
