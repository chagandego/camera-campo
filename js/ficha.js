// Layout do PV: desenho do CORTE (vista de frente), da PLANTA (vista de cima)
// e a folha completa (cabeçalho, informações gerais, cotas, tubos, foto).
//
// Convenção das posições (olhando o PV de cima, com a "frente" embaixo):
//   esquerda / direita → no corte aparecem como tubo saindo pela parede
//   frente / atrás     → no corte aparecem como "bolinha" (tubo visto de ponta)

import { APP_NAME, STAMP } from './config.js';
import { toUTM } from './geo.js';
import { fmtDate, fmtTime } from './util.js';

export const POSICOES = { esquerda: 'Esquerda', direita: 'Direita', frente: 'Frente', atras: 'Atrás' };
export const SENTIDOS = { chegada: 'Chegada', saida: 'Saída' };
export const TAMPAO = { dificuldade: 'Aberto com dificuldade', facil: 'Aberto facilmente', nao_abriu: 'Não foi possível abrir' };
export const ESTADO = { limpo: 'Limpo', entupido: 'Entupido', assoreado: 'Assoreado', agua: 'Com água' };

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const INK = '#111';

// ---------- números ----------
/** "759,572" ou "759.572" → 759.572. Vazio/inválido → null. */
export function parseNum(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
export const fmt3 = (n) => (n == null ? '—' : n.toFixed(3));
export const fmt2 = (n) => (n == null ? '—' : n.toFixed(2));

/** Profundidade do PV: tampão − fundo; sem as duas cotas, usa a medida digitada. */
export function depthOf(f) {
  if (!f) return null;
  if (f.ct != null && f.cf != null) return f.ct > f.cf ? f.ct - f.cf : null;
  return f.prof != null && f.prof > 0 ? f.prof : null;
}

export const emptyFicha = () => ({ ct: null, cf: null, prof: null, tampao: null, estado: {}, tubos: [], obs: '' });

// ---------- auxiliares de desenho ----------
function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function label(ctx, s, x, y, size, o = {}) {
  ctx.save();
  ctx.translate(x, y);
  if (o.rot) ctx.rotate(o.rot);
  ctx.font = `${o.weight || 600} ${size}px ${FONT}`;
  ctx.textAlign = o.align || 'center';
  ctx.textBaseline = 'middle';
  if (o.bg) {
    const tw = ctx.measureText(s).width;
    const p = size * 0.25;
    const x0 = ctx.textAlign === 'center' ? -tw / 2 : ctx.textAlign === 'right' ? -tw : 0;
    ctx.fillStyle = o.bg;
    ctx.fillRect(x0 - p, -size * 0.62, tw + 2 * p, size * 1.24);
  }
  ctx.fillStyle = o.color || INK;
  ctx.fillText(s, 0, 0);
  ctx.restore();
}

function pattern(ctx, size, bg, color, dots) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);
  g.fillStyle = color;
  for (const [x, y, r] of dots) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return ctx.createPattern(c, 'repeat');
}
const soilPattern = (ctx) => pattern(ctx, 11, '#c9c9c9', '#5f5f5f', [[2, 2, 1], [7, 5, 1.1], [4, 8.5, 0.8], [9.5, 9.5, 0.7]]);
const concretePattern = (ctx) => pattern(ctx, 13, '#f3f3f3', '#9a9a9a', [[3, 3, 0.7], [9, 7, 0.8], [6, 11, 0.6]]);

/** Cota vertical (linha com traços de 45° nas pontas e o valor girado). */
function vdim(ctx, xd, ya, yb, txt, size, lw, u, side = -1) {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw * 0.9;
  line(ctx, xd, ya, xd, yb);
  const k = u * 1.1;
  line(ctx, xd - k, ya + k, xd + k, ya - k);
  line(ctx, xd - k, yb + k, xd + k, yb - k);
  ctx.restore();
  label(ctx, txt, xd + side * size * 0.75, (ya + yb) / 2, size, { rot: -Math.PI / 2, bg: '#e4e4e4' });
}

const validTubos = (f) => (f?.tubos || []).filter((t) => t && POSICOES[t.posicao] && SENTIDOS[t.sentido]);
const diamTxt = (t) => `ø${t.diametro || '?'}`;

// ---------- CORTE (vista de frente) ----------
export function drawCorte(ctx, x, y, w, h, f, o = {}) {
  const D = depthOf(f);
  const u = Math.min(w, h) / 100;
  const fs = Math.max(o.minFont || 0, u * 3.6);
  const lw = Math.max(1, u * 0.32);
  const cx = x + w * 0.5;
  const y0 = y + h * 0.17; // terreno / tampão
  const yB = y + h * 0.75; // fundo interno
  const iw = w * 0.3; // vão interno
  const t = Math.max(3, w * 0.04); // espessura da parede
  const base = t * 1.15;
  const soil = w * 0.12;
  const xL = cx - iw / 2;
  const xR = cx + iw / 2;
  const yBot = yB + base + soil * 0.35;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // terra em volta (contorno irregular)
  const wob = (i) => Math.sin(i * 1.9) * soil * 0.1 + Math.sin(i * 0.7 + 1) * soil * 0.07;
  const N = 9;
  ctx.beginPath();
  ctx.moveTo(xL - t - soil, y0);
  for (let i = 1; i <= N; i++) {
    const k = i / N;
    ctx.lineTo(xL - t - soil * (1 - 0.4 * k ** 3) + wob(i), y0 + (yBot - y0) * k);
  }
  ctx.quadraticCurveTo(cx, yBot + soil * 0.25, xR + t + soil * 0.6 + wob(N + 3), yBot);
  for (let i = N - 1; i >= 0; i--) {
    const k = i / N;
    ctx.lineTo(xR + t + soil * (1 - 0.4 * k ** 3) + wob(i + 4), y0 + (yBot - y0) * k);
  }
  ctx.lineTo(xR + t, y0);
  ctx.lineTo(xR + t, yB + base);
  ctx.lineTo(xL - t, yB + base);
  ctx.lineTo(xL - t, y0);
  ctx.closePath();
  ctx.fillStyle = soilPattern(ctx);
  ctx.fill();

  // paredes e laje de fundo
  ctx.fillStyle = concretePattern(ctx);
  ctx.fillRect(xL - t, y0, t, yB + base - y0);
  ctx.fillRect(xR, y0, t, yB + base - y0);
  ctx.fillRect(xL - t, yB, iw + 2 * t, base);
  ctx.fillStyle = '#fff';
  ctx.fillRect(xL, y0, iw, yB - y0);
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(xL - t, y0);
  ctx.lineTo(xL - t, yB + base);
  ctx.lineTo(xR + t, yB + base);
  ctx.lineTo(xR + t, y0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(xL, y0);
  ctx.lineTo(xL, yB);
  ctx.lineTo(xR, yB);
  ctx.lineTo(xR, y0);
  ctx.stroke();

  // terreno e tampão
  ctx.lineWidth = lw * 1.4;
  line(ctx, x + w * 0.04, y0, xL - t, y0);
  line(ctx, xR + t, y0, x + w * 0.96, y0);
  ctx.lineWidth = lw * 3.5;
  ctx.lineCap = 'butt';
  line(ctx, xL - t * 0.5, y0 - lw * 1.8, xR + t * 0.5, y0 - lw * 1.8);
  ctx.lineCap = 'round';

  // marcas de interrupção (desenho fora de escala)
  const yb = y0 + (yB - y0) * 0.27;
  const g = u * 2.2;
  const gap = u * 1.7;
  for (const [xa, xb] of [[xL - t - soil * 0.9, xL + u * 0.6], [xR - u * 0.6, xR + t + soil * 0.9]]) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(xa, yb + g);
    ctx.lineTo(xb, yb - g);
    ctx.lineTo(xb, yb - g + gap);
    ctx.lineTo(xa, yb + g + gap);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = lw;
    line(ctx, xa, yb + g, xb, yb - g);
    line(ctx, xa, yb + g + gap, xb, yb - g + gap);
  }

  // tubos
  const tubos = validTubos(f);
  const yOf = (tb) => {
    const p = tb.prof != null && tb.prof > 0 ? tb.prof : null;
    let r = 1;
    if (p != null) r = D ? Math.min(p / D, 1) : 0.7;
    return y0 + (yB - y0) * Math.max(r, 0.14);
  };
  const ph = (tb) => Math.max(u * 3, Math.min(w * (0.028 + (tb.diametro || 200) / 10000), (yB - y0) * 0.2));
  const elevated = (tb) => tb.prof != null && tb.prof > 0 && (D == null || tb.prof < D - 0.005);

  ctx.lineWidth = lw;
  for (const side of ['esquerda', 'direita']) {
    const s = side === 'esquerda' ? -1 : 1;
    tubos.filter((tb) => tb.posicao === side).forEach((tb, k) => {
      const yi = yOf(tb);
      const p = ph(tb);
      const outer = side === 'esquerda' ? xL - t - soil * 0.95 : xR + t + soil * 0.95;
      const inner = side === 'esquerda' ? xL : xR;
      const xa = Math.min(outer, inner);
      ctx.fillStyle = '#fff';
      ctx.fillRect(xa, yi - p, Math.abs(inner - outer), p);
      ctx.strokeStyle = INK;
      line(ctx, outer, yi - p, inner, yi - p);
      line(ctx, outer, yi, inner, yi);
      ctx.beginPath();
      ctx.ellipse(outer, yi - p / 2, p * 0.18, p / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      label(ctx, diamTxt(tb), outer - s * fs * 0.85, yi - p - u * 1.2, fs, { rot: -Math.PI / 2, align: 'left', bg: '#fff' });
      if (elevated(tb)) {
        const xd = side === 'esquerda' ? xL + iw * 0.14 + k * fs * 1.6 : xR - iw * 0.12 - k * fs * 1.6;
        vdim(ctx, xd, y0, yi, fmt2(tb.prof), fs, lw, u, side === 'esquerda' ? 1 : -1);
      }
    });
  }

  tubos.filter((tb) => tb.posicao === 'frente' || tb.posicao === 'atras').forEach((tb, k) => {
    const yi = yOf(tb);
    const r = ph(tb) * 0.55;
    const cxk = cx - iw * 0.16 - k * (2 * r + u * 1.5);
    const cyk = yi - r;
    ctx.save();
    if (tb.posicao === 'atras') ctx.setLineDash([u * 1.2, u * 0.8]);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = INK;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(cxk, cyk, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cxk, cyk, r * 0.78, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    label(ctx, diamTxt(tb), cxk + r * 0.9, cyk + r * 1.5, fs * 0.92, { rot: -Math.PI / 4, align: 'left', bg: '#fff' });
    if (elevated(tb)) vdim(ctx, cxk, y0, cyk - r, fmt2(tb.prof), fs, lw, u, 1);
  });

  // profundidade total
  vdim(ctx, cx + iw * 0.12, y0, yB, D == null ? '?' : fmt2(D), fs, lw, u, -1);

  // CT e CF
  const ctTxt = `CT=${fmt3(f?.ct ?? null)}`;
  const tyCT = y + h * 0.07;
  label(ctx, ctTxt, cx, tyCT, fs, { bg: '#e4e4e4' });
  ctx.lineWidth = lw * 0.8;
  line(ctx, cx, tyCT + fs * 0.65, cx, y0 - lw * 3.5);

  const cfTxt = `CF=${fmt3(f?.cf ?? null)}`;
  const tyCF = yB + base + fs * 1.6;
  const txCF = cx + u * 2;
  label(ctx, cfTxt, txCF, tyCF, fs, { align: 'left', bg: '#e4e4e4' });
  line(ctx, cx - iw * 0.08, yB - lw, txCF - u, tyCF);

  ctx.restore();
}

// ---------- PLANTA (vista de cima) ----------
export function drawPlanta(ctx, x, y, w, h, f, o = {}) {
  const u = Math.min(w, h) / 100;
  const fs = Math.max(o.minFont || 0, u * 3.6);
  const lw = Math.max(1, u * 0.32);
  const S = Math.min(w, h) * 0.48;
  const cx = x + w / 2;
  const cy = y + h * 0.46;
  const t = S * 0.07;
  const L = S * 0.34;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;

  // câmara (paredes) e tampão
  ctx.fillStyle = concretePattern(ctx);
  ctx.fillRect(cx - S / 2, cy - S / 2, S, S);
  ctx.fillStyle = '#fff';
  ctx.fillRect(cx - S / 2 + t, cy - S / 2 + t, S - 2 * t, S - 2 * t);
  ctx.strokeRect(cx - S / 2, cy - S / 2, S, S);
  ctx.strokeRect(cx - S / 2 + t, cy - S / 2 + t, S - 2 * t, S - 2 * t);
  for (const r of [S * 0.34, S * 0.29, S * 0.065]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // tubos com seta do fluxo
  const tubos = validTubos(f);
  const dirs = { esquerda: [-1, 0], direita: [1, 0], atras: [0, -1], frente: [0, 1] };
  for (const side of Object.keys(dirs)) {
    const list = tubos.filter((tb) => tb.posicao === side);
    const [dx, dy] = dirs[side];
    list.forEach((tb, i) => {
      const off = (i - (list.length - 1) / 2) * S * 0.3;
      const pw = Math.max(u * 2.6, Math.min(S * (0.06 + (tb.diametro || 200) / 7000), S * 0.2));
      const into = tb.sentido === 'chegada' ? -1 : 1; // -1 = seta aponta para o PV
      if (dx) {
        const x1 = cx + dx * (S / 2);
        const x2 = cx + dx * (S / 2 + L);
        const yc = cy + off;
        ctx.fillStyle = '#fff';
        ctx.fillRect(Math.min(x1, x2), yc - pw / 2, L, pw);
        line(ctx, x1, yc - pw / 2, x2, yc - pw / 2);
        line(ctx, x1, yc + pw / 2, x2, yc + pw / 2);
        line(ctx, x2, yc - pw / 2, x2, yc + pw / 2);
        arrow(ctx, (x1 + x2) / 2, yc, dx * into, 0, pw, u);
        label(ctx, diamTxt(tb), (x1 + x2) / 2, yc - pw / 2 - fs * 0.8, fs, { bg: '#fff' });
      } else {
        const y1 = cy + dy * (S / 2);
        const y2 = cy + dy * (S / 2 + L);
        const xc = cx + off;
        ctx.fillStyle = '#fff';
        ctx.fillRect(xc - pw / 2, Math.min(y1, y2), pw, L);
        line(ctx, xc - pw / 2, y1, xc - pw / 2, y2);
        line(ctx, xc + pw / 2, y1, xc + pw / 2, y2);
        line(ctx, xc - pw / 2, y2, xc + pw / 2, y2);
        arrow(ctx, xc, (y1 + y2) / 2, 0, dy * into, pw, u);
        label(ctx, diamTxt(tb), xc + pw / 2 + u * 1.5, (y1 + y2) / 2, fs, { align: 'left', bg: '#fff' });
      }
    });
  }

  // linhas de centro
  ctx.strokeStyle = '#8a8a8a';
  ctx.lineWidth = lw * 0.7;
  ctx.setLineDash([u * 3.2, u * 1.1, u * 0.5, u * 1.1]);
  const ext = S / 2 + L + u * 3;
  line(ctx, cx - ext, cy, cx + ext, cy);
  line(ctx, cx, cy - ext, cx, cy + ext);
  ctx.setLineDash([]);

  label(ctx, 'FRENTE', cx, cy + S / 2 + L + fs * 1.5, fs * 0.85, { color: '#666', weight: 700 });
  if (o.legend) {
    label(ctx, 'Seta para dentro do PV = chegada · seta para fora = saída', cx, y + h - fs * 0.6, fs * 0.8, { color: '#555', weight: 500 });
  }
  ctx.restore();
}

/** Seta preenchida centrada em (x, y), apontando para (dx, dy). */
function arrow(ctx, x, y, dx, dy, pw, u) {
  const len = Math.max(pw * 1.15, u * 4.2);
  const half = Math.max(pw * 0.42, u * 1.7);
  const tipX = x + (dx * len) / 2;
  const tipY = y + (dy * len) / 2;
  const bx = x - (dx * len) / 2;
  const by = y - (dy * len) / 2;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(bx - dy * half, by + dx * half);
  ctx.lineTo(bx + dy * half, by - dx * half);
  ctx.closePath();
  ctx.fill();
}

// ---------- FOLHA COMPLETA ----------
function checkbox(ctx, x, y, size, checked, text, fs) {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, size, size);
  if (checked) {
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    const p = size * 0.22;
    line(ctx, x + p, y + p, x + size - p, y + size - p);
    line(ctx, x + size - p, y + p, x + p, y + size - p);
  }
  ctx.restore();
  label(ctx, text, x + size + 12, y + size / 2, fs, { align: 'left', weight: checked ? 700 : 500 });
}

function wrapText(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split(/\n/)) {
    let line0 = '';
    for (const word of para.split(/\s+/)) {
      const test = line0 ? `${line0} ${word}` : word;
      if (line0 && ctx.measureText(test).width > maxW) {
        out.push(line0);
        line0 = word;
      } else {
        line0 = test;
      }
    }
    out.push(line0);
  }
  return out;
}

export function addressText(a) {
  if (!a || !(a.logradouro || a.cidade || a.bairro)) return 'Endereço não identificado';
  const l1 = a.logradouro ? `${a.logradouro}, ${a.numero || 's/nº'}` : 'Logradouro não identificado';
  return [l1, a.bairro, [a.cidade, a.uf].filter(Boolean).join('/'), a.cep && `CEP ${a.cep}${a.cepAprox ? ' (aprox.)' : ''}`]
    .filter(Boolean).join(' – ');
}

/** Folha A4 (1240 × 1754 px) com o layout completo do PV. */
export async function renderSheet(rec) {
  const W = 1240;
  const H = 1754;
  const m = 48;
  const f = rec.ficha || emptyFicha();
  const D = depthOf(f);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;

  const cw = W - 2 * m;
  const txt = (s, x, y, size, o = {}) => label(ctx, s, x, y, size, { align: 'left', weight: 500, ...o });
  // Diminui a letra (até `min`) e, se ainda não couber, corta com "…".
  const fit = (s, maxW, size, weight = 500, min = 14) => {
    let sz = size;
    ctx.font = `${weight} ${sz}px ${FONT}`;
    while (sz > min && ctx.measureText(s).width > maxW) {
      sz -= 1;
      ctx.font = `${weight} ${sz}px ${FONT}`;
    }
    let out = s;
    while (out.length > 1 && ctx.measureText(out).width > maxW) out = out.slice(0, -2) + '…';
    return [out, sz];
  };

  // --- cabeçalho ---
  let y = m;
  const hh = 210;
  ctx.strokeRect(m, y, cw, hh);
  ctx.fillStyle = '#ffc400';
  ctx.fillRect(m, y, 10, hh);
  txt(APP_NAME.toUpperCase(), m + 32, y + 42, 36, { weight: 800 });
  txt('CADASTRO DE POÇO DE VISITA', m + 32, y + 84, 20, { color: '#555', weight: 600 });
  label(ctx, 'PV Nº', W - m - 24, y + 30, 18, { align: 'right', color: '#555' });
  const [tagTxt, tagSz] = fit(rec.tag || '—', cw * 0.42, 46, 800, 22);
  label(ctx, tagTxt, W - m - 24, y + 72, tagSz, { align: 'right', weight: 800 });
  ctx.lineWidth = 1.5;
  line(ctx, m + 10, y + 112, W - m, y + 112);
  const d = new Date(rec.createdAt);
  const maxW = cw - 56;
  txt(`Data da foto: ${fmtDate(d)} às ${fmtTime(d)}`, m + 32, y + 136, 19);
  const [addrTxt, addrSz] = fit(`Endereço: ${addressText(rec.address)}`, maxW, 19);
  txt(addrTxt, m + 32, y + 162, addrSz);
  let coords = 'Coordenadas: sem GPS';
  if (rec.pos) {
    const ut = toUTM(rec.pos.lat, rec.pos.lon);
    coords = `Coordenadas: Lat ${rec.pos.lat.toFixed(6)}  Long ${rec.pos.lon.toFixed(6)} (±${Math.round(rec.pos.acc)} m)  ·  ` +
      `UTM ${ut.zone}${ut.hemi}  E ${ut.e.toFixed(2)}  N ${ut.n.toFixed(2)}  ${STAMP.datum}`;
  }
  const [coordTxt, coordSz] = fit(coords, maxW, 19);
  txt(coordTxt, m + 32, y + 188, coordSz);
  y += hh + 16;

  // --- informações gerais ---
  const ih = 250;
  ctx.lineWidth = 2;
  ctx.strokeRect(m, y, cw, ih);
  txt('INFORMAÇÕES GERAIS', m + 20, y + 28, 20, { weight: 800 });
  const c1 = m + 20;
  const c2 = m + 330;
  const c3 = m + 720;
  ctx.lineWidth = 1.5;
  line(ctx, c2 - 20, y + 52, c2 - 20, y + ih - 14);
  line(ctx, c3 - 20, y + 52, c3 - 20, y + ih - 14);
  txt('O PV ESTÁ:', c1, y + 72, 18, { weight: 700 });
  Object.entries(ESTADO).forEach(([k, v], i) => checkbox(ctx, c1, y + 94 + i * 38, 24, !!f.estado?.[k], v, 19));
  txt('O TAMPÃO FOI:', c2, y + 72, 18, { weight: 700 });
  Object.entries(TAMPAO).forEach(([k, v], i) => checkbox(ctx, c2, y + 94 + i * 38, 24, f.tampao === k, v, 19));
  txt('COTAS:', c3, y + 72, 18, { weight: 700 });
  const rows = [
    ['Cota do tampão (CT)', fmt3(f.ct)],
    ['Cota do fundo (CF)', fmt3(f.cf)],
    ['Profundidade', D == null ? '—' : `${fmt2(D)} m`],
  ];
  rows.forEach(([k, v], i) => {
    const yy = y + 110 + i * 44;
    txt(k, c3, yy, 19);
    label(ctx, v, W - m - 24, yy, 21, { align: 'right', weight: 800 });
    ctx.lineWidth = 1;
    line(ctx, c3 + 200, yy + 15, W - m - 20, yy + 15);
  });
  y += ih + 16;

  // --- desenhos ---
  const dh = 600;
  const dw1 = Math.round(cw * 0.55);
  ctx.lineWidth = 2;
  ctx.strokeRect(m, y, cw, dh);
  ctx.lineWidth = 1.5;
  line(ctx, m + dw1, y, m + dw1, y + dh);
  txt('CORTE – VISTA DE FRENTE', m + 20, y + 26, 18, { weight: 800 });
  txt('PLANTA – VISTA DE CIMA', m + dw1 + 20, y + 26, 18, { weight: 800 });
  drawCorte(ctx, m + 10, y + 44, dw1 - 20, dh - 54, f);
  drawPlanta(ctx, m + dw1 + 10, y + 44, cw - dw1 - 20, dh - 54, f, { legend: true });
  y += dh + 16;

  // --- tubos + observações | foto ---
  const bh = H - m - 30 - y;
  const lw0 = 580;
  ctx.lineWidth = 2;
  ctx.strokeRect(m, y, lw0, bh);
  ctx.strokeRect(m + lw0 + 16, y, cw - lw0 - 16, bh);
  txt('TUBOS', m + 20, y + 28, 20, { weight: 800 });
  const cols = [['Nº', 44], ['Fluxo', 112], ['Diâmetro', 112], ['Posição', 120], ['Profund.', 150]];
  let ty = y + 52;
  ctx.fillStyle = '#ececec';
  ctx.fillRect(m + 14, ty, lw0 - 28, 34);
  let cxp = m + 22;
  cols.forEach(([name, cwid]) => { txt(name, cxp, ty + 17, 16, { weight: 700 }); cxp += cwid; });
  ty += 34;
  const tubos = validTubos(f);
  if (!tubos.length) {
    txt('Nenhum tubo informado (PV fechado ou sem dados).', m + 22, ty + 22, 17, { color: '#555' });
    ty += 44;
  }
  tubos.slice(0, 9).forEach((tb, i) => {
    const vals = [
      String(i + 1),
      SENTIDOS[tb.sentido],
      tb.diametro ? `ø ${tb.diametro} mm` : '—',
      POSICOES[tb.posicao],
      tb.prof != null && tb.prof > 0 ? `${fmt2(tb.prof)} m` : (D != null ? `no fundo (${fmt2(D)} m)` : 'no fundo'),
    ];
    let xx = m + 22;
    vals.forEach((v, j) => { txt(v, xx, ty + 18, 17, { weight: j === 0 ? 700 : 500 }); xx += cols[j][1]; });
    ctx.strokeStyle = '#d0d0d0';
    ctx.lineWidth = 1;
    line(ctx, m + 14, ty + 36, m + lw0 - 14, ty + 36);
    ctx.strokeStyle = INK;
    ty += 36;
  });
  if (tubos.length > 9) { txt(`+ ${tubos.length - 9} tubo(s)`, m + 22, ty + 18, 16, { color: '#555' }); ty += 36; }

  ty += 26;
  txt('OBSERVAÇÕES', m + 20, ty, 20, { weight: 800 });
  ctx.font = `500 18px ${FONT}`;
  const obs = (f.obs || '').trim() || '—';
  const lines = wrapText(ctx, obs, lw0 - 44);
  const maxLines = Math.max(0, Math.floor((y + bh - ty - 30) / 26));
  lines.slice(0, maxLines).forEach((l, i) => txt(l, m + 22, ty + 30 + i * 26, 18));

  // foto
  const px = m + lw0 + 16;
  const pw = cw - lw0 - 16;
  txt('FOTO', px + 20, y + 28, 20, { weight: 800 });
  try {
    const bmp = await createImageBitmap(rec.stamped);
    const bx = px + 14;
    const by = y + 48;
    const bw = pw - 28;
    const bhh = bh - 62;
    const k = Math.min(bw / bmp.width, bhh / bmp.height);
    const iw = bmp.width * k;
    const ih2 = bmp.height * k;
    ctx.drawImage(bmp, bx + (bw - iw) / 2, by + (bhh - ih2) / 2, iw, ih2);
    bmp.close?.();
  } catch {
    txt('Foto indisponível', px + 20, y + 80, 18, { color: '#555' });
  }

  // rodapé
  const now = new Date();
  label(ctx, `Gerado pelo app ${APP_NAME} em ${fmtDate(now)} às ${fmtTime(now).slice(0, 5)}`, W - m, H - m + 12, 15, { align: 'right', color: '#777', weight: 500 });
  return c;
}

export async function renderSheetBlob(rec) {
  const c = await renderSheet(rec);
  try {
    return await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar o layout'))), 'image/jpeg', 0.92));
  } finally {
    c.width = c.height = 0;
  }
}
