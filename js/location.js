// Acompanha o GPS enquanto a câmera está aberta e mantém o endereço atualizado.

import { GEO } from './config.js';
import { distance } from './geo.js';
import { reverseGeocode } from './geocode.js';
import { sleep } from './util.js';

export const state = {
  pos: null,          // { lat, lon, acc, alt, time }
  error: null,        // mensagem de erro do GPS
  address: null,      // último endereço encontrado
  addrFor: null,      // coordenada usada para buscar `address`
  addrStatus: 'idle', // idle | loading | ok | offline | error
};

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}
const emit = () => listeners.forEach((fn) => fn(state));

let watchId = null;
let timer = null;
let inflight = null;
let lastRun = 0;
let backoffUntil = 0;

export function startTracking() {
  stopTracking();
  if (!('geolocation' in navigator)) {
    state.error = 'Este navegador não dá acesso ao GPS.';
    emit();
    return;
  }
  state.error = null;
  emit();
  watchId = navigator.geolocation.watchPosition(onPosition, onError, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 30000,
  });
}

export function stopTracking() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

function onPosition(p) {
  const c = p.coords;
  state.pos = {
    lat: c.latitude,
    lon: c.longitude,
    acc: c.accuracy,
    alt: Number.isFinite(c.altitude) ? c.altitude : null,
    time: p.timestamp || Date.now(),
  };
  state.error = null;
  emit();
  scheduleGeocode();
}

function onError(e) {
  if (e.code === 3 && state.pos) return; // demorou, mas já temos uma posição
  state.error = e.code === 1
    ? 'Localização bloqueada. Libere o acesso à localização para este app.'
    : e.code === 2
      ? 'GPS indisponível. Verifique se a localização do celular está ligada.'
      : 'GPS demorando para responder…';
  emit();
}

function scheduleGeocode() {
  if (timer || inflight) return;
  const wait = Math.max(0, lastRun + 2000 - Date.now(), backoffUntil - Date.now());
  timer = setTimeout(runGeocode, wait);
}

function needsGeocode(p) {
  return !state.address || !state.addrFor || distance(state.addrFor, p) >= GEO.refetchDistance;
}

async function runGeocode() {
  timer = null;
  const p = state.pos;
  if (!p || !needsGeocode(p)) return;
  if (!navigator.onLine) {
    state.addrStatus = 'offline';
    emit();
    return;
  }
  const at = { lat: p.lat, lon: p.lon };
  lastRun = Date.now();
  state.addrStatus = 'loading';
  emit();
  inflight = reverseGeocode(at.lat, at.lon)
    .then((addr) => {
      state.address = addr;
      state.addrFor = at;
      state.addrStatus = 'ok';
      backoffUntil = 0;
    })
    .catch(() => {
      state.addrStatus = navigator.onLine ? 'error' : 'offline';
      backoffUntil = Date.now() + 8000;
    })
    .finally(() => {
      inflight = null;
      emit();
      if (state.pos && needsGeocode(state.pos)) scheduleGeocode();
    });
}

/**
 * Endereço válido para a posição da foto (buscado a até GEO.maxAddressDistance metros).
 * Se uma busca estiver em andamento, espera um pouco por ela.
 */
export async function addressFor(pos, maxWait = 2500) {
  if (!state.address || distance(state.addrFor, pos) > GEO.maxAddressDistance) {
    if (!inflight && navigator.onLine) scheduleGeocode();
    const deadline = Date.now() + maxWait;
    while (Date.now() < deadline) {
      if (inflight) await Promise.race([inflight, sleep(deadline - Date.now())]);
      else await sleep(150);
      if (state.address && distance(state.addrFor, pos) <= GEO.maxAddressDistance) break;
      if (!inflight && !timer) break;
    }
  }
  if (state.address && distance(state.addrFor, pos) <= GEO.maxAddressDistance) return { ...state.address };
  return null;
}

window.addEventListener('online', scheduleGeocode);
window.addEventListener('offline', () => {
  if (!state.address) {
    state.addrStatus = 'offline';
    emit();
  }
});
