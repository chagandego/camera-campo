// Busca o endereço a partir da coordenada.
//  1) OpenStreetMap (Nominatim): rua, número, bairro, cidade, UF e, às vezes, CEP.
//  2) Se o CEP não vier, procura no ViaCEP pelo nome da rua (escolhe a faixa de numeração certa).
// Os dois serviços são gratuitos. O Nominatim pede no máximo 1 consulta por segundo,
// por isso todas as consultas passam pela fila `slot()`.

import { norm, sleep } from './util.js';

const UF_BY_NAME = {
  'acre': 'AC', 'alagoas': 'AL', 'amapa': 'AP', 'amazonas': 'AM', 'bahia': 'BA', 'ceara': 'CE',
  'distrito federal': 'DF', 'espirito santo': 'ES', 'goias': 'GO', 'maranhao': 'MA',
  'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG', 'para': 'PA',
  'paraiba': 'PB', 'parana': 'PR', 'pernambuco': 'PE', 'piaui': 'PI', 'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN', 'rio grande do sul': 'RS', 'rondonia': 'RO', 'roraima': 'RR',
  'santa catarina': 'SC', 'sao paulo': 'SP', 'sergipe': 'SE', 'tocantins': 'TO',
};

let queue = Promise.resolve();
let lastCall = 0;
function slot() {
  const turn = queue.then(async () => {
    const wait = lastCall + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
  });
  queue = turn.catch(() => {});
  return turn;
}

async function getJSON(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export function formatCep(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : '';
}

function ufFrom(a) {
  const iso = a['ISO3166-2-lvl4'] || '';
  if (/^BR-[A-Z]{2}$/.test(iso)) return iso.slice(3);
  return UF_BY_NAME[norm(a.state)] || '';
}

/** Endereço da coordenada. Lança erro se não houver internet/serviço. */
export async function reverseGeocode(lat, lon) {
  await slot();
  const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1' +
    `&accept-language=pt-BR&lat=${lat.toFixed(7)}&lon=${lon.toFixed(7)}`;
  const j = await getJSON(url);
  if (j.error) throw new Error(j.error);
  const a = j.address || {};

  const addr = {
    logradouro: a.road || a.pedestrian || a.footway || a.path || a.cycleway || a.square || '',
    numero: a.house_number || '',
    bairro: a.suburb || a.neighbourhood || a.quarter || a.city_district || a.hamlet || '',
    cidade: a.city || a.town || a.village || a.municipality || a.county || '',
    uf: ufFrom(a),
    cep: formatCep(a.postcode),
    cepAprox: false,
  };

  if (!addr.cep && addr.uf && addr.cidade && addr.logradouro) {
    try {
      const found = await cepByStreet(addr);
      if (found) {
        addr.cep = found.cep;
        addr.cepAprox = found.aprox;
        if (!addr.bairro && found.bairro) addr.bairro = found.bairro;
      }
    } catch { /* sem CEP — segue sem ele */ }
  }
  return addr;
}

const STREET_TYPES = /^(rua|r\.|avenida|av\.?|travessa|tv\.?|alameda|al\.?|estrada|estr\.?|rodovia|rod\.?|praca|largo|viela|via|beco|ladeira|passagem|caminho|servidao|vila)\s+/;

function streetName(s) {
  return norm(s).replace(STREET_TYPES, '');
}

/** O número `n` está dentro da faixa descrita pelo ViaCEP (ex.: "de 1001 a 1999 - lado ímpar")? */
function numberInRange(complemento, n) {
  const c = norm(complemento);
  if (!c) return null;
  const parity = c.includes('lado par') ? 0 : c.includes('lado impar') ? 1 : null;
  if (parity !== null && n % 2 !== parity) return false;
  let lo = 0;
  let hi = Infinity;
  let m;
  if ((m = c.match(/de\s+(\d+)(?:\/(\d+))?\s+a\s+(\d+)(?:\/(\d+))?/))) {
    lo = +m[1];
    hi = +(m[4] || m[3]);
  } else if ((m = c.match(/de\s+(\d+)(?:\/(\d+))?\s+ao\s+fim/))) {
    lo = +m[1];
  } else if ((m = c.match(/ate\s+(\d+)(?:\/(\d+))?/))) {
    hi = +(m[2] || m[1]);
  } else if (parity === null) {
    return null;
  }
  return n >= lo && n <= hi;
}

async function cepByStreet(addr) {
  const name = streetName(addr.logradouro);
  if (name.length < 3) return null;
  const url = `https://viacep.com.br/ws/${addr.uf}/${encodeURIComponent(addr.cidade)}/${encodeURIComponent(name)}/json/`;
  let list = await getJSON(url);
  if (!Array.isArray(list)) return null;

  list = list.filter((x) => streetName(x.logradouro) === name);
  if (!list.length) return null;

  if (addr.bairro) {
    const sameBairro = list.filter((x) => norm(x.bairro) === norm(addr.bairro));
    if (sameBairro.length) list = sameBairro;
  }
  if (list.length === 1) return { cep: formatCep(list[0].cep), bairro: list[0].bairro, aprox: false };

  const n = parseInt(addr.numero, 10);
  if (Number.isFinite(n)) {
    const hit = list.find((x) => numberInRange(x.complemento, n) === true);
    if (hit) return { cep: formatCep(hit.cep), bairro: hit.bairro, aprox: false };
  }
  // Rua com vários CEPs e número desconhecido: usa o primeiro e avisa que é aproximado.
  return { cep: formatCep(list[0].cep), bairro: list[0].bairro, aprox: true };
}
