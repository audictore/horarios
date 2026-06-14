# Documentación de diseño — *From Schedule FI*

Análisis para la migración del motor de generación de horarios hacia un modelo de
**Satisfacción de Restricciones (CSP)** con **Google OR-Tools / CP-SAT**.

| Documento | Contenido |
|---|---|
| [`arquitectura-csp.md`](arquitectura-csp.md) | Diseño completo: arquitectura por capas, modelado en variables/dominios, formulación de restricciones, estrategia anti-combinatoria (preproceso + pre-asignación de inglés), cascada de objetivos lexicográficos, unicidad canónica y manejo de inviabilidad. |
| [`estrategia-pruebas-qa.md`](estrategia-pruebas-qa.md) | Plan de verificación: oráculos de invariante, validación de la regla institucional de **docentes con ambos turnos**, pruebas de **unicidad/determinismo**, partición de horas, días por carga, inviabilidad y casos límite. |

> Ambos documentos son **conceptuales**: describen el diseño objetivo. Sirven como base
> metodológica para tesis y como especificación para la migración.

## Implementación (JS puro, sin dependencias — `node --test`, 40/40 verde)

| Módulo (`src/`) | Rol |
|---|---|
| `preproceso.js` | días → N → split balanceado (partición determinista) |
| `invariantes.js` | oráculo INV-1..8 sobre el horario de salida (agnóstico al motor) |
| `prechecks.js` | pre-checks de capacidad Nivel 1 (nombran el dato culpable) |
| `motor-min.js` | colocador greedy (regla de ambos turnos, *failing test* BT-3) |
| `engine.js` | solver CP por backtracking canónico → solución lex-mínima + unicidad |

**Integración en el SPA:** `index.html` carga estos módulos y expone el botón **“Motor CSP (beta)”**
(`#button_csp`), que corre pre-checks + solver sobre los datos ya cargados y pinta el resultado en
`#csp_resultado`, **sin alterar** el generador metaheurístico existente. El solver beta está acotado
por tamaño (el backtracking aún no escala a datasets completos; los pre-checks sí).
