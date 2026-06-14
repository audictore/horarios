/**
 * Objetivos de calidad del horario — From Schedule FI.
 *
 * El engine garantiza horarios VÁLIDOS; este módulo permite elegir, entre los válidos, EL MEJOR.
 * Cascada lexicográfica acordada con la institución:
 *   tier 1 — HUECOS de los grupos: horas muertas intercaladas entre clases de un mismo día para
 *            un grupo (no cuentan las libres antes de la 1ª clase ni después de la última).
 *   tier 2 — DESBALANCE diario: diferencia entre el día más cargado y el más ligero de un grupo
 *            (repartir la carga pareja en la semana).
 * "Mejor" = menos huecos; a igualdad de huecos, menos desbalance.
 *
 * Evaluadores puros (sin estado, sin dependencias). 100% JS, navegador + Node (UMD-lite).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calidad = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Agrupa una lista de bloques por día → { dia: [bloques] }. */
  function _porDia(bloques) {
    const m = {};
    for (const b of bloques) (m[b.dia] || (m[b.dia] = [])).push(b);
    return m;
  }

  /**
   * Huecos de un conjunto de bloques de UN grupo: por cada día, span − ocupadas
   * (extensión punta-a-punta menos horas realmente ocupadas) = tiempo muerto intercalado.
   */
  function huecosDeBloques(bloques) {
    const dias = _porDia(bloques);
    let total = 0;
    for (const d in dias) {
      let ocupadas = 0, primera = Infinity, ultima = -Infinity;
      for (const b of dias[d]) {
        ocupadas += b.duracion;
        if (b.inicio < primera) primera = b.inicio;
        if (b.inicio + b.duracion > ultima) ultima = b.inicio + b.duracion;
      }
      total += (ultima - primera) - ocupadas; // 0 si el día es compacto o tiene un solo bloque
    }
    return total;
  }

  /**
   * Desbalance diario de UN grupo: diferencia entre las horas del día más cargado y el más ligero
   * (entre los días en que el grupo tiene clase). 0 si tiene ≤ 1 día con clase.
   */
  function desbalanceDeBloques(bloques) {
    const dias = _porDia(bloques);
    const cargas = Object.keys(dias).map((d) => dias[d].reduce((s, b) => s + b.duracion, 0));
    if (cargas.length <= 1) return 0;
    return Math.max(...cargas) - Math.min(...cargas);
  }

  /** Métricas de un grupo: { huecos, desbalance }. */
  function metricasGrupo(bloquesDelGrupo) {
    return { huecos: huecosDeBloques(bloquesDelGrupo), desbalance: desbalanceDeBloques(bloquesDelGrupo) };
  }

  /** Evalúa un horario completo: suma de huecos y de desbalance sobre todos los grupos. */
  function evaluarCalidad(horario) {
    const porGrupo = {};
    for (const b of horario.bloques) (porGrupo[b.grupo] || (porGrupo[b.grupo] = [])).push(b);
    let huecos = 0, desbalance = 0;
    for (const g in porGrupo) {
      const m = metricasGrupo(porGrupo[g]);
      huecos += m.huecos; desbalance += m.desbalance;
    }
    return { huecos, desbalance };
  }

  /** Comparador lexicográfico: < 0 si `a` es mejor (menos huecos; a igualdad, menos desbalance). */
  function compararCalidad(a, b) {
    return (a.huecos - b.huecos) || (a.desbalance - b.desbalance);
  }

  return { huecosDeBloques, desbalanceDeBloques, metricasGrupo, evaluarCalidad, compararCalidad };
});
