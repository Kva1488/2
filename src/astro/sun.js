// Положение Солнца (Миус, глава 25, точность ~0.01°).

import { sind, cosd, norm360 } from './math.js';
import { centuries } from './time.js';
import { obliquity, eclToEq } from './coords.js';

export const AU_KM = 149597870.7;
export const SUN_RADIUS_KM = 696000;

/**
 * @param {number} jdTT юлианская дата в TT
 * @returns {{lon:number, ra:number, dec:number, dist:number, meanAnomaly:number}}
 *   видимая эклиптическая долгота, RA/Dec эпохи даты (градусы), расстояние (а. е.)
 */
export function sunPosition(jdTT) {
  const T = centuries(jdTT);
  const L0 = norm360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  const M = norm360(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * sind(M) +
    (0.019993 - 0.000101 * T) * sind(2 * M) +
    0.000289 * sind(3 * M);
  const trueLon = L0 + C;
  const nu = M + C;
  const dist = (1.000001018 * (1 - e * e)) / (1 + e * cosd(nu));
  const omega = 125.04 - 1934.136 * T;
  const lon = norm360(trueLon - 0.00569 - 0.00478 * sind(omega));
  const eps = obliquity(T) + 0.00256 * cosd(omega);
  const [ra, dec] = eclToEq(lon, 0, eps);
  return { lon, ra, dec, dist, meanAnomaly: M };
}
