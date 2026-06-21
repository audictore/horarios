# Motor de horarios con CP-SAT (OR-Tools)

Solver **completo y óptimo** para *From Schedule FI*, alternativo al motor metaheurístico
de `index.html`. Modela el problema como **Satisfacción de Restricciones** y lo resuelve con
[Google OR-Tools CP-SAT](https://developers.google.com/optimization/cp/cp_solver).

Sobre los datos reales (9 grupos, 24 docentes, 354 h) entrega el horario **354/354 h,
óptimo demostrado, en ~13 s** — completo, sin solapes, sin huecos, respetando todas las
reglas duras. El metaheurístico nunca pasó de ~350 h válidas.

## Reglas modeladas

| Regla | En el modelo |
|---|---|
| Ventana de turno (matutino 7-16, vespertino 12-20) | dominio de las variables |
| Disponibilidad declarada del docente | solo se crean variables en slots disponibles |
| No-solape de docente y de grupo | `AddAtMostOne` por (docente/grupo, día, hora) |
| 1 sesión/día (normal e Inglés 8/9; tutoría 2; Inglés 1-7 hasta 3) | conteo de "comienzos de bloque" ≤ `max_ses` |
| `durMax` horas seguidas por carga/día | suma diaria ≤ 4 |
| Inglés simultáneo (2° y 5° a la misma hora) | igualdad de variables entre grupos del grado |
| Perfil de días de PA (preferencia) | minimiza los días por encima del escalón ajustado (solo PA; PTC/Inglés sin límite) |
| Calidad: mínimo de huecos de los grupos | objetivo lexicográfico |

**Objetivo lexicográfico:** 1º máximo de horas colocadas · 2º mínimo de días-extra de PA
(regla institucional, blanda) · 3º mínimo de huecos de los grupos.

> El `maxDias` de cada PA lo calcula `exportar_datos.js` replicando `calcularMaxDias()` +
> el ajuste por holgura de `calcularDiasDocentes()` del `index.html`. Es **preferencia**, no
> restricción dura: si hace falta un día extra para colocar todas las horas, se permite y
> solo se penaliza en el objetivo (así nunca baja de 354/354).

## Requisitos

OR-Tools es nativo (C++). En **Windows nativo lo bloquea Smart App Control** (`WinError 4551`),
así que se ejecuta en **WSL (Ubuntu)**:

```bash
wsl bash -lc "python3 -m pip install --break-system-packages ortools openpyxl"
```

## Uso

```bash
# 1) Exportar la plantilla a JSON (desde Windows, con Node):
node ortools/exportar_datos.js  ["Carga.xlsx"]  ["Disponibilidades.xlsx"]

# 2) Resolver y generar el Excel (desde WSL):
wsl bash -lc "cd '/mnt/c/Users/Alonzo/Documents/programacion/horarios/ortools' && python3 cp_horarios.py"
#   → genera Horario_CP_ORTools.xlsx (una hoja por grupo)
```

## Archivos

- `exportar_datos.js` — plantilla `.xlsx` → `datos_horarios.json` (reusa `tools/cargarReales.js`).
- `cp_horarios.py` — modelo CP-SAT; lee el JSON, resuelve y exporta el Excel.
- `datos_horarios.json` — datos de entrada del solver (generado).
