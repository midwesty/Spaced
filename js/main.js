import { loadGameData } from './data.js';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatStartupError(err) {
  const message = String(err?.message || err || 'Unknown startup error');
  const stack = err?.stack ? `\n\n${err.stack}` : '';

  let hint = '';

  if (message.includes('Unexpected token') && message.includes('export')) {
    hint = `

Most likely cause:
A module file such as engine.js, data.js, ui.js, state.js, utils.js, or CardTable.js is being loaded as a normal script somewhere.

Your index.html should directly load ONLY this one JavaScript file:

<script type="module" src="js/main.js"></script>

Do NOT directly load these with separate script tags:
<script src="js/engine.js"></script>
<script src="js/data.js"></script>
<script src="js/ui.js"></script>
<script src="js/state.js"></script>
<script src="js/utils.js"></script>
<script src="js/CardTable.js"></script>

Also make sure you are opening index.html through GitHub Pages or a local server, not by double-clicking the file.`;
  }

  if (message.includes('Failed to fetch') || (message.includes('Unexpected token') && message.includes('<'))) {
    hint = `

Possible cause:
A JSON file path is wrong, missing, or returning an HTML 404 page instead of JSON.

Make sure all JSON files are inside the /data/ folder and named exactly:
config.json
species.json
classes.json
abilities.json
items.json
statuses.json
companions.json
quests.json
dialogue.json
maps.json
encounters.json
factions.json
tables.json
gamblers.json`;
  }

  if (
    message.includes('Failed to resolve module specifier') ||
    message.includes('404') ||
    message.includes('not found')
  ) {
    hint = `

Possible cause:
A JavaScript module file is missing or in the wrong folder.

Make sure these files are inside /js/:
main.js
data.js
engine.js
state.js
ui.js
utils.js
CardTable.js`;
  }

  return `${message}${hint}${stack}`;
}

function showStartupError(err) {
  console.error(err);

  const splash = document.getElementById('splash');
  if (splash) splash.classList.add('active');

  let box = document.getElementById('startupErrorBox');
  if (!box) {
    const panel = splash?.querySelector('.splash-panel') || document.body;
    box = document.createElement('div');
    box.id = 'startupErrorBox';
    box.style.marginTop = '16px';
    box.style.padding = '12px';
    box.style.border = '1px solid #ad5d67';
    box.style.borderRadius = '12px';
    box.style.background = 'rgba(80,20,20,0.35)';
    box.style.whiteSpace = 'pre-wrap';
    box.style.maxHeight = '320px';
    box.style.overflow = 'auto';
    box.style.fontSize = '13px';
    box.style.lineHeight = '1.45';
    box.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    panel.appendChild(box);
  }

  box.innerHTML = `<strong>Startup error</strong><br>${escapeHtml(formatStartupError(err))}`;
}

window.addEventListener('error', (e) => {
  showStartupError(e.error || e.message || 'Unknown script error');
});

window.addEventListener('unhandledrejection', (e) => {
  showStartupError(e.reason || 'Unhandled promise rejection');
});

async function boot() {
  try {
    const data = await loadGameData();

    const mod = await import('./engine.js');
    const GameEngine = mod.GameEngine;

    if (!GameEngine) {
      throw new Error('engine.js loaded, but it did not export GameEngine.');
    }

    window.game = new GameEngine(data);
    document.getElementById('splash')?.classList.add('active');
  } catch (err) {
    showStartupError(err);
  }
}

boot();