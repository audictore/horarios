/**
 * Lector mínimo de .xlsx en JavaScript puro (sin dependencias) — From Schedule FI / tooling.
 *
 * Un .xlsx es un ZIP de XML. Aquí se lee el directorio central del ZIP, se inflan las entradas con
 * `zlib`, y se parsean `sharedStrings.xml` + `worksheets/sheetN.xml` a filas de celdas (strings).
 * Suficiente para extraer la carga académica / disponibilidades y dárselas al engine CP.
 *
 * Uso (Node):  const { leerXlsx } = require('./tools/leerXlsx.js'); const wb = leerXlsx(ruta);
 *              wb.sheetNames -> [...] ; wb.sheets['Hoja1'] -> [ [c1,c2,...], ... ]
 */
'use strict';
const fs = require('fs');
const zlib = require('zlib');

function leerZip(buf) {
  // Localizar el End Of Central Directory (firma 0x06054b50), escaneando desde el final.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('xlsx inválido: no se encontró EOCD');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdCount = buf.readUInt16LE(eocd + 10);

  const files = {};
  let p = cdOffset;
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break; // firma de entrada del directorio central
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    const lhNameLen = buf.readUInt16LE(localOffset + 26);
    const lhExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lhNameLen + lhExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    files[name] = method === 0 ? comp : zlib.inflateRawSync(comp);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&amp;/g, '&');

function sharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const si = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = si.exec(xml))) {
    const tre = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let t, s = '';
    while ((t = tre.exec(m[1]))) s += t[1];
    out.push(decode(s));
  }
  return out;
}

const colIndex = (ref) => {
  const m = ref.match(/^([A-Z]+)/);
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

function parseSheet(xml, ss) {
  const rows = [];
  const rowRe = /<row[^>]*?>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const cells = [];
    const cRe = /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cRe.exec(rm[1]))) {
      const idx = colIndex(cm[1]);
      const attrs = cm[2] || '';
      const inner = cm[3] || '';
      let val = '';
      const t = (attrs.match(/\bt="([^"]*)"/) || [])[1];
      if (t === 's') {
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        val = v != null ? (ss[+v] || '') : '';
      } else if (t === 'inlineStr') {
        const it = (inner.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
        val = it != null ? decode(it) : '';
      } else {
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        val = v != null ? decode(v) : '';
      }
      cells[idx] = val;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}

function leerXlsx(ruta) {
  const files = leerZip(fs.readFileSync(ruta));
  const ss = sharedStrings(files['xl/sharedStrings.xml'] && files['xl/sharedStrings.xml'].toString('utf8'));

  // Nombres de hoja en orden, mapeados a su archivo vía los rels del workbook.
  const wbXml = (files['xl/workbook.xml'] || Buffer.from('')).toString('utf8');
  const relsXml = (files['xl/_rels/workbook.xml.rels'] || Buffer.from('')).toString('utf8');
  const relMap = {};
  let rm;
  const relRe = /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
  while ((rm = relRe.exec(relsXml))) relMap[rm[1]] = rm[2].replace(/^\/?xl\//, '').replace(/^\//, '');

  const sheetNames = [];
  const sheets = {};
  const shRe = /<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/>/g;
  let sm;
  while ((sm = shRe.exec(wbXml))) {
    const name = decode(sm[1]);
    const target = relMap[sm[2]] || `worksheets/sheet${sheetNames.length + 1}.xml`;
    const key = `xl/${target}`;
    sheetNames.push(name);
    sheets[name] = files[key] ? parseSheet(files[key].toString('utf8'), ss) : [];
  }
  return { sheetNames, sheets };
}

module.exports = { leerXlsx };

// CLI: node tools/leerXlsx.js <ruta> → resumen de hojas
if (require.main === module) {
  const wb = leerXlsx(process.argv[2]);
  console.log('Hojas:', wb.sheetNames.length);
  for (const name of wb.sheetNames) {
    const rows = wb.sheets[name];
    console.log(`\n=== "${name}" (${rows.length} filas) ===`);
    rows.slice(0, 6).forEach((r) => console.log('  ', r.slice(0, 8).map((c) => String(c).slice(0, 18)).join(' | ')));
  }
}
