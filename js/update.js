// Aviso "Nova atualização".
// Quando sai uma versão nova do app, o celular baixa tudo em segundo plano e mostra o aviso.
// Ao tocar em "Atualizar", o app recarrega já na versão nova (fotos e layouts continuam no app).
// Se a pessoa tocar em "Depois", a versão nova entra sozinha na próxima vez que o app for aberto do zero.

import { APP_NAME } from './config.js';
import { $, sleep, toast } from './util.js';

const CHECK_MS = 5 * 60 * 1000; // procura versão nova ao voltar para o app (no máximo a cada 5 min)
const SNOOZE_MS = 30 * 60 * 1000; // "Depois" esconde o aviso por 30 min
const FLAG = 'app-just-updated';

let reg = null;
let lastCheck = 0;
let snoozedAt = 0;
let updating = false;
let reloading = false;

const card = () => document.getElementById('update-card');

/** Versão nova baixada e esperando para entrar (só conta se o app já roda por um service worker). */
function waitingWorker() {
  return reg?.waiting && navigator.serviceWorker.controller ? reg.waiting : null;
}

function maybeShow() {
  const el = card();
  if (!el || updating || !waitingWorker()) return;
  if (Date.now() - snoozedAt < SNOOZE_MS) return;
  el.hidden = false;
  document.body.classList.add('has-update'); // esconde o aviso de instalação enquanto isso
}

function hide() {
  const el = card();
  if (el) el.hidden = true;
  document.body.classList.remove('has-update');
}

function watch(worker) {
  if (!worker) return;
  worker.addEventListener('statechange', () => { if (worker.state === 'installed') maybeShow(); });
}

function check() {
  if (!reg || document.hidden || Date.now() - lastCheck < CHECK_MS) return;
  lastCheck = Date.now();
  reg.update().catch(() => {}); // sem internet: tenta de novo mais tarde
}

function reload() {
  if (reloading) return;
  reloading = true;
  location.reload();
}

async function applyUpdate() {
  if (updating) return;
  updating = true;
  const btn = $('#update-go');
  btn.disabled = true;
  btn.textContent = 'Atualizando…';
  $('#update-later').disabled = true;

  // Dá tempo de gravar o que estiver pendente (ex.: layout sendo preenchido).
  const waits = [];
  window.dispatchEvent(new CustomEvent('app:before-update', { detail: { waitUntil: (p) => waits.push(p) } }));
  await Promise.race([Promise.allSettled(waits), sleep(3000)]);

  try { sessionStorage.setItem(FLAG, '1'); } catch { /* ignore */ }
  const w = waitingWorker();
  if (!w) return reload();
  w.postMessage({ type: 'SKIP_WAITING' }); // a versão nova assume e o app recarrega (controllerchange)
  setTimeout(reload, 4000); // garantia, caso o aviso de troca não chegue
}

/** Pergunta ao service worker em uso qual é a versão do app (ex.: 'v5'). */
function askVersion(worker) {
  return new Promise((resolve) => {
    if (!worker) return resolve(null);
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 2000); // versões antigas não respondem
    ch.port1.onmessage = (e) => { clearTimeout(timer); resolve(typeof e.data === 'string' ? e.data : null); };
    try { worker.postMessage({ type: 'GET_VERSION' }, [ch.port2]); } catch { clearTimeout(timer); resolve(null); }
  });
}

const versionLabel = (v) => `versão ${String(v).replace(/^v/i, '')}`;

/** Mostra a versão no fim da galeria (para conferir se o celular já atualizou). */
async function showVersion() {
  const v = await askVersion(navigator.serviceWorker.controller);
  const el = document.getElementById('app-version');
  if (v && el) {
    el.textContent = `${APP_NAME} · ${versionLabel(v)}`;
    el.hidden = false;
  }
  return v;
}

function afterUpdate(version) {
  let flag = null;
  try { flag = sessionStorage.getItem(FLAG); sessionStorage.removeItem(FLAG); } catch { /* ignore */ }
  if (flag && !waitingWorker()) {
    toast(version ? `App atualizado para a ${versionLabel(version)} ✓` : 'App atualizado ✓', 3500);
  }
}

export function initUpdate() {
  if (!('serviceWorker' in navigator)) return;

  $('#update-later')?.addEventListener('click', () => { snoozedAt = Date.now(); hide(); });
  $('#update-go')?.addEventListener('click', applyUpdate);

  // Só recarrega quando foi a pessoa que pediu (na primeira instalação também há troca, e aí não recarrega).
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updating) reload();
    else showVersion(); // primeira instalação: o app acabou de passar a funcionar offline
  });

  const start = () => navigator.serviceWorker.register('sw.js')
    .then(async (r) => {
      reg = r;
      lastCheck = Date.now(); // abrir o app já faz o navegador procurar versão nova
      watch(r.installing);
      r.addEventListener('updatefound', () => watch(r.installing));
      maybeShow();
      afterUpdate(await showVersion());
    })
    .catch(() => {});
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });

  // App instalado costuma ficar aberto em segundo plano: procura versão nova quando a pessoa volta.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    check();
    maybeShow();
  });
  setInterval(check, CHECK_MS);
}
