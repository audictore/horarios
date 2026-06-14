/**
 * Pruebas de la capa de calidad — node --test
 *
 * Evaluadores puros (huecos de grupos, desbalance diario) contra la definición del tier 1/2, y
 * la mejora por búsqueda local del engine (reduce huecos sin romper la validez).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Cal = require('../src/calidad.js');
const E = require('../src/engine.js');
const I = require('../src/invariantes.js');

const blk = (grupo, materia, docente, dia, inicio, duracion) =>
  ({ grupo, materia, docente, turno: 'matutino', dia, inicio, duracion });

test('huecos · cuenta solo el tiempo muerto INTERCALADO', () => {
  // Lunes 1A: 7–8, 9–10, 12–13 → span 7..13 = 6, ocupadas 3 → 3 horas muertas.
  const conHuecos = [blk('1A', 'Mate', 'A', 0, 7, 1), blk('1A', 'Hist', 'B', 0, 9, 1), blk('1A', 'Ing', 'C', 0, 12, 1)];
  assert.equal(Cal.huecosDeBloques(conHuecos), 3);
  // Compacto 7–8, 8–9, 9–10 → 0.
  const compacto = [blk('1A', 'Mate', 'A', 0, 7, 1), blk('1A', 'Hist', 'B', 0, 8, 1), blk('1A', 'Ing', 'C', 0, 9, 1)];
  assert.equal(Cal.huecosDeBloques(compacto), 0);
  // Un solo bloque en el día → 0 (no hay nada que intercalar).
  assert.equal(Cal.huecosDeBloques([blk('1A', 'Mate', 'A', 0, 9, 2)]), 0);
});

test('huecos · libre antes de la 1ª y después de la última NO cuenta', () => {
  // Entra 9, sale 11: aunque el turno empiece a las 7, eso no es hueco.
  assert.equal(Cal.huecosDeBloques([blk('1A', 'Mate', 'A', 0, 9, 1), blk('1A', 'Hist', 'B', 0, 10, 1)]), 0);
});

test('desbalance · diferencia entre el día más cargado y el más ligero', () => {
  // Lunes 4h, Martes 2h → 2.
  const b = [blk('1A', 'M', 'A', 0, 7, 2), blk('1A', 'M', 'A', 0, 9, 2), blk('1A', 'N', 'B', 1, 7, 2)];
  assert.equal(Cal.desbalanceDeBloques(b), 2);
  // Un solo día → 0.
  assert.equal(Cal.desbalanceDeBloques([blk('1A', 'M', 'A', 0, 7, 2)]), 0);
});

test('evaluarCalidad · suma sobre todos los grupos', () => {
  const horario = { bloques: [
    blk('1A', 'Mate', 'A', 0, 7, 1), blk('1A', 'Hist', 'B', 0, 9, 1), // 1A: 1 hueco
    blk('2A', 'Mate', 'C', 0, 7, 1), blk('2A', 'Hist', 'D', 0, 8, 1), // 2A: 0 huecos
  ] };
  assert.deepEqual(Cal.evaluarCalidad(horario), { huecos: 1, desbalance: 0 });
});

test('compararCalidad · lexicográfico (huecos manda; luego desbalance)', () => {
  assert.ok(Cal.compararCalidad({ huecos: 1, desbalance: 0 }, { huecos: 2, desbalance: 0 }) < 0);
  assert.ok(Cal.compararCalidad({ huecos: 2, desbalance: 1 }, { huecos: 2, desbalance: 3 }) < 0);
  assert.equal(Cal.compararCalidad({ huecos: 2, desbalance: 1 }, { huecos: 2, desbalance: 1 }), 0);
});

test('optimizarCalidad · convierte un hueco en horario compacto (1 → 0)', () => {
  const sesiones = [
    { grupo: '1A', materia: 'Mate', docente: 'Ana', turno: 'matutino', duracion: 1, carga: '1A|Mate|Ana', bloque: 0 },
    { grupo: '1A', materia: 'Hist', docente: 'Bea', turno: 'matutino', duracion: 1, carga: '1A|Hist|Bea', bloque: 0 },
  ];
  const dominios = [
    [{ dia: 0, inicio: 7 }, { dia: 0, inicio: 8 }, { dia: 0, inicio: 9 }],
    [{ dia: 0, inicio: 7 }, { dia: 0, inicio: 8 }, { dia: 0, inicio: 9 }],
  ];
  const asign = [{ dia: 0, inicio: 7 }, { dia: 0, inicio: 9 }]; // 7–8 y 9–10 → hueco a las 8
  const armar = (a) => ({ bloques: sesiones.map((s, i) => ({ ...s, dia: a[i].dia, inicio: a[i].inicio })) });

  assert.equal(Cal.evaluarCalidad(armar(asign)).huecos, 1);
  E.optimizarCalidad(sesiones, dominios, asign, {});
  assert.equal(Cal.evaluarCalidad(armar(asign)).huecos, 0); // la búsqueda local compactó
});

test('resolverConCalidad · resultado válido y calidad nunca empeora', () => {
  const datos = {
    grupos: { '1A': { turno: 'matutino' } },
    docentes: {
      Ana: { disponibilidad: { 0: [7, 8, 9, 10, 11], 1: [7, 8, 9, 10, 11] } },
      Bea: { disponibilidad: { 0: [7, 8, 9, 10, 11], 1: [7, 8, 9, 10, 11] } },
    },
    cargas: [
      { grupo: '1A', materia: 'Mate', docente: 'Ana', turno: 'matutino', horas: 3 },
      { grupo: '1A', materia: 'Hist', docente: 'Bea', turno: 'matutino', horas: 3 },
    ],
  };
  const r = E.resolverConCalidad(datos);
  assert.ok(r.ok);
  // Sigue siendo válido (oráculo de invariantes).
  const disponibilidad = { Ana: datos.docentes.Ana.disponibilidad, Bea: datos.docentes.Bea.disponibilidad };
  const requeridas = { '1A|Mate|Ana': 3, '1A|Hist|Bea': 3 };
  assert.deepEqual(I.verificarTodo({ bloques: r.horario.bloques, disponibilidad, requeridas }), []);
  // La calidad final no empeora respecto a la inicial.
  assert.ok(Cal.compararCalidad(r.calidad, r.calidadInicial) <= 0);
});
