// Desenha o carimbo (endereço, CEP, coordenadas, data e hora) na parte de baixo da foto.
// A mesma função desenha a prévia ao vivo na câmera, então o que se vê é o que sai na foto.

import { STAMP } from './config.js';
import { toUTM } from './geo.js';
import { fmtDate, fmtTime } from './util.js';

const ACCENT = '#ffc400';
const MUTED = 'rgba(255,255,255,0.78)';
const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const font = (weight, size) => `${weight} ${size.toFixed(1)}px ${FONT_STACK}`;

const PENDING_TEXT = {
  loading: 'Buscando endereço…',
  offline: 'Sem internet – o endereço será preenchido depois',
  error: 'Endereço não encontrado – tentando de novo…',
  pending: 'Endereço pendente – será preenchido quando houver internet',
};

/** Linhas do carimbo, na ordem em que aparecem. */
export function stampLines(info) {
  const lines = [];
  if (info.tag) lines.push({ text: info.tag, weight: 700, scale: 1.2, color: ACCENT });

  const a = info.address;
  if (a && (a.logradouro || a.cidade || a.bairro)) {
    let l1 = a.logradouro ? `${a.logradouro}, ${a.numero || 's/nº'}` : 'Logradouro não identificado';
    if (a.bairro) l1 += ` – ${a.bairro}`;
    lines.push({ text: l1, weight: 600 });
    const cityUf = [a.cidade, a.uf].filter(Boolean).join(' – ');
    const cep = a.cep ? `CEP ${a.cep}${a.cepAprox ? ' (aprox.)' : ''}` : 'CEP não identificado';
    lines.push({ text: [cityUf, cep].filter(Boolean).join('  ·  '), weight: 500 });
  } else if (info.pos) {
    lines.push({ text: PENDING_TEXT[info.addrStatus] || PENDING_TEXT.pending, weight: 500, color: MUTED });
  }

  if (info.pos) {
    const p = info.pos;
    const acc = Number.isFinite(p.acc) ? `   ±${Math.max(1, Math.round(p.acc))} m` : '';
    lines.push({ text: `Lat ${p.lat.toFixed(6)}   Long ${p.lon.toFixed(6)}${acc}`, weight: 500 });
    if (STAMP.showUTM) {
      const u = toUTM(p.lat, p.lon);
      lines.push({ text: `UTM ${u.zone}${u.hemi}   E ${u.e.toFixed(2)}   N ${u.n.toFixed(2)}   ${STAMP.datum}`, weight: 500 });
    }
  } else {
    lines.push({ text: 'Localização indisponível (sem sinal de GPS)', weight: 500, color: MUTED });
  }

  lines.push({ text: `${fmtDate(info.date)}   ${fmtTime(info.date)}`, weight: 700 });
  return lines;
}

function wrap(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return [text];
  const words = text.split(' ');
  const out = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(test).width > maxW) {
      out.push(line.trim());
      line = w;
    } else {
      line = test;
    }
  }
  if (line.trim()) out.push(line.trim());
  return out;
}

/** Desenha o carimbo no contexto. Retorna a altura da faixa. */
export function drawStamp(ctx, W, H, info) {
  const fs = Math.max(9, Math.min(W, H) * STAMP.fontScale);
  const pad = fs * 0.85;
  const bar = Math.max(2, fs * 0.2);
  const x = pad + bar + fs * 0.65;
  const maxW = W - x - pad;

  const rows = [];
  for (const l of stampLines(info)) {
    const size = fs * (l.scale || 1);
    ctx.font = font(l.weight, size);
    for (const text of wrap(ctx, l.text, maxW)) rows.push({ ...l, text, size, h: size * 1.34 });
  }
  const bandH = rows.reduce((s, r) => s + r.h, 0) + pad * 2;
  const top = H - bandH;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.58)';
  ctx.fillRect(0, top, W, bandH);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(pad, top + pad, bar, bandH - pad * 2);

  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = fs * 0.15;
  let y = top + pad;
  for (const r of rows) {
    ctx.font = font(r.weight, r.size);
    ctx.fillStyle = r.color || '#fff';
    ctx.fillText(r.text, x, y + (r.h - r.size) / 2);
    y += r.h;
  }
  ctx.restore();
  return bandH;
}

export function sizeOf(src) {
  return {
    w: src.videoWidth || src.naturalWidth || src.width,
    h: src.videoHeight || src.naturalHeight || src.height,
  };
}

/** Copia a imagem para um canvas, limitando o maior lado a STAMP.maxSize. */
export function toCanvas(src) {
  const { w, h } = sizeOf(src);
  const k = Math.min(1, STAMP.maxSize / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Foto final: imagem + carimbo. */
export function renderStamped(src, info) {
  const c = toCanvas(src);
  drawStamp(c.getContext('2d'), c.width, c.height, info);
  return c;
}

export function canvasToBlob(c, quality = STAMP.jpegQuality) {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar a imagem'))), 'image/jpeg', quality);
  });
}

export function makeThumb(c, short = 360) {
  const k = short / Math.min(c.width, c.height);
  const t = document.createElement('canvas');
  t.width = Math.round(c.width * k);
  t.height = Math.round(c.height * k);
  const ctx = t.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, 0, 0, t.width, t.height);
  return canvasToBlob(t, 0.78).finally(() => { t.width = t.height = 0; });
}
