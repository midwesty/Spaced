import { $, $$, chance, clamp, createEl, deepClone, distance, getById, pick, rand, rollDice, statMod, uid } from './utils.js';
import { applyDerivedStats, createActorFromTemplate, freshState, loadState, saveState } from './state.js';
import { initPanels, pushMessage, renderActionBar, renderAdmin, renderCodex, renderCrew, renderDialogue, renderInspect, renderInventory, renderJournal, renderMap, renderMessages, renderPartyStrip, renderResources, renderSectorMap, renderShip, renderTopHUD } from './ui.js';

export class GameEngine {
  constructor(data) {
    this.data = data;
    this.state = loadState() || freshState(data);
    this.pendingAction = null;
    this.drag = { active: false, pending: false, pointerId: null, lastX: 0, lastY: 0, startX: 0, startY: 0 };
    this.pinch = { active: false, startDistance: 0, startZoom: 1 };
    this.viewport = $('#mapViewport');
    this.api = this.buildApi();
    initPanels(this.state, this.api);
    this.bindShellUI();
    this.ensureWorldInitialized();
    this.renderAll();
    requestAnimationFrame(() => this.fitViewportToScreen(true));
    this.startLoop();
  }

  buildApi() {
    return {
      renderAll: () => this.renderAll(),
      renderCodex: () => renderCodex(),
      currentMap: () => this.currentMap(),
      centerOnActor: actor => this.centerOnActor(actor),
      handleTileClick: (x, y, e) => this.handleTileClick(x, y, e),
      handleTileContext: (x, y, e) => this.handleTileContext(x, y, e),
      handleActorPrimary: (id, e) => this.handleActorPrimary(id, e),
      handleActorLongPress: (id, x, y) => this.showActorContext(id, x, y),
      selectActor: id => this.selectActor(id),
      interactWithActor: id => this.interactWithActor(id),
      showActorContext: (id, x, y) => this.showActorContext(id, x, y),
      setPendingAction: action => {
        this.pendingAction = action;
        const type = this.pendingActionType();
        if (type === 'move') this.log('Movement readied. Select a destination.');
        else if (type === 'ability') {
          const ability = getById(this.data.abilities, this.pendingActionAbilityId());
          this.log(`Prepared technique: ${ability?.name || 'Ability'}. Select a target.`);
        } else {
          this.log(`Prepared action: ${type}. Select a target.`);
        }
        this.renderAll();
      },
      toggleStealth: id => this.toggleStealth(id),
      longRest: () => this.longRest(),
      openPanel: id => this.openPanel(id),
      inspectEquipmentSlot: (actorId, slot) => this.inspectEquipmentSlot(actorId, slot),
      inspectInventoryItem: (actorId, idx, x, y, forceContext = false) => this.inspectInventoryItem(actorId, idx, x, y, forceContext),
      handleInventoryDrop: (e, actorId, idx) => this.handleInventoryDrop(e, actorId, idx),
      inspectCargoItem: idx => this.inspectCargoItem(idx),
      travelToSector: id => this.travelToSector(id),
      adminHealParty: () => this.adminHealParty(),
      adminFeedParty: () => this.adminFeedParty(),
      adjustResource: (k, amt) => this.adjustResource(k, amt),
      adminToggleCombat: () => this.adminToggleCombat(),
      adminSpawnEnemy: () => this.adminSpawnEnemy(),
      advanceTime: mins => this.advanceTime(mins),
      adminAdvanceMainQuest: () => this.adminAdvanceMainQuest(),
      evaluateChoice: choice => this.evaluateChoice(choice),
      resolveDialogueChoice: (choice, result, actor) => this.resolveDialogueChoice(choice, result, actor),
      toggleGroupFollow: () => this.toggleGroupFollow(),
      toggleGroupStealth: () => this.toggleGroupStealth(),
    };
  }

  ensureWorldInitialized() {
    if (this.state.roster.length) return;
    const hero = this.buildHeroFromCreatorPreview();
    this.state.roster.push(hero);
    this.state.party.push(hero.id);
    this.state.selectedActorId = hero.id;

    this.data.companions.forEach(c => {
      const actor = createActorFromTemplate(c, this.data);
      actor.mapId = c.startMapId;
      applyDerivedStats(actor, this.data);
      this.state.roster.push(actor);
      this.state.relationship[actor.id] = { affinity: actor.affinity || 0, romance: 0, flags: [] };
    });

    const mapActors = this.currentMap().actors.map(t => {
      const actor = createActorFromTemplate(t, this.data);
      actor.mapId = this.state.mapId;
      applyDerivedStats(actor, this.data);
      return actor;
    });
    this.state.roster.push(...mapActors);

    this.data.quests.forEach(q => this.state.quests[q.id] = { stage: 0, complete: false, failed: false });
    this.state.partyControl.leaderId = hero.id;
    this.state.visitedMaps = Array.from(new Set([...(this.state.visitedMaps || []), this.state.mapId]));
    this.log('Campaign initialized.');
    saveState(this.state);
  }

  buildHeroFromCreatorPreview() {
    const creatorCache = JSON.parse(localStorage.getItem('starfall_creator_cache') || '{}');
    const speciesId = creatorCache.speciesId || this.data.species[0].id;
    const classId = creatorCache.classId || this.data.classes[0].id;
    const species = getById(this.data.species, speciesId);
    const cls = getById(this.data.classes, classId);
    const stats = {
      might: 10 + (species?.statMods?.might || 0) + (cls?.statMods?.might || 0),
      agility: 10 + (species?.statMods?.agility || 0) + (cls?.statMods?.agility || 0),
      grit: 10 + (species?.statMods?.grit || 0) + (cls?.statMods?.grit || 0),
      wit: 10 + (species?.statMods?.wit || 0) + (cls?.statMods?.wit || 0),
      presence: 10 + (species?.statMods?.presence || 0) + (cls?.statMods?.presence || 0),
      tech: 10 + (species?.statMods?.tech || 0) + (cls?.statMods?.tech || 0),
    };
    const actor = createActorFromTemplate({
      id: 'hero',
      name: creatorCache.name || 'Rook Vey',
      speciesId, classId,
      role: 'player',
      x: 2, y: 8,
      hpMax: 14,
      shield: cls?.baseShield || 0,
      shieldMax: cls?.baseShield || 0,
      armor: 11 + statMod(stats.agility),
      stats,
      movement: 6,
      abilities: [...(cls?.abilities || []), ...(species?.abilities || [])],
      inventory: deepClone(cls?.startingItems || []),
      equipped: deepClone(cls?.startingEquip || {}),
      bio: 'A nobody with a talent for surviving the worst day of their life.',
      survival: { hunger: 88, thirst: 82, fatigue: 72, morale: 55, toxicity: 0 },
      factionId: 'free',
      ai: 'player',
      appearance: creatorCache.appearance || {},
      portrait: 'assets/images/portraits/player_placeholder.png',
      voice: 'assets/audio/voice/player_intro_001.ogg'
    }, this.data);
    actor.mapId = 'port_sable';
    return applyDerivedStats(actor, this.data);
  }


bindShellUI() {
  $('#newGameBtn').addEventListener('click', () => {
    $('#splash').classList.remove('active');
    $('#creatorScreen').classList.add('active');
    this.populateCreator();
  });
  $('#continueBtn').addEventListener('click', () => {
    $('#splash').classList.remove('active');
    $('#gameRoot').classList.add('active');
    renderCodex();
    this.renderAll();
    requestAnimationFrame(() => this.fitViewportToScreen(true));
  });
  $('#backToMenuBtn').addEventListener('click', () => {
    $('#creatorScreen').classList.remove('active');
    $('#splash').classList.add('active');
  });
  $('#randomizeHeroBtn').addEventListener('click', () => this.randomizeCreator());
  $('#startCampaignBtn').addEventListener('click', () => this.commitCreatorAndStart());
  $('#zoomInBtn').addEventListener('click', () => this.setZoom(this.state.zoom + 0.1));
  $('#zoomOutBtn').addEventListener('click', () => this.setZoom(this.state.zoom - 0.1));
  $('#recenterBtn').addEventListener('click', () => {
    const actor = this.commandActor() || this.selectedActor();
    if (actor) this.centerOnActor(actor);
  });
  $('#endTurnBtn').addEventListener('click', () => this.endTurn());
  let _ctxDismissX = 0, _ctxDismissY = 0;
  document.addEventListener('pointerdown', (e) => {
    _ctxDismissX = e.clientX; _ctxDismissY = e.clientY;
  });
  document.addEventListener('pointerup', (e) => {
    const moved = Math.hypot(e.clientX - _ctxDismissX, e.clientY - _ctxDismissY);
    if (moved < 8 && !e.target.closest('#contextMenu')) {
      $('#contextMenu').classList.add('hidden');
    }
  });

  const wrap = this.viewport.parentElement;

  wrap.addEventListener('pointerdown', (e) => {
    if (this.pinch.active) return;
    if (e.target.closest('.entity') || e.target.closest('.tile') || e.target.closest('.panel') || e.target.closest('#mapControls') || e.target.closest('#contextMenu')) return;
    this.drag.active = false; // don't activate until moved
    this.drag.pending = true;
    this.drag.pointerId = e.pointerId;
    this.drag.lastX = e.clientX;
    this.drag.lastY = e.clientY;
    this.drag.startX = e.clientX;
    this.drag.startY = e.clientY;
    wrap.setPointerCapture(e.pointerId);
  });
  wrap.addEventListener('pointermove', (e) => {
    if ((!this.drag.active && !this.drag.pending) || this.drag.pointerId !== e.pointerId || this.pinch.active) return;
    const totalMoved = Math.hypot(e.clientX - this.drag.startX, e.clientY - this.drag.startY);
    if (!this.drag.active && totalMoved < 6) return; // threshold before panning starts
    this.drag.active = true;
    this.drag.pending = false;
    const dx = e.clientX - this.drag.lastX;
    const dy = e.clientY - this.drag.lastY;
    this.drag.lastX = e.clientX;
    this.drag.lastY = e.clientY;
    this.state.camera.x += dx;
    this.state.camera.y += dy;
    this.applyViewportTransform();
  });
  wrap.addEventListener('pointerup', (e) => {
    if (this.drag.pointerId === e.pointerId) {
      this.drag.active = false;
      this.drag.pending = false;
    }
  });
  wrap.addEventListener('pointercancel', () => {
    this.drag.active = false;
    this.pinch.active = false;
  });
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    this.setZoom(this.state.zoom + (e.deltaY < 0 ? 0.08 : -0.08));
  }, { passive: false });

  wrap.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      this.pinch.active = true;
      this.drag.active = false;
      this.pinch.startDistance = this.getTouchDistance(e.touches);
      this.pinch.startZoom = this.state.zoom;
    }
  }, { passive: false });

  wrap.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && this.pinch.active) {
      e.preventDefault();
      const nextDistance = this.getTouchDistance(e.touches);
      if (!this.pinch.startDistance) return;
      const scale = nextDistance / this.pinch.startDistance;
      this.setZoom(this.pinch.startZoom * scale);
    }
  }, { passive: false });

  wrap.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) this.pinch.active = false;
  }, { passive: true });

  window.addEventListener('resize', () => {
    this.fitViewportToScreen(false);
  });
}

populateCreator() {
    const speciesSel = $('#ccSpecies'), classSel = $('#ccClass'), traitSel = $('#ccTrait');
    speciesSel.innerHTML = this.data.species.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    classSel.innerHTML = this.data.classes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    traitSel.innerHTML = this.data.statuses.filter(s => s.category === 'origin').map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    ['ccName','ccPronouns','ccSpecies','ccClass','ccBackground','ccBody','ccSkin','ccHair','ccEyes','ccAccent','ccTrait'].forEach(id =>
      document.getElementById(id).addEventListener('input', () => this.updateCreatorPreview())
    );
    this.updateCreatorPreview();
  }

  randomizeCreator() {
    $('#ccName').value = pick(['Rook Vey','Mara Quill','Jax Mercer','Sable Korr','Dima Rusk','Nori Vale']);
    $('#ccPronouns').value = pick(['they/them','she/her','he/him']);
    $('#ccSpecies').value = pick(this.data.species).id;
    $('#ccClass').value = pick(this.data.classes).id;
    $('#ccBackground').value = pick(['drifter','enforcer','academy-dropout','dock-rat','cult-runaway','frontier-medic']);
    $('#ccBody').value = pick(['lean','average','broad','heavy']);
    $('#ccSkin').value = pick(['#b88e74','#8f6c56','#6f8e9f','#c8ad8a','#7aa0ab']);
    $('#ccHair').value = pick(['#2f3d5a','#a54848','#d6d6d6','#24380d','#4f2d66']);
    $('#ccEyes').value = pick(['#93d7ff','#8affbb','#ffd56f','#ff9cde']);
    $('#ccAccent').value = pick(['#d2a84b','#9d73ff','#6de1d1','#ff725c']);
    $('#ccTrait').value = pick(this.data.statuses.filter(s => s.category === 'origin')).id;
    this.updateCreatorPreview();
  }

  updateCreatorPreview() {
    const species = getById(this.data.species, $('#ccSpecies').value);
    const cls = getById(this.data.classes, $('#ccClass').value);
    $('#dollBody').style.setProperty('--skin', $('#ccSkin').value);
    $('#dollHair').style.setProperty('--hair', $('#ccHair').value);
    $('#dollAccent').style.setProperty('--eyes', $('#ccEyes').value);
    $('#dollArmor').style.setProperty('--accentColor', $('#ccAccent').value);
    $('#creatorSummary').innerHTML = `
      <p><strong>${$('#ccName').value}</strong> · ${$('#ccPronouns').value}</p>
      <p>${species?.summary || ''}</p>
      <p>${cls?.summary || ''}</p>
      <p><strong>Signature:</strong> ${(cls?.abilities || []).map(id => getById(this.data.abilities, id)?.name || id).join(', ')}</p>
    `;
    localStorage.setItem('starfall_creator_cache', JSON.stringify({
      name: $('#ccName').value,
      pronouns: $('#ccPronouns').value,
      speciesId: $('#ccSpecies').value,
      classId: $('#ccClass').value,
      background: $('#ccBackground').value,
      traitId: $('#ccTrait').value,
      appearance: {
        body: $('#ccBody').value, skin: $('#ccSkin').value, hair: $('#ccHair').value, eyes: $('#ccEyes').value, accent: $('#ccAccent').value
      }
    }));
  }

  commitCreatorAndStart() {
    localStorage.removeItem('starfall_mvp_save_v1');
    this.state = freshState(this.data);
    this.ensureWorldInitialized();
    $('#creatorScreen').classList.remove('active');
    $('#gameRoot').classList.add('active');
    this.triggerIntro();
    this.renderAll();
    requestAnimationFrame(() => this.fitViewportToScreen(true));
  }

  triggerIntro() {
    this.state.flags.introSeen = true;
    this.log('Cold open: a failed deal in Port Sable turns into a bloodbath.');
    this.log('You discover a damaged smuggler vessel hidden in a drydock while escaping station security and scavenger killers.');
    this.advanceQuest('main_awake', 0);
    this.openDialogue('intro_station_master', this.state.roster.find(a => a.templateId === 'comp_vesk'));
    this.save();
  }

  currentMap() { return getById(this.data.maps, this.state.mapId); }
  selectedActor() { return this.state.roster.find(a => a.id === this.state.selectedActorId); }
  currentTurnActor() {
    if (!this.state.combat.active) return null;
    return this.state.roster.find(a => a.id === this.state.combat.turnOrder[this.state.combat.currentTurnIndex]) || null;
  }
  commandActor() {
    return this.currentTurnActor() || this.selectedActor();
  }
  pendingActionType() {
    return typeof this.pendingAction === 'string' ? this.pendingAction : this.pendingAction?.type || null;
  }
  pendingActionAbilityId() {
    return typeof this.pendingAction === 'object' ? this.pendingAction?.abilityId || null : null;
  }
  getTouchDistance(touches) {
    const [a, b] = touches;
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  fitViewportToScreen(force = false) {
    const wrap = this.viewport?.parentElement;
    const map = this.currentMap();
    if (!wrap || !map) return;
    const tileSize = this.data.config.map.tileSize;
    const mapWidth = map.width * tileSize;
    const mapHeight = map.height * tileSize;
    const availableWidth = Math.max(220, wrap.clientWidth - 24);
    const availableHeight = Math.max(220, wrap.clientHeight - 24);
    const fitZoom = Math.min(1, availableWidth / mapWidth, availableHeight / mapHeight);
    const targetZoom = clamp(fitZoom, 0.22, 2.2);
    if (force || window.innerWidth <= 920 || this.state.zoom > targetZoom) {
      this.state.zoom = targetZoom;
      this.applyViewportTransform();
    }
  }

  actorKey(actor) {
    return actor?.conversationTag || actor?.templateId || actor?.id;
  }

  isOccupied(mapId, x, y, ignoreId = null) {
    return this.state.roster.some(a => a.mapId === mapId && !a.dead && a.id !== ignoreId && a.x === x && a.y === y);
  }

  findFreeTileNear(mapId, x, y, ignoreId = null, maxRadius = 4) {
    const map = getById(this.data.maps, mapId);
    if (!map) return null;
    if (map.tiles[y]?.[x] && !map.tiles[y][x].blocked && !this.isOccupied(mapId, x, y, ignoreId)) return { x, y };
    for (let r = 1; r <= maxRadius; r++) {
      for (let yy = y - r; yy <= y + r; yy++) {
        for (let xx = x - r; xx <= x + r; xx++) {
          if (!map.tiles[yy]?.[xx]) continue;
          if (map.tiles[yy][xx].blocked) continue;
          if (this.isOccupied(mapId, xx, yy, ignoreId)) continue;
          return { x: xx, y: yy };
        }
      }
    }
    return null;
  }

  markTalked(actor, nodeId = null) {
    const key = this.actorKey(actor);
    if (!key) return;
    this.state.flags[`talked_${key}`] = true;
    this.state.dialogueMemory[key] ??= { count: 0, nodes: [] };
    this.state.dialogueMemory[key].count += 1;
    if (nodeId && !this.state.dialogueMemory[key].nodes.includes(nodeId)) this.state.dialogueMemory[key].nodes.push(nodeId);
  }

  toggleGroupFollow() {
    this.state.partyControl.follow = !this.state.partyControl.follow;
    if (this.state.partyControl.follow && !this.state.partyControl.leaderId) this.state.partyControl.leaderId = this.state.selectedActorId || this.state.party[0] || null;
    this.log(this.state.partyControl.follow ? 'Party linked to leader movement.' : 'Party unlinked.');
    this.renderAll();
  }

  toggleGroupStealth() {
    const party = this.state.party.map(id => this.state.roster.find(a => a.id === id)).filter(Boolean);
    const next = !this.state.partyControl.squadStealth;
    this.state.partyControl.squadStealth = next;
    party.forEach(actor => {
      const has = actor.statuses.includes('stealthed');
      if (next && !has) actor.statuses.push('stealthed');
      if (!next && has) actor.statuses = actor.statuses.filter(s => s !== 'stealthed');
    });
    this.log(next ? 'Squad enters stealth.' : 'Squad leaves stealth.');
    this.renderAll();
  }

  syncPartyFormation(leader) {
    if (!leader || this.state.combat.active || !this.state.partyControl.follow) return;
    this.state.partyControl.leaderId = leader.id;
    const offsets = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1],[2,0],[0,2]];
    const followers = this.state.party.filter(id => id !== leader.id).map(id => this.state.roster.find(a => a.id === id)).filter(Boolean);
    followers.forEach((actor, idx) => {
      const [dx, dy] = offsets[idx] || [idx + 1, 0];
      const spot = this.findFreeTileNear(leader.mapId, leader.x + dx, leader.y + dy, actor.id, 3);
      if (!spot) return;
      actor.mapId = leader.mapId;
      actor.x = spot.x;
      actor.y = spot.y;
      if (this.state.partyControl.squadStealth && !actor.statuses.includes('stealthed')) actor.statuses.push('stealthed');
      if (!this.state.partyControl.squadStealth && actor.statuses.includes('stealthed')) actor.statuses = actor.statuses.filter(s => s !== 'stealthed');
    });
  }

  openAmbientDialogue(actor) {
    const root = $('#dialogueBody');
    const key = this.actorKey(actor);
    const memory = this.state.dialogueMemory[key] || { count: 0 };
    const lines = actor.ambientDialogue?.length ? actor.ambientDialogue : [
      `${actor.name} eyes you warily and keeps one hand near their gear.`,
      `"Busy day," ${actor.name.toLowerCase().includes('enforcer') ? 'the officer mutters' : actor.name + ' says'}, "and it is not getting better."`
    ];
    const idx = Math.min(memory.count, lines.length - 1);
    root.innerHTML = `
      <div class="card">
        <div class="dialogue-speaker">${actor.name}</div>
        <div class="small">Ambient exchange</div>
        <p>${lines[idx]}</p>
      </div>
    `;
    const btn1 = createEl('button', { class: 'choice', onclick: () => { this.log(`${actor.name} shares a rumor.`); $('#dialoguePanel').classList.add('hidden'); } }, 'Any leads?');
    const btn2 = createEl('button', { class: 'choice', onclick: () => { $('#dialoguePanel').classList.add('hidden'); } }, 'Leave');
    root.append(btn1, btn2);
    this.markTalked(actor, `ambient_${idx}`);
    this.openPanel('dialoguePanel');
  }

  evaluateConditions(conditions = []) {
    return (conditions || []).every(cond => {
      if (!cond) return true;
      if (cond.type === 'flag') return !!this.state.flags[cond.key] === (cond.value ?? true);
      if (cond.type === 'talkedTo') return !!this.state.flags[`talked_${cond.actor}`];
      if (cond.type === 'actorInParty') return this.state.party.some(id => {
        const a = this.state.roster.find(x => x.id === id);
        return a && (a.templateId === cond.actor || a.id === cond.actor || a.conversationTag === cond.actor);
      });
      if (cond.type === 'visitedMap') return (this.state.visitedMaps || []).includes(cond.id);
      if (cond.type === 'currentSectorNodeIn') return (cond.ids || []).includes(this.state.currentSectorNode);
      if (cond.type === 'resourceAtLeast') return (this.state.resources[cond.key] || 0) >= cond.value;
      if (cond.type === 'questStageAtLeast') return (this.state.quests[cond.id]?.stage || 0) >= cond.stage;
      return false;
    });
  }

  checkQuestProgress() {
    let changed = false;
    for (const quest of this.data.quests) {
      const prog = this.state.quests[quest.id] || (this.state.quests[quest.id] = { stage: 0, complete: false, failed: false });
      if (prog.complete || prog.failed) continue;
      const stageDef = quest.stages[prog.stage];
      if (stageDef?.autoAdvanceIf && this.evaluateConditions(stageDef.autoAdvanceIf)) {
        prog.stage = Math.min(prog.stage + 1, quest.stages.length - 1);
        if (stageDef.onAdvanceFlag) this.state.flags[stageDef.onAdvanceFlag] = true;
        if (stageDef.onAdvanceLog) this.log(stageDef.onAdvanceLog);
        this.log(`Quest updated: ${quest.name}`);
        changed = true
      }
      if (quest.completeIf && this.evaluateConditions(quest.completeIf)) {
        prog.complete = true;
        this.log(`Quest complete: ${quest.name}`);
        changed = true
      }
    }
    return changed;
  }
  ensureActorResources(actor) {
    if (!actor) return;
    const cls = getById(this.data.classes, actor.classId) || {};
    actor.powerPools ??= {};
    actor.abilityUses ??= {};

    const configuredPools = cls.powerPools || {};
    Object.entries(configuredPools).forEach(([poolId, conf]) => {
      actor.powerPools[poolId] ??= {
        label: conf.label || poolId,
        current: conf.max ?? 0,
        max: conf.max ?? 0,
        recharge: conf.recharge || 'longRest'
      };
      actor.powerPools[poolId].max = conf.max ?? actor.powerPools[poolId].max ?? 0;
      if (actor.powerPools[poolId].current == null) actor.powerPools[poolId].current = actor.powerPools[poolId].max;
      actor.powerPools[poolId].label = conf.label || actor.powerPools[poolId].label;
      actor.powerPools[poolId].recharge = conf.recharge || actor.powerPools[poolId].recharge || 'longRest';
    });

    actor.abilities.forEach(abilityId => {
      const ability = getById(this.data.abilities, abilityId);
      if (!ability?.usesPerRest) return;
      actor.abilityUses[abilityId] ??= { current: ability.usesPerRest, max: ability.usesPerRest, recharge: ability.recharge || 'longRest' };
      actor.abilityUses[abilityId].max = ability.usesPerRest;
      actor.abilityUses[abilityId].recharge = ability.recharge || actor.abilityUses[abilityId].recharge || 'longRest';
      if (actor.abilityUses[abilityId].current == null) actor.abilityUses[abilityId].current = actor.abilityUses[abilityId].max;
    });
  }
  isCurrentTurnActor(actor) {
    if (!this.state.combat.active) return true;
    return this.state.combat.turnOrder[this.state.combat.currentTurnIndex] === actor?.id;
  }
  hasSpentCost(actor, type = 'action') {
    if (!this.state.combat.active || !actor) return false;
    if (type === 'bonus') return !!this.state.combat.bonusActed[actor.id];
    if (type === 'reaction') return !!this.state.combat.reactionSpent?.[actor.id];
    if (type === 'free' || type === 'none' || type === 'move') return false;
    return !!this.state.combat.acted[actor.id];
  }
  canAffordAbility(actor, ability) {
    this.ensureActorResources(actor);
    if (!ability) return { ok: true };
    if (ability.powerSource) {
      const pool = actor.powerPools?.[ability.powerSource];
      const cost = ability.slotCost ?? 1;
      if (!pool || pool.current < cost) return { ok: false, reason: `${pool?.label || ability.powerSource} depleted.` };
    }
    if (ability.usesPerRest) {
      const entry = actor.abilityUses?.[ability.id];
      if (!entry || entry.current <= 0) return { ok: false, reason: `${ability.name} is out of uses.` };
    }
    return { ok: true };
  }
  canSpendCost(actor, type = 'action', ability = null) {
    if (!actor) return { ok: false, reason: 'No active actor.' };
    if (!this.state.combat.active) return this.canAffordAbility(actor, ability);
    if (!this.isCurrentTurnActor(actor)) return { ok: false, reason: `It is not ${actor.name}'s turn.` };
    if (this.hasSpentCost(actor, type)) {
      const label = type === 'bonus' ? 'bonus action' : type === 'reaction' ? 'reaction' : 'action';
      return { ok: false, reason: `${actor.name} has already spent their ${label}.` };
    }
    return this.canAffordAbility(actor, ability);
  }
  spendAbilityResources(actor, ability) {
    this.ensureActorResources(actor);
    if (!ability) return;
    if (ability.powerSource && actor.powerPools?.[ability.powerSource]) {
      actor.powerPools[ability.powerSource].current = Math.max(0, actor.powerPools[ability.powerSource].current - (ability.slotCost ?? 1));
    }
    if (ability.usesPerRest && actor.abilityUses?.[ability.id]) {
      actor.abilityUses[ability.id].current = Math.max(0, actor.abilityUses[ability.id].current - 1);
    }
  }

  renderAll() {
    this.state.ui.pendingAction = this.pendingAction;
    renderTopHUD(this.state, this.data);
    renderPartyStrip(this.state, this.data, this.api);
    renderMap(this.state, this.data, this.api);
    renderResources(this.state);
    renderActionBar(this.state, this.data, this.api);
    renderMessages(this.state);
    renderJournal(this.state, this.data);
    renderInventory(this.state, this.data, this.api);
    renderCrew(this.state, this.data);
    renderShip(this.state);
    renderSectorMap(this.state, this.data, this.api);
    renderAdmin(this.state, this.data, this.api);
    renderCodex();
    this.applyViewportTransform();
    saveState(this.state);
  }

  applyViewportTransform() {
    this.viewport.style.transform = `translate(calc(-50% + ${this.state.camera.x}px), calc(-50% + ${this.state.camera.y}px)) scale(${this.state.zoom})`;
  }
  setZoom(val) {
    this.state.zoom = clamp(val, 0.22, 2.2);
    this.applyViewportTransform();
  }
  centerOnActor(actor) {
    const size = this.data.config.map.tileSize;
    this.state.camera.x = -(actor.x * size - 800);
    this.state.camera.y = -(actor.y * size - 600);
    this.applyViewportTransform();
  }

  selectActor(id) {
    this.state.selectedActorId = id;
    this.renderAll();
  }

  handleActorPrimary(id, e) {
    const actor = this.state.roster.find(a => a.id === id);
    const selected = this.selectedActor();
    if (!actor) return;

    const actionType = this.pendingActionType();

    if (actionType === 'attack') {
      const commandActor = this.commandActor();
      if (!commandActor || commandActor.id === actor.id) return this.log('Choose another target.');
      this.tryAttackAt(actor.x, actor.y);
      return;
    }
    if (actionType === 'talk') {
      this.tryTalkAt(actor.x, actor.y);
      return;
    }
    if (actionType === 'ability') {
      this.tryUseAbilityAt(actor.x, actor.y, this.pendingActionAbilityId());
      return;
    }
    if (actionType === 'loot') {
      this.tryLootAt(actor.x, actor.y);
      return;
    }

    if (selected?.id === actor.id) {
      this.interactWithActor(actor.id);
      return;
    }

    this.selectActor(actor.id);
  }

  handleTileClick(x, y) {
    const actor = this.commandActor();
    if (!actor || actor.dead) return;
    const actionType = this.pendingActionType();
    if (actionType === 'attack') return this.tryAttackAt(x, y);
    if (actionType === 'talk') return this.tryTalkAt(x, y);
    if (actionType === 'loot') return this.tryLootAt(x, y);
    if (actionType === 'ability') return this.tryUseAbilityAt(x, y, this.pendingActionAbilityId());
    if (actionType === 'move') return this.moveActorToward(actor, x, y);
    return this.moveActorToward(actor, x, y);
  }

  handleTileContext(x, y, e) {
    this.showContextMenu(e.clientX, e.clientY, [
      ['Move Here', () => this.moveActorToward(this.selectedActor(), x, y)],
      ['Inspect Tile', () => this.inspectTile(x, y)],
      ['Toggle Stealth', () => this.toggleStealth(this.state.selectedActorId)]
    ]);
  }

  moveActorToward(actor, x, y) {
    if (!actor) return;
    if (this.state.combat.active && this.state.combat.turnOrder[this.state.combat.currentTurnIndex] !== actor.id) {
      this.log(`It is not ${actor.name}'s turn.`);
      return;
    }
    const map = this.currentMap();
    if (!map.tiles[y]?.[x]) return;
    if (map.tiles[y][x].blocked) {
      this.log('Blocked terrain.');
      return;
    }
    if (this.isOccupied(actor.mapId, x, y, actor.id)) {
      this.log('That space is occupied.');
      return;
    }
    const dist = distance(actor, { x, y });
    if (this.state.combat.active && dist > (this.state.combat.movementLeft[actor.id] ?? actor.moveRange)) {
      this.log('Out of movement range.');
      return;
    }
    actor.x = x; actor.y = y;
    if (this.state.combat.active) this.state.combat.movementLeft[actor.id] = Math.max(0, (this.state.combat.movementLeft[actor.id] ?? actor.moveRange) - dist);
    this.resolveTileTriggers(actor, x, y);
    if (!this.state.combat.active && this.state.party.includes(actor.id) && this.state.partyControl.follow) this.syncPartyFormation(actor);
    this.advanceTime(this.state.combat.active ? 1 : 6);
    this.pendingAction = null;
    this.centerOnActor(actor);
    this.renderAll();
  }

  resolveTileTriggers(actor, x, y) {
    const tile = this.currentMap().tiles[y][x];
    if (tile.interactId === 'wake_airlock' && !this.state.flags.acquiredWake) {
      this.state.flags.acquiredWake = true;
      this.state.flags.shipOwned = true;
      this.log(`You and your crew claim ${this.state.ship.name}.`);
      this.advanceQuest('main_awake', 1);
    }
    if (tile.zone === 'security_restricted' && actor.role === 'player') {
      this.raiseCrime('trespass');
    }
    if (tile.transition) {
      this.state.mapId = tile.transition.mapId;
      this.state.currentSectorNode = tile.transition.sectorNode || this.state.currentSectorNode;
      this.state.visitedMaps = Array.from(new Set([...(this.state.visitedMaps || []), this.state.mapId]));
      const spot = this.findFreeTileNear(this.state.mapId, tile.transition.x ?? 2, tile.transition.y ?? 2, actor.id, 4) || { x: tile.transition.x ?? 2, y: tile.transition.y ?? 2 };
      this.state.party.forEach(id => {
        const p = this.state.roster.find(a => a.id === id);
        if (!p) return;
        const free = this.findFreeTileNear(this.state.mapId, spot.x + rand(-1,1), spot.y + rand(-1,1), p.id, 4) || spot;
        p.mapId = this.state.mapId;
        p.x = free.x;
        p.y = free.y;
      });
      (getById(this.data.maps, this.state.mapId)?.actors || []).forEach(t => {
        if (!this.state.roster.some(a => a.mapId === this.state.mapId && a.templateId === t.id)) {
          const spawned = createActorFromTemplate(t, this.data);
          spawned.mapId = this.state.mapId;
          applyDerivedStats(spawned, this.data);
          this.state.roster.push(spawned);
        }
      });
      this.log(tile.transition.text || `Area entered: ${getById(this.data.maps, this.state.mapId)?.name || this.state.mapId}.`);
    }
    if (tile.discoveryFlag) this.state.flags[tile.discoveryFlag] = true;
    if (tile.loot) this.inspectTile(x, y);
    if (tile.encounter && !this.state.combat.active) {
      const encounterId = tile.encounter;
      tile.encounter = null;
      this.startEncounter(encounterId);
    }
  }

  tryAttackAt(x, y) {
    const attacker = this.commandActor();
    if (!attacker || attacker.dead) return;
    const costCheck = this.canSpendCost(attacker, 'action');
    if (!costCheck.ok) {
      this.log(costCheck.reason);
      return;
    }
    const target = this.state.roster.find(a => a.mapId === this.state.mapId && a.x === x && a.y === y && a.id !== attacker.id);
    if (!target) {
      this.log('No target there.');
      return;
    }
    this.attack(attacker, target);
    this.pendingAction = null;
  }

  tryTalkAt(x, y) {
    const actor = this.state.roster.find(a => a.mapId === this.state.mapId && a.x === x && a.y === y && a.dialogueId);
    if (!actor) return this.log('No one there wants to talk.');
    this.pendingAction = null;
    this.interactWithActor(actor.id);
  }

  tryLootAt(x, y) {
    const tile = this.currentMap().tiles[y][x];
    if (!tile.loot) return this.log('Nothing obvious to loot.');
    this.pendingAction = null;
    this.inspectTile(x, y);
  }


tryUseAbilityAt(x, y, abilityId = null) {
  const actor = this.commandActor();
  if (!actor || actor.dead) return;
  const chosenAbilityId = abilityId || actor.abilities[0];
  const ability = getById(this.data.abilities, chosenAbilityId);
  const target = this.state.roster.find(a => a.mapId === this.state.mapId && a.x === x && a.y === y);
  if (!ability) return;

  const costCheck = this.canSpendCost(actor, ability.costType || 'action', ability);
  if (!costCheck.ok) {
    this.log(costCheck.reason);
    return;
  }

  if (ability.kind === 'heal' && target) {
    const amt = rand(4, 9) + statMod(actor.stats.tech);
    target.hp = clamp(target.hp + amt, 0, target.hpMax);
    this.spendAbilityResources(actor, ability);
    this.consumeAction(actor, ability.costType || 'action');
    this.log(`${actor.name} uses ${ability.name} on ${target.name} for ${amt}.`);
    this.advanceTime(1);
    this.pendingAction = null;
    this.renderAll();
    return;
  }
  if (ability.kind === 'attack' && target) {
    this.attack(actor, target, ability);
    return;
  }
  if (ability.kind === 'buff' && target) {
    if (!target.statuses.includes(ability.applyStatus)) target.statuses.push(ability.applyStatus);
    this.spendAbilityResources(actor, ability);
    this.consumeAction(actor, ability.costType || 'bonus');
    this.log(`${actor.name} uses ${ability.name}. ${target.name} gains ${ability.applyStatus}.`);
    this.advanceTime(1);
    this.pendingAction = null;
    this.renderAll();
    return;
  }

  this.log('That technique needs a valid target.');
}

tryUseFirstAbilityAt(x, y) {
  return this.tryUseAbilityAt(x, y, this.pendingActionAbilityId());
}

interactWithActor(id) {
    const actor = this.state.roster.find(a => a.id === id);
    if (!actor) return;
    this.state.selectedActorId = id;
    const key = this.actorKey(actor);
    const memory = this.state.dialogueMemory[key] || { count: 0, nodes: [] };
    if (key === 'fixer_naia' && this.state.flags.has_debt_ledger && !this.state.flags.debt_ledger_turned_in) {
      this.markTalked(actor, 'naia_ledger_turnin');
      this.openDialogue('naia_ledger_turnin', actor);
      return;
    }
    if (key === 'archivist_pell' && this.state.flags.has_reef_idol && !this.state.flags.learnedShipSecret) {
      this.markTalked(actor, 'archivist_idol');
      this.openDialogue('archivist_idol', actor);
      return;
    }
    if (actor.dialogueId && memory.count === 0) {
      this.markTalked(actor, actor.dialogueId);
      this.openDialogue(actor.dialogueId, actor);
      this.checkQuestProgress();
      return;
    }
    if (actor.repeatDialogueId) {
      this.markTalked(actor, actor.repeatDialogueId);
      this.openDialogue(actor.repeatDialogueId, actor);
      this.checkQuestProgress();
      return;
    }
    if (actor.dialogueId && memory.count > 0) {
      this.markTalked(actor, actor.dialogueId);
      this.openDialogue(actor.dialogueId, actor);
      return;
    }
    this.openAmbientDialogue(actor);
    this.checkQuestProgress();
  }

  inspectActor(actor) {
    renderInspect(this.state, this.data, `
      <div class="card">
        <strong>${actor.name}</strong>
        <div class="small">${actor.classId} · ${actor.speciesId} · ${actor.role}</div>
        <p>${actor.bio || 'No biography.'}</p>
        <div class="statline"><span>HP</span><strong>${actor.hp}/${actor.hpMax}</strong></div>
        <div class="statline"><span>Armor</span><strong>${actor.armor}</strong></div>
        <div class="statline"><span>Faction</span><strong>${actor.factionId}</strong></div>
      </div>
    `);
    this.openPanel('inspectPanel');
  }

  inspectTile(x, y) {
    const tile = this.currentMap().tiles[y][x];
    const title = tile.containerName || tile.interactText || `Tile (${x}, ${y})`;
    let html = `<div class="card"><strong>${title}</strong><div class="small">${tile.type}</div>`;
    if (tile.interactText) html += `<p>${tile.interactText}</p>`;
    if (tile.transition) html += `<p><strong>Leads to:</strong> ${tile.transition.mapId}</p>`;
    if (tile.lootTable?.length) {
      html += `<p><strong>Contents:</strong></p>`;
      tile.lootTable.forEach((l, idx) => {
        const item = getById(this.data.items, l.itemId);
        html += `<div class="statline"><span>${item?.name || l.itemId}</span><strong>x${l.qty}</strong> <button data-loot="${idx}">Take</button></div>`;
      });
    } else if (tile.loot) {
      html += `<p>It looks recently emptied.</p>`;
    }
    html += `</div>`;
    renderInspect(this.state, this.data, html);
    this.openPanel('inspectPanel');
    $$('[data-loot]').forEach(btn => btn.onclick = () => {
      const idx = Number(btn.dataset.loot);
      const loot = tile.lootTable[idx];
      const actor = this.selectedActor();
      actor.inventory.push(deepClone(loot));
      tile.lootTable.splice(idx, 1);
      if (loot.itemId) this.state.flags[`has_${loot.itemId}`] = true;
      if (tile.questFlag) this.state.flags[tile.questFlag] = true;
      if (!tile.lootTable.length) tile.loot = false;
      this.log(`${actor.name} loots ${loot.qty}x ${loot.itemId}.`);
      this.checkQuestProgress();
      this.renderAll();
      this.inspectTile(x, y);
    });
  }

  showActorContext(id, x, y) {
    const actor = this.state.roster.find(a => a.id === id);
    if (!actor) return;
    this.showContextMenu(x, y, [
      ['Talk / Inspect', () => this.interactWithActor(id)],
      ['Attack', () => this.attack(this.selectedActor(), actor)],
      ['Pickpocket', () => this.tryPickpocket(actor)],
      ['Mark Follow / Join', () => this.tryRecruit(actor)],
    ]);
  }

  showContextMenu(x, y, options) {
    const menu = $('#contextMenu');
    menu.innerHTML = '';
    options.forEach(([label, fn]) => {
      const btn = createEl('button', {}, label);
      btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.add('hidden');
        fn();
      });
      menu.appendChild(btn);
    });
    // Keep menu inside viewport
    const vw = window.innerWidth, vh = window.innerHeight;
    const menuW = 200, menuH = options.length * 44;
    const safeX = Math.min(x, vw - menuW - 8);
    const safeY = Math.min(y, vh - menuH - 8);
    menu.style.left = `${Math.max(8, safeX)}px`;
    menu.style.top  = `${Math.max(8, safeY)}px`;
    menu.classList.remove('hidden');
  }

  inspectEquipmentSlot(actorId, slot) {
    const actor = this.state.roster.find(a => a.id === actorId);
    const itemId = actor.equipped[slot];
    const item = getById(this.data.items, itemId);
    renderInspect(this.state, this.data, `
      <div class="card">
        <strong>${slot}</strong>
        <p>${item ? item.name : 'Empty slot.'}</p>
        <div class="small">${item?.description || ''}</div>
      </div>
    `);
    this.openPanel('inspectPanel');
  }

  inspectInventoryItem(actorId, idx, x = 200, y = 200, forceContext = false) {
    const actor = this.state.roster.find(a => a.id === actorId);
    const entry = actor.inventory[idx];
    const item = getById(this.data.items, entry.itemId);
    if (!entry || !item) return;
    if (forceContext) {
      return this.showContextMenu(x, y, [
        ['Use / Equip', () => this.useItem(actor, idx)],
        ['Send to Cargo', () => this.sendItemToCargo(actor, idx)],
        ['Rename Stack', () => this.renameItemStack(actor, idx)],
        ['Drop', () => this.dropItem(actor, idx)]
      ]);
    }
    renderInspect(this.state, this.data, `
      <div class="card">
        <strong>${entry.customName || item.name}</strong>
        <div class="small">${item.type} · ${item.rarity || 'common'} · x${entry.qty}</div>
        <p>${item.description}</p>
        <div class="row-wrap">
          <button id="useInvBtn">Use / Equip</button>
          <button id="sendInvBtn">Send to Cargo</button>
          <button id="renameInvBtn">Rename</button>
          <button id="dropInvBtn">Drop</button>
        </div>
      </div>
    `);
    this.openPanel('inspectPanel');
    $('#useInvBtn').onclick = () => this.useItem(actor, idx);
    $('#sendInvBtn').onclick = () => this.sendItemToCargo(actor, idx);
    $('#renameInvBtn').onclick = () => this.renameItemStack(actor, idx);
    $('#dropInvBtn').onclick = () => this.dropItem(actor, idx);
  }

  handleInventoryDrop(e, actorId, idx) {
    e.preventDefault();
    const payload = JSON.parse(e.dataTransfer.getData('text/plain') || '{}');
    const src = this.state.roster.find(a => a.id === payload.ownerId);
    const dst = this.state.roster.find(a => a.id === actorId);
    if (!src || !dst || payload.idx == null) return;
    const [entry] = src.inventory.splice(payload.idx, 1);
    if (!entry) return;
    if (idx >= dst.inventory.length) dst.inventory.push(entry);
    else dst.inventory.splice(idx, 0, entry);
    this.log(`Moved ${entry.itemId} from ${src.name} to ${dst.name}.`);
    this.renderAll();
  }

  inspectCargoItem(idx) {
    const entry = this.state.ship.cargo[idx];
    const item = getById(this.data.items, entry.itemId);
    renderInspect(this.state, this.data, `
      <div class="card">
        <strong>${entry.customName || item?.name || entry.itemId}</strong>
        <div class="small">${item?.type || 'misc'} x${entry.qty}</div>
        <div class="row-wrap">
          <button id="pullCargoBtn">Pull to Selected Actor</button>
        </div>
      </div>
    `);
    this.openPanel('inspectPanel');
    $('#pullCargoBtn').onclick = () => {
      const actor = this.selectedActor();
      actor.inventory.push(entry);
      this.state.ship.cargo.splice(idx, 1);
      this.log(`${actor.name} takes ${entry.itemId} from ship cargo.`);
      this.renderAll();
    };
  }


useItem(actor, idx) {
  const actingActor = this.state.combat.active ? this.commandActor() : actor;
  const entry = actor.inventory[idx];
  const item = getById(this.data.items, entry.itemId);
  if (!item) return;
  if (item.type === 'consumable') {
    const costCheck = this.canSpendCost(actingActor, 'action');
    if (!costCheck.ok) {
      this.log(costCheck.reason);
      return;
    }
    if (item.effect?.heal) actor.hp = clamp(actor.hp + item.effect.heal, 0, actor.hpMax);
    if (item.effect?.hunger) actor.survival.hunger = clamp(actor.survival.hunger + item.effect.hunger, 0, 100);
    if (item.effect?.thirst) actor.survival.thirst = clamp(actor.survival.thirst + item.effect.thirst, 0, 100);
    if (item.effect?.morale) actor.survival.morale = clamp(actor.survival.morale + item.effect.morale, 0, 100);
    entry.qty -= 1;
    if (this.state.combat.active) this.consumeAction(actingActor, 'action');
    this.log(`${actor.name} uses ${item.name}.`);
    if (entry.qty <= 0) actor.inventory.splice(idx, 1);
    this.renderAll();
    return;
  }
  if (item.slot) {
    actor.equipped[item.slot] = item.id;
    this.log(`${actor.name} equips ${item.name}.`);
    this.renderAll();
    return;
  }
  if (item.type === 'container') {
    this.log(`${item.name} is a named container hook. Nested container UI can be expanded later.`);
    this.renameItemStack(actor, idx);
  }
}

sendItemToCargo(actor, idx) {
    const [entry] = actor.inventory.splice(idx, 1);
    if (!entry) return;
    this.state.ship.cargo.push(entry);
    this.log(`${entry.itemId} sent to ship cargo.`);
    this.renderAll();
  }

  renameItemStack(actor, idx) {
    const entry = actor.inventory[idx];
    const next = prompt('Rename this item/container/stack:', entry.customName || '');
    if (next != null) {
      entry.customName = next.trim() || null;
      this.log(`Renamed stack to "${entry.customName || 'default'}".`);
      this.renderAll();
    }
  }

  dropItem(actor, idx) {
    const [entry] = actor.inventory.splice(idx, 1);
    if (!entry) return;
    this.log(`${actor.name} drops ${entry.itemId}.`);
    this.renderAll();
  }


toggleStealth(actorId) {
  const actor = this.state.roster.find(a => a.id === actorId) || this.commandActor();
  if (!actor) return;
  const costCheck = this.canSpendCost(actor, this.state.combat.active ? 'bonus' : 'free');
  if (!costCheck.ok) {
    this.log(costCheck.reason);
    return;
  }
  const has = actor.statuses.includes('stealthed');
  actor.statuses = has ? actor.statuses.filter(s => s !== 'stealthed') : [...actor.statuses, 'stealthed'];
  if (this.state.combat.active) this.consumeAction(actor, 'bonus');
  if (this.state.party.includes(actor.id) && !this.state.combat.active && this.state.partyControl.squadStealth) {
    this.state.party.forEach(id => {
      const mate = this.state.roster.find(a => a.id === id);
      if (!mate) return;
      if (has) mate.statuses = mate.statuses.filter(s => s !== 'stealthed');
      else if (!mate.statuses.includes('stealthed')) mate.statuses.push('stealthed');
    });
  }
  this.log(`${actor.name} ${has ? 'leaves' : 'enters'} stealth.`);
  this.renderAll();
}

attack(attacker, target, ability = null) {
    if (!attacker || !target || attacker.dead || target.dead) return;
    if (this.state.combat.active && this.state.combat.turnOrder[this.state.combat.currentTurnIndex] !== attacker.id) {
      this.log(`It is not ${attacker.name}'s turn.`);
      return;
    }
    const weapon = getById(this.data.items, attacker.equipped.mainhand);
    const attackBonus = statMod(attacker.stats.agility) + attacker.level + (weapon?.attackBonus || 0) + (ability?.attackBonus || 0);
    const roll = rollDice('1d20');
    const crit = roll.rolls[0] === 20;
    const hit = crit || (roll.total + attackBonus) >= target.armor;
    this.log(`${attacker.name} attacks ${target.name}: ${roll.rolls[0]} + ${attackBonus} vs AC ${target.armor}.`);
    attacker.statuses = attacker.statuses.filter(s => s !== 'stealthed');
    if (hit) {
      const baseExpr = ability?.damage || weapon?.damage || '1d6';
      const dmgRoll = rollDice(baseExpr);
      let dmg = dmgRoll.total + statMod(attacker.stats.might);
      if (crit) dmg += dmgRoll.total;
      if (target.shield > 0) {
        const absorbed = Math.min(target.shield, dmg);
        target.shield -= absorbed;
        dmg -= absorbed;
      }
      if (dmg > 0) target.hp -= dmg;
      this.log(`${target.name} takes ${Math.max(dmg,0)} damage${crit ? ' (CRIT)' : ''}.`);
      if (ability?.applyStatus && !target.statuses.includes(ability.applyStatus)) {
        target.statuses.push(ability.applyStatus);
        this.log(`${target.name} gains ${ability.applyStatus}.`);
      }
      this.handleDeathState(target);
    } else {
      this.log(`${attacker.name} misses.`);
    }
    this.consumeAction(attacker, ability?.costType || 'action');
    if (!this.state.combat.active) this.startCombat();
    this.advanceTime(1);
    this.pendingAction = null;
    this.renderAll();
  }

  consumeAction(actor, type = 'action') {
    if (!this.state.combat.active || !actor) return;
    if (type === 'bonus') this.state.combat.bonusActed[actor.id] = true;
    else if (type === 'reaction') {
      this.state.combat.reactionSpent ??= {};
      this.state.combat.reactionSpent[actor.id] = true;
    } else if (type !== 'free' && type !== 'none' && type !== 'move') {
      this.state.combat.acted[actor.id] = true;
    }
  }

  handleDeathState(actor) {
    if (actor.hp > 0) return;
    if (actor.canRevive && !actor.downed) {
      actor.downed = true;
      actor.hp = 0;
      this.log(`${actor.name} is downed.`);
      return;
    }
    actor.dead = true;
    actor.downed = false;
    this.log(`${actor.name} dies.`);
    if (this.state.party.includes(actor.id)) this.state.party = this.state.party.filter(id => id !== actor.id);
  }

  startCombat() {
    const actors = this.state.roster.filter(a => a.mapId === this.state.mapId && !a.dead && (this.state.party.includes(a.id) || a.role === 'enemy'));
    actors.forEach(actor => this.ensureActorResources(actor));
    this.state.combat.active = true;
    this.state.combat.round = 1;
    this.state.combat.turnOrder = [...actors].sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0)).map(a => a.id);
    this.state.combat.currentTurnIndex = 0;
    this.state.combat.movementLeft = Object.fromEntries(actors.map(a => [a.id, a.moveRange]));
    this.state.combat.acted = {};
    this.state.combat.bonusActed = {};
    this.state.combat.reactionSpent = {};
    this.state.combat.aiActingId = null;
    this.state.selectedActorId = this.state.combat.turnOrder[0];
    this.log('Combat begins.');
    this.renderAll();
  }

  startEncounter(encounterId) {
    const enc = getById(this.data.encounters, encounterId);
    if (!enc) return;
    this.log(enc.text || 'An encounter begins.');
    enc.spawn?.forEach(t => {
      const actor = createActorFromTemplate(t, this.data);
      actor.mapId = this.state.mapId;
      const spot = this.findFreeTileNear(this.state.mapId, t.x, t.y, actor.id, 4) || { x: t.x, y: t.y };
      actor.x = spot.x; actor.y = spot.y;
      applyDerivedStats(actor, this.data);
      this.state.roster.push(actor);
    });
    this.startCombat();
  }

  endTurn() {
    if (!this.state.combat.active) return;

    this.state.combat.turnOrder = this.state.combat.turnOrder.filter(id => {
      const actor = this.state.roster.find(a => a.id === id);
      return actor && !actor.dead && actor.mapId === this.state.mapId;
    });
    if (!this.state.combat.turnOrder.length) {
      this.state.combat.active = false;
      this.renderAll();
      return;
    }

    this.state.combat.currentTurnIndex++;
    if (this.state.combat.currentTurnIndex >= this.state.combat.turnOrder.length) {
      this.state.combat.currentTurnIndex = 0;
      this.state.combat.round++;
      this.state.combat.acted = {};
      this.state.combat.bonusActed = {};
      this.state.combat.reactionSpent = {};
      this.state.combat.movementLeft = Object.fromEntries(this.state.combat.turnOrder
        .map(id => this.state.roster.find(a => a.id === id))
        .filter(Boolean).map(a => [a.id, a.moveRange]));
      this.applyRoundEffects();
      this.log(`Round ${this.state.combat.round}.`);
      if (!this.state.combat.active) {
        this.renderAll();
        return;
      }
    }
    const nextId = this.state.combat.turnOrder[this.state.combat.currentTurnIndex];
    this.state.selectedActorId = nextId;
    this.pendingAction = null;
    const next = this.state.roster.find(a => a.id === nextId);
    if (next) this.centerOnActor(next);
    if (next && next.ai !== 'player' && !this.state.party.includes(next.id)) {
      this.state.combat.aiActingId = next.id;
      this.renderAll();
      clearTimeout(this.aiTurnTimer);
      this.aiTurnTimer = setTimeout(() => {
        this.runAITurn(next);
        this.state.combat.aiActingId = null;
        this.renderAll();
        clearTimeout(this.aiEndTimer);
        this.aiEndTimer = setTimeout(() => this.endTurn(), 380);
      }, 500);
      return;
    }
    this.state.combat.aiActingId = null;
    this.renderAll();
  }

  runAITurn(actor) {
    const partyActors = this.state.party.map(id => this.state.roster.find(a => a.id === id)).filter(a => a && !a.dead);
    if (!partyActors.length) return;
    const target = partyActors.sort((a,b) => distance(actor,a)-distance(actor,b))[0];
    const attackAbility = actor.abilities.map(id => getById(this.data.abilities,id)).find(a => a && a.kind === 'attack');
    if (distance(actor, target) <= 1) {
      this.attack(actor, target, attackAbility?.powerSource ? attackAbility : null);
      return;
    }
    const options = [
      { x: target.x + 1, y: target.y }, { x: target.x - 1, y: target.y },
      { x: target.x, y: target.y + 1 }, { x: target.x, y: target.y - 1 }
    ];
    const open = options.map(pos => this.findFreeTileNear(actor.mapId, pos.x, pos.y, actor.id, 1)).find(Boolean);
    if (open) this.moveActorToward(actor, open.x, open.y);
  }

  applyRoundEffects() {
    this.state.roster.forEach(actor => {
      if (actor.dead) return;
      if (actor.statuses.includes('bleeding')) actor.hp -= 1;
      if (actor.statuses.includes('irradiated')) actor.survival.toxicity = clamp(actor.survival.toxicity + 2, 0, 100);
      if (actor.survival.toxicity >= 100) actor.hp -= 2;
      this.handleDeathState(actor);
    });
    const enemiesAlive = this.state.roster.some(a => a.mapId === this.state.mapId && a.role === 'enemy' && !a.dead);
    const partyAlive = this.state.party.some(id => {
      const actor = this.state.roster.find(a => a.id === id);
      return actor && !actor.dead;
    });
    if (!enemiesAlive || !partyAlive) {
      this.state.combat.active = false;
      this.log(!partyAlive ? 'Your party is wiped out.' : 'Combat ends.');
    }
  }

  advanceTime(minutes) {
    this.state.timeMinutes += minutes;
    if (!this.state.combat.active) this.tickSurvival(minutes);
    this.handleScheduledEvents();
    this.renderAll();
  }

  tickSurvival(minutes) {
    const party = this.state.party.map(id => this.state.roster.find(a => a.id === id)).filter(Boolean);
    party.forEach(actor => {
      actor.survival.hunger = clamp(actor.survival.hunger - (minutes / 24), 0, 100);
      actor.survival.thirst = clamp(actor.survival.thirst - (minutes / 18), 0, 100);
      actor.survival.fatigue = clamp(actor.survival.fatigue - (minutes / 32), 0, 100);
      actor.survival.morale = clamp(actor.survival.morale - (minutes / 180), 0, 100);
      if (actor.survival.hunger <= 0) actor.hp -= Math.max(1, Math.floor(minutes / 30));
      if (actor.survival.thirst <= 0) actor.hp -= Math.max(1, Math.floor(minutes / 20));
      if (actor.survival.fatigue <= 0) actor.hp -= Math.max(1, Math.floor(minutes / 45));
      this.handleDeathState(actor);
    });
    if (minutes >= 60) {
      if (this.state.resources.rations > 0) {
        this.state.resources.rations = Math.max(0, this.state.resources.rations - 1);
        party.forEach(a => a.survival.hunger = clamp(a.survival.hunger + 18, 0, 100));
      }
      if (this.state.resources.water > 0) {
        this.state.resources.water = Math.max(0, this.state.resources.water - 1);
        party.forEach(a => a.survival.thirst = clamp(a.survival.thirst + 18, 0, 100));
      }
    }
  }

  longRest() {
    if (!this.state.flags.shipOwned && this.state.mapId !== 'wake_interior') {
      this.log('You need a safe rest zone or the ship.');
      return;
    }
    if (this.state.resources.rations < 1 || this.state.resources.water < 1) {
      this.log('Not enough food or water for a proper rest.');
      return;
    }
    this.state.resources.rations -= 1;
    this.state.resources.water -= 1;
    this.state.party.forEach(id => {
      const actor = this.state.roster.find(a => a.id === id);
      if (!actor) return;
      this.ensureActorResources(actor);
      actor.hp = actor.hpMax;
      actor.shield = actor.shieldMax;
      actor.downed = false;
      actor.statuses = actor.statuses.filter(s => !['bleeding'].includes(s));
      actor.survival.hunger = clamp(actor.survival.hunger + 35, 0, 100);
      actor.survival.thirst = clamp(actor.survival.thirst + 35, 0, 100);
      actor.survival.fatigue = clamp(actor.survival.fatigue + 60, 0, 100);
      actor.survival.morale = clamp(actor.survival.morale + 12, 0, 100);
      Object.values(actor.powerPools || {}).forEach(pool => {
        if ((pool.recharge || 'longRest') === 'longRest') pool.current = pool.max;
      });
      Object.values(actor.abilityUses || {}).forEach(entry => {
        if ((entry.recharge || 'longRest') === 'longRest') entry.current = entry.max;
      });
    });
    this.advanceTime(8 * 60);
    this.state.partyControl.squadStealth = false;
    this.log('The crew takes a long rest.');
  }

  tryRecruit(actor) {
    if (this.state.party.includes(actor.id)) return this.log(`${actor.name} is already in the party.`);
    if (actor.role !== 'ally') return this.log(`${actor.name} is not recruitable right now.`);
    if (this.state.party.length >= this.state.partyMax) return this.log('Party is full.');
    this.state.party.push(actor.id);
    this.state.flags[`joined_${this.actorKey(actor)}`] = true;
    if (this.state.partyControl.follow && this.state.partyControl.leaderId) {
      const leader = this.state.roster.find(a => a.id === this.state.partyControl.leaderId) || actor;
      this.syncPartyFormation(leader);
    }
    this.log(`${actor.name} joins the active party.`);
    this.checkQuestProgress();
    this.renderAll();
  }

  tryPickpocket(actor) {
    const thief = this.selectedActor();
    const dc = 12 + actor.level;
    const roll = rollDice('1d20').total + statMod(thief.stats.agility) + (thief.statuses.includes('stealthed') ? 2 : 0);
    if (roll >= dc) {
      thief.inventory.push({ itemId: 'credits_chit', qty: rand(1,3) });
      this.log(`${thief.name} successfully pickpockets ${actor.name}.`);
    } else {
      this.raiseCrime('theft');
      this.log(`Pickpocket attempt failed. ${actor.name} notices.`);
    }
    this.renderAll();
  }

  raiseCrime(kind) {
    this.state.crime.witnessLevel += 1;
    this.state.flags.crimeAlert = true;
    this.log(`Crime detected: ${kind}. Security tension rises.`);
    const factionPenalty = kind === 'theft' ? -3 : -1;
    this.state.factions['station_civic'] = (this.state.factions['station_civic'] || 0) + factionPenalty;
  }

  travelToSector(nodeId) {
    const node = getById(this.data.config.sectorNodes, nodeId);
    if (!node) return;
    if (!this.state.flags.shipOwned) return this.log('You do not control a ship yet.');
    if (this.state.resources.fuel < node.fuelCost) return this.log('Not enough fuel.');
    this.state.resources.fuel -= node.fuelCost;
    this.advanceTime(node.travelHours * 60);
    this.state.currentSectorNode = node.id;
    this.state.mapId = node.mapId;
    this.state.visitedMaps = Array.from(new Set([...(this.state.visitedMaps || []), this.state.mapId]));
    (getById(this.data.maps, this.state.mapId)?.actors || []).forEach(t => {
      if (!this.state.roster.some(a => a.mapId === this.state.mapId && a.templateId === t.id)) {
        const actor = createActorFromTemplate(t, this.data);
        actor.mapId = this.state.mapId;
        const free = this.findFreeTileNear(this.state.mapId, t.x ?? 2, t.y ?? 2, actor.id, 4) || { x: t.x ?? 2, y: t.y ?? 2 };
        actor.x = free.x; actor.y = free.y;
        applyDerivedStats(actor, this.data);
        this.state.roster.push(actor);
      }
    });
    const lead = this.state.roster.find(a => a.id === (this.state.partyControl.leaderId || this.state.party[0]));
    const base = this.findFreeTileNear(this.state.mapId, 2, 2, lead?.id, 4) || { x: 2, y: 2 };
    this.state.party.forEach(id => {
      const actor = this.state.roster.find(a => a.id === id);
      if (actor) {
        const free = this.findFreeTileNear(this.state.mapId, base.x + rand(0,2), base.y + rand(0,2), actor.id, 4) || base;
        actor.mapId = this.state.mapId; actor.x = free.x; actor.y = free.y;
      }
    });
    this.resolveTravelEncounter(node);
    this.checkQuestProgress();
    this.log(`Travel complete: ${node.name}.`);
    this.renderAll();
  }

  resolveTravelEncounter(node) {
    if (chance(node.encounterChance)) {
      const enc = pick(this.data.encounters.filter(e => e.scope === 'travel'));
      this.log(`Travel encounter: ${enc.name}. ${enc.text}`);
      if (enc.resourceLoss) {
        Object.entries(enc.resourceLoss).forEach(([k,v]) => this.state.resources[k] = Math.max(0, this.state.resources[k] - v));
      }
      if (enc.damageParty) {
        this.state.party.forEach(id => {
          const a = this.state.roster.find(x => x.id === id);
          if (a) a.hp = Math.max(1, a.hp - enc.damageParty);
        });
      }
    }
  }

  openDialogue(nodeId, actor) {
    if (actor) this.markTalked(actor, nodeId);
    renderDialogue(this.state, this.data, this.api, nodeId, actor);
    this.openPanel('dialoguePanel');
  }

  evaluateChoice(choice) {
    if (!choice.check) return { pass: true };
    const actor = this.selectedActor();
    const mod = statMod(actor.stats[choice.check.stat] || 10) + actor.level + (choice.check.bonus || 0);
    const roll = rollDice('1d20').total + mod;
    return {
      pass: roll >= choice.check.dc,
      passText: `rolled ${roll}`,
      failText: `rolled ${roll}`
    };
  }

  resolveDialogueChoice(choice, result, speakerActor) {
    if (choice.effects) this.applyEffects(choice.effects, speakerActor);
    const targetNode = choice.check ? (result.pass ? choice.target : choice.failTarget ?? choice.target) : choice.target;
    if (!targetNode) {
      $('#dialoguePanel').classList.add('hidden');
      this.checkQuestProgress();
      return;
    }
    this.openDialogue(targetNode, speakerActor);
  }

  applyEffects(effects, speakerActor) {
    if (effects.questAdvance) this.advanceQuest(effects.questAdvance.id, effects.questAdvance.stage);
    if (effects.completeQuest) {
      this.state.quests[effects.completeQuest] ??= { stage: 0, complete: false, failed: false };
      this.state.quests[effects.completeQuest].complete = true;
    }
    if (effects.setFlag) {
      if (Array.isArray(effects.setFlag)) effects.setFlag.forEach(flag => this.state.flags[flag] = true);
      else this.state.flags[effects.setFlag] = true;
    }
    if (effects.shipOwned) this.state.flags.shipOwned = true;
    if (effects.joinParty && speakerActor) this.tryRecruit(speakerActor);
    if (effects.affinity && speakerActor) {
      speakerActor.affinity += effects.affinity;
      const rel = this.state.relationship[speakerActor.id];
      if (rel) rel.affinity += effects.affinity;
    }
    if (effects.romance && speakerActor) {
      speakerActor.romance.stage = Math.max(speakerActor.romance.stage, effects.romance);
      if (effects.romance >= 2) speakerActor.romance.active = true;
    }
    if (effects.resource) {
      Object.entries(effects.resource).forEach(([k,v]) => this.adjustResource(k, v, false));
    }
    if (effects.addItem) {
      const actor = this.selectedActor();
      actor?.inventory.push(deepClone(effects.addItem));
    }
    if (effects.travel) this.travelToSector(effects.travel);
    if (effects.log) this.log(effects.log);
    this.checkQuestProgress();
    this.renderAll();
  }

  advanceQuest(id, stage) {
    const quest = getById(this.data.quests, id);
    if (!this.state.quests[id]) this.state.quests[id] = { stage: 0, complete: false, failed: false };
    const nextStage = Math.max(0, Math.min(stage, Math.max(0, (quest?.stages?.length || 1) - 1)));
    this.state.quests[id].stage = nextStage;
    this.log(`Quest updated: ${quest?.name || id}`);
    this.checkQuestProgress();
  }

  handleScheduledEvents() {
    const q = this.state.quests['main_awake'];
    if (q?.stage === 1 && this.state.flags.shipOwned && !this.state.flags.tutorialComplete) {
      this.state.flags.tutorialComplete = true;
      this.log('Tutorial complete. You now have the ship, sector travel, inventory, and crew management available.');
      this.advanceQuest('main_awake', 2);
    }
    this.checkQuestProgress();
  }

  openPanel(id) {
    document.getElementById(id).classList.remove('hidden');
  }

  log(msg) {
    pushMessage(this.state, msg);
  }

  adjustResource(key, amount, rerender = true) {
    this.state.resources[key] = Math.max(0, (this.state.resources[key] || 0) + amount);
    this.log(`${key} ${amount >= 0 ? '+' : ''}${amount}.`);
    if (rerender) this.renderAll();
  }

  adminHealParty() {
    this.state.party.forEach(id => {
      const a = this.state.roster.find(x => x.id === id);
      if (a) { a.hp = a.hpMax; a.shield = a.shieldMax; a.downed = false; a.dead = false; }
    });
    this.log('Admin: party healed.');
    this.renderAll();
  }

  adminFeedParty() {
    this.state.party.forEach(id => {
      const a = this.state.roster.find(x => x.id === id);
      if (a) {
        a.survival.hunger = 100; a.survival.thirst = 100; a.survival.fatigue = 100; a.survival.morale = 90;
      }
    });
    this.log('Admin: party fed and rested.');
    this.renderAll();
  }

  adminToggleCombat() {
    this.state.combat.active ? this.state.combat.active = false : this.startCombat();
    this.log('Admin toggled combat.');
    this.renderAll();
  }

  adminSpawnEnemy() {
    const actor = createActorFromTemplate({
      id: 'debug_bandit', name: 'Debug Marauder', speciesId: 'synthel', classId: 'raider',
      role: 'enemy', factionId: 'void_reavers', x: rand(5,10), y: rand(3,8), hpMax: 16, armor: 12,
      abilities: ['burst_fire'], inventory: [{ itemId: 'stunstick', qty: 1 }], equipped: { mainhand: 'scrap_pistol', armor: 'patch_armor' }
    }, this.data);
    actor.mapId = this.state.mapId;
    applyDerivedStats(actor, this.data);
    this.state.roster.push(actor);
    this.log('Admin spawned enemy.');
    this.renderAll();
  }

  adminAdvanceMainQuest() {
    const q = this.state.quests['main_awake'];
    q.stage = Math.min(q.stage + 1, getById(this.data.quests, 'main_awake').stages.length - 1);
    this.log('Admin advanced main quest.');
    this.renderAll();
  }

  save() {
    saveState(this.state);
  }

  startLoop() {
    setInterval(() => {
      if (!document.hidden && $('#gameRoot').classList.contains('active')) {
        this.advanceTime(1);
        this.save();
      }
    }, 5000);
  }
}
