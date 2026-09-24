// Точка входа.
import { App } from './app.js';

function start() {
  const app = new App();
  app.init();
  window.nebosvod = app;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
