// Zoom só na imagem (foto ou layout pronto):
//  - dois dedos para ampliar/reduzir, toque duplo para ampliar/voltar, um dedo para arrastar a imagem ampliada;
//  - no computador, rodinha do mouse e arrastar.
// O resto da tela (título e botões) fica sempre no lugar e no tamanho normal.
// Antes, os dois dedos ampliavam a tela inteira do app e o título e os botões tampavam a imagem.

const MAX = 6; // ampliação máxima
const DOUBLE_TAP = 2.5; // ampliação do toque duplo

// iPhone: impede que o gesto de pinça amplie a tela inteira.
document.addEventListener('gesturestart', (e) => e.preventDefault());

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Deixa `img` ampliável dentro de `stage` (a imagem precisa estar centralizada no stage).
 * `onSwipe(+1|-1)`: deslizar para o lado sem zoom (passar para a próxima/anterior).
 */
export function zoomable(stage, img, { onSwipe } = {}) {
  let s = 1;
  let tx = 0;
  let ty = 0;
  const pts = new Map();
  let pinch = null;
  let pan = null;
  let swipe = null;
  let moved = false;
  let lastTap = null;

  img.draggable = false;

  function apply(anim) {
    img.style.transition = anim ? 'transform 0.2s ease-out' : 'none';
    img.style.transform = s === 1 && !tx && !ty ? '' : `translate(${tx}px, ${ty}px) scale(${s})`;
  }

  // Não deixa a imagem sair da área: só arrasta até a borda dela.
  function clamp() {
    const mx = Math.max(0, (img.offsetWidth * s - stage.clientWidth) / 2);
    const my = Math.max(0, (img.offsetHeight * s - stage.clientHeight) / 2);
    tx = Math.min(mx, Math.max(-mx, tx));
    ty = Math.min(my, Math.max(-my, ty));
  }

  function center() {
    const r = stage.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // Amplia mantendo parado o ponto da imagem que estava em `from`, e leva esse ponto para `to`.
  function zoomTo(ns, from, to, base = { s, tx, ty }) {
    const c = center();
    const qx = (from.x - c.x - base.tx) / base.s;
    const qy = (from.y - c.y - base.ty) / base.s;
    s = Math.min(MAX, Math.max(1, ns));
    tx = to.x - c.x - s * qx;
    ty = to.y - c.y - s * qy;
    clamp();
  }

  function reset(anim = false) {
    s = 1;
    tx = 0;
    ty = 0;
    apply(anim);
  }

  function tap(x, y) {
    const now = Date.now();
    if (lastTap && now - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 40) {
      lastTap = null;
      if (s > 1) reset(true);
      else {
        zoomTo(DOUBLE_TAP, { x, y }, { x, y });
        apply(true);
      }
    } else {
      lastTap = { x, y, t: now };
    }
  }

  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      moved = false;
      pan = { x: e.clientX, y: e.clientY, tx0: tx, ty0: ty };
      swipe = { x: e.clientX, y: e.clientY };
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d0: dist(a, b) || 1, m0: mid(a, b), base: { s, tx, ty } };
      pan = null;
      swipe = null;
      moved = true;
    }
  });

  stage.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      zoomTo(pinch.base.s * (dist(a, b) / pinch.d0), pinch.m0, mid(a, b), pinch.base);
      apply(false);
    } else if (pan) {
      const dx = e.clientX - pan.x;
      const dy = e.clientY - pan.y;
      if (Math.abs(dx) + Math.abs(dy) > 8) moved = true;
      if (s > 1) {
        tx = pan.tx0 + dx;
        ty = pan.ty0 + dy;
        clamp();
        apply(false);
      }
    }
  });

  function end(e) {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (e.type === 'pointerup' && swipe && pts.size === 0) {
      const dx = e.clientX - swipe.x;
      const dy = e.clientY - swipe.y;
      if (s === 1 && onSwipe && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx < 0 ? 1 : -1);
      else if (!moved) tap(e.clientX, e.clientY);
    }
    if (pts.size < 2) pinch = null;
    if (pts.size === 1) {
      const [p] = [...pts.values()];
      pan = { x: p.x, y: p.y, tx0: tx, ty0: ty }; // continua arrastando com o dedo que ficou
      swipe = null;
    }
    if (pts.size === 0) {
      pan = null;
      swipe = null;
      if (s < 1.03) reset(true);
    }
  }
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = { x: e.clientX, y: e.clientY };
    zoomTo(s * Math.exp(-e.deltaY * 0.002), p, p);
    apply(false);
  }, { passive: false });

  img.addEventListener('load', () => reset()); // imagem nova começa sem zoom
  window.addEventListener('resize', () => { clamp(); apply(false); });

  return { reset, isZoomed: () => s > 1 };
}
