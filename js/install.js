// Aviso "Instale o app no celular".
// Aparece só quando o app foi aberto pelo navegador do celular (não quando já está instalado).
//  - Android (Chrome, Edge, Samsung…): botão "Instalar" abre a instalação direto.
//    Se o navegador não oferecer isso, mostra o caminho pelo menu ⋮.
//  - iPhone: a Apple não permite instalar por botão, então mostra o passo a passo.

import { $, $$, isIOS, toast } from './util.js';

const DISMISS_KEY = 'install-dismissed-at';
const DISMISS_MS = 24 * 60 * 60 * 1000; // "Agora não" esconde por 1 dia

let deferredPrompt = null;

const isAndroid = () => /Android/i.test(navigator.userAgent);
export const isInstalled = () =>
  matchMedia('(display-mode: standalone)').matches ||
  matchMedia('(display-mode: fullscreen)').matches ||
  navigator.standalone === true;

function dismissedRecently() {
  try {
    return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < DISMISS_MS;
  } catch {
    return false;
  }
}

function show(mode) {
  const card = $('#install-card');
  card.dataset.mode = mode;
  $$('[data-show]', card).forEach((el) => { el.hidden = !el.dataset.show.split(' ').includes(mode); });
  card.hidden = false;
}

function hide() {
  $('#install-card').hidden = true;
}

function maybeShow() {
  if (isInstalled() || dismissedRecently()) return;
  if (isIOS()) show('ios');
  else if (isAndroid()) show('android');
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // guarda o pedido para o nosso botão
  deferredPrompt = e;
});

window.addEventListener('appinstalled', () => {
  hide();
  toast('App instalado! Agora abra pelo ícone na tela do celular.', 5000);
});

export function initInstall() {
  $('#install-later').addEventListener('click', () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    hide();
  });
  $('#install-ok').addEventListener('click', hide);
  $('#install-go').addEventListener('click', async () => {
    if (deferredPrompt) {
      const ev = deferredPrompt;
      deferredPrompt = null;
      ev.prompt();
      const { outcome } = await ev.userChoice;
      if (outcome === 'accepted') hide();
      return;
    }
    show('manual'); // navegador sem instalação direta: ensina pelo menu
  });
  maybeShow();
}
