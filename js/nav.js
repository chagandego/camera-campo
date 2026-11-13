// Troca de telas (câmera → galeria → foto) usando o histórico do navegador,
// para o botão "voltar" do Android funcionar como esperado.

const listeners = [];
let current = 'camera';

export const currentView = () => current;
export const onView = (fn) => listeners.push(fn);

export function show(view) {
  current = view;
  document.querySelectorAll('.view').forEach((el) => { el.hidden = el.dataset.view !== view; });
  listeners.forEach((fn) => fn(view));
}

export function go(view) {
  history.pushState({ view }, '');
  show(view);
}

export function back() {
  if (history.state?.view && history.state.view !== 'camera') history.back();
  else show('camera');
}

history.replaceState({ view: 'camera' }, '');
window.addEventListener('popstate', (e) => {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  show(e.state?.view || 'camera');
});
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-back]')) back();
});
