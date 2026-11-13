// Cálculos de coordenadas.

const RAD = Math.PI / 180;

/** Distância em metros entre dois pontos {lat, lon}. */
export function distance(a, b) {
  const R = 6371008.8;
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Converte latitude/longitude em UTM (elipsoide GRS80, o mesmo do SIRGAS 2000).
 * A diferença para WGS84 é milimétrica — bem abaixo da precisão do GPS do celular.
 * Retorna { zone, hemi, e, n } — ex.: { zone: 23, hemi: 'S', e: 333456.78, n: 7394567.89 }.
 */
export function toUTM(lat, lon) {
  const a = 6378137;
  const f = 1 / 298.257222101;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  const ep2 = e2 / (1 - e2);

  const zone = Math.floor((lon + 180) / 6) + 1;
  const lon0 = ((zone - 1) * 6 - 180 + 3) * RAD;
  const phi = lat * RAD;
  const lam = lon * RAD;

  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const tan = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * sin * sin);
  const T = tan * tan;
  const C = ep2 * cos * cos;
  const A = cos * (lam - lon0);

  const M = a * (
    (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi -
    (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi) +
    (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi) -
    (35 * e6 / 3072) * Math.sin(6 * phi)
  );

  const e = k0 * N * (
    A +
    (1 - T + C) * A ** 3 / 6 +
    (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120
  ) + 500000;

  let n = k0 * (M + N * tan * (
    A * A / 2 +
    (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 +
    (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720
  ));
  if (lat < 0) n += 10000000;

  return { zone, hemi: lat < 0 ? 'S' : 'N', e, n };
}
