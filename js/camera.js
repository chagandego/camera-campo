// Acesso à câmera traseira.

import { CAMERA } from './config.js';

let stream = null;
let track = null;

export function friendlyError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'O acesso à câmera foi bloqueado. Libere a câmera para este app nas configurações do navegador e toque em "Tentar novamente".';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Nenhuma câmera encontrada neste aparelho.';
    case 'NotReadableError':
    case 'AbortError':
      return 'A câmera está sendo usada por outro aplicativo. Feche-o e tente novamente.';
    default:
      return err?.message || 'Erro desconhecido ao abrir a câmera.';
  }
}

export async function start(video) {
  stop();
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(window.isSecureContext
      ? 'Este navegador não permite usar a câmera. Use o Chrome (Android) ou o Safari (iPhone).'
      : 'A câmera só funciona com o app aberto em endereço seguro (https).');
  }
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: CAMERA.width },
      height: { ideal: CAMERA.height },
    },
  });
  track = stream.getVideoTracks()[0];
  video.srcObject = stream;
  await video.play().catch(() => {});
  if (!video.videoWidth) {
    await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }));
  }
}

export function stop() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  track = null;
}

export const isLive = () => track?.readyState === 'live';

export function hasTorch() {
  try {
    return !!track?.getCapabilities?.().torch;
  } catch {
    return false;
  }
}

export async function setTorch(on) {
  if (!track) return;
  await track.applyConstraints({ advanced: [{ torch: on }] });
}

/** Congela o quadro atual da câmera num canvas. */
export function grab(video) {
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  return c;
}
