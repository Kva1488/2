// Сборка: один самодостаточный HTML-файл (весь код, стили и данные внутри) + PWA-обвязка.
//   dist/index.html            — приложение (работает и с диска, и с GitHub Pages)
//   dist/sw.js, manifest, иконки — офлайн-режим и установка на телефон
//   dist/nebosvod-embed.html   — фрагмент для встраивания (без <html>/<head>/<body>)

import { build, transform } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const between = (html, name) => {
  const a = html.indexOf(`<!-- build:${name} -->`);
  const b = html.indexOf(`<!-- /build:${name} -->`);
  if (a < 0 || b < 0) throw new Error(`нет маркеров build:${name}`);
  return { start: a, end: b + `<!-- /build:${name} -->`.length, inner: html.slice(a + `<!-- build:${name} -->`.length, b) };
};

async function main() {
  const t0 = performance.now();
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  const js = await build({
    entryPoints: [join(root, 'src/main.js')],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2020', 'chrome90', 'firefox90', 'safari15'],
    write: false,
    legalComments: 'none',
  });
  const code = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const cssSrc = await readFile(join(root, 'src/styles.css'), 'utf8');
  const css = (await transform(cssSrc, { loader: 'css', minify: true, target: ['safari15', 'chrome90', 'firefox90'] })).code;
  const version = createHash('sha256').update(code + css).digest('hex').slice(0, 10);

  const template = await readFile(join(root, 'index.html'), 'utf8');

  // Полная страница.
  let html = template;
  const c = between(html, 'css');
  html = html.slice(0, c.start) + `<style>${css}</style>` + html.slice(c.end);
  const j = between(html, 'js');
  html = html.slice(0, j.start) + `<script>${code}</script>` + html.slice(j.end);
  await writeFile(join(dist, 'index.html'), html);

  // Фрагмент для встраивания: заголовок, шрифты, стили, тело и скрипт — без документа-обёртки.
  const body = between(template, 'body').inner.trim();
  const fonts = template.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]+>/)[0];
  const embed = [
    '<title>Небосвод</title>',
    '<meta name="description" content="Живая карта звёздного неба: звёзды, планеты, Луна, сумерки, затмения и метеоры над вашим городом.">',
    fonts,
    `<style>${css}</style>`,
    body,
    '<script>window.NEBO_EMBED = true;</script>',
    `<script>${code}</script>`,
  ].join('\n');
  await writeFile(join(dist, 'nebosvod-embed.html'), embed);

  // Статика и service worker с версией.
  for (const f of await readdir(join(root, 'public'))) {
    if (f === 'sw.js') {
      const sw = (await readFile(join(root, 'public', f), 'utf8')).replace('__VERSION__', version);
      await writeFile(join(dist, f), sw);
    } else await copyFile(join(root, 'public', f), join(dist, f));
  }
  await writeFile(join(dist, '.nojekyll'), '');

  const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} КБ`;
  console.log(`Готово за ${Math.round(performance.now() - t0)} мс · версия ${version}`);
  console.log(`  dist/index.html          ${kb(html)}`);
  console.log(`  dist/nebosvod-embed.html ${kb(embed)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
