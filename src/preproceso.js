/**
 * Preproceso determinista del generador de horarios — From Schedule FI.
 *
 * Esta capa convierte la carga académica en una lista de sesiones (bloques) de
 * duración fija ANTES de que el motor de emplazamiento intervenga. El objetivo
 * de diseño es que el solver no tome ninguna decisión estructural: la partición
 * de horas y el número de días son funciones deterministas de los datos, no del
 * azar de la búsqueda. Esto es lo que mantiene la combinatoria bajo control y es
 * la base de la unicidad canónica (ver docs/arquitectura-csp.md §6.1).
 *
 * 100% JavaScript, sin dependencias. Compatible con navegador y Node
 * (patrón UMD-lite al final del archivo).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Preproceso = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Error de dato/configuración detectado en el preproceso (no es un bug del motor). */
  class PreprocesoError extends Error {
    constructor(message, detalle) {
      super(message);
      this.name = 'PreprocesoError';
      this.detalle = detalle || null; // contexto para diagnóstico por nombre
    }
  }

  /**
   * Días de asistencia según el escalón de carga (regla institucional, Docentes Tipo 2 / PAs).
   * Se usa el escalón porque la institución reparte la presencia del docente en función de su
   * carga, no de su preferencia: a más horas, más días para evitar jornadas inviables.
   *   carga 2–9  → 2 días | 10–20 → 3 días | 21+ → 4 días
   * Cargas < 2 se resuelven en 1 día (caso degenerado, fuera del rango documentado).
   */
  function diasObjetivo(cargaTotal) {
    if (!Number.isInteger(cargaTotal) || cargaTotal < 0) {
      throw new PreprocesoError('La carga total debe ser un entero ≥ 0', { cargaTotal });
    }
    if (cargaTotal < 2) return 1;
    if (cargaTotal <= 9) return 2;
    if (cargaTotal <= 20) return 3;
    return 4;
  }

  /**
   * Partición balanceada determinista de H horas en N bloques.
   * Reparte como (H mod N) bloques de ⌈H/N⌉ y el resto de ⌊H/N⌋, en orden descendente.
   * Es determinista (mismo (H,N) ⇒ misma salida) para no introducir ambigüedad estructural.
   *   balanced(7,2) = [4,3] | balanced(7,3) = [3,2,2] | balanced(7,4) = [2,2,2,1]
   */
  function balanced(H, N) {
    if (!Number.isInteger(H) || H <= 0) {
      throw new PreprocesoError('H (horas) debe ser un entero ≥ 1', { H });
    }
    if (!Number.isInteger(N) || N <= 0) {
      throw new PreprocesoError('N (bloques) debe ser un entero ≥ 1', { N });
    }
    if (N > H) {
      // Más bloques que horas obligaría a bloques < 1h: imposible por definición.
      throw new PreprocesoError('N no puede exceder H (bloques de < 1h)', { H, N });
    }
    const mayor = Math.ceil(H / N);
    const menor = Math.floor(H / N);
    const nMayores = H % N; // cuántos bloques llevan la hora extra
    const out = [];
    for (let i = 0; i < N; i++) out.push(i < nMayores ? mayor : menor);
    return out; // ya descendente: primero los ⌈⌉, luego los ⌊⌋
  }

  /**
   * Banda factible de N (número de bloques/días) para una materia de H horas dada la
   * disponibilidad del docente. Fuera de esta banda la materia no se puede partir bien:
   *   nMin = ⌈H/durMax⌉           → ningún bloque excede el tope de horas seguidas
   *   nMax = min(díasDocente, ⌊H/durMin⌋) → ni más días que asistencia, ni bloques < durMin
   * Devuelve { nMin, nMax }. Si nMin > nMax la materia es estructuralmente inviable
   * con esos parámetros (lo detecta elegirN).
   */
  function bandaN(H, diasDocente, opciones) {
    const durMax = (opciones && opciones.durMax) || 4;
    const durMin = (opciones && opciones.durMin) || 1;
    if (!Number.isInteger(diasDocente) || diasDocente <= 0) {
      throw new PreprocesoError('díasDocente debe ser un entero ≥ 1', { diasDocente });
    }
    const nMin = Math.ceil(H / durMax);
    const nMax = Math.min(diasDocente, Math.floor(H / durMin));
    return { nMin, nMax };
  }

  /**
   * Elige el N canónico para una carga: se reparte en tantos días como el docente asista
   * (N = nMax), porque distribuir maximiza el balance y respeta la presencia del docente.
   * Si la banda es vacía (nMin > nMax) la materia no cabe → PreprocesoError (dato a corregir).
   */
  function elegirN(H, diasDocente, opciones) {
    const { nMin, nMax } = bandaN(H, diasDocente, opciones);
    if (nMin > nMax) {
      throw new PreprocesoError(
        'Materia inviable: no cabe en los días disponibles con el tope de horas por bloque',
        { H, diasDocente, nMin, nMax, opciones: opciones || {} }
      );
    }
    return nMax;
  }

  /**
   * Genera el split de una materia: combina elegirN + balanced.
   * Es la función de cara al resto del preproceso; entrega el arreglo de duraciones fijas.
   *   generarSplit(7, 3) → [3,2,2]   generarSplit(7, 2) → [4,3]
   */
  function generarSplit(H, diasDocente, opciones) {
    const N = elegirN(H, diasDocente, opciones);
    return balanced(H, N);
  }

  return { PreprocesoError, diasObjetivo, balanced, bandaN, elegirN, generarSplit };
});
