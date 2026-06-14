/**
 * Escritor mínimo de .xlsx en JavaScript puro (sin dependencias) — From Schedule FI / tooling.
 *
 * Construye un .xlsx (ZIP de XML) desde cero: una hoja por entrada de `hojas`, con celdas inline
 * (sin sharedStrings). El ZIP se arma con método "store" (sin compresión) + CRC32, así no hace
 * falta deflate. Suficiente para exportar el horario del motor CP a un Excel abrible.
 *
 *   escribirXlsx('salida.xlsx', { 'Hoja1': [ [c1,c2], [c3,c4] ], ... })
 */
'use strict';
const fs = require('fs');
const zlib = require('zlib');

// CRC32 (usa zlib.crc32 si existe — Node ≥22; si no, tabla manual).
const crc32 = typeof zlib.crc32 === 'function'
  ? (buf) => zlib.crc32(buf) >>> 0
  : (() => {
      const tabla = new Uint32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); tabla[n] = c >>> 0; }
      return (buf) => { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = tabla[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
    })();

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colLetra = (i) => { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = (i - r - 1) / 26; } return s; };
const sanearHoja = (n) => String(n).replace(/[\\/?*:\[\]]/g, '-').slice(0, 31);

function hojaXml(filas) {
  let rows = '';
  filas.forEach((fila, r) => {
    let cells = '';
    fila.forEach((val, c) => {
      if (val === '' || val == null) return;
      cells += `<c r="${colLetra(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${esc(val)}</t></is></c>`;
    });
    rows += `<row r="${r + 1}">${cells}</row>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

function escribirXlsx(ruta, hojas) {
  const nombres = Object.keys(hojas).map(sanearHoja);
  const partes = {};
  partes['[Content_Types].xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${nombres.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  partes['_rels/.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  partes['xl/workbook.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nombres.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  partes['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${nombres.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`;
  Object.values(hojas).forEach((filas, i) => { partes[`xl/worksheets/sheet${i + 1}.xml`] = hojaXml(filas); });

  // Armar ZIP (store, sin compresión).
  const locales = [], centrales = [];
  let offset = 0;
  for (const [nombre, contenido] of Object.entries(partes)) {
    const data = Buffer.from(contenido, 'utf8');
    const nameBuf = Buffer.from(nombre, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locales.push(lh, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10); cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14); cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    centrales.push(cd, nameBuf);
    offset += lh.length + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(centrales);
  const localBuf = Buffer.concat(locales);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(partes).length, 8); eocd.writeUInt16LE(Object.keys(partes).length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(localBuf.length, 16);
  fs.writeFileSync(ruta, Buffer.concat([localBuf, cdBuf, eocd]));
}

module.exports = { escribirXlsx };
