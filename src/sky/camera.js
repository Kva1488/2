// Камера со стереографической проекцией: сохраняет форму созвездий даже при
// очень широком поле зрения, как в настоящих планетариях.

import { cosd, sind, DEG, clamp, cross, norm360, atan2d, asind } from '../astro/math.js';

export class Camera {
  constructor() {
    this.az = 180; // градусы, от севера через восток
    this.alt = 25;
    this.roll = 0; // поворот вокруг луча зрения (для AR)
    this.fov = 100; // поле зрения по большей стороне экрана, градусы
    this.width = 800;
    this.height = 600;
    this.minFov = 0.5;
    this.maxFov = 220;
    this.update();
  }

  setSize(w, h) {
    this.width = w;
    this.height = h;
    this.update();
  }

  /** Пересчитать базис (f — взгляд, r — вправо, u — вверх) в системе ENU и масштаб. */
  update() {
    this.fov = clamp(this.fov, this.minFov, this.maxFov);
    this.alt = clamp(this.alt, -89.9, 89.9);
    this.az = norm360(this.az);
    if (this.basisOverride) {
      ({ f: this.f, r: this.r, u: this.u } = this.basisOverride);
    } else {
      const f = [cosd(this.alt) * sind(this.az), cosd(this.alt) * cosd(this.az), sind(this.alt)];
      let r = [cosd(this.az), -sind(this.az), 0];
      let u = cross(r, f);
      if (this.roll) {
        const c = cosd(this.roll), s = sind(this.roll);
        const r2 = [r[0] * c + u[0] * s, r[1] * c + u[1] * s, r[2] * c + u[2] * s];
        u = [u[0] * c - r[0] * s, u[1] * c - r[1] * s, u[2] * c - r[2] * s];
        r = r2;
      }
      this.f = f;
      this.r = r;
      this.u = u;
    }
    this.cx = this.width / 2;
    this.cy = this.height / 2;
    const maxDim = Math.max(this.width, this.height);
    this.k = maxDim / (4 * Math.tan((this.fov * DEG) / 4));
    // Пикселей на градус в центре экрана.
    this.pxPerDeg = 2 * this.k * Math.tan(0.5 * DEG);
  }

  /** Задать базис напрямую (AR-режим): f, r, u — единичные векторы ENU. */
  setBasis(f, r, u) {
    this.basisOverride = { f, r, u };
    const [az, alt] = [norm360(atan2d(f[0], f[1])), asind(f[2])];
    this.az = az;
    this.alt = alt;
    this.update();
  }

  clearBasis() {
    this.basisOverride = null;
    this.roll = 0;
    this.update();
  }

  /**
   * Проекция вектора ENU на экран. Возвращает [x, y, cz] или null, если точка позади.
   * cz — косинус угла от центра поля зрения.
   */
  project(v, out) {
    const cz = v[0] * this.f[0] + v[1] * this.f[1] + v[2] * this.f[2];
    if (cz < -0.85) return null;
    const cx = v[0] * this.r[0] + v[1] * this.r[1] + v[2] * this.r[2];
    const cy = v[0] * this.u[0] + v[1] * this.u[1] + v[2] * this.u[2];
    const s = (2 * this.k) / (1 + cz);
    out = out || [0, 0, 0];
    out[0] = this.cx + cx * s;
    out[1] = this.cy - cy * s;
    out[2] = cz;
    return out;
  }

  /** Экранная точка → единичный вектор ENU. */
  unproject(x, y) {
    const X = x - this.cx, Y = this.cy - y;
    const rho = Math.hypot(X, Y);
    if (rho < 1e-9) return [...this.f];
    const c = 2 * Math.atan(rho / (2 * this.k));
    const sc = Math.sin(c) / rho, cc = Math.cos(c);
    return [
      this.f[0] * cc + (this.r[0] * X + this.u[0] * Y) * sc,
      this.f[1] * cc + (this.r[1] * X + this.u[1] * Y) * sc,
      this.f[2] * cc + (this.r[2] * X + this.u[2] * Y) * sc,
    ];
  }

  /** Направление в камеру по пикселю буфера: [cx, cy, cz] (без базиса). */
  rayLocal(x, y) {
    const X = x - this.cx, Y = this.cy - y;
    const rho = Math.hypot(X, Y);
    if (rho < 1e-9) return [0, 0, 1];
    const c = 2 * Math.atan(rho / (2 * this.k));
    const s = Math.sin(c) / rho;
    return [X * s, Y * s, Math.cos(c)];
  }

  /** Угловое расстояние (градусы), соответствующее отрезку в пикселях в центре экрана. */
  pxToDeg(px) {
    return px / this.pxPerDeg;
  }

  /**
   * Повернуть камеру так, чтобы направление `from` (ENU) оказалось там, где сейчас `to`.
   * Используется для «перетаскивания неба» и зума к курсору. Горизонт остаётся горизонтальным.
   */
  rotateFromTo(from, to) {
    // Разница по азимуту и высоте в сферических координатах — устойчиво и без крена.
    const [az1, alt1] = [atan2d(from[0], from[1]), asind(from[2])];
    const [az2, alt2] = [atan2d(to[0], to[1]), asind(to[2])];
    let dAz = az1 - az2;
    dAz = ((dAz + 540) % 360) - 180;
    // Вблизи зенита азимут вырождается: ограничиваем шаг, чтобы небо не «прыгало».
    this.az += clamp(dAz, -30, 30);
    this.alt += alt1 - alt2;
    this.update();
  }
}
