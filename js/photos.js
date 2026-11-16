// Criação, atualização e exportação das fotos (e do layout do PV de cada foto).

import { APP_NAME } from './config.js';
import * as db from './db.js';
import { addExif } from './exif.js';
import { renderSheetBlob } from './ficha.js';
import { reverseGeocode } from './geocode.js';
import { renderStamped, toCanvas, canvasToBlob, makeThumb } from './stamp.js';
import { fileName, isIOS, sleep } from './util.js';

export const events = new EventTarget();
const changed = () => events.dispatchEvent(new Event('change'));

function describe(info) {
  const a = info.address;
  const parts = [info.tag];
  if (a) parts.push([a.logradouro && `${a.logradouro}, ${a.numero || 's/n'}`, a.bairro, a.cidade && `${a.cidade}-${a.uf}`, a.cep && `CEP ${a.cep}`].filter(Boolean).join(' - '));
  return parts.filter(Boolean).join(' | ');
}

const infoOf = (rec) => ({
  tag: rec.tag,
  pos: rec.pos,
  address: rec.address,
  addrStatus: rec.addrStatus,
  date: new Date(rec.createdAt),
});

async function render(src, info) {
  const canvas = renderStamped(src, info);
  try {
    const jpeg = await canvasToBlob(canvas);
    const stamped = await addExif(jpeg, { date: info.date, pos: info.pos, description: describe(info), software: APP_NAME });
    const thumb = await makeThumb(canvas);
    return { stamped, thumb, width: canvas.width, height: canvas.height };
  } finally {
    canvas.width = canvas.height = 0; // libera memória (importante no iPhone)
  }
}

/** Gera e salva a foto. `src` = canvas/imagem capturada; `info` = { date, pos, address, addrStatus, tag }. */
export async function createPhoto(src, info) {
  const out = await render(src, info);
  const origCanvas = toCanvas(src);
  let original;
  try {
    original = await canvasToBlob(origCanvas, 0.9);
  } finally {
    origCanvas.width = origCanvas.height = 0;
  }
  const rec = {
    id: `${info.date.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: info.date.getTime(),
    tag: info.tag || '',
    pos: info.pos,
    address: info.address,
    addrStatus: info.addrStatus,
    savedAt: null,
    original,
    ficha: null,     // dados do layout do PV
    fichaImg: null,  // imagem pronta do layout (gerada em segundo plano)
    v: 0,            // muda sempre que a foto ou o layout mudam
    ...out,
  };
  await db.putPhoto(rec);
  changed();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  return rec;
}

/**
 * Refaz o carimbo a partir da foto original, aplicando `changes`
 * (ex.: { tag }, { address, addrStatus }). Usa sempre a versão mais recente salva.
 */
export async function restamp(rec, changes = {}) {
  const cur = await db.getPhoto(rec.id);
  if (!cur) return null;
  Object.assign(cur, changes);
  const bmp = await createImageBitmap(cur.original);
  let out;
  try {
    out = await render(bmp, infoOf(cur));
  } finally {
    bmp.close?.();
  }
  const saved = await db.patchPhoto(cur.id, (r) => {
    Object.assign(r, changes, out, { savedAt: null, fichaImg: null, v: (r.v || 0) + 1 });
  });
  changed();
  if (saved?.ficha) scheduleFichaImage(saved.id, 300);
  return saved;
}

/** Grava os dados do layout do PV. */
export async function saveFicha(id, ficha) {
  const saved = await db.patchPhoto(id, (r) => {
    r.ficha = ficha;
    r.fichaImg = null;
    r.v = (r.v || 0) + 1;
  });
  changed();
  if (saved) scheduleFichaImage(id);
  return saved;
}

// Gera a imagem do layout em segundo plano, para salvar/compartilhar sair na hora.
const fichaTimers = new Map();
export function scheduleFichaImage(id, delay = 1500) {
  clearTimeout(fichaTimers.get(id));
  fichaTimers.set(id, setTimeout(() => buildFichaImage(id).catch(() => {}), delay));
}
async function buildFichaImage(id) {
  fichaTimers.delete(id);
  const rec = await db.getPhoto(id);
  if (!rec?.ficha) return;
  const v = rec.v || 0;
  const blob = await renderSheetBlob(rec);
  const saved = await db.patchPhoto(id, (r) => {
    if ((r.v || 0) === v) r.fichaImg = blob; // só grava se nada mudou enquanto gerava
  });
  if (saved?.fichaImg === blob) changed();
}

/** Imagem do layout (a pronta, ou gera agora). */
export function layoutBlob(rec) {
  return rec.fichaImg || renderSheetBlob(rec);
}

export async function removePhotos(ids) {
  await db.deletePhotos(ids);
  changed();
}

export const listPhotos = db.listPhotos;
export const getPhoto = db.getPhoto;

/** Fotos tiradas sem internet: busca o endereço e refaz o carimbo quando a conexão voltar. */
let pendingRunning = false;
export async function processPending() {
  if (pendingRunning || !navigator.onLine) return;
  pendingRunning = true;
  try {
    const pending = (await db.listPhotos()).filter((r) => r.addrStatus === 'pending' && r.pos);
    for (const rec of pending.reverse()) {
      try {
        const address = await reverseGeocode(rec.pos.lat, rec.pos.lon);
        await restamp(rec, { address, addrStatus: 'ok' });
      } catch {
        break; // sem conexão de novo — tenta mais tarde
      }
    }
  } finally {
    pendingRunning = false;
  }
}

export const layoutFileName = (rec) => fileName(rec).replace(/^FOTO_/, 'LAYOUT_');

/**
 * Monta os arquivos. Padrão: a foto e, se a foto tiver layout, o layout junto.
 * { photo: false } = só o layout.
 * Quando as imagens de layout já estão prontas, monta sem nenhuma espera — no iPhone,
 * compartilhar só é permitido logo após o toque.
 */
function filesNow(recs, { photo = true, layout = true } = {}) {
  if (layout && recs.some((r) => r.ficha && !r.fichaImg)) return null;
  const files = [];
  for (const r of recs) {
    if (photo) files.push(new File([r.stamped], fileName(r), { type: 'image/jpeg', lastModified: r.createdAt }));
    if (layout && r.ficha) files.push(new File([r.fichaImg], layoutFileName(r), { type: 'image/jpeg', lastModified: r.createdAt }));
  }
  return files;
}

async function filesFor(recs, opts = {}) {
  const ready = filesNow(recs, opts);
  if (ready) return ready;
  const { photo = true, layout = true } = opts;
  const files = [];
  for (const r of recs) {
    if (photo) files.push(new File([r.stamped], fileName(r), { type: 'image/jpeg', lastModified: r.createdAt }));
    if (layout && r.ficha) {
      const blob = await layoutBlob(r);
      files.push(new File([blob], layoutFileName(r), { type: 'image/jpeg', lastModified: r.createdAt }));
    }
  }
  return files;
}

export function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

async function markSaved(recs) {
  const now = Date.now();
  for (const r of recs) await db.patchPhoto(r.id, (x) => { x.savedAt = now; });
  changed();
}

export const canShareFiles = () => {
  try {
    return !!navigator.canShare?.({ files: [new File([new Blob()], 'x.jpg', { type: 'image/jpeg' })] });
  } catch {
    return false;
  }
};

/**
 * Salva na galeria do celular.
 * iPhone: abre a folha de compartilhamento (opção "Salvar imagem" → vai para o app Fotos).
 * Android/computador: baixa o arquivo (fica na pasta Download, que aparece na galeria).
 * Retorna { result: 'shared' | 'downloaded' | 'cancelled', photos, layouts }.
 */
export async function saveToDevice(recs, opts = {}) {
  const files = filesNow(recs, opts) || (await filesFor(recs, opts));
  const count = {
    photos: opts.photo === false ? 0 : recs.length,
    layouts: files.filter((f) => f.name.startsWith('LAYOUT_')).length,
  };
  if (isIOS() && navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files });
    } catch (e) {
      if (e.name === 'AbortError') return { result: 'cancelled', ...count };
      throw e;
    }
    if (opts.photo !== false) await markSaved(recs);
    return { result: 'shared', ...count };
  }
  for (const f of files) {
    downloadFile(f);
    if (files.length > 1) await sleep(400);
  }
  if (opts.photo !== false) await markSaved(recs);
  return { result: 'downloaded', ...count };
}

/** Compartilhar (WhatsApp, e-mail, Drive…). */
export async function shareFiles(recs, opts = {}) {
  const files = filesNow(recs, opts) || (await filesFor(recs, opts));
  try {
    await navigator.share({ files });
    return true;
  } catch (e) {
    if (e.name === 'AbortError') return false;
    throw e;
  }
}
