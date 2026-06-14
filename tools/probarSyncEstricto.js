/**
 * Verificación de la sincronización ESTRICTA del inglés (réplica fiel de sincronizarGrupos con
 * estricto=true) sobre las disponibilidades reales. Confirma que el inglés de cada cuatrimestre
 * se coloca COMPLETO y a la MISMA hora en todos sus grupos.
 *   node tools/probarSyncEstricto.js "<carga.xlsx>" "<disp.xlsx>"
 */
'use strict';
const { cargarDatos } = require('./cargarReales.js');
const d = cargarDatos(process.argv[2], process.argv[3]);

const diasSemana = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
// disponibilidad real (índice 0-5) → Set por nombre de día
const dispDe = (doc) => {
  const out = {}; diasSemana.forEach((dn, i) => { out[dn] = new Set((d.docentes[doc].disponibilidad[i] || [])); });
  return out;
};

// Réplica EXACTA del núcleo estricto de sincronizarGrupos.
function sincronizar(porGrupo, baseHoras, maxSesionesDia = 3) {
  const grupos = [...porGrupo.keys()];
  const idx = new Map(grupos.map((g) => [g, 0]));
  const quedan = () => grupos.some((g) => idx.get(g) < porGrupo.get(g).length);
  const gruposDisponibles = (dia, h) => grupos.filter((g) => {
    if (idx.get(g) >= porGrupo.get(g).length) return false;
    const b = porGrupo.get(g)[idx.get(g)];
    if (g.horario[dia][h] != null) return false;
    if (b.docente.asignado[dia][h]) return false;
    if ((g.sesionesDia[dia][b.materia] || 0) >= maxSesionesDia) return false;
    if (!b.docente.disp[dia].has(h)) return false;
    return true;
  });
  const baseHorasRev = [...baseHoras].reverse();
  while (quedan()) {
    const pendientes = grupos.filter((g) => idx.get(g) < porGrupo.get(g).length).length;
    let mejorDia = null, mejorH = null, mejorGrupos = [];
    for (const dia of diasSemana) for (const h of baseHorasRev) {
      const disp = gruposDisponibles(dia, h);
      if (disp.length === 0) continue;
      if (disp.length < pendientes) continue;          // estricto: cobertura total
      if (disp.length > mejorGrupos.length) { mejorDia = dia; mejorH = h; mejorGrupos = disp; }
    }
    if (mejorGrupos.length === 0) break;
    for (const g of mejorGrupos) {
      const i = idx.get(g); const b = porGrupo.get(g)[i];
      g.horario[mejorDia][mejorH] = b; b.docente.asignado[mejorDia][mejorH] = b;
      g.sesionesDia[mejorDia][b.materia] = (g.sesionesDia[mejorDia][b.materia] || 0) + 1;
      idx.set(g, i + 1);
    }
  }
}

// Construye grupos/bloques de inglés por cuatrimestre y corre la sincronización.
function probar(cuatri, turno, baseHoras) {
  const cargas = d.cargas.filter((c) => c.sync === `INGLES|${cuatri}`);
  const docentes = {};
  for (const c of cargas) if (!docentes[c.docente]) docentes[c.docente] = { disp: dispDe(c.docente), asignado: {} };
  for (const dn of diasSemana) for (const k in docentes) docentes[k].asignado[dn] = {};
  const porGrupo = new Map();
  for (const c of cargas) {
    const g = { nombre: c.grupo, horario: {}, sesionesDia: {} };
    for (const dn of diasSemana) { g.horario[dn] = {}; g.sesionesDia[dn] = {}; }
    const bloques = Array.from({ length: c.horas }, () => ({ materia: c.materia, duracion: 1, docente: docentes[c.docente] }));
    porGrupo.set(g, bloques);
  }
  sincronizar(porGrupo, baseHoras);
  console.log(`\nINGLÉS ${cuatri}° (${turno}):`);
  const slotsPorGrupo = [];
  for (const [g] of porGrupo) {
    const slots = [];
    for (const dn of diasSemana) for (const h of baseHoras) if (g.horario[dn][h]) slots.push(dn[0].toUpperCase() + h);
    const cargaH = cargas.find((c) => c.grupo === g.nombre).horas;
    console.log(`  ${g.nombre.padEnd(9)} ${slots.length}/${cargaH}h  ${slots.sort().join(' ')}`);
    slotsPorGrupo.push(slots.slice().sort().join(' '));
  }
  const sincronizado = slotsPorGrupo.every((s) => s === slotsPorGrupo[0]);
  const completo = porGrupo.size && [...porGrupo].every(([g, bl]) => {
    let n = 0; for (const dn of diasSemana) for (const h of baseHoras) if (g.horario[dn][h]) n++; return n === bl.length;
  });
  console.log(`  → ${completo ? '✅ COMPLETO' : '⛔ incompleto'} · ${sincronizado ? '✅ SINCRONIZADO' : '⛔ desincronizado'}`);
}

probar(2, 'matutino', [7, 8, 9, 10, 11, 12, 13, 14, 15]);
probar(5, 'vespertino', [12, 13, 14, 15, 16, 17, 18, 19, 20]);
