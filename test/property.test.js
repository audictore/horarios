/**
 * Pruebas de propiedad — node --test
 *
 * Genera muchos datasets aleatorios (factibles por construcción: disponibilidad amplia y cargas
 * modestas) y verifica que **toda** salida del engine cumple el oráculo de invariantes, es
 * determinista, y que la mejora de calidad nunca rompe la validez ni empeora la calidad.
 *
 * Sin dependencias: PRNG (mulberry32) con SEMILLA FIJA → fallos reproducibles. Si una propiedad
 * se viola, el mensaje incluye el dataset exacto para depurar.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const I = require('../src/invariantes.js');
const Cal = require('../src/calidad.js');

function prng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ri = (rng, a, b) => a + Math.floor(rng() * (b - a + 1)); // entero en [a,b]
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

/** Dataset aleatorio factible: disponibilidad amplia (6 días, 7–19h) y cargas modestas por grupo. */
function genDataset(rng) {
  const nDoc = ri(rng, 2, 4), nGrp = ri(rng, 2, 4);
  const dispAmplia = {};
  for (let d = 0; d < 6; d++) dispAmplia[d] = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

  const docentes = {};
  for (let t = 0; t < nDoc; t++) docentes['T' + t] = { tipo: pick(rng, [1, 2, 3]), disponibilidad: dispAmplia };

  const grupos = {}, cargas = [];
  for (let g = 0; g < nGrp; g++) {
    const gn = 'G' + g;
    const turno = pick(rng, ['matutino', 'vespertino']);
    grupos[gn] = { turno };
    let total = 0;
    const nMat = ri(rng, 1, 3);
    for (let m = 0; m < nMat; m++) {
      const horas = ri(rng, 2, 4);
      if (total + horas > 8) break; // tope por grupo → siempre cabe en la ventana
      total += horas;
      cargas.push({ grupo: gn, materia: 'M' + m, docente: 'T' + ri(rng, 0, nDoc - 1), turno, horas });
    }
  }
  return { grupos, docentes, cargas };
}

function oraculo(datos, horario) {
  const disponibilidad = {};
  for (const d in datos.docentes) disponibilidad[d] = datos.docentes[d].disponibilidad;
  const requeridas = {};
  for (const c of datos.cargas) requeridas[`${c.grupo}|${c.materia}|${c.docente}`] = c.horas;
  return I.verificarTodo({ bloques: horario.bloques, disponibilidad, requeridas });
}

test('property · toda salida factible cumple los invariantes y es determinista (200 casos)', () => {
  const rng = prng(0x5C4ED);
  for (let i = 0; i < 200; i++) {
    const datos = genDataset(rng);
    const ctx = `caso ${i} · ${JSON.stringify(datos)}`;
    const r = E.resolverFactible(datos);
    assert.ok(r.ok, `debe ser factible — ${ctx}`);
    const viol = oraculo(datos, r.horario);
    assert.deepEqual(viol, [], `invariantes violados ${JSON.stringify(viol.slice(0, 2))} — ${ctx}`);
    // Conservación de horas (todas las sesiones colocadas).
    assert.equal(r.horario.bloques.length, r.sesiones.length, `sesiones sin colocar — ${ctx}`);
    // Determinismo.
    assert.deepEqual(E.resolverFactible(datos).horario, r.horario, `no determinista — ${ctx}`);
  }
});

test('property · resolverConCalidad mantiene la validez y no empeora la calidad (150 casos)', () => {
  const rng = prng(0xCA11DAD);
  for (let i = 0; i < 150; i++) {
    const datos = genDataset(rng);
    const ctx = `caso ${i} · ${JSON.stringify(datos)}`;
    const r = E.resolverConCalidad(datos);
    assert.ok(r.ok, `factible — ${ctx}`);
    assert.deepEqual(oraculo(datos, r.horario), [], `validez tras optimizar — ${ctx}`);
    assert.ok(Cal.compararCalidad(r.calidad, r.calidadInicial) <= 0, `la calidad empeoró — ${ctx}`);
  }
});
