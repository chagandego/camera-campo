// Tela "Layout do PV": os dados do PV ficam ligados à foto, com o desenho atualizando ao vivo.
// Tudo é salvo sozinho enquanto a pessoa preenche.

import * as nav from './nav.js';
import { drawCorte, drawPlanta, depthOf, parseNum, fmt2, fmt3, emptyFicha, POSICOES, SENTIDOS } from './ficha.js';
import { saveFicha, restamp, getPhoto, layoutBlob, layoutFileName, downloadFile, canShareFiles } from './photos.js';
import { $, $$, isIOS, toast } from './util.js';

const DIAMETROS = [100, 150, 200, 250, 300, 400, 500, 600];
const PRESETS = {
  fechado: [],
  passagem: [['chegada', 'esquerda'], ['saida', 'direita']],
  duas: [['chegada', 'esquerda'], ['chegada', 'frente'], ['saida', 'direita']],
  tres: [['chegada', 'esquerda'], ['chegada', 'frente'], ['chegada', 'atras'], ['saida', 'direita']],
};

const form = $('#lay-form');
const canvas = $('#lay-canvas');
const tubosBox = $('#lay-tubos');

let rec = null; // foto aberta
let F = null; // dados do layout em edição
let tag = ''; // Nº do PV em edição
let view = 'corte';
let dirty = false;
let saveTimer = null;
let tagTimer = null;
let tagChain = Promise.resolve();
let autoMode = null; // profundidade calculada pelas cotas?
let active = false;

const clone = (o) => JSON.parse(JSON.stringify(o));
const status = (s) => { $('#lay-sub').textContent = s; };
const title = () => { $('#lay-title').textContent = tag ? `Layout – ${tag}` : 'Layout do PV'; };

// ---------- abrir ----------
export function openLayout(r) {
  rec = r;
  F = Object.assign(emptyFicha(), r.ficha ? clone(r.ficha) : {});
  F.estado = F.estado || {};
  F.tubos = Array.isArray(F.tubos) ? F.tubos : [];
  tag = r.tag || '';
  dirty = false;
  autoMode = null;
  form.tag.value = tag;
  form.ct.value = F.ct ?? '';
  form.cf.value = F.cf ?? '';
  form.prof.value = F.prof ?? '';
  form.obs.value = F.obs || '';
  title();
  status(r.ficha ? 'Salvo automaticamente ✓' : 'Novo layout · tudo é salvo sozinho');
  renderChecks();
  renderTubos();
  updateDepthUI();
  nav.go('layout');
  $('#layout-scroll').scrollTop = 0;
  requestAnimationFrame(sizeCanvas);
}

// ---------- salvar ----------
function changed() {
  dirty = true;
  drawPreview();
  updateDepthUI();
  status('Salvando…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 450);
}

// Os dados e o id são copiados na hora: se a pessoa já abriu outro PV, nada se mistura.
function save() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!rec || !dirty) return Promise.resolve();
  dirty = false;
  const id = rec.id;
  const data = { ...clone(F), updatedAt: Date.now() };
  return saveFicha(id, data)
    .then((saved) => {
      if (rec?.id !== id) return;
      if (saved) rec = saved;
      if (!tagTimer) status('Salvo automaticamente ✓');
    })
    .catch((e) => {
      if (rec?.id === id) { dirty = true; status('Erro ao salvar'); }
      toast(`Erro ao salvar o layout: ${e.message || e}`, 4000);
    });
}

// O Nº do PV também vai no carimbo da foto: refaz o carimbo quando a pessoa para de digitar.
function tagChanged() {
  clearTimeout(tagTimer);
  status('Salvando…');
  tagTimer = setTimeout(applyTag, 900);
}
function applyTag() {
  clearTimeout(tagTimer);
  tagTimer = null;
  if (!rec) return tagChain;
  const id = rec.id;
  const newTag = tag;
  tagChain = tagChain
    .then(async () => {
      const cur = await getPhoto(id);
      if (!cur || (cur.tag || '') === newTag) return;
      const saved = await restamp(cur, { tag: newTag });
      if (saved && rec?.id === id) rec = saved;
    })
    .then(() => { if (rec?.id === id && !dirty && !tagTimer) status('Salvo automaticamente ✓'); })
    .catch((e) => toast(`Erro ao salvar o Nº do PV: ${e.message || e}`, 4000));
  return tagChain;
}

/** Grava tudo que estiver pendente (dados do layout e Nº do PV). */
async function flush() {
  const pData = save(); // copia os dados agora, antes de qualquer espera
  const pTag = tagTimer ? applyTag() : tagChain;
  await Promise.all([pData, pTag]);
}

nav.onView((v) => {
  if (v === 'layout') { active = true; return; }
  if (v === 'sheet') return; // continua no mesmo PV
  if (active) { active = false; flush(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && active) flush(); });

// ---------- campos ----------
form.addEventListener('submit', (e) => e.preventDefault());
form.addEventListener('input', (e) => {
  const el = e.target;
  switch (el.name) {
    case 'tag': tag = el.value.trim(); title(); tagChanged(); return;
    case 'ct': F.ct = parseNum(el.value); break;
    case 'cf': F.cf = parseNum(el.value); break;
    case 'prof': if (el.readOnly) return; F.prof = parseNum(el.value); break;
    case 'obs': F.obs = el.value; break;
    default: return; // tubos são tratados abaixo
  }
  changed();
});

function updateDepthUI() {
  const both = F.ct != null && F.cf != null;
  const D = depthOf(F);
  const inp = form.prof;
  const hint = $('#lay-prof-hint');
  if (both) {
    inp.readOnly = true;
    inp.value = D != null ? D.toFixed(2) : '';
    hint.classList.toggle('bad', D == null);
    hint.textContent = D != null
      ? `Calculada sozinha: ${fmt3(F.ct)} − ${fmt3(F.cf)} = ${fmt2(D)} m`
      : 'A cota do fundo tem que ser menor que a cota do tampão.';
  } else {
    if (autoMode !== false) inp.value = F.prof ?? ''; // saiu do cálculo automático: volta a medida digitada
    inp.readOnly = false;
    hint.classList.remove('bad');
    hint.textContent = 'Com as duas cotas, a profundidade é calculada sozinha. Sem as cotas, digite a profundidade medida (trena).';
  }
  autoMode = both;
  $$('.tubo', tubosBox).forEach((card) => tuboHint(card, F.tubos[+card.dataset.i], D));
}

// ---------- tampão / estado ----------
function renderChecks() {
  $$('.checks[data-group="tampao"] .check', form).forEach((b) => b.setAttribute('aria-checked', String(F.tampao === b.dataset.v)));
  $$('.checks[data-group="estado"] .check', form).forEach((b) => b.setAttribute('aria-checked', String(!!F.estado[b.dataset.v])));
}

form.addEventListener('click', (e) => {
  const b = e.target.closest('.check');
  if (!b) return;
  const v = b.dataset.v;
  if (b.parentElement.dataset.group === 'tampao') {
    F.tampao = F.tampao === v ? null : v; // uma opção só; tocar de novo desmarca
  } else {
    const on = !F.estado[v];
    F.estado[v] = on;
    if (on && v === 'limpo') { F.estado.entupido = false; F.estado.assoreado = false; }
    if (on && (v === 'entupido' || v === 'assoreado')) F.estado.limpo = false;
  }
  renderChecks();
  changed();
});

// ---------- tubos ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const summary = (t) => `${SENTIDOS[t.sentido]} · ø${t.diametro || '?'} · ${POSICOES[t.posicao]}`;

function tuboHTML(t, i) {
  const posBtn = (v, cls, txt) => `<button type="button" class="${cls}" role="radio" data-act="pos" data-v="${v}" aria-checked="${t.posicao === v}">${txt}</button>`;
  const custom = t.diametro && !DIAMETROS.includes(t.diametro) ? t.diametro : '';
  return `
    <div class="tubo" data-i="${i}">
      <div class="tubo-head">
        <span class="tubo-n">Tubo ${i + 1}</span>
        <span class="tubo-sum">${esc(summary(t))}</span>
        <button type="button" class="icon-btn tubo-del" data-act="del" aria-label="Remover tubo ${i + 1}"><svg class="ico"><use href="#i-trash"/></svg></button>
      </div>
      <div class="tubo-label">Fluxo</div>
      <div class="seg" role="radiogroup">
        <button type="button" role="radio" data-act="sentido" data-v="chegada" aria-checked="${t.sentido === 'chegada'}">Chegada (entra)</button>
        <button type="button" role="radio" data-act="sentido" data-v="saida" aria-checked="${t.sentido === 'saida'}">Saída (sai)</button>
      </div>
      <div class="tubo-label">Diâmetro (mm)</div>
      <div class="chips">
        ${DIAMETROS.map((d) => `<button type="button" class="dchip" data-act="diam" data-v="${d}" aria-pressed="${t.diametro === d}">${d}</button>`).join('')}
        <input class="dchip-input" data-act="diam-outro" inputmode="numeric" maxlength="4" placeholder="Outro" aria-label="Outro diâmetro (mm)" value="${custom}">
      </div>
      <div class="tubo-grid">
        <div>
          <div class="tubo-label">Posição (vista de cima)</div>
          <div class="pospad" role="radiogroup">
            ${posBtn('atras', 'pp-top', 'Atrás')}
            ${posBtn('esquerda', 'pp-left', 'Esquerda')}
            <span class="pp-center" aria-hidden="true">PV</span>
            ${posBtn('direita', 'pp-right', 'Direita')}
            ${posBtn('frente', 'pp-bottom', 'Frente')}
          </div>
        </div>
        <label class="field tubo-prof">
          <span class="tubo-label">Profundidade do tubo (m)</span>
          <input data-act="prof" inputmode="decimal" placeholder="Vazio = no fundo" value="${t.prof ?? ''}">
          <small class="tubo-hint"></small>
        </label>
      </div>
    </div>`;
}

function renderTubos() {
  tubosBox.innerHTML = F.tubos.map(tuboHTML).join('');
  $('#lay-tubos-count').textContent = F.tubos.length ? `(${F.tubos.length})` : '';
  const D = depthOf(F);
  $$('.tubo', tubosBox).forEach((card) => tuboHint(card, F.tubos[+card.dataset.i], D));
}

function updateTuboCard(card, t) {
  $$('[data-act="sentido"]', card).forEach((b) => b.setAttribute('aria-checked', String(t.sentido === b.dataset.v)));
  $$('[data-act="pos"]', card).forEach((b) => b.setAttribute('aria-checked', String(t.posicao === b.dataset.v)));
  $$('[data-act="diam"]', card).forEach((b) => b.setAttribute('aria-pressed', String(t.diametro === +b.dataset.v)));
  $('.tubo-sum', card).textContent = summary(t);
}

function tuboHint(card, t, D) {
  const el = $('.tubo-hint', card);
  let txt;
  let bad = false;
  if (t.prof != null && t.prof <= 0) { txt = 'Profundidade inválida.'; bad = true; }
  else if (t.prof != null && D != null && t.prof > D + 0.005) { txt = `Maior que a profundidade do PV (${fmt2(D)} m).`; bad = true; }
  else if (t.prof == null) txt = D != null ? `Chega no fundo (${fmt2(D)} m).` : 'Chega no fundo do PV.';
  else if (D != null) txt = `Chega ${fmt2(Math.max(0, D - t.prof))} m acima do fundo.`;
  else txt = 'Medida a partir do tampão.';
  el.textContent = txt;
  el.classList.toggle('bad', bad);
}

tubosBox.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const card = b.closest('.tubo');
  const i = +card.dataset.i;
  const t = F.tubos[i];
  switch (b.dataset.act) {
    case 'del':
      F.tubos.splice(i, 1);
      renderTubos();
      changed();
      return;
    case 'sentido': t.sentido = b.dataset.v; break;
    case 'pos': t.posicao = b.dataset.v; break;
    case 'diam':
      t.diametro = +b.dataset.v;
      $('[data-act="diam-outro"]', card).value = '';
      break;
    default: return;
  }
  updateTuboCard(card, t);
  changed();
});

tubosBox.addEventListener('input', (e) => {
  const inp = e.target;
  const card = inp.closest('.tubo');
  if (!card) return;
  const t = F.tubos[+card.dataset.i];
  if (inp.dataset.act === 'diam-outro') {
    inp.value = inp.value.replace(/\D/g, '');
    const n = parseInt(inp.value, 10);
    t.diametro = Number.isFinite(n) && n > 0 ? n : null;
  } else if (inp.dataset.act === 'prof') {
    t.prof = parseNum(inp.value);
  } else {
    return;
  }
  updateTuboCard(card, t);
  changed();
});

function addTubo(sentido, posicao) {
  const last = F.tubos[F.tubos.length - 1];
  F.tubos.push({ sentido, posicao, diametro: last?.diametro || 200, prof: null });
}

$('#lay-add').addEventListener('click', () => {
  const used = new Set(F.tubos.map((t) => t.posicao));
  const free = (order) => order.find((p) => !used.has(p)) || order[0];
  if (!F.tubos.length) addTubo('chegada', 'esquerda');
  else if (!F.tubos.some((t) => t.sentido === 'saida')) addTubo('saida', free(['direita', 'frente', 'atras', 'esquerda']));
  else addTubo('chegada', free(['frente', 'atras', 'esquerda', 'direita']));
  renderTubos();
  changed();
  tubosBox.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

$('.presets', form).addEventListener('click', (e) => {
  const b = e.target.closest('[data-preset]');
  if (!b) return;
  if (F.tubos.length && !confirm('Trocar os tubos atuais por este modelo?')) return;
  F.tubos = PRESETS[b.dataset.preset].map(([sentido, posicao]) => ({ sentido, posicao, diametro: 200, prof: null }));
  renderTubos();
  changed();
});

// ---------- desenho ao vivo ----------
function sizeCanvas() {
  const w = canvas.clientWidth;
  if (!w) return;
  const h = Math.round(Math.min(w * 0.86, 400));
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  drawPreview();
}

function drawPreview() {
  if (!F || !canvas.width || !canvas.clientWidth) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const k = canvas.width / w;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  (view === 'corte' ? drawCorte : drawPlanta)(ctx, 0, 0, w, h, F, { minFont: 11 });
}

new ResizeObserver(sizeCanvas).observe(canvas);

$('#lay-view-seg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-v]');
  if (!b) return;
  view = b.dataset.v;
  $$('#lay-view-seg [data-v]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  drawPreview();
});

// ---------- ver layout pronto / salvar / enviar ----------
let sheetFile = null;
let sheetUrl = null;

$('#lay-sheet').addEventListener('click', async () => {
  if (!rec) return;
  if (!rec.ficha) dirty = true; // abriu o layout e quer a folha: grava mesmo sem mudanças
  sheetFile = null;
  $('#sheet-img').hidden = true;
  $('#sheet-loading').hidden = false;
  $('#sheet-loading').textContent = 'Gerando o layout…';
  $('#sheet-title').textContent = tag ? `Layout – ${tag}` : 'Layout do PV';
  $('#sheet-share').hidden = !canShareFiles();
  nav.go('sheet');
  try {
    await flush();
    const r = await getPhoto(rec.id);
    if (!r) throw new Error('foto não encontrada');
    rec = r;
    const blob = await layoutBlob(r);
    sheetFile = new File([blob], layoutFileName(r), { type: 'image/jpeg', lastModified: r.createdAt });
    if (sheetUrl) URL.revokeObjectURL(sheetUrl);
    sheetUrl = URL.createObjectURL(blob);
    $('#sheet-img').src = sheetUrl;
    $('#sheet-img').hidden = false;
    $('#sheet-loading').hidden = true;
  } catch (e) {
    $('#sheet-loading').textContent = `Não foi possível gerar o layout: ${e.message || e}`;
  }
});

// Sem nenhuma espera antes de compartilhar: o iPhone só permite logo após o toque.
$('#sheet-save').addEventListener('click', () => {
  if (!sheetFile) return;
  if (isIOS() && navigator.canShare?.({ files: [sheetFile] })) {
    navigator.share({ files: [sheetFile] }).catch((e) => {
      if (e.name !== 'AbortError') toast(`Não foi possível salvar: ${e.message || e}`, 4000);
    });
    return;
  }
  downloadFile(sheetFile);
  toast('Layout baixado — está na galeria do celular (pasta Download).', 4000);
});

$('#sheet-share').addEventListener('click', () => {
  if (!sheetFile) return;
  navigator.share({ files: [sheetFile] }).catch((e) => {
    if (e.name !== 'AbortError') toast(`Não foi possível enviar: ${e.message || e}`, 4000);
  });
});

nav.onView((v) => {
  if (v === 'layout') requestAnimationFrame(sizeCanvas);
  if (v !== 'sheet' && v !== 'layout' && sheetUrl) {
    URL.revokeObjectURL(sheetUrl);
    sheetUrl = null;
    $('#sheet-img').removeAttribute('src');
  }
});
