// Criação, atualização e exportação das fotos.

import { APP_NAME } from './config.js';
import * as db from './db.js';
import { addExif } from './exif.js';
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
    ...out,
  };
  await db.putPhoto(rec);
  changed();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  return rec;
}

/** Refaz o carimbo a partir da foto original (depois de editar dados ou achar o endereço). */
export async function restamp(rec) {
  const bmp = await createImageBitmap(rec.original);
  try {
    Object.assign(rec, await render(bmp, infoOf(rec)));
  } finally {
    bmp.close?.();
  }
  rec.savedAt = null;
  await db.putPhoto(rec);
  changed();
  return rec;
}

export async function removePhotos(ids) {
  await db.deletePhotos(ids);
  changed();
}

export const listPhotos = db.listPhotos;

/** Fotos tiradas sem internet: busca o endereço e refaz o carimbo quando a conexão voltar. */
let pendingRunning = false;
export async function processPending() {
  if (pendingRunning || !navigator.onLine) return;
  pendingRunning = true;
  try {
    const pending = (await db.listPhotos()).filter((r) => r.addrStatus === 'pending' && r.pos);
    for (const rec of pending.reverse()) {
      try {
        rec.address = await reverseGeocode(rec.pos.lat, rec.pos.lon);
        rec.addrStatus = 'ok';
        await restamp(rec);
      } catch {
        break; // sem conexão de novo — tenta mais tarde
      }
    }
  } finally {
    pendingRunning = false;
  }
}

function toFiles(recs) {
  return recs.map((r) => new File([r.stamped], fileName(r), { type: 'image/jpeg', lastModified: r.createdAt }));
}

async function markSaved(recs) {
  const now = Date.now();
  for (const r of recs) {
    r.savedAt = now;
    await db.putPhoto(r);
  }
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
 * Retorna 'shared' | 'downloaded' | 'cancelled'.
 */
export async function saveToDevice(recs) {
  const files = toFiles(recs);
  if (isIOS() && navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files });
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      throw e;
    }
    await markSaved(recs);
    return 'shared';
  }
  for (const f of files) {
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    if (files.length > 1) await sleep(400);
  }
  await markSaved(recs);
  return 'downloaded';
}

/** Compartilhar (WhatsApp, e-mail, Drive…). */
export async function shareFiles(recs) {
  const files = toFiles(recs);
  try {
    await navigator.share({ files });
    return true;
  } catch (e) {
    if (e.name === 'AbortError') return false;
    throw e;
  }
}
