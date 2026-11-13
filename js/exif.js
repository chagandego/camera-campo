// Grava data/hora e coordenadas GPS dentro do arquivo JPEG (EXIF).
// Assim a foto aparece no mapa da galeria do celular, no Google Earth, QGIS etc.

const BYTE = 1;
const ASCII = 2;
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;

const p2 = (n) => String(n).padStart(2, '0');

function ascii(str) {
  const s = String(str).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?');
  const out = new Uint8Array(s.length + 1);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const rationals = (pairs) => new Uint8Array(pairs.flatMap(([n, d]) => [...u32(n), ...u32(d)]));
const entry = (tag, type, count, bytes) => ({ tag, type, count, bytes: Uint8Array.from(bytes) });
const asciiEntry = (tag, str) => {
  const b = ascii(str);
  return { tag, type: ASCII, count: b.length, bytes: b };
};

function concat(parts) {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Monta um IFD (big-endian) que começa em `offset` (relativo ao cabeçalho TIFF). */
function buildIFD(entries, offset) {
  const list = [...entries].sort((a, b) => a.tag - b.tag);
  const head = 2 + list.length * 12 + 4;
  const ifd = new Uint8Array(head);
  const dv = new DataView(ifd.buffer);
  const data = [];
  let dataOff = offset + head;
  dv.setUint16(0, list.length);
  list.forEach((e, i) => {
    const p = 2 + i * 12;
    dv.setUint16(p, e.tag);
    dv.setUint16(p + 2, e.type);
    dv.setUint32(p + 4, e.count);
    if (e.bytes.length <= 4) {
      ifd.set(e.bytes, p + 8);
    } else {
      dv.setUint32(p + 8, dataOff);
      data.push(e.bytes);
      dataOff += e.bytes.length;
      if (e.bytes.length % 2) { data.push(new Uint8Array(1)); dataOff += 1; }
    }
  });
  dv.setUint32(2 + list.length * 12, 0);
  return { bytes: concat([ifd, ...data]), end: dataOff };
}

function dms(v) {
  v = Math.abs(v);
  const d = Math.floor(v);
  const mf = (v - d) * 60;
  const m = Math.floor(mf);
  const s = (mf - m) * 60;
  return rationals([[d, 1], [m, 1], [Math.round(s * 10000), 10000]]);
}

function tzOffset(date) {
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${sign}${p2(Math.floor(a / 60))}:${p2(a % 60)}`;
}

function buildTiff({ date, pos, description, software }) {
  const dt = `${date.getFullYear()}:${p2(date.getMonth() + 1)}:${p2(date.getDate())} ` +
    `${p2(date.getHours())}:${p2(date.getMinutes())}:${p2(date.getSeconds())}`;

  const ifd0 = (exifPtr, gpsPtr) => {
    const list = [
      entry(0x0112, SHORT, 1, [0, 1, 0, 0]), // Orientation = normal
      asciiEntry(0x0131, software || 'App de campo'),
      asciiEntry(0x0132, dt),
      entry(0x8769, LONG, 1, u32(exifPtr)),
    ];
    if (description) list.push(asciiEntry(0x010e, description));
    if (pos) list.push(entry(0x8825, LONG, 1, u32(gpsPtr)));
    return list;
  };

  const exifEntries = [
    asciiEntry(0x9003, dt), // DateTimeOriginal
    asciiEntry(0x9004, dt), // DateTimeDigitized
    asciiEntry(0x9011, tzOffset(date)), // OffsetTimeOriginal
  ];

  let gpsEntries = null;
  if (pos) {
    const utc = date;
    gpsEntries = [
      entry(0x0000, BYTE, 4, [2, 3, 0, 0]),
      asciiEntry(0x0001, pos.lat < 0 ? 'S' : 'N'),
      { tag: 0x0002, type: RATIONAL, count: 3, bytes: dms(pos.lat) },
      asciiEntry(0x0003, pos.lon < 0 ? 'W' : 'E'),
      { tag: 0x0004, type: RATIONAL, count: 3, bytes: dms(pos.lon) },
      {
        tag: 0x0007, type: RATIONAL, count: 3,
        bytes: rationals([[utc.getUTCHours(), 1], [utc.getUTCMinutes(), 1], [utc.getUTCSeconds(), 1]]),
      },
      asciiEntry(0x0012, 'WGS-84'),
      asciiEntry(0x001d, `${utc.getUTCFullYear()}:${p2(utc.getUTCMonth() + 1)}:${p2(utc.getUTCDate())}`),
    ];
    if (Number.isFinite(pos.alt)) {
      gpsEntries.push(entry(0x0005, BYTE, 1, [pos.alt < 0 ? 1 : 0, 0, 0, 0]));
      gpsEntries.push({ tag: 0x0006, type: RATIONAL, count: 1, bytes: rationals([[Math.round(Math.abs(pos.alt) * 100), 100]]) });
    }
    if (Number.isFinite(pos.acc)) {
      gpsEntries.push({ tag: 0x001f, type: RATIONAL, count: 1, bytes: rationals([[Math.round(pos.acc * 100), 100]]) });
    }
  }

  // 1ª passada só para saber onde o IFD0 termina; os ponteiros não mudam o tamanho.
  const first = buildIFD(ifd0(0, 0), 8);
  const exif = buildIFD(exifEntries, first.end);
  const gps = gpsEntries ? buildIFD(gpsEntries, exif.end) : null;
  const ifd = buildIFD(ifd0(first.end, exif.end), 8);

  const header = new Uint8Array([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8]); // "MM", 42, IFD0 em 8
  return concat([header, ifd.bytes, exif.bytes, ...(gps ? [gps.bytes] : [])]);
}

/** Devolve um novo JPEG com o bloco EXIF (substitui qualquer EXIF existente). */
export async function addExif(blob, meta) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return blob;

  const tiff = buildTiff(meta);
  const len = 2 + 6 + tiff.length;
  if (len > 0xffff) return blob;
  const app1 = concat([
    new Uint8Array([0xff, 0xe1, len >> 8, len & 255, 0x45, 0x78, 0x69, 0x66, 0, 0]), // "Exif\0\0"
    tiff,
  ]);

  // Percorre os segmentos do cabeçalho: mantém APP0 (JFIF) na frente, remove EXIF antigo.
  const app0 = [];
  const others = [];
  let i = 2;
  while (i + 4 <= buf.length && buf[i] === 0xff) {
    const marker = buf[i + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const segLen = (buf[i + 2] << 8) | buf[i + 3];
    const seg = buf.subarray(i, i + 2 + segLen);
    const isExif = marker === 0xe1 && buf[i + 4] === 0x45 && buf[i + 5] === 0x78;
    if (marker === 0xe0) app0.push(seg);
    else if (!isExif) others.push(seg);
    i += 2 + segLen;
  }
  return new Blob([buf.subarray(0, 2), ...app0, app1, ...others, buf.subarray(i)], { type: 'image/jpeg' });
}
