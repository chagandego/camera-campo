// Tela da câmera + captura das fotos.

import { APP_NAME, GEO } from './config.js';
import * as cam from './camera.js';
import * as loc from './location.js';
import * as nav from './nav.js';
import { distance } from './geo.js';
import { drawStamp } from './stamp.js';
import { createPhoto, events, listPhotos, processPending } from './photos.js';
import { initGallery } from './gallery.js';
import { initInstall } from './install.js';
import { initUpdate } from './update.js';
import { $, toast } from './util.js';

document.title = APP_NAME;

const video = $('#video');
const frame = $('#frame');
const viewfinder = $('#viewfinder');
const overlay = $('#overlay');
const shutter = $('#btn-shutter');
const torchBtn = $('#btn-torch');

// ---------- identificação (ex.: PV-01) ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
let tag = store.get('tag') || '';

function renderTag() {
  $('#tag-text').textContent = tag || 'Identificação';
  $('#btn-tag').classList.toggle('has-tag', !!tag);
  $('#btn-tag-inc').hidden = !/\d+$/.test(tag);
  drawPreview();
}
function setTag(v) {
  tag = v.trim();
  store.set('tag', tag);
  renderTag();
}
const nextTag = (t) => t.replace(/(\d+)$/, (d) => String(+d + 1).padStart(d.length, '0'));

$('#btn-tag').addEventListener('click', () => {
  const dlg = $('#tag-dialog');
  $('#tag-input').value = tag;
  dlg.showModal();
  setTimeout(() => $('#tag-input').select(), 50);
});
// Aplica na hora do envio (o evento "close" do diálogo chega um pouco depois).
$('#tag-dialog form').addEventListener('submit', () => setTag($('#tag-input').value));
$('#tag-clear').addEventListener('click', () => {
  setTag('');
  $('#tag-dialog').close();
});
$('#btn-tag-inc').addEventListener('click', () => {
  setTag(nextTag(tag));
  toast(`Próxima foto: ${tag}`, 1400);
});

// ---------- câmera ----------
function layout() {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;
  const box = viewfinder.getBoundingClientRect();
  const k = Math.min(box.width / vw, box.height / vh);
  const w = Math.round(vw * k);
  const h = Math.round(vh * k);
  frame.style.width = `${w}px`;
  frame.style.height = `${h}px`;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  overlay.width = Math.round(w * dpr);
  overlay.height = Math.round(h * dpr);
  drawPreview();
}

function liveInfo() {
  const s = loc.state;
  const addrOk = s.address && s.pos && distance(s.addrFor, s.pos) <= GEO.maxAddressDistance;
  return {
    tag,
    pos: s.pos,
    address: addrOk ? s.address : null,
    addrStatus: navigator.onLine ? (s.addrStatus === 'ok' ? 'loading' : s.addrStatus) : 'offline',
    date: new Date(),
  };
}

function drawPreview() {
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!video.videoWidth || !overlay.width) return;
  drawStamp(ctx, overlay.width, overlay.height, liveInfo());
}

function showCamError(msg) {
  $('#cam-error-msg').textContent = msg;
  $('#cam-error').hidden = false;
  frame.hidden = true;
  shutter.disabled = true;
}

let starting = null;
async function startCamera() {
  if (starting) return starting;
  starting = (async () => {
    $('#cam-error').hidden = true;
    frame.hidden = false;
    try {
      await cam.start(video);
      shutter.disabled = false;
      layout();
      torchBtn.hidden = !cam.hasTorch();
      $('#torch-spacer').hidden = !torchBtn.hidden;
      setTorchUI(false);
    } catch (err) {
      showCamError(cam.friendlyError(err));
    } finally {
      starting = null;
    }
  })();
  return starting;
}

function setTorchUI(on) {
  torchBtn.setAttribute('aria-pressed', String(on));
}
torchBtn.addEventListener('click', async () => {
  const on = torchBtn.getAttribute('aria-pressed') !== 'true';
  try {
    await cam.setTorch(on);
    setTorchUI(on);
  } catch {
    toast('Não foi possível ligar a lanterna');
  }
});

video.addEventListener('resize', layout);
video.addEventListener('loadedmetadata', layout);
new ResizeObserver(layout).observe(viewfinder);

$('#btn-retry').addEventListener('click', () => {
  loc.startTracking();
  startCamera();
});

// Alternativa: câmera nativa do celular (resolução máxima) → recebe o mesmo carimbo.
const fileInput = $('#file-input');
$('#btn-native').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  try {
    const bmp = await createImageBitmap(file);
    enqueue(bmp, new Date(), loc.state.pos ? { ...loc.state.pos } : null);
  } catch {
    toast('Não foi possível abrir essa imagem');
  }
});

// ---------- GPS ----------
const pill = $('#gps-pill');
function renderGps() {
  const s = loc.state;
  let state;
  let text;
  if (s.pos) {
    const acc = Math.max(1, Math.round(s.pos.acc));
    const stale = Date.now() - s.pos.time > 30000;
    state = stale ? 'warn' : acc <= 10 ? 'ok' : acc <= 30 ? 'warn' : 'bad';
    text = stale ? `GPS parado · ±${acc} m` : `GPS ±${acc} m`;
  } else if (s.error) {
    state = 'bad';
    text = 'Sem GPS';
  } else {
    state = 'wait';
    text = 'Buscando GPS…';
  }
  pill.dataset.state = state;
  $('#gps-text').textContent = text;
  $('#net-pill').hidden = navigator.onLine;
}
pill.addEventListener('click', () => {
  const s = loc.state;
  if (!s.pos) toast(s.error || 'Procurando sinal de GPS. Fique em local aberto.', 4000);
  else toast(`Precisão de ±${Math.round(s.pos.acc)} m. Quanto menor, melhor — em céu aberto o GPS melhora em alguns segundos.`, 4500);
});
loc.subscribe(() => { renderGps(); drawPreview(); });
window.addEventListener('online', renderGps);
window.addEventListener('offline', renderGps);

// Atualiza relógio e GPS na prévia a cada segundo.
setInterval(() => {
  if (nav.currentView() === 'camera' && !document.hidden) {
    renderGps();
    drawPreview();
  }
}, 1000);

// ---------- captura ----------
let queue = Promise.resolve();
let processing = 0;
let lastShot = 0;

function setProcessing(delta) {
  processing += delta;
  $('#processing').hidden = processing === 0;
}

function release(src) {
  if (typeof src.close === 'function') src.close();
  else if ('width' in src) src.width = src.height = 0;
}

async function finalize(src, date, pos, photoTag) {
  try {
    let address = null;
    let addrStatus = 'none';
    if (pos) {
      address = await loc.addressFor(pos);
      addrStatus = address ? 'ok' : 'pending';
    }
    await createPhoto(src, { date, pos, address, addrStatus, tag: photoTag });
    if (!pos) toast('Foto salva sem coordenadas — o GPS ainda não respondeu.', 3500);
    else if (addrStatus === 'pending') {
      toast('Foto salva. O endereço entra na foto quando houver internet.', 3500);
      setTimeout(processPending, 10000);
    }
  } finally {
    release(src);
  }
}

function enqueue(src, date, pos) {
  const photoTag = tag;
  setProcessing(1);
  queue = queue
    .then(() => finalize(src, date, pos, photoTag))
    .catch((err) => {
      console.error(err);
      toast(`Erro ao salvar a foto: ${err.message || err}`, 5000);
    })
    .finally(() => setProcessing(-1));
}

function takePhoto() {
  if (!cam.isLive() || !video.videoWidth) return;
  const now = performance.now();
  if (now - lastShot < 350) return;
  lastShot = now;

  const date = new Date();
  const src = cam.grab(video);
  const pos = loc.state.pos ? { ...loc.state.pos } : null;

  const fl = $('#flash');
  fl.classList.remove('go');
  void fl.offsetWidth;
  fl.classList.add('go');
  navigator.vibrate?.(30);

  enqueue(src, date, pos);
}
shutter.addEventListener('click', takePhoto);
document.addEventListener('keydown', (e) => {
  if (nav.currentView() !== 'camera' || document.querySelector('dialog[open]')) return;
  if (e.target.closest?.('button, input, a')) return;
  if (e.code === 'Space' || e.key === 'AudioVolumeUp' || e.key === 'AudioVolumeDown') {
    e.preventDefault();
    takePhoto();
  }
});

// ---------- miniatura da última foto ----------
let thumbUrl = null;
async function refreshLastThumb() {
  const all = await listPhotos();
  const img = $('#last-thumb');
  const count = $('#gallery-count');
  if (thumbUrl) URL.revokeObjectURL(thumbUrl);
  thumbUrl = null;
  if (all.length) {
    thumbUrl = URL.createObjectURL(all[0].thumb);
    img.src = thumbUrl;
    img.hidden = false;
    $('#gallery-ico').style.visibility = 'hidden';
  } else {
    img.hidden = true;
    $('#gallery-ico').style.visibility = '';
  }
  count.hidden = !all.length;
  count.textContent = all.length > 999 ? '999+' : String(all.length);
}
events.addEventListener('change', refreshLastThumb);
$('#btn-gallery').addEventListener('click', () => nav.go('gallery'));

// ---------- tela ligada enquanto a câmera estiver aberta ----------
let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock && !document.hidden) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* sem suporte */ }
}

// ---------- ciclo de vida ----------
nav.onView((v) => {
  if (v === 'camera') {
    if (!cam.isLive()) startCamera();
    else requestAnimationFrame(layout);
    keepAwake();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cam.stop();
    loc.stopTracking();
  } else {
    loc.startTracking();
    if (nav.currentView() === 'camera') startCamera();
    keepAwake();
    processPending();
  }
});
window.addEventListener('online', processPending);

initGallery();
initInstall();
renderTag();
renderGps();
refreshLastThumb();
loc.startTracking();
startCamera();
keepAwake();
processPending();
initUpdate(); // funcionamento offline + aviso "Nova atualização"
