// Galeria do app, visualização da foto, edição e exportação.

import * as nav from './nav.js';
import { reverseGeocode, formatCep } from './geocode.js';
import { toUTM } from './geo.js';
import {
  events, listPhotos, removePhotos, restamp, saveToDevice, shareFiles, canShareFiles,
} from './photos.js';
import { $, fmtBytes, fmtDate, fmtDayLabel, fmtTime, isIOS, toast } from './util.js';

let photos = [];
let viewerIndex = 0;
let selecting = false;
const selected = new Set();

// ---------- URLs das imagens (liberadas quando não são mais usadas) ----------
const thumbUrls = new Map(); // id -> { blob, url }
function thumbUrl(rec) {
  const c = thumbUrls.get(rec.id);
  if (c && c.blob === rec.thumb) return c.url;
  if (c) URL.revokeObjectURL(c.url);
  const url = URL.createObjectURL(rec.thumb);
  thumbUrls.set(rec.id, { blob: rec.thumb, url });
  return url;
}
function pruneThumbs() {
  const ids = new Set(photos.map((p) => p.id));
  for (const [id, c] of thumbUrls) {
    if (!ids.has(id)) { URL.revokeObjectURL(c.url); thumbUrls.delete(id); }
  }
}
let fullUrl = null;

// ---------- grade ----------
const svg = (id) => `<svg class="ico"><use href="#${id}"/></svg>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function refresh() {
  photos = await listPhotos();
  pruneThumbs();
  for (const id of [...selected]) if (!photos.some((p) => p.id === id)) selected.delete(id);
  renderGrid();
  if (nav.currentView() === 'viewer') renderViewer();
}

function renderGrid() {
  const grid = $('#grid');
  $('#gallery-empty').hidden = photos.length > 0;
  $('#btn-select').hidden = photos.length === 0;

  const groups = [];
  for (const [i, p] of photos.entries()) {
    const label = fmtDayLabel(new Date(p.createdAt));
    if (!groups.length || groups.at(-1).label !== label) groups.push({ label, items: [] });
    groups.at(-1).items.push([i, p]);
  }

  grid.innerHTML = groups.map((g) => `
    <h2 class="day">${esc(g.label)}<small>${g.items.length} ${g.items.length === 1 ? 'foto' : 'fotos'}</small></h2>
    <div class="grid">${g.items.map(([i, p]) => `
      <button class="cell${selected.has(p.id) ? ' selected' : ''}" type="button" data-i="${i}" aria-label="Foto ${esc(p.tag || '')} ${fmtTime(new Date(p.createdAt))}">
        <img src="${thumbUrl(p)}" alt="" loading="lazy" decoding="async">
        ${p.tag ? `<span class="cell-tag">${esc(p.tag)}</span>` : ''}
        <span class="marks">
          ${p.addrStatus === 'pending' ? `<span class="mark pending" title="Endereço pendente">${svg('i-clock')}</span>` : ''}
          ${p.savedAt ? `<span class="mark saved" title="Já salva no celular">${svg('i-check')}</span>` : ''}
        </span>
        <span class="sel">${svg('i-check')}</span>
      </button>`).join('')}
    </div>`).join('');

  renderHeader();
}

async function renderHeader() {
  const sub = $('#gallery-sub');
  if (selecting) {
    $('#gallery-title').textContent = selected.size ? `${selected.size} selecionada${selected.size > 1 ? 's' : ''}` : 'Toque nas fotos';
    sub.textContent = '';
    $('#btn-select').textContent = 'Cancelar';
  } else {
    $('#gallery-title').textContent = 'Galeria';
    $('#btn-select').textContent = 'Selecionar';
    const unsaved = photos.filter((p) => !p.savedAt).length;
    let text = `${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'}`;
    if (unsaved && photos.length) text += ` · ${unsaved} não salva${unsaved > 1 ? 's' : ''}`;
    sub.textContent = text;
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.usage && !selecting) sub.textContent = `${text} · ${fmtBytes(est.usage)}`;
    } catch { /* sem suporte */ }
  }
  $('#select-bar').hidden = !selecting;
  ['#sel-save', '#sel-share', '#sel-delete'].forEach((s) => { $(s).disabled = selected.size === 0; });
  $('#sel-share').hidden = !canShareFiles();
  $('#sel-all span').textContent = selected.size === photos.length && photos.length ? 'Nenhuma' : 'Todas';
}

function setSelecting(on) {
  selecting = on;
  selected.clear();
  $('#grid').classList.toggle('selecting', on);
  renderGrid();
}

$('#btn-select').addEventListener('click', () => setSelecting(!selecting));

$('#grid').addEventListener('click', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  const i = +cell.dataset.i;
  if (selecting) {
    const id = photos[i].id;
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    cell.classList.toggle('selected', selected.has(id));
    renderHeader();
  } else {
    viewerIndex = i;
    nav.go('viewer');
  }
});

// Toque longo numa foto já entra no modo de seleção (Android).
$('#grid').addEventListener('contextmenu', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  e.preventDefault();
  if (!selecting) setSelecting(true);
  const id = photos[+cell.dataset.i].id;
  selected.add(id);
  renderGrid();
});

const selectedRecs = () => photos.filter((p) => selected.has(p.id));

$('#sel-all').addEventListener('click', () => {
  if (selected.size === photos.length) selected.clear();
  else photos.forEach((p) => selected.add(p.id));
  renderGrid();
});

$('#sel-save').addEventListener('click', () => doSave(selectedRecs(), () => setSelecting(false)));
$('#sel-share').addEventListener('click', () => doShare(selectedRecs()));
$('#sel-delete').addEventListener('click', () => doDelete(selectedRecs(), () => setSelecting(false)));

// ---------- ações ----------
async function doSave(recs, after) {
  if (!recs.length) return;
  try {
    const r = await saveToDevice(recs);
    if (r === 'downloaded') {
      toast(recs.length > 1
        ? `${recs.length} fotos baixadas — estão na galeria do celular (pasta Download).`
        : 'Foto baixada — está na galeria do celular (pasta Download).', 4000);
    } else if (r === 'shared') {
      toast('Pronto!');
    }
    if (r !== 'cancelled') after?.();
  } catch (err) {
    toast(`Não foi possível salvar: ${err.message || err}`, 4000);
  }
}

async function doShare(recs) {
  if (!recs.length) return;
  try {
    await shareFiles(recs);
  } catch (err) {
    toast(`Não foi possível compartilhar: ${err.message || err}`, 4000);
  }
}

async function doDelete(recs, after) {
  if (!recs.length) return;
  const n = recs.length;
  const unsaved = recs.filter((r) => !r.savedAt).length;
  let msg = n === 1 ? 'Excluir esta foto do app?' : `Excluir ${n} fotos do app?`;
  if (unsaved) msg += `\n\nAtenção: ${unsaved === n && n === 1 ? 'ela ainda não foi salva' : `${unsaved} ainda não ${unsaved === 1 ? 'foi salva' : 'foram salvas'}`} no celular.`;
  msg += '\n\nNão dá para desfazer.';
  if (!confirm(msg)) return;
  await removePhotos(recs.map((r) => r.id));
  toast(n === 1 ? 'Foto excluída' : `${n} fotos excluídas`);
  after?.();
}

// ---------- visualizar foto ----------
function renderViewer() {
  if (!photos.length) { nav.back(); return; }
  viewerIndex = Math.max(0, Math.min(viewerIndex, photos.length - 1));
  const rec = photos[viewerIndex];
  const d = new Date(rec.createdAt);

  if (fullUrl) URL.revokeObjectURL(fullUrl);
  fullUrl = URL.createObjectURL(rec.stamped);
  $('#viewer-img').src = fullUrl;

  $('#viewer-title').textContent = rec.tag || 'Foto';
  const bits = [`${fmtDate(d)} ${fmtTime(d).slice(0, 5)}`, `${viewerIndex + 1} de ${photos.length}`];
  if (rec.savedAt) bits.push('salva ✓');
  else if (rec.addrStatus === 'pending') bits.push('endereço pendente');
  $('#viewer-sub').textContent = bits.join(' · ');

  const map = $('#viewer-map');
  map.hidden = !rec.pos;
  if (rec.pos) map.href = `https://www.google.com/maps/search/?api=1&query=${rec.pos.lat.toFixed(7)},${rec.pos.lon.toFixed(7)}`;
  $('#v-share').hidden = !canShareFiles();
}

nav.onView((v) => {
  if (v === 'gallery') refresh();
  if (v === 'viewer') renderViewer();
  if (v === 'camera') {
    if (selecting) setSelecting(false);
    if (fullUrl) { URL.revokeObjectURL(fullUrl); fullUrl = null; }
  }
});

function step(delta) {
  const i = viewerIndex + delta;
  if (i < 0 || i >= photos.length) return;
  viewerIndex = i;
  renderViewer();
}

let touch = null;
const stage = $('#viewer-stage');
stage.addEventListener('touchstart', (e) => {
  touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
}, { passive: true });
stage.addEventListener('touchend', (e) => {
  if (!touch || window.visualViewport?.scale > 1.01) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touch.x;
  const dy = t.clientY - touch.y;
  touch = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
}, { passive: true });
document.addEventListener('keydown', (e) => {
  if (nav.currentView() !== 'viewer' || document.querySelector('dialog[open]')) return;
  if (e.key === 'ArrowRight') step(1);
  if (e.key === 'ArrowLeft') step(-1);
});

const current = () => photos[viewerIndex];
$('#v-save').addEventListener('click', () => doSave([current()]));
$('#v-share').addEventListener('click', () => doShare([current()]));
$('#v-delete').addEventListener('click', () => doDelete([current()]));
$('#v-edit').addEventListener('click', () => openEdit(current()));

// ---------- editar ----------
const editDlg = $('#edit-dialog');
const form = $('#edit-form');
let editing = null;

function openEdit(rec) {
  editing = rec;
  const a = rec.address || {};
  form.tag.value = rec.tag || '';
  for (const k of ['logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep']) form[k].value = a[k] || '';
  const d = new Date(rec.createdAt);
  let info = `${fmtDate(d)} às ${fmtTime(d)}`;
  if (rec.pos) {
    const u = toUTM(rec.pos.lat, rec.pos.lon);
    info = `Lat ${rec.pos.lat.toFixed(6)}, Long ${rec.pos.lon.toFixed(6)} (±${Math.round(rec.pos.acc)} m) · ` +
      `UTM ${u.zone}${u.hemi} E ${u.e.toFixed(2)} N ${u.n.toFixed(2)} · ${info}`;
  } else {
    info = `Sem coordenadas · ${info}`;
  }
  $('#edit-coords').textContent = info;
  $('#btn-regeo').hidden = !rec.pos;
  editDlg.returnValue = '';
  editDlg.showModal();
}

$('#edit-cancel').addEventListener('click', () => editDlg.close('cancel'));

$('#btn-regeo').addEventListener('click', async () => {
  if (!editing?.pos) return;
  const btn = $('#btn-regeo');
  btn.disabled = true;
  try {
    const a = await reverseGeocode(editing.pos.lat, editing.pos.lon);
    for (const k of ['logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep']) form[k].value = a[k] || '';
    form.dataset.cepAprox = a.cepAprox ? '1' : '';
    toast('Endereço encontrado');
  } catch {
    toast(navigator.onLine ? 'Não foi possível buscar o endereço agora.' : 'Sem internet no momento.');
  } finally {
    btn.disabled = false;
  }
});

form.cep.addEventListener('input', () => {
  const d = form.cep.value.replace(/\D/g, '').slice(0, 8);
  form.cep.value = d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
  form.dataset.cepAprox = '';
});

editDlg.addEventListener('close', async () => {
  const rec = editing;
  editing = null;
  if (editDlg.returnValue !== 'save' || !rec) { delete form.dataset.cepAprox; return; }
  const v = (k) => form[k].value.trim();
  const address = {
    logradouro: v('logradouro'),
    numero: v('numero'),
    bairro: v('bairro'),
    cidade: v('cidade'),
    uf: v('uf').toUpperCase(),
    cep: formatCep(v('cep')) || v('cep'),
    cepAprox: form.dataset.cepAprox === '1' || (rec.address?.cepAprox && rec.address?.cep === (formatCep(v('cep')) || v('cep'))),
  };
  delete form.dataset.cepAprox;
  const hasAddress = address.logradouro || address.cidade || address.bairro;
  rec.tag = v('tag');
  rec.address = hasAddress ? address : null;
  rec.addrStatus = hasAddress ? 'manual' : rec.pos ? 'pending' : 'none';
  toast('Atualizando a foto…', 1500);
  try {
    await restamp(rec);
    toast('Foto atualizada');
  } catch (err) {
    toast(`Erro ao atualizar: ${err.message || err}`, 4000);
  }
});

export function initGallery() {
  events.addEventListener('change', () => {
    if (nav.currentView() !== 'camera') refresh();
  });
  if (isIOS()) {
    // No iPhone, "Salvar" abre a folha de compartilhamento: lá aparece "Salvar Imagem".
    $('#v-save').title = 'Escolha "Salvar Imagem" para ir para o app Fotos';
  }
}
