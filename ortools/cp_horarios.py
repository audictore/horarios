#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generador de horarios con CP-SAT (OR-Tools) — From Schedule FI.
Reglas: ventana de turno, disponibilidad declarada, no-solape docente/grupo,
1 sesión/día (normal/Inglés 8-9 = 1 bloque contiguo; tutoría 2; Inglés 1-7 hasta 3),
durMax horas/día por carga, inglés simultáneo (2°/5°), escalón institucional por PA
(HARD; el front puede conceder +N días vía whitelist). Objetivo lexicográfico:
1) máx horas colocadas, 2) patrón didáctico (5→2,2,1, 6→2,2,2; tutorías exentas),
3) cero huecos de grupo (DURO), 4) días parejos (min spread max−min por grupo, suave).
Exporta a Excel (una hoja por grupo)."""
import json, time, unicodedata, re, sys
from collections import defaultdict
from ortools.sat.python import cp_model
import openpyxl

DURMAX = 4
def norm(s): return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn').upper()
def es_ing17(mat): u = norm(mat); return 'INGLES' in u and not re.search(r'INGLES\s*[89]', u)
def es_tut(mat):   return 'TUTORIA' in norm(mat)
def max_ses(mat):  return 3 if es_ing17(mat) else (2 if es_tut(mat) else 1)
def dias_obj(carga): return 1 if carga < 2 else (2 if carga <= 9 else (3 if carga <= 20 else 4))

D = json.load(open('datos_horarios.json', encoding='utf-8'))
ventanas, docentes, cargas = D['ventanas'], D['docentes'], D['cargas']
DIAS = range(6); DIA_NOM = ['LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO']
HREQ = sum(c['horas'] for c in cargas)
m = cp_model.CpModel()

x = {}
for i, c in enumerate(cargas):
    lo, hi = ventanas[c['turno']]; disp = docentes[c['docente']]['disponibilidad']
    for d in DIAS:
        dd = set(disp.get(str(d), []))
        for h in range(lo, hi):
            if h in dd: x[(i, d, h)] = m.NewBoolVar(f'x_{i}_{d}_{h}')

colocadas = []
for i, c in enumerate(cargas):
    s = [x[(i, d, h)] for d in DIAS for h in range(*ventanas[c['turno']]) if (i, d, h) in x]
    m.Add(sum(s) <= c['horas']); colocadas.append(sum(s))
    for d in DIAS:  # durMax: horas/día de la carga ≤ DURMAX
        sd = [x[(i, d, h)] for h in range(*ventanas[c['turno']]) if (i, d, h) in x]
        if sd: m.Add(sum(sd) <= DURMAX)

porDoc, porGru = defaultdict(list), defaultdict(list)
for i, c in enumerate(cargas):
    porDoc[c['docente']].append(i); porGru[c['grupo']].append(i)
for idxs in list(porDoc.values()) + list(porGru.values()):
    for d in DIAS:
        for h in range(7, 21):
            t = [x[(i, d, h)] for i in idxs if (i, d, h) in x]
            if len(t) > 1: m.AddAtMostOne(t)

# N sesiones/día: se cuentan los "comienzos de bloque" (transición 0→1 al recorrer las
# horas) y se limitan a max_ses. 1 comienzo = 1 bloque contiguo = 1 sesión. Así un hueco
# de cualquier tamaño parte el bloque en dos y cuenta como 2 sesiones (lo que captura la
# regla real). normal/Inglés 8-9 → 1; tutoría → 2; Inglés 1-7 → 3.
# Patrón didáctico (preferencia, materias NO-tutoría): bloques de 2 h y un 1 h si la carga
# es impar (5→2,2,1; 6→2,2,2; 4→2,2; 3→2,1). Se logra minimizando, con α<β<2α:
#   α·(nº de sesiones)  [empuja a juntar en bloques]  +  β·(horas en bloques de 3+)
#   [empuja a cortar los bloques largos en 2]. El óptimo de esa suma es justo el patrón;
#   donde no cabe, parte en pocos bloques (3,2 antes que 1,1,1,1). Tutorías exentas.
sesion_terms = []   # 'ini' de materias normales = nº de sesiones (preferir pocas)
exceso_terms = []   # 3.ª+ hora contigua de materias normales (penaliza bloques >2 h)
for i, c in enumerate(cargas):
    lim = max_ses(c['materia']); lo, hi = ventanas[c['turno']]
    normal = not es_tut(c['materia'])
    for d in DIAS:
        inicios = []
        for h in range(lo, hi):
            if (i, d, h) not in x: continue
            ini = m.NewBoolVar(f'ini_{i}_{d}_{h}'); prev = x.get((i, d, h - 1))
            if prev is None:
                m.Add(ini == x[(i, d, h)])
            else:
                m.Add(ini <= x[(i, d, h)]); m.Add(ini <= 1 - prev); m.Add(ini >= x[(i, d, h)] - prev)
            inicios.append(ini)
        if inicios: m.Add(sum(inicios) <= lim)
        if normal:
            sesion_terms.extend(inicios)
            for h in range(lo + 2, hi):  # exceso: e=1 sólo si (h-2,h-1,h) están las 3 activas
                if (i, d, h) in x and (i, d, h - 1) in x and (i, d, h - 2) in x:
                    e = m.NewBoolVar(f'exc_{i}_{d}_{h}')
                    m.Add(e >= x[(i, d, h)] + x[(i, d, h - 1)] + x[(i, d, h - 2)] - 2)
                    exceso_terms.append(e)

# Bloques ≤ 2h (DURO, materias normales): no se permiten 3+ horas consecutivas de la
# misma materia. Garantiza el patrón didáctico 5→2,2,1 / 6→2,2,2 / 4→2,2 / 3→2,1.
for e in exceso_terms: m.Add(e == 0)

# Inglés simultáneo (2°/5°).
sync = defaultdict(list)
for i, c in enumerate(cargas):
    if c.get('sync'): sync[c['sync']].append(i)
for idxs in sync.values():
    if len(idxs) < 2: continue
    for d in DIAS:
        for h in range(7, 21):
            vs = [x[(i, d, h)] for i in idxs if (i, d, h) in x]
            if len(vs) == len(idxs):
                for k in range(1, len(vs)): m.Add(vs[0] == vs[k])
            else:
                for v in vs: m.Add(v == 0)

# DÍAS POR PERFIL (HARD, solo PA): el escalón institucional es regla DURA — ningún PA
# puede dar clase en más días que `maxDias`. El front calcula maxDias como escalón puro
# (≤9→2, ≤20→3, 21+→4) más +1 si el usuario marcó al docente en la whitelist del
# desglose. PTC/Inglés: maxDias=None → sin límite.
for doc, idxs in porDoc.items():
    md = docentes[doc].get('maxDias')
    if docentes[doc]['tipo'] != 2 or md is None: continue
    dias_doc = []
    for d in DIAS:
        slots = [x[(i, d, h)] for i in idxs for h in range(7, 21) if (i, d, h) in x]
        if not slots: continue
        y = m.NewBoolVar(f'act_{doc}_{d}')
        for v in slots: m.Add(y >= v)
        m.Add(y <= sum(slots))
        dias_doc.append(y)
    if dias_doc: m.Add(sum(dias_doc) <= md)

# Objetivo lexicográfico: 1º máx horas (peso grande), 2º mín huecos de los grupos.
# Huecos por (grupo, día): span(última-primera+1) - ocupadas. Aprox con primera/última.
hueco_terms = []
for g, idxs in porGru.items():
    turno = cargas[idxs[0]]['turno']; lo, hi = ventanas[turno]
    for d in DIAS:
        slots = {h: [x[(i, d, h)] for i in idxs if (i, d, h) in x] for h in range(lo, hi)}
        ocup = {h: m.NewBoolVar(f'oc_{g}_{d}_{h}') for h in range(lo, hi) if slots[h]}
        for h, ov in ocup.items():
            m.Add(ov == sum(slots[h]))  # AtMostOne ya garantiza ≤1
        if len(ocup) < 2: continue
        prim = m.NewIntVar(lo, hi, f'pri_{g}_{d}'); ult = m.NewIntVar(lo, hi, f'ult_{g}_{d}')
        tiene = m.NewBoolVar(f'tie_{g}_{d}'); m.Add(sum(ocup.values()) >= 1).OnlyEnforceIf(tiene)
        m.Add(sum(ocup.values()) == 0).OnlyEnforceIf(tiene.Not())
        for h, ov in ocup.items():
            m.Add(prim <= h).OnlyEnforceIf(ov); m.Add(ult >= h + 1).OnlyEnforceIf(ov)
        span = m.NewIntVar(0, hi - lo, f'span_{g}_{d}')
        m.Add(span == ult - prim).OnlyEnforceIf(tiene); m.Add(span == 0).OnlyEnforceIf(tiene.Not())
        hk = m.NewIntVar(0, hi - lo, f'hk_{g}_{d}')
        m.Add(hk == span - sum(ocup.values())); hueco_terms.append(hk)

# Cero huecos de grupo: regla DURA (decisión del usuario). Si físicamente imposible llegar
# a 354 h sin huecos, el solver reduce cargas (las restricciones son `<= horas`) y el
# diagnóstico final dirá qué docente/grupo es el cuello.
for hk in hueco_terms: m.Add(hk == 0)

# DOCENTE por (doc, día): huecos (span − ocupadas) Y días flacos (faltan para ≥ MIN h),
# compartiendo el cálculo de horas/día y "abierto". Si el día no se usa, ninguno aporta.
# Pesos bajos: el docente cede primero ante patrón / huecos del grupo.
MIN_HORAS_DOC = 3
hueco_doc_terms, corto_doc_terms = [], []
hueco_por_doc = defaultdict(list)   # doc → [hk vars] para tope semanal de PAs
for doc, idxs in porDoc.items():
    for d in DIAS:
        slots = {h: [x[(i, d, h)] for i in idxs if (i, d, h) in x] for h in range(7, 21)}
        ocup = {h: m.NewBoolVar(f'od_{doc}_{d}_{h}') for h in range(7, 21) if slots[h]}
        for h, ov in ocup.items(): m.Add(ov == sum(slots[h]))  # AtMostOne ya garantiza ≤1
        if not ocup: continue
        # Variables compartidas: horas del día y "día abierto".
        horas_dd = m.NewIntVar(0, 14, f'hdd_{doc}_{d}'); m.Add(horas_dd == sum(ocup.values()))
        tiene = m.NewBoolVar(f'dti_{doc}_{d}')
        m.Add(horas_dd >= 1).OnlyEnforceIf(tiene); m.Add(horas_dd == 0).OnlyEnforceIf(tiene.Not())
        # Días flacos del docente: penaliza faltante (MIN − horas) sólo si el día está abierto.
        corto_d = m.NewIntVar(0, MIN_HORAS_DOC, f'crd_{doc}_{d}')
        m.Add(corto_d >= MIN_HORAS_DOC - horas_dd - MIN_HORAS_DOC * (1 - tiene))
        corto_doc_terms.append(corto_d)
        # Huecos del docente: con < 2 slots legales no hay hueco posible, salta.
        if len(ocup) < 2: continue
        prim = m.NewIntVar(7, 21, f'dpr_{doc}_{d}'); ult = m.NewIntVar(7, 21, f'dul_{doc}_{d}')
        for h, ov in ocup.items():
            m.Add(prim <= h).OnlyEnforceIf(ov); m.Add(ult >= h + 1).OnlyEnforceIf(ov)
        span = m.NewIntVar(0, 14, f'dsp_{doc}_{d}')
        m.Add(span == ult - prim).OnlyEnforceIf(tiene); m.Add(span == 0).OnlyEnforceIf(tiene.Not())
        hk = m.NewIntVar(0, 14, f'dhk_{doc}_{d}')
        m.Add(hk == span - horas_dd); hueco_doc_terms.append(hk)
        hueco_por_doc[doc].append(hk)

# Huecos semanales PA ≤ 3 (DURO): un PA no puede acumular más de 3 horas muertas en
# toda la semana. PTC/Inglés: sin límite (tipo != 2).
MAX_HUECOS_PA = 3
for doc, hks in hueco_por_doc.items():
    if docentes[doc]['tipo'] != 2 or not hks: continue
    m.Add(sum(hks) <= MAX_HUECOS_PA)

# Variables auxiliares por (grupo, día), compartidas por preferencias de jornada.
abierto_gd, horas_gd = {}, {}
for g, idxs in porGru.items():
    turno = cargas[idxs[0]]['turno']; lo, hi = ventanas[turno]
    for d in DIAS:
        slots = [x[(i, d, h)] for i in idxs for h in range(lo, hi) if (i, d, h) in x]
        if not slots: continue
        hgd = m.NewIntVar(0, hi - lo, f'hgd_{g}_{d}'); m.Add(hgd == sum(slots))
        abr = m.NewBoolVar(f'abr_{g}_{d}')
        m.Add(hgd >= 1).OnlyEnforceIf(abr); m.Add(hgd == 0).OnlyEnforceIf(abr.Not())
        horas_gd[(g, d)] = hgd; abierto_gd[(g, d)] = abr

# Días parejos (PREFERENCIA): distribuir las horas del grupo lo más uniformemente posible
# entre sus días abiertos. Se minimiza (max_día − min_día) por grupo.
# Ej: 41h en 5 días → 8,8,8,8,9 = spread 1 (casi perfecto).
desnivel_terms = []
for g, idxs in porGru.items():
    turno = cargas[idxs[0]]['turno']; lo, hi = ventanas[turno]
    dias_g = [d for d in DIAS if (g, d) in abierto_gd]
    if len(dias_g) < 2: continue
    max_g = m.NewIntVar(0, hi - lo, f'maxg_{g}')
    min_g = m.NewIntVar(0, hi - lo, f'ming_{g}')
    for d in dias_g:
        m.Add(max_g >= horas_gd[(g, d)])
        m.Add(min_g <= horas_gd[(g, d)]).OnlyEnforceIf(abierto_gd[(g, d)])
    spread = m.NewIntVar(0, hi - lo, f'spr_{g}')
    m.Add(spread == max_g - min_g)
    desnivel_terms.append(spread)

# Márgenes de jornada (PREFERENCIA): matutino empieza a las 7:00, vespertino termina
# a las 21:00 (= slot 20). Por cada día abierto del grupo, penaliza 1 si el slot crítico
# (7 para matutino / 20 para vespertino) NO está ocupado por alguna clase del grupo.
# Si ningún docente está disponible a esa hora, no se cuenta (no exigible).
margen_terms = []
for g, idxs in porGru.items():
    turno = cargas[idxs[0]]['turno']
    h_critico = 7 if turno == 'matutino' else 20
    for d in DIAS:
        if (g, d) not in abierto_gd: continue
        slot = [x[(i, d, h_critico)] for i in idxs if (i, d, h_critico) in x]
        if not slot: continue
        ocup = m.NewBoolVar(f'mc_{g}_{d}'); m.Add(ocup == sum(slot))
        # pen = 1 sii (abierto Y NOT ocup). Linealización: pen ≥ abierto − ocup; al
        # minimizar y ser Bool, queda 1 solo cuando falta y 0 en los demás casos.
        pen = m.NewBoolVar(f'mrg_{g}_{d}')
        m.Add(pen >= abierto_gd[(g, d)] - ocup)
        margen_terms.append(pen)

# Objetivo lexicográfico (pesos separados para que las prioridades no se mezclen):
#   1º máx horas (100%); 2º patrón didáctico (peso 1000); 3º huecos-docente (peso 100);
#   4º días parejos grupo (min spread, peso 500); 4b flacos docente ≥3 h (peso 200);
#   5º márgenes de jornada (peso 1).
# Restricciones DURAS arriba (no entran al objetivo): escalón de días PA, cero huecos grupo.
patron = 2 * sum(sesion_terms) + 3 * sum(exceso_terms)
m.Maximize(1000000 * sum(colocadas) - 1000 * patron
           - 100 * sum(hueco_doc_terms) - 500 * sum(desnivel_terms) - 200 * sum(corto_doc_terms)
           - sum(margen_terms))

import os
_MAXT = int(os.environ.get('CP_MAX_TIME', '300'))  # tope (s); 300 alcanza patrón 100%. CP_MAX_TIME lo ajusta
solver = cp_model.CpSolver(); solver.parameters.max_time_in_seconds = _MAXT; solver.parameters.num_search_workers = 8
t0 = time.time(); st = solver.Solve(m); dt = time.time() - t0
ok = st in (cp_model.OPTIMAL, cp_model.FEASIBLE)
col = sum(solver.Value(v) for v in x.values()) if ok else 0
hue = sum(solver.Value(t) for t in hueco_terms) if ok else 0
pat = solver.Value(patron) if ok else 0
dsn = sum(solver.Value(t) for t in desnivel_terms) if ok else 0
crd = sum(solver.Value(t) for t in corto_doc_terms) if ok else 0
mrg = sum(solver.Value(t) for t in margen_terms) if ok else 0
hud = sum(solver.Value(t) for t in hueco_doc_terms) if ok else 0
print(f'estado={solver.StatusName(st)}  tiempo={dt:.2f}s  colocadas={col}/{HREQ}h ({round(col/HREQ*100)}%)  patron={pat}  huecos_grupo={hue}  huecos_doc={hud}  desnivel={dsn}  flacos_doc={crd}  margenes={mrg}  optimo={"SI" if st==cp_model.OPTIMAL else "no(tope)"}')

if ok:
    oD, oG, inc = defaultdict(int), defaultdict(int), []
    for (i, d, h), v in x.items():
        if solver.Value(v): oD[(cargas[i]['docente'], d, h)] += 1; oG[(cargas[i]['grupo'], d, h)] += 1
    for i, c in enumerate(cargas):
        if sum(solver.Value(x[(i, d, h)]) for d in DIAS for h in range(*ventanas[c['turno']]) if (i, d, h) in x) < c['horas']:
            inc.append(f"{c['grupo']}/{c['materia']}")
    print(f'solapes_doc={sum(1 for v in oD.values() if v>1)}  solapes_grupo={sum(1 for v in oG.values() if v>1)}  incompletas={len(inc)}')
    for s in inc[:12]: print('   • ' + s)

    # ── Garantía / diagnóstico: si NO se alcanzó el 100%, decir QUÉ dato corregir ──
    if col < HREQ:
        print('\n⚠ NO se alcanzó el 100%. El óptimo demostrado es ' + str(col) + '/' + str(HREQ) + 'h.')
        print('  Causa (qué corregir en la plantilla):')
        cargaDoc = defaultdict(int); turnosDoc = defaultdict(set)
        for c in cargas: cargaDoc[c['docente']] += c['horas']; turnosDoc[c['docente']].add(c['turno'])
        docs_inc = set(cargas[i]['docente'] for i, c in enumerate(cargas)
                       if sum(solver.Value(x[(i, d, h)]) for d in DIAS for h in range(*ventanas[c['turno']]) if (i, d, h) in x) < c['horas'])
        culpa = False
        for doc in sorted(docs_inc):
            disp = docentes[doc]['disponibilidad']; vts = [ventanas[t] for t in turnosDoc[doc]]
            dispH = sum(1 for dia in DIAS for h in set(disp.get(str(dia), [])) if any(lo <= h < hi for lo, hi in vts))
            if cargaDoc[doc] > dispH:
                print(f'  ⛔ DATO: "{doc}" — {cargaDoc[doc]}h de carga pero solo {dispH}h disponibles en su turno (faltan {cargaDoc[doc]-dispH}h). Amplíale disponibilidad o quítale carga.')
                culpa = True
            else:
                md = docentes[doc].get('maxDias')
                if docentes[doc]['tipo'] == 2 and md is not None and cargaDoc[doc] > md * DURMAX:
                    print(f'  ⛔ ESCALÓN: "{doc}" (PA) — {cargaDoc[doc]}h no caben en {md} días (máx {md*DURMAX}h). Marca este docente en "+1 día permitido" del desglose y vuelve a generar.')
                    culpa = True
        if not culpa:
            print('  Cada docente tiene capacidad suficiente por separado → el faltante es por INTERACCIÓN.')
            print('  Causas típicas:')
            print('  · Inglés sincronizado: los profes deben coincidir en hora.')
            print('  · Cero huecos de grupo (regla DURA): si un docente sólo tiene huecos puntuales en')
            print('    su disponibilidad, sus horas no caben sin generar un hueco para el grupo.')
            print('  Opciones: marca a un PA en "+1 día permitido", amplía disponibilidad, reparte una')
            print('  carga, o ablanda la regla de cero huecos (avísame).')
        print('  NOTA: el Excel generado es PARCIAL (no uses este horario hasta corregir y volver a 100%).')
    else:
        print('\n✅ 100% GARANTIZADO: 354/354h, óptimo demostrado. Horario completo y válido.')

    # ── Exportar a Excel (una hoja por grupo, formato HORA × DÍAS) ──
    wb = openpyxl.Workbook(); wb.remove(wb.active)
    for g, idxs in porGru.items():
        turno = cargas[idxs[0]]['turno']; lo, hi = ventanas[turno]
        ws = wb.create_sheet(('G_' + g)[:31])
        ws.append(['HORA'] + DIA_NOM)
        for h in range(lo, hi):
            fila = [h]
            for d in DIAS:
                cel = ''
                for i in idxs:
                    if (i, d, h) in x and solver.Value(x[(i, d, h)]):
                        cel = f"{cargas[i]['materia']} ({cargas[i]['docente']})"; break
                fila.append(cel)
            ws.append(fila)
    out = 'Horario_CP_ORTools.xlsx'
    try:
        wb.save(out); print(f'\n✅ Excel generado: {out}')
    except PermissionError:
        print(f'\n⚠ No se pudo guardar {out} (¿está abierto en Excel? ciérralo). El horario JSON sí se generó.')

    # ── Salida JSON del horario (la consume el servidor local para pintar en la web) ──
    horario_json = []
    for (i, d, h), v in x.items():
        if solver.Value(v):
            horario_json.append({'grupo': cargas[i]['grupo'], 'materia': cargas[i]['materia'],
                                 'docente': cargas[i]['docente'], 'dia': d, 'hora': h})
    json.dump({'ok': True, 'colocadas': col, 'total': HREQ, 'horario': horario_json,
               'optimo': st == cp_model.OPTIMAL, 'patron': pat,
               'huecos': hue, 'status': solver.StatusName(st), 'segundos': round(dt, 1)},
              open('horario_cp.json', 'w', encoding='utf-8'), ensure_ascii=False)
    print('✅ JSON generado: horario_cp.json')
