import { $, $$, clamp, createEl, formatTime, getById } from './utils.js';

// ─── PANEL DRAG ───────────────────────────────────────────────────────────────
function initPanelDrag(panel) {
  const header = panel.querySelector('.panel-header');
  if (!header) return;
  let dragging = false, startMoved = false, offX = 0, offY = 0, startX = 0, startY = 0;

  header.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    startX = e.clientX; startY = e.clientY;
    const rect = panel.getBoundingClientRect();
    offX = e.clientX - rect.left;
    offY = e.clientY - rect.top;
    startMoved = false;
    dragging = true;
    header.setPointerCapture(e.pointerId);
  });

  header.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const moved = Math.hypot(e.clientX - startX, e.clientY - startY);
    if (!startMoved && moved < 6) return;
    startMoved = true;
    panel.style.left      = `${clamp(e.clientX - offX, 4, window.innerWidth  - 60)}px`;
    panel.style.top       = `${clamp(e.clientY - offY, 4, window.innerHeight - 40)}px`;
    panel.style.right     = 'auto';
    panel.style.transform = 'none';
  });

  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t =>
    header.addEventListener(t, () => { dragging = false; startMoved = false; })
  );
}

function centerPanel(panel) {
  const w = panel.offsetWidth  || 420;
  const h = panel.offsetHeight || 300;
  panel.style.left      = `${Math.max(4, (window.innerWidth  - w) / 2)}px`;
  panel.style.top       = `${Math.max(4, (window.innerHeight - h) / 3)}px`;
  panel.style.right     = 'auto';
  panel.style.transform = 'none';
}

// ─── INIT PANELS ──────────────────────────────────────────────────────────────
export function initPanels(state, api) {
  $$('.panel').forEach(panel => {
    const closeBtn    = panel.querySelector('.close-btn');
    const collapseBtn = panel.querySelector('.collapse-btn');
    [closeBtn, collapseBtn].forEach(btn => {
      if (!btn) return;
      ['pointerdown','pointerup','click'].forEach(t =>
        btn.addEventListener(t, e => { e.stopPropagation(); e.preventDefault(); })
      );
    });
    closeBtn?.addEventListener('click',    () => panel.classList.add('hidden'));
    collapseBtn?.addEventListener('click', () => panel.classList.toggle('collapsed'));
    initPanelDrag(panel);
  });

  $$('[data-panel]').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = document.getElementById(btn.dataset.panel);
      if (!panel) return;
      const wasHidden = panel.classList.contains('hidden');
      panel.classList.toggle('hidden');
      panel.classList.remove('collapsed');
      if (wasHidden) requestAnimationFrame(() => centerPanel(panel));
    });
  });

  $('#openCodexBtn')?.addEventListener('click', () => {
    const p = $('#codexPanel');
    p.classList.remove('hidden');
    $('#splash').classList.remove('active');
    $('#gameRoot').classList.add('active');
    renderCodex();
    requestAnimationFrame(() => centerPanel(p));
  });

  // Collapsible HUD bottom
  const hudToggle = $('#hudToggleBtn');
  if (hudToggle) {
    hudToggle.addEventListener('click', () => {
      const hud = $('#hudBottom');
      hud.classList.toggle('hud-collapsed');
      hudToggle.textContent = hud.classList.contains('hud-collapsed') ? '▲' : '▼';
    });
  }
}

// ─── TOP HUD ──────────────────────────────────────────────────────────────────
export function renderTopHUD(state, data) {
  const clockEl    = $('#worldClock');
  const locEl      = $('#locationName');
  const modeEl     = $('#modeName');
  const threatEl   = $('#threatName');
  if (!clockEl) return;

  clockEl.textContent  = formatTime(state.timeMinutes);
  locEl.textContent    = currentMap(state, data)?.name || '—';

  const turnActor = state.combat.active
    ? state.roster.find(a => a.id === state.combat.turnOrder[state.combat.currentTurnIndex])
    : null;
  modeEl.textContent  = state.combat.active ? `Combat · ${turnActor?.name || '—'}` : 'Exploration';
  threatEl.textContent = state.combat.active
    ? `Round ${state.combat.round}`
    : (currentMap(state, data)?.threat || 'Low');

  document.body.classList.toggle('in-combat', !!state.combat.active);
}

// ─── PARTY STRIP ──────────────────────────────────────────────────────────────
export function renderPartyStrip(state, data, api) {
  const root = $('#partyStrip');
  if (!root) return;
  root.innerHTML = '';
  const party = state.party.map(id => state.roster.find(a => a.id === id)).filter(Boolean);
  party.forEach(actor => {
    const hpPct   = Math.max(0, (actor.hp / actor.hpMax) * 100);
    const hpColor = actor.downed ? '#555' : hpPct > 50 ? '#86dfa3' : hpPct > 25 ? '#ffcc6b' : '#ff6e6e';
    const isAI    = state.combat.active && state.combat.aiActingId === actor.id;
    const card = createEl('div', {
      class: `party-card ${state.selectedActorId === actor.id ? 'selected' : ''} ${isAI ? 'ai-acting-card' : ''}`
    });
    card.innerHTML = `
      <div class="row">
        <strong>${actor.name}</strong>
        <span class="small">${actor.classId}${isAI ? ' ◉' : ''}</span>
      </div>
      <div class="small">${actor.speciesId} · Lv ${actor.level}</div>
      <div class="bar"><div class="fill" style="width:${hpPct}%;background:${hpColor}"></div></div>
      <div class="small">HP ${actor.hp}/${actor.hpMax}${actor.dead ? ' · DEAD' : actor.downed ? ' · DOWN' : ''}</div>
      <div class="bar"><div class="fill" style="width:${actor.survival?.hunger ?? 0}%;background:#ffcc6b"></div></div>
      <div class="small">
        🍖${Math.round(actor.survival?.hunger ?? 0)}
        💧${Math.round(actor.survival?.thirst ?? 0)}
        ♥${Math.round(actor.survival?.morale ?? 0)}
      </div>
    `;
    card.addEventListener('click', () => {
      state.selectedActorId = actor.id;
      api.centerOnActor(actor);
      api.renderAll();
    });
    root.appendChild(card);
  });
}

function currentMap(state, data) {
  return data.maps.find(m => m.id === state.mapId);
}

// ─── MAP RENDER ───────────────────────────────────────────────────────────────
export function renderMap(state, data, api) {
  const map         = currentMap(state, data);
  const tileLayer   = $('#tileLayer');
  const entityLayer = $('#entityLayer');
  tileLayer.innerHTML   = '';
  entityLayer.innerHTML = '';
  if (!map) return;

  const size = data.config.map.tileSize;
  document.documentElement.style.setProperty('--tile', `${size}px`);

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = map.tiles[y]?.[x];
      if (!t) continue;
      const revealed = api.isTileRevealed(x, y);

      let cls = `tile ${t.type}`;
      if (!revealed) {
        cls += ' fogged';
      } else {
        if (t.cover) cls += ' cover';
        // Classify the tile's interactive nature for icon rendering
        if (t.transition)      cls += ' tile-door';
        else if (t.loot)       cls += ' tile-loot';
        else if (t.interact)   cls += ' tile-interact';
      }

      const tile = createEl('div', { class: cls });
      tile.style.left = `${x * size}px`;
      tile.style.top  = `${y * size}px`;
      tile.dataset.x  = x;
      tile.dataset.y  = y;

      // Add icon span for interactive/loot/door tiles
      if (revealed && (t.transition || t.loot || t.interact)) {
        const iconSpan = createEl('span', { class: 'tile-icon' });
        iconSpan.textContent = getTileIcon(t);
        tile.appendChild(iconSpan);
      }

      if (revealed) {
        tile.addEventListener('click', (e) => api.handleTileClick(x, y, e));
        tile.addEventListener('contextmenu', (e) => { e.preventDefault(); api.handleTileContext(x, y, e); });
      }
      tileLayer.appendChild(tile);
    }
  }

  // Entities
  const roleIcon   = { player: '★', ally: '◉', enemy: '✕', neutral: '◆' };
  const actorsHere = state.roster.filter(a => a.mapId === state.mapId && !a.dead);

  actorsHere.forEach(actor => {
    const revealed = api.isTileRevealed(actor.x, actor.y);
    if (!revealed && !state.party.includes(actor.id)) return;

    const isAI      = state.combat.aiActingId === actor.id;
    const isCurrent = state.combat.active &&
      state.combat.turnOrder[state.combat.currentTurnIndex] === actor.id;

    let cls = `entity ${actor.role}`;
    if (actor.downed)                         cls += ' down';
    if (state.selectedActorId === actor.id)   cls += ' selected';
    if (actor.statuses.includes('stealthed')) cls += ' stealthed';
    if (isAI)                                 cls += ' ai-acting';
    if (isCurrent && !isAI)                   cls += ' current-turn';

    const ent = createEl('div', { class: cls });
    ent.style.left = `${actor.x * size}px`;
    ent.style.top  = `${actor.y * size}px`;
    ent.dataset.actorid = actor.id;

    const icon = roleIcon[actor.role] || actor.name.split(' ').map(w => w[0]).slice(0, 2).join('');
    ent.innerHTML = `<span class="icon">${icon}</span><div class="bubble">${actor.name}</div>`;

    ent.addEventListener('pointerdown', e => e.stopPropagation());
    ent.addEventListener('click', e => { e.stopPropagation(); api.handleActorPrimary(actor.id, e); });
    ent.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      api.showActorContext(actor.id, e.clientX, e.clientY);
    });
    entityLayer.appendChild(ent);
  });
}

// Determine the best icon glyph for a tile based on its content
function getTileIcon(t) {
  // Doors / transitions first — most important to identify
  if (t.transition) {
    const dest = t.transition.mapId || '';
    if (dest.includes('vent'))    return '▤'; // grate/vent
    if (dest.includes('hold'))    return '⬒'; // hatch
    if (dest.includes('wake'))    return '⬡'; // ship airlock
    if (dest.includes('jail'))    return '▦'; // barred door
    if (dest.includes('archive')) return '▤'; // archive hatch
    if (dest.includes('derelict'))return '⬡'; // pressure door
    return '▣';                               // generic door
  }

  // Loot containers — use container name clues
  if (t.loot) {
    const name = (t.containerName || t.interactText || '').toLowerCase();
    if (name.includes('crate') || name.includes('cargo') || name.includes('duffel') || name.includes('box'))  return '▩';
    if (name.includes('locker') || name.includes('lock') || name.includes('cache') || name.includes('safe')) return '▪';
    if (name.includes('cabinet') || name.includes('trunk') || name.includes('reliquary'))                    return '▫';
    if (name.includes('drawer') || name.includes('desk'))  return '▬';
    if (name.includes('pod') || name.includes('barrel'))   return '▧';
    if (name.includes('shelf') || name.includes('record')) return '▤';
    return '◈'; // generic loot
  }

  // Interact-only tiles — classify by interactText keywords
  if (t.interact) {
    const txt = (t.interactText || '').toLowerCase();
    if (txt.includes('door') || txt.includes('gate') || txt.includes('hatch') || txt.includes('grate')) return '▣';
    if (txt.includes('terminal') || txt.includes('console') || txt.includes('computer') || txt.includes('panel')) return '▦';
    if (txt.includes('desk') || txt.includes('counter') || txt.includes('workbench') || txt.includes('table')) return '▬';
    if (txt.includes('bunk') || txt.includes('bed') || txt.includes('rest')) return '▭';
    if (txt.includes('galley') || txt.includes('cook') || txt.includes('food') || txt.includes('kitchen')) return '◇';
    if (txt.includes('stall') || txt.includes('shop') || txt.includes('vendor') || txt.includes('market')) return '◆';
    if (txt.includes('board') || txt.includes('bulletin') || txt.includes('notice') || txt.includes('sign')) return '▤';
    if (txt.includes('nav') || txt.includes('navigation') || txt.includes('chart') || txt.includes('sector')) return '◈';
    if (txt.includes('med') || txt.includes('scan') || txt.includes('clinic') || txt.includes('diagnostic')) return '✚';
    if (txt.includes('engine') || txt.includes('reactor') || txt.includes('fuel')) return '◉';
    if (txt.includes('strut') || txt.includes('berth') || txt.includes('cradle') || txt.includes('mooring')) return '◎';
    if (txt.includes('airlock') || txt.includes('seal') || txt.includes('berth e-7')) return '▣';
    if (txt.includes('camp') || txt.includes('fire pit')) return '◇';
    if (txt.includes('corridor') || txt.includes('passage') || txt.includes('junction')) return '◌';
    return '◇'; // generic interact
  }

  return '·';
}

// ─── RESOURCES ────────────────────────────────────────────────────────────────
export function renderResources(state) {
  const bar = $('#resourceBar');
  if (!bar) return;
  bar.innerHTML = '';
  [
    ['Credits', state.resources.credits],
    ['Fuel',    `${state.resources.fuel}/${state.ship.fuelCapacity}`],
    ['Rations', state.resources.rations],
    ['Water',   state.resources.water],
    ['Supplies',state.resources.shipSupplies],
    ['Medgel',  state.resources.medgel],
    ['Scrap',   state.resources.scrap],
  ].forEach(([label, val]) => {
    bar.appendChild(createEl('div', { class: 'resource-chip' },
      `<span class="small">${label}</span><strong>${val}</strong>`));
  });
}

// ─── ACTION BAR ───────────────────────────────────────────────────────────────
export function renderActionBar(state, data, api) {
  const bar = $('#actionBar');
  if (!bar) return;
  bar.innerHTML = '';

  const actor = state.party
    .map(id => state.roster.find(a => a.id === id))
    .filter(Boolean)
    .find(a => a.id === state.selectedActorId)
    || state.roster.find(a => state.party.includes(a.id) && !a.dead);

  if (!actor) return;

  if (state.combat.active) {
    const strip = createEl('div', { class: 'combat-roster' });
    state.combat.turnOrder.forEach((id, idx) => {
      const a = state.roster.find(x => x.id === id);
      if (!a) return;
      const isCurrent = idx === state.combat.currentTurnIndex;
      const isAI      = state.combat.aiActingId === id;
      strip.appendChild(createEl('div', {
        class: `combatant-chip ${a.role} ${isCurrent ? 'current' : ''} ${a.dead ? 'dead' : ''} ${isAI ? 'ai-acting' : ''}`
      }, `${a.name} ${a.hp}/${a.hpMax}`));
    });
    bar.appendChild(strip);
  }

  if (actor.abilities?.length) {
    const strip = createEl('div', { class: 'ability-strip' });
    actor.abilities.forEach(id => {
      const ability = getById(data.abilities, id);
      if (!ability) return;
      const btn = createEl('button', { class: 'ability-chip' },
        `${ability.name} [${ability.costType || 'action'}]`);
      btn.addEventListener('click', () => api.setPendingAction({ type: 'ability', abilityId: id }));
      strip.appendChild(btn);
    });
    bar.appendChild(strip);
  }

  if (!state.combat.active) {
    const row = createEl('div', { class: 'row-wrap' });
    const mk = (label, action) => {
      const b = createEl('button', {}, label);
      b.addEventListener('click', () => api.setPendingAction(action));
      return b;
    };
    row.append(mk('Move', 'move'), mk('Talk', 'talk'), mk('Loot', 'loot'));
    const restBtn = createEl('button', { class: 'secondary' }, 'Rest');
    restBtn.addEventListener('click', () => api.longRest());
    row.appendChild(restBtn);
    const followBtn = createEl('button', { class: 'secondary' },
      `Follow: ${state.partyControl.follow ? 'ON' : 'OFF'}`);
    followBtn.addEventListener('click', () => api.toggleGroupFollow());
    row.appendChild(followBtn);
    bar.appendChild(row);
  }
}

// ─── MESSAGES ─────────────────────────────────────────────────────────────────
export function renderMessages(state) {
  const log = $('#messageLog');
  if (!log) return;
  log.innerHTML = '';
  const msgs = (state.ui.messages || []).slice(-12);
  msgs.forEach((msg, i) => {
    const div = createEl('div', {}, msg);
    if (i === msgs.length - 1) div.style.color = 'var(--text)';
    log.appendChild(div);
  });
  log.scrollTop = log.scrollHeight;
}

export function pushMessage(state, msg) {
  state.ui.messages = state.ui.messages || [];
  state.ui.messages.push(msg);
  if (state.ui.messages.length > 60) state.ui.messages.shift();
}

// ─── JOURNAL ──────────────────────────────────────────────────────────────────
export function renderJournal(state, data) {
  const root = $('#journalBody');
  if (!root) return;
  root.innerHTML = '';
  let any = false;
  data.quests.forEach(quest => {
    const prog = state.quests[quest.id];
    if (!prog) return;
    any = true;
    const stage = quest.stages[prog.stage];
    root.appendChild(createEl('div', { class: 'card' }, `
      <strong>${quest.name}</strong>
      <div class="small">${quest.category}${prog.complete ? ' · ✓ Complete' : prog.failed ? ' · ✗ Failed' : ''}</div>
      <p>${stage?.text || quest.description}</p>
    `));
  });
  if (!any) root.innerHTML = '<div class="card"><div class="small">No quests yet.</div></div>';
}

// ─── INVENTORY ────────────────────────────────────────────────────────────────
export function renderInventory(state, data, api) {
  const root = $('#inventoryBody');
  if (!root) return;
  root.innerHTML = '';

  const actor = state.party
    .map(id => state.roster.find(a => a.id === id))
    .filter(Boolean)
    .find(a => a.id === state.selectedActorId)
    || state.roster.find(a => state.party.includes(a.id) && !a.dead);

  if (!actor) {
    root.innerHTML = '<div class="card"><div class="small">No party member selected.</div></div>';
    return;
  }

  // Equipment
  const actorCol = createEl('div', { class: 'card' },
    `<strong>${actor.name}</strong><div class="small">${actor.classId}</div>`);
  ['mainhand','offhand','armor','utility','implant','pack'].forEach(slot => {
    const item = getById(data.items, actor.equipped?.[slot]);
    const div = createEl('div', { class: 'equip-slot' },
      `<div class="small">${slot}</div><div>${item?.name || 'Empty'}</div>`);
    div.addEventListener('click', () => api.inspectEquipmentSlot(actor.id, slot));
    actorCol.appendChild(div);
  });

  // Bag
  const bagCol = createEl('div', { class: 'card' }, '<strong>Carried Items</strong>');
  const grid   = createEl('div', { class: 'slot-grid' });
  (actor.inventory || []).forEach((entry, idx) => {
    const item = getById(data.items, entry.itemId);
    const slot = createEl('div', { class: 'slot', dataset: { idx } });
    slot.innerHTML = `<div class="item"><strong>${entry.customName || item?.name || entry.itemId}</strong><div class="meta">${item?.type || 'item'} x${entry.qty}</div></div>`;
    slot.addEventListener('click', e => api.inspectInventoryItem(actor.id, idx, e.clientX, e.clientY));
    slot.setAttribute('draggable', 'true');
    slot.addEventListener('dragstart', e =>
      e.dataTransfer.setData('text/plain', JSON.stringify({ actorId: actor.id, idx })));
    slot.addEventListener('dragover', e => e.preventDefault());
    slot.addEventListener('drop',     e => api.handleInventoryDrop(e, actor.id, idx));
    grid.appendChild(slot);
  });
  for (let i = (actor.inventory || []).length; i < 20; i++) {
    const slot = createEl('div', { class: 'slot', dataset: { idx: i } },
      '<span class="small">Empty</span>');
    slot.addEventListener('dragover', e => e.preventDefault());
    slot.addEventListener('drop',     e => api.handleInventoryDrop(e, actor.id, i));
    grid.appendChild(slot);
  }
  bagCol.appendChild(grid);

  // Cargo
  const stashCol  = createEl('div', { class: 'card' },
    '<strong>Ship Cargo</strong><div class="small">Shared storage.</div>');
  const stashGrid = createEl('div', { class: 'slot-grid' });
  (state.ship.cargo || []).forEach((entry, idx) => {
    const item = getById(data.items, entry.itemId);
    const slot = createEl('div', { class: 'slot' });
    slot.innerHTML = `<div class="item"><strong>${entry.customName || item?.name || entry.itemId}</strong><div class="meta">${item?.type || 'misc'} x${entry.qty}</div></div>`;
    slot.addEventListener('click', () => api.inspectCargoItem(idx));
    stashGrid.appendChild(slot);
  });
  for (let i = (state.ship.cargo || []).length; i < 15; i++) {
    stashGrid.appendChild(createEl('div', { class: 'slot' }, '<span class="small">Empty</span>'));
  }
  stashCol.appendChild(stashGrid);

  const wrap = createEl('div', { class: 'inventory-columns' });
  wrap.append(actorCol, bagCol, stashCol);
  root.appendChild(wrap);
}

// ─── CREW ─────────────────────────────────────────────────────────────────────
export function renderCrew(state, data) {
  const root = $('#crewBody');
  if (!root) return;
  root.innerHTML = '';
  state.roster
    .filter(a => a.role === 'ally' || state.party.includes(a.id))
    .forEach(actor => {
      root.appendChild(createEl('div', { class: 'card' }, `
        <strong>${actor.name}</strong>
        <div class="small">${actor.classId} · ${actor.speciesId}</div>
        <p>${actor.bio || 'No biography yet.'}</p>
        <div class="statline"><span>Affinity</span><strong>${actor.affinity ?? 0}</strong></div>
        <div class="statline"><span>Romance</span><strong>Stage ${actor.romance?.stage || 0}</strong></div>
        <div class="statline"><span>Morale</span><strong>${Math.round(actor.survival?.morale ?? 0)}</strong></div>
        <div class="small">${actor.romance?.active ? 'Romance active.' : ''}</div>
      `));
    });
}

// ─── SHIP ─────────────────────────────────────────────────────────────────────
export function renderShip(state, api) {
  const root = $('#shipBody');
  if (!root) return;
  const scrap     = state.resources.scrap;
  const canMake   = Math.floor(scrap / 5);
  const fuelSpace = state.ship.fuelCapacity - state.resources.fuel;
  root.innerHTML = `
    <div class="card">
      <strong>${state.ship.name}</strong>
      <div class="small">Mobile base, safe-rest zone, cargo hold, companion hub, travel interface.</div>
      <div class="statline"><span>Hull</span><strong>${state.ship.hull}%</strong></div>
      <div class="statline"><span>Fuel</span><strong>${state.resources.fuel} / ${state.ship.fuelCapacity}</strong></div>
      <div class="statline"><span>Scrap</span><strong>${scrap} (can convert ${Math.min(canMake, fuelSpace)} → fuel)</strong></div>
      <div class="statline"><span>Modules</span><strong>${state.ship.installedModules.join(', ')}</strong></div>
    </div>
    <div class="card">
      <strong>Actions</strong>
      <div class="small">Ship Rest uses 1 ration + 1 water. Restores full HP and abilities for all party.</div>
      <div class="row-wrap" style="margin-top:8px">
        <button id="restOnShipBtn">Ship Rest</button>
        <button id="refuelShipBtn" ${fuelSpace <= 0 || canMake <= 0 ? 'disabled' : ''}>Scrap → Fuel (5:1)</button>
        <button id="openCargoBtn">Open Cargo</button>
      </div>
    </div>
    <div class="card">
      <strong>Ship Log</strong>
      ${(state.ship.notes || []).map(n => `<p class="small">${n}</p>`).join('') || '<p class="small">No entries.</p>'}
    </div>
  `;
  $('#restOnShipBtn').addEventListener('click', () => api?.shipRest?.());
  $('#refuelShipBtn').addEventListener('click', () => api?.convertScrapToFuel?.());
  $('#openCargoBtn').addEventListener('click', () => {
    const inv = $('#inventoryPanel');
    if (inv) { inv.classList.remove('hidden'); requestAnimationFrame(() => centerPanel(inv)); }
  });
}

// ─── SECTOR MAP ───────────────────────────────────────────────────────────────
export function renderSectorMap(state, data, api) {
  const root = $('#sectorMapBody');
  if (!root) return;
  root.innerHTML = '';
  data.config.sectorNodes.forEach(node => {
    const isCurrent = state.currentSectorNode === node.id;
    const card = createEl('div', { class: 'travel-node' }, `
      <strong>${node.name}</strong>
      <div class="small">${node.type} · Danger: ${node.danger}</div>
      <p>${node.description}</p>
      <div class="statline"><span>Fuel Cost</span><strong>${node.fuelCost}</strong></div>
      <div class="row-wrap"></div>
    `);
    const btn = createEl('button', {},
      isCurrent ? 'Current Location' : `Travel (${node.fuelCost} fuel)`);
    btn.disabled = isCurrent || (!state.flags.shipOwned && node.fuelCost > 0);
    btn.addEventListener('click', () => api.travelToSector(node.id));
    card.querySelector('.row-wrap').appendChild(btn);
    root.appendChild(card);
  });
}

// ─── ADMIN ────────────────────────────────────────────────────────────────────
export function renderAdmin(state, data, api) {
  const root = $('#adminBody');
  if (!root) return;
  root.innerHTML = `
    <div class="card">
      <strong>Testing Controls</strong>
      <div class="row-wrap">
        <button id="adminHealBtn">Heal Party</button>
        <button id="adminFeedBtn">Feed Party</button>
        <button id="adminAddFuelBtn">+Fuel</button>
        <button id="adminAddCreditsBtn">+Credits</button>
        <button id="adminAddScrapBtn">+Scrap</button>
        <button id="adminToggleCombatBtn">Toggle Combat</button>
        <button id="adminSpawnEnemyBtn">Spawn Enemy</button>
        <button id="adminAdvanceHourBtn">+1 Hour</button>
        <button id="adminQuestAdvanceBtn">Advance Quest</button>
      </div>
    </div>
    <div class="card">
      <strong>Party Size</strong>
      <div class="small">Max: ${state.partyMax} / Admin max: ${data.config.party.adminMax}</div>
      <input id="partySizeInput" type="range" min="1" max="${data.config.party.adminMax}" value="${state.partyMax}" />
      <div id="partySizeLabel">${state.partyMax}</div>
    </div>
    <div class="card">
      <strong>Fog Revealed</strong>
      <div class="small">${Object.values(state.fogRevealed || {}).reduce((n, m) => n + Object.keys(m).length, 0)} tiles</div>
    </div>
    <div class="card">
      <strong>Flags</strong>
      <div class="small">${Object.entries(state.flags).map(([k,v]) => `${k}: ${v}`).join('<br>')}</div>
    </div>
  `;
  $('#adminHealBtn').onclick        = api.adminHealParty;
  $('#adminFeedBtn').onclick        = api.adminFeedParty;
  $('#adminAddFuelBtn').onclick     = () => api.adjustResource('fuel', 4);
  $('#adminAddCreditsBtn').onclick  = () => api.adjustResource('credits', 250);
  $('#adminAddScrapBtn').onclick    = () => api.adjustResource('scrap', 25);
  $('#adminToggleCombatBtn').onclick = api.adminToggleCombat;
  $('#adminSpawnEnemyBtn').onclick  = api.adminSpawnEnemy;
  $('#adminAdvanceHourBtn').onclick = () => api.advanceTime(60);
  $('#adminQuestAdvanceBtn').onclick = api.adminAdvanceMainQuest;
  $('#partySizeInput').oninput = e => {
    state.partyMax = Number(e.target.value);
    $('#partySizeLabel').textContent = state.partyMax;
  };
}

// ─── DIALOGUE ─────────────────────────────────────────────────────────────────
export function renderDialogue(state, data, api, nodeId, speakerActor) {
  const root = $('#dialogueBody');
  const node = data.dialogue.nodes[nodeId];
  if (!node) {
    root.innerHTML = `<div class="card"><em class="small">Missing dialogue node: ${nodeId}</em></div>`;
    return;
  }
  const speaker = speakerActor?.name || node.speaker || 'Unknown';
  root.innerHTML = `
    <div class="card">
      <div class="dialogue-speaker">${speaker}</div>
      <div class="dialogue-npc-line">${node.text}</div>
    </div>
  `;
  (node.choices || []).forEach(choice => {
    const result = api.evaluateChoice(choice);
    let label = choice.label;
    if (choice.check) label += ` [${choice.check.stat.toUpperCase()} DC ${choice.check.dc}]`;
    const btn = createEl('button', {
      class: `choice ${result.pass ? 'check-pass' : choice.check ? 'check-fail' : ''}`
    }, label);
    btn.disabled = !!(choice.check && !result.pass && !choice.failTarget);
    btn.addEventListener('pointerdown', e => e.stopPropagation());
    btn.addEventListener('click', e => {
      e.stopPropagation();
      api.resolveDialogueChoice(choice, result, speakerActor);
    });
    root.appendChild(btn);
  });
}

// ─── INSPECT ──────────────────────────────────────────────────────────────────
export function renderInspect(state, data, html) {
  const root = $('#inspectBody');
  if (root) root.innerHTML = html;
}

// ─── CODEX ────────────────────────────────────────────────────────────────────
export function renderCodex() {
  const root = $('#codexBody');
  if (!root) return;
  root.innerHTML = `
    <div class="card">
      <strong>How to play Spaced</strong>
      <p>Click or tap any tile to see available actions — move, talk, loot, or interact. You must be within 5 tiles to talk or loot. During combat, use the action buttons then End Turn.</p>
    </div>
    <div class="card">
      <strong>Controls</strong>
      <p><strong>PC:</strong> Left-click tiles or entities to interact. Right-click for the action menu. Scroll to zoom. Drag empty space to pan.</p>
      <p><strong>Mobile:</strong> Tap anything to interact. Pinch to zoom. Drag empty map to pan. Use the ▼ button to collapse the bottom bar for more map space.</p>
    </div>
    <div class="card">
      <strong>What's in this build</strong>
      <p>Exploration, turn-based combat, party control, inventory, equipment, survival, dialogue trees with skill checks, ship hub, sector travel, quests, faction reputation, stealth, companion affinity, romance, fog of war, and save/load.</p>
    </div>
    <div class="card">
      <strong>Running locally</strong>
      <p>Use a local server, not file://. Example: <code>python -m http.server 8000</code></p>
    </div>
  `;
}