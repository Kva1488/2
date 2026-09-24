// Текстура видимой стороны Луны: моря на своих местах (селенографические координаты),
// кратеры-лучи Тихо и Коперника, лёгкое потемнение к краю.
// Ось u — к восточному краю Луны (к Морю Кризисов), v — к северу.

const SIZE = 768;

// [широта°, долгота°, радиус°, тёмность] — моря собираются из нескольких пятен,
// поэтому их края выходят неровными, как на настоящей Луне.
const MARIA = [
  [33, -16, 15, 0.5], [40, -22, 8, 0.4], [26, -8, 8, 0.45], // Море Дождей
  [28, 17.5, 9.5, 0.52], // Море Ясности
  [8.5, 31, 11, 0.5], [4, 24, 6, 0.45], [12, 38, 6, 0.45], // Море Спокойствия
  [17, 59, 7.5, 0.6], // Море Кризисов
  [-5, 51, 8, 0.42], [-12, 55, 6, 0.4], // Море Изобилия
  [-15, 35, 5, 0.42], // Море Нектара
  [-21, -16, 9, 0.38], [-15, -20, 6, 0.35], // Море Облаков
  [-8, -20, 5, 0.33], // Море Познанное
  [20, -57, 12, 0.42], [8, -55, 11, 0.42], [30, -50, 9, 0.38], [-5, -45, 10, 0.4], [-15, -48, 7, 0.35], [40, -40, 7, 0.32], // Океан Бурь
  [-24, -38, 6, 0.45], // Море Влажности
  [56, -10, 5, 0.33], [57, 5, 5, 0.33], [55, 22, 4.5, 0.3], // Море Холода
  [13, 4, 4, 0.38], // Море Паров
  [2, 1, 3.5, 0.35], // Залив Центральный
  [20, 87, 5, 0.35], [-2, 88, 4, 0.3], // Краевое и Смита
];

const CRATERS = [
  [-43.3, -11.2, 3.2, 0.14], // Тихо
  [9.6, -20.1, 3, 0.1], // Коперник
  [8.1, -38, 2, 0.07], // Кеплер
  [23.7, -47.4, 1.5, 0], // Аристарх
];

function project(lat, lon) {
  const r = Math.PI / 180;
  return [Math.cos(lat * r) * Math.sin(lon * r), Math.sin(lat * r), Math.cos(lat * r) * Math.cos(lon * r)];
}

export function buildMoonTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d');
  const R = SIZE / 2;
  const toPx = ([x, y]) => [R + x * R, R - y * R];
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // Базовый тон — светлый реголит материков с лёгкой неравномерностью.
  g.fillStyle = '#e7e3d8';
  g.beginPath();
  g.arc(R, R, R, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.beginPath();
  g.arc(R, R, R, 0, Math.PI * 2);
  g.clip();
  for (let i = 0; i < 220; i++) {
    const x = rnd() * SIZE, y = rnd() * SIZE, rr = 8 + rnd() * 40;
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,253,245,0.05)' : 'rgba(150,145,135,0.05)';
    g.beginPath();
    g.arc(x, y, rr, 0, Math.PI * 2);
    g.fill();
  }

  // Моря: каждое — объединение пятен в отдельном слое (без наложения полупрозрачности),
  // с учётом ракурса: к краю диска пятна сжимаются в эллипсы.
  const layer = document.createElement('canvas');
  layer.width = layer.height = SIZE;
  const lg = layer.getContext('2d');
  for (const [lat, lon, rad, dark] of MARIA) {
    lg.clearRect(0, 0, SIZE, SIZE);
    lg.fillStyle = '#5e6068';
    for (let k = 0; k < 18; k++) {
      const a = rnd() * Math.PI * 2, dist = Math.sqrt(rnd()) * rad * 0.62;
      const la = lat + Math.sin(a) * dist;
      const lo = lon + (Math.cos(a) * dist) / Math.max(Math.cos((lat * Math.PI) / 180), 0.3);
      const p = project(la, lo);
      if (p[2] < 0.02) continue;
      const [x, y] = toPx(p);
      const rr = (rad / 57.3) * R * (0.32 + rnd() * 0.3);
      const ang = Math.atan2(y - R, x - R);
      lg.save();
      lg.translate(x, y);
      lg.rotate(ang);
      lg.scale(Math.max(p[2], 0.15), 1);
      lg.beginPath();
      lg.arc(0, 0, rr, 0, Math.PI * 2);
      lg.fill();
      lg.restore();
    }
    g.globalAlpha = dark * 0.62;
    g.filter = 'blur(2px)';
    g.drawImage(layer, 0, 0);
  }
  g.globalAlpha = 1;
  g.filter = 'none';

  // Мелкие кратеры — очень деликатно.
  for (let i = 0; i < 900; i++) {
    const x = rnd() * SIZE, y = rnd() * SIZE;
    const rr = 0.8 + rnd() * rnd() * 5;
    g.strokeStyle = 'rgba(255,255,250,0.06)';
    g.lineWidth = 0.8;
    g.beginPath();
    g.arc(x, y, rr, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = 'rgba(70,68,62,0.05)';
    g.fill();
  }

  // Молодые кратеры с системами лучей.
  for (const [lat, lon, size, rays] of CRATERS) {
    const p = project(lat, lon);
    if (p[2] < 0) continue;
    const [x, y] = toPx(p);
    if (rays) {
      g.strokeStyle = `rgba(255,255,248,${rays})`;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2 + rnd() * 0.35;
        const len = size * (6 + rnd() * 16);
        g.lineWidth = 0.6 + rnd() * 1.4;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        g.stroke();
      }
    }
    const grd = g.createRadialGradient(x, y, 0, x, y, size * 1.4);
    grd.addColorStop(0, 'rgba(255,255,252,0.55)');
    grd.addColorStop(1, 'rgba(255,255,252,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, size * 1.4, 0, Math.PI * 2);
    g.fill();
  }

  // Потемнение к краю: у Луны слабое, но оно добавляет объём.
  const limb = g.createRadialGradient(R, R, R * 0.55, R, R, R);
  limb.addColorStop(0, 'rgba(0,0,0,0)');
  limb.addColorStop(1, 'rgba(50,44,36,0.22)');
  g.fillStyle = limb;
  g.fillRect(0, 0, SIZE, SIZE);
  g.restore();
  return c;
}
