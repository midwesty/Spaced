/**
 * VOID BILLIARDS — Pool & Blitzards Table System for Spaced
 * ==========================================================
 * Entry point: openPoolTable(tableId, state, data, api)
 *
 * Games: eight_ball | nine_ball | straight_pool | blitzards
 *
 * Physics: True canvas-based ball physics with friction, spin, cushion bounce,
 * pocket detection. GTA:SA-style aim line + power meter for shot input.
 *
 * Blitzards: Original IP. Explosive space bottles on the table.
 * Break one = penalty. Bottle clusters = tactical hazards.
 * Full rules defined in GAME_REGISTRY.
 */

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const PT_TABLE_W = 800;
const PT_TABLE_H = 420;
const PT_CUSHION = 38;
const PT_BALL_R  = 12;
const PT_POCKET_R = 22;
const PT_FRICTION = 0.985;
const PT_MIN_SPEED = 0.15;
const PT_CUSHION_RESTITUTION = 0.72;
const PT_BALL_RESTITUTION    = 0.92;
const PT_MAX_POWER = 22;

const PT_PLAY_X1 = PT_CUSHION;
const PT_PLAY_Y1 = PT_CUSHION;
const PT_PLAY_X2 = PT_TABLE_W - PT_CUSHION;
const PT_PLAY_Y2 = PT_TABLE_H - PT_CUSHION;
const PT_MID_Y   = (PT_PLAY_Y1 + PT_PLAY_Y2) / 2;

const POCKET_POSITIONS = [
  { x: PT_PLAY_X1 + 4, y: PT_PLAY_Y1 + 4 },
  { x: (PT_PLAY_X1 + PT_PLAY_X2) / 2, y: PT_PLAY_Y1 - 2 },
  { x: PT_PLAY_X2 - 4, y: PT_PLAY_Y1 + 4 },
  { x: PT_PLAY_X1 + 4, y: PT_PLAY_Y2 - 4 },
  { x: (PT_PLAY_X1 + PT_PLAY_X2) / 2, y: PT_PLAY_Y2 + 2 },
  { x: PT_PLAY_X2 - 4, y: PT_PLAY_Y2 - 4 },
];

// Standard ball colors
const BALL_COLORS = [
  null,
  '#f5d800', // 1 yellow
  '#1a56d6', // 2 blue
  '#d63a1a', // 3 red
  '#7b2fbe', // 4 purple
  '#d6521a', // 5 orange
  '#1a9e44', // 6 green
  '#8b1a1a', // 7 maroon
  '#1a1a1a', // 8 black
  '#f5d800', // 9 yellow stripe
  '#1a56d6', // 10 blue stripe
  '#d63a1a', // 11 red stripe
  '#7b2fbe', // 12 purple stripe
  '#d6521a', // 13 orange stripe
  '#1a9e44', // 14 green stripe
  '#8b1a1a', // 15 maroon stripe
];

// Blitzards bottle colors
const BOTTLE_COLORS = ['#3fa', '#f83', '#f3a', '#3af', '#ff3'];

// ─── MODULE STATE ─────────────────────────────────────────────────────────────

let _overlay   = null;
let _tableData = null;
let _state     = null;
let _data      = null;
let _api       = null;
let _sessionStartCredits = 0;

let _canvas    = null;
let _ctx       = null;
let _animId    = null;

let _pts = {   // _poolTableState
  game: null,
  phase: 'lobby',     // lobby | opponent | bet | playing | turn_result | game_over
  playerCredits: 0,
  playerBet: 0,
  opponent: null,     // seat object
  opponentCredits: 0,
  message: '',
  log: [],
  gossipShown: new Set(),
  round: 0,
  // physics
  balls: [],
  shooting: false,
  aimAngle: Math.PI,
  power: 0,
  powerDir: 1,
  powerCharging: false,
  shotInProgress: false,
  lastShotResult: null,
  // game specific
  playerGroup: null,  // 'solid' | 'stripe' | null
  opponentGroup: null,
  currentTurn: 'player', // 'player' | 'opponent'
  pocketedThisTurn: [],
  foulThisTurn: false,
  cueBallPosX: 0,
  cueBallPosY: 0,
  placingCueBall: false,
  // 9-ball
  lowestBall: 1,
  // straight pool
  playerScore: 0,
  opponentScore: 0,
  scoreTarget: 30,
  // blitzards
  bottles: [],
  blitzScore: 0,
  opponentBlitzScore: 0,
  blitzTargetScore: 10,
  blitzLastBreak: null,
};

// ─── GAME REGISTRY ────────────────────────────────────────────────────────────

const PT_GAME_REGISTRY = {
  eight_ball: {
    id: 'eight_ball',
    name: '8-Ball',
    icon: '●',
    subtitle: 'Pocket your group, then the 8',
    description: 'Solids (1–7) vs Stripes (9–15). Pocket all your group then sink the 8-ball to win. Scratch on the 8 = instant loss. Groups assigned on first legal pocket.',
    initFn: (...a) => initEightBall(...a),
    renderGameUI: (...a) => renderEightBallUI(...a),
  },
  nine_ball: {
    id: 'nine_ball',
    name: '9-Ball',
    icon: '◉',
    subtitle: 'Lowest ball first — race to sink the 9',
    description: 'Only balls 1–9. Must always hit the lowest-numbered ball first. Pocket the 9-ball (legally) on any shot to win. Fouls give opponent ball-in-hand.',
    initFn: (...a) => initNineBall(...a),
    renderGameUI: (...a) => renderNineBallUI(...a),
  },
  straight_pool: {
    id: 'straight_pool',
    name: 'Straight Pool',
    icon: '◎',
    subtitle: 'Call your shot — race to 30 points',
    description: 'Call the ball and pocket before shooting. Each legally pocketed ball = 1 point. Scratch = –1 point. First to 30 wins. Any ball, any pocket — just call it.',
    initFn: (...a) => initStraightPool(...a),
    renderGameUI: (...a) => renderStraightPoolUI(...a),
  },
  blitzards: {
    id: 'blitzards',
    name: 'Blitzards',
    icon: '💥',
    subtitle: 'Score points — don\'t blow up the bottles',
    description: 'Glowing void-bottles scatter the table. Pocket numbered balls for points (1pt each). Hit a bottle = it SHATTERS and you lose your turn + 2pts. Pocket a bottle = FORFEIT. Race to 10pts. Bottles respawn each rack. Class abilities apply.',
    initFn: (...a) => initBlitzards(...a),
    renderGameUI: (...a) => renderBlitzardsUI(...a),
  },
};

// ─── CLASS ABILITIES (Void Hustles) ──────────────────────────────────────────

const VOID_HUSTLES = {
  marshal:  { id: 'deadeye',      label: 'Dead Eye',    desc: 'Your aim line extends full table length this shot.',    cooldown: 3 },
  raider:   { id: 'power_break',  label: 'Power Break', desc: 'Next break shot deals 1.5× power. Bottles more likely to scatter safely.', cooldown: 3 },
  salvager: { id: 'arc_calc',     label: 'Arc Calc',    desc: 'Aim line shows predicted ball path after first collision.', cooldown: 3 },
  voidseer: { id: 'premonition',  label: 'Premonition', desc: 'Reveals exactly which pocket each ball will go for next 3 turns.', cooldown: 4 },
  _default: { id: 'lucky_roll',   label: 'Lucky Roll',  desc: '+30% power on current shot. Ball finds its way.',       cooldown: 3 },
};

// ─── ENTRY POINT ──────────────────────────────────────────────────────────────

export function openPoolTable(tableId, state, data, api) {
  _state = state; _data = data; _api = api;
  const table = (data.tables || []).find(t => t.id === tableId);
  if (!table) { console.warn('[PoolTable] Not found:', tableId); return; }
  _tableData = table;

  if (table.requiredFlag && !state.flags[table.requiredFlag]) {
    api.log(`The ${table.name} is not accessible yet.`); return;
  }

  _sessionStartCredits = state.resources.credits;

  _pts = {
    game: null, phase: 'lobby',
    playerCredits: state.resources.credits,
    playerBet: Math.max(table.minBet || 20, 20),
    opponent: null, opponentCredits: 0,
    message: '', log: [], gossipShown: new Set(),
    round: 0,
    balls: [], shooting: false,
    aimAngle: Math.PI, power: 0, powerDir: 1,
    powerCharging: false, shotInProgress: false, lastShotResult: null,
    playerGroup: null, opponentGroup: null,
    currentTurn: 'player',
    pocketedThisTurn: [], foulThisTurn: false,
    cueBallPosX: 0, cueBallPosY: 0, placingCueBall: false,
    lowestBall: 1,
    playerScore: 0, opponentScore: 0, scoreTarget: 30,
    bottles: [], blitzScore: 0, opponentBlitzScore: 0,
    blitzTargetScore: 10, blitzLastBreak: null,
    voidHustleUsed: false, voidHustleCooldown: 0,
    calledBall: null, calledPocket: null,
  };

  injectStyles();
  if (_overlay) { _overlay.remove(); stopAnimation(); }
  _overlay = document.createElement('div');
  _overlay.id = 'poolTableOverlay';
  _overlay.className = 'pt-overlay';
  document.body.appendChild(_overlay);
  renderLobby();
}

// ─── LOBBY ────────────────────────────────────────────────────────────────────

function renderLobby() {
  const t = _tableData;
  const availGames = (t.availableGames || Object.keys(PT_GAME_REGISTRY))
    .map(id => PT_GAME_REGISTRY[id]).filter(Boolean);
  const seats = buildSeats(t);

  _overlay.innerHTML = `
    <div class="pt-container pt-lobby">
      <div class="pt-header">
        <div class="pt-header-left">
          <div class="pt-title">${t.name}</div>
          <div class="pt-subtitle">${t.location || 'Void Billiards Hall'}</div>
        </div>
        <div class="pt-header-right">
          <div class="pt-credits-display">
            <span class="pt-label">YOUR CREDITS</span>
            <span class="pt-credits-val">${_pts.playerCredits}</span>
          </div>
          <button class="pt-btn pt-btn-leave" id="ptLeaveBtn">Leave</button>
        </div>
      </div>
      <div class="pt-lobby-body">
        <div class="pt-seats-section">
          <div class="pt-section-title">CHALLENGERS</div>
          <div class="pt-seat-cards">
            ${seats.map(seat => {
              const archLabel = { shark:'◆ Shark', nervous:'◇ Nervous', reckless:'⚠ Reckless', drunk:'~ Drunk' }[seat.archetype] || seat.archetype;
              return `<div class="pt-seat-card pt-arch-${seat.archetype}" data-gambler="${seat.gamblerId}">
                <div class="pt-seat-avatar">${seat.name[0].toUpperCase()}</div>
                <div class="pt-seat-info">
                  <div class="pt-seat-name">${seat.name}</div>
                  <div class="pt-seat-arch">${archLabel}</div>
                  <div class="pt-seat-credits">${seat.credits}¢ on the table</div>
                  <div class="pt-seat-bio">${seat._def?.bio || ''}</div>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
        <div class="pt-games-section">
          <div class="pt-section-title">CHOOSE YOUR GAME</div>
          <div class="pt-game-cards">
            ${availGames.map(g => `
              <div class="pt-game-card">
                <div class="pt-game-icon">${g.icon}</div>
                <div class="pt-game-name">${g.name}</div>
                <div class="pt-game-sub">${g.subtitle}</div>
                <div class="pt-game-desc">${g.description}</div>
                <div class="pt-game-stakes">Wager: <strong>${t.minBet}¢</strong> – <strong>${t.maxBet}¢</strong></div>
                <button class="pt-btn pt-btn-primary pt-play-btn" data-game="${g.id}">Rack Up — ${g.name}</button>
              </div>`).join('')}
          </div>
        </div>
      </div>
      <div class="pt-atmosphere-bar">
        <span class="pt-atm-label">${({ dim:'🔅 Low lights, chalk dust', tense:'⚡ Somebody already lost money tonight', hostile:'🔴 Everyone here is dangerous', quiet:'◈ Quiet except for the crack of a break' })[t.atmosphere] || '◈ Void Billiards'}</span>
      </div>
    </div>`;

  document.getElementById('ptLeaveBtn').onclick = () => closeTable();
  document.querySelectorAll('.pt-play-btn').forEach(btn => {
    btn.onclick = () => selectOpponent(btn.dataset.game, seats);
  });
}

function buildSeats(table) {
  return (table.seats || []).map(s => {
    const g = (_data.gamblers || []).find(x => x.id === s.gamblerId) || {
      id: s.gamblerId, name: 'Stranger', archetype: 'nervous',
      bluffFrequency: 0.1, foldThreshold: 0.4, aggressionBias: 0.2,
      creditReset: 200, tells: [], winDialogue: [], loseDialogue: [],
      bustDialogue: [], gossipDialogue: {},
    };
    const saved = _state.gamblerCredits?.[g.id];
    return {
      gamblerId: g.id, name: g.name, archetype: g.archetype,
      speciesId: g.speciesId,
      credits: saved !== undefined ? saved : (s.startingCredits || g.creditReset || 200),
      _def: g,
    };
  });
}

// ─── OPPONENT SELECT ──────────────────────────────────────────────────────────

function selectOpponent(gameId, seats) {
  _pts.game = gameId;
  const game = PT_GAME_REGISTRY[gameId];
  if (!game) return;

  _overlay.innerHTML = `
    <div class="pt-container pt-opponent-select">
      <div class="pt-header">
        <div class="pt-header-left">
          <div class="pt-title">${_tableData.name}</div>
          <div class="pt-subtitle">${game.name} — Choose your opponent</div>
        </div>
        <div class="pt-header-right">
          <div class="pt-credits-display">
            <span class="pt-label">CREDITS</span>
            <span class="pt-credits-val">${_pts.playerCredits}</span>
          </div>
          <button class="pt-btn pt-btn-leave" id="ptBackBtn">← Back</button>
        </div>
      </div>
      <div class="pt-opponent-list">
        ${seats.map(seat => `
          <div class="pt-opponent-card pt-arch-${seat.archetype}" data-gambler="${seat.gamblerId}">
            <div class="pt-opp-avatar">${seat.name[0]}</div>
            <div class="pt-opp-info">
              <div class="pt-opp-name">${seat.name}</div>
              <div class="pt-opp-arch">${({ shark:'◆ Shark — plays tight, rarely misses', nervous:'◇ Nervous — inconsistent, folds under pressure', reckless:'⚠ Reckless — big swings, big mistakes', drunk:'~ Drunk — chaotic and somehow still dangerous' })[seat.archetype] || seat.archetype}</div>
              <div class="pt-opp-credits">Bankroll: ${seat.credits}¢</div>
              <div class="pt-opp-bio">${seat._def?.bio || ''}</div>
            </div>
            <button class="pt-btn pt-btn-primary pt-challenge-btn" data-gambler="${seat.gamblerId}">Challenge</button>
          </div>`).join('')}
      </div>
    </div>`;

  document.getElementById('ptBackBtn').onclick = () => renderLobby();
  document.querySelectorAll('.pt-challenge-btn').forEach(btn => {
    btn.onclick = () => {
      const seat = seats.find(s => s.gamblerId === btn.dataset.gambler);
      if (seat) startBetPhase(seat);
    };
  });
}

// ─── BET PHASE ────────────────────────────────────────────────────────────────

function startBetPhase(seat) {
  _pts.opponent = seat;
  _pts.opponentCredits = seat.credits;
  const t = _tableData;
  const maxBet = Math.min(t.maxBet, _pts.playerCredits, seat.credits);
  const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v));

  _overlay.innerHTML = `
    <div class="pt-container pt-bet-screen">
      <div class="pt-header">
        <div class="pt-header-left">
          <div class="pt-title">${t.name}</div>
          <div class="pt-subtitle">${PT_GAME_REGISTRY[_pts.game].name} vs ${seat.name}</div>
        </div>
        <div class="pt-header-right">
          <div class="pt-credits-display">
            <span class="pt-label">CREDITS</span>
            <span class="pt-credits-val">${_pts.playerCredits}</span>
          </div>
          <button class="pt-btn pt-btn-leave" id="ptBackBtn">← Back</button>
        </div>
      </div>
      <div class="pt-bet-body">
        <div class="pt-bet-panel">
          <div class="pt-section-title">SET YOUR WAGER</div>
          <div class="pt-bet-display" id="ptBetDisplay">${_pts.playerBet}¢</div>
          <input type="range" class="pt-bet-slider" id="ptBetSlider"
            min="${t.minBet}" max="${maxBet}"
            value="${clamp(_pts.playerBet, t.minBet, maxBet)}"
            step="${Math.max(1, Math.floor(t.minBet / 2))}"/>
          <div class="pt-quick-bets">
            <button class="pt-btn pt-quick-btn" data-pct="0">Min (${t.minBet}¢)</button>
            <button class="pt-btn pt-quick-btn" data-pct="25">¼</button>
            <button class="pt-btn pt-quick-btn" data-pct="50">½</button>
            <button class="pt-btn pt-quick-btn" data-pct="100">All In (${maxBet}¢)</button>
          </div>
          <button class="pt-btn pt-btn-primary" id="ptRackUpBtn">RACK 'EM UP — <span id="ptBetLabel">${_pts.playerBet}¢</span></button>
        </div>
        <div class="pt-opponent-preview">
          <div class="pt-section-title">YOUR OPPONENT</div>
          <div class="pt-opp-big pt-arch-${seat.archetype}">
            <div class="pt-opp-big-avatar">${seat.name[0]}</div>
            <div class="pt-opp-big-name">${seat.name}</div>
            <div class="pt-opp-big-arch">${seat.archetype.toUpperCase()}</div>
            <div class="pt-opp-big-credits">${seat.credits}¢</div>
            <div class="pt-opp-big-bio">${seat._def?.bio || ''}</div>
          </div>
          ${(seat._def?.tells || []).length ? `<div class="pt-tell-hint">💭 "${seat._def.tells[0]}"</div>` : ''}
        </div>
      </div>
    </div>`;

  const slider = document.getElementById('ptBetSlider');
  const display = document.getElementById('ptBetDisplay');
  const label = document.getElementById('ptBetLabel');
  slider.addEventListener('input', () => {
    _pts.playerBet = parseInt(slider.value);
    display.textContent = _pts.playerBet + '¢';
    label.textContent = _pts.playerBet + '¢';
  });
  document.querySelectorAll('.pt-quick-btn').forEach(btn => {
    btn.onclick = () => {
      const pct = parseInt(btn.dataset.pct);
      _pts.playerBet = pct === 0 ? t.minBet : Math.min(Math.floor(maxBet * pct / 100), maxBet);
      _pts.playerBet = Math.max(t.minBet, _pts.playerBet);
      slider.value = _pts.playerBet;
      display.textContent = _pts.playerBet + '¢';
      label.textContent = _pts.playerBet + '¢';
    };
  });
  document.getElementById('ptBackBtn').onclick = () => selectOpponent(_pts.game, buildSeats(_tableData));
  document.getElementById('ptRackUpBtn').onclick = () => {
    if (_pts.playerCredits < _pts.playerBet) { ptShowMsg('Not enough credits.'); return; }
    _pts.playerCredits -= _pts.playerBet;
    _pts.opponentCredits -= _pts.playerBet;
    _pts.round++;
    _pts.phase = 'playing';
    PT_GAME_REGISTRY[_pts.game].initFn();
  };
}

// ═══════════════════════════════════════════════════════════
//  PHYSICS ENGINE
// ═══════════════════════════════════════════════════════════

function createBall(num, x, y) {
  return {
    num, x, y, vx: 0, vy: 0,
    pocketed: false,
    isStripe: num >= 9 && num <= 15,
    isCue: num === 0,
    color: num === 0 ? '#f0f0f0' : BALL_COLORS[num] || '#888',
    spinX: 0, spinY: 0,
  };
}

function physicsStep() {
  const balls = _pts.balls.filter(b => !b.pocketed);
  let anyMoving = false;

  // Move and apply friction
  for (const b of balls) {
    b.x += b.vx;
    b.y += b.vy;
    b.vx *= PT_FRICTION;
    b.vy *= PT_FRICTION;
    if (Math.abs(b.vx) < PT_MIN_SPEED) b.vx = 0;
    if (Math.abs(b.vy) < PT_MIN_SPEED) b.vy = 0;
    if (b.vx !== 0 || b.vy !== 0) anyMoving = true;

    // Cushion bounces
    if (b.x - PT_BALL_R < PT_PLAY_X1) { b.x = PT_PLAY_X1 + PT_BALL_R; b.vx = Math.abs(b.vx) * PT_CUSHION_RESTITUTION; }
    if (b.x + PT_BALL_R > PT_PLAY_X2) { b.x = PT_PLAY_X2 - PT_BALL_R; b.vx = -Math.abs(b.vx) * PT_CUSHION_RESTITUTION; }
    if (b.y - PT_BALL_R < PT_PLAY_Y1) { b.y = PT_PLAY_Y1 + PT_BALL_R; b.vy = Math.abs(b.vy) * PT_CUSHION_RESTITUTION; }
    if (b.y + PT_BALL_R > PT_PLAY_Y2) { b.y = PT_PLAY_Y2 - PT_BALL_R; b.vy = -Math.abs(b.vy) * PT_CUSHION_RESTITUTION; }
  }

  // Ball-ball collisions
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const a = balls[i], b = balls[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < PT_BALL_R * 2 && dist > 0) {
        // Check bottle collision for Blitzards
        if (_pts.game === 'blitzards') {
          checkBottleCollision(a, b);
        }
        const nx = dx / dist, ny = dy / dist;
        const overlap = PT_BALL_R * 2 - dist;
        a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
        b.x += nx * overlap / 2; b.y += ny * overlap / 2;
        const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
        const dot = dvx * nx + dvy * ny;
        if (dot > 0) {
          const impulse = dot * PT_BALL_RESTITUTION;
          a.vx -= impulse * nx; a.vy -= impulse * ny;
          b.vx += impulse * nx; b.vy += impulse * ny;
        }
      }
    }
  }

  // Pocket detection
  for (const b of balls) {
    for (const p of POCKET_POSITIONS) {
      const dx = b.x - p.x, dy = b.y - p.y;
      if (Math.sqrt(dx * dx + dy * dy) < PT_POCKET_R) {
        b.pocketed = true; b.vx = 0; b.vy = 0;
        onBallPocketed(b, p);
        break;
      }
    }
  }

  return anyMoving;
}

function checkBottleCollision(a, b) {
  // Check if either ball just collided near a bottle
  for (const bottle of _pts.bottles) {
    if (bottle.shattered) continue;
    const dx = a.x - bottle.x, dy = a.y - bottle.y;
    const distA = Math.sqrt(dx * dx + dy * dy);
    const dx2 = b.x - bottle.x, dy2 = b.y - bottle.y;
    const distB = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    if (distA < PT_BALL_R + 10 || distB < PT_BALL_R + 10) {
      // Ball is very close to bottle — check velocity
      const speed = Math.sqrt(a.vx * a.vx + a.vy * a.vy) + Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (speed > 2.5 && !bottle._collidedThisShot) {
        bottle._collidedThisShot = true;
        triggerBottleShatter(bottle, a.num === 0 ? b.num : a.num);
      }
    }
  }
}

function triggerBottleShatter(bottle, culpritBall) {
  bottle.shattered = true;
  bottle.shatterTime = Date.now();
  bottle.fragments = Array.from({ length: 8 }, (_, i) => ({
    angle: (i / 8) * Math.PI * 2 + Math.random() * 0.4,
    speed: 2 + Math.random() * 4,
    x: bottle.x, y: bottle.y,
    life: 1.0,
  }));
  const isPlayer = (_pts.currentTurn === 'player');
  const penalty = isPlayer ? -2 : 0;
  if (isPlayer) {
    _pts.blitzScore = Math.max(0, _pts.blitzScore + penalty);
    _pts.foulThisTurn = true;
    ptAddLog(`💥 BOTTLE SHATTERED! ${culpritBall > 0 ? `Ball ${culpritBall} hit it.` : 'Cue ball hit it.'} –2 pts, turn over.`);
  } else {
    ptAddLog(`💥 Opponent shattered a bottle! Lucky for you.`);
  }
  _pts.blitzLastBreak = { x: bottle.x, y: bottle.y, time: Date.now() };
}

function onBallPocketed(ball, pocket) {
  if (_pts.game === 'blitzards' && !ball.isCue) {
    // Pocketing a bottle in blitzards = forfeit
    const bottleHit = _pts.bottles.find(bt => !bt.shattered && Math.abs(bt.x - ball.x) < 15 && Math.abs(bt.y - ball.y) < 15);
    if (bottleHit) {
      bottleHit.shattered = true;
      _pts.foulThisTurn = true;
      ptAddLog(`💥 VOID BOTTLE POCKETED — FORFEIT! Turn over.`);
      return;
    }
  }
  _pts.pocketedThisTurn.push({ ball, pocket });
  if (ball.isCue) {
    _pts.foulThisTurn = true;
    ptAddLog('SCRATCH — cue ball pocketed.');
    _pts.placingCueBall = true;
  }
}

// ─── RENDER LOOP ──────────────────────────────────────────────────────────────

function startRenderLoop() {
  stopAnimation();

  function frame() {
    if (!_canvas || !_ctx) return;
    const stillMoving = _pts.shotInProgress ? physicsStep() : false;
    drawTable();

    if (_pts.shotInProgress && !stillMoving) {
      _pts.shotInProgress = false;
      onShotSettled();
    }

    _animId = requestAnimationFrame(frame);
  }
  _animId = requestAnimationFrame(frame);
}

function stopAnimation() {
  if (_animId) { cancelAnimationFrame(_animId); _animId = null; }
}

function drawTable() {
  if (!_ctx) return;
  const ctx = _ctx;
  const W = PT_TABLE_W, H = PT_TABLE_H;

  // Table felt
  ctx.fillStyle = '#1a4a2e';
  ctx.fillRect(0, 0, W, H);

  // Felt texture lines
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let i = 0; i < W; i += 20) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, H); ctx.stroke();
  }
  for (let j = 0; j < H; j += 20) {
    ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(W, j); ctx.stroke();
  }

  // Cushion
  ctx.fillStyle = '#0f3a20';
  ctx.fillRect(0, 0, W, PT_CUSHION);
  ctx.fillRect(0, H - PT_CUSHION, W, PT_CUSHION);
  ctx.fillRect(0, 0, PT_CUSHION, H);
  ctx.fillRect(W - PT_CUSHION, 0, PT_CUSHION, H);

  // Rail highlight
  ctx.strokeStyle = '#2a6040';
  ctx.lineWidth = 3;
  ctx.strokeRect(PT_PLAY_X1, PT_PLAY_Y1, PT_PLAY_X2 - PT_PLAY_X1, PT_PLAY_Y2 - PT_PLAY_Y1);

  // Head string
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  const headX = PT_PLAY_X1 + (PT_PLAY_X2 - PT_PLAY_X1) * 0.25;
  ctx.beginPath(); ctx.moveTo(headX, PT_PLAY_Y1); ctx.lineTo(headX, PT_PLAY_Y2); ctx.stroke();
  ctx.setLineDash([]);

  // Center dot
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.arc((PT_PLAY_X1 + PT_PLAY_X2) / 2, PT_MID_Y, 4, 0, Math.PI * 2);
  ctx.fill();

  // Pockets
  for (const p of POCKET_POSITIONS) {
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(p.x, p.y, PT_POCKET_R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, PT_POCKET_R, 0, Math.PI * 2); ctx.stroke();
  }

  // Blitzards bottles
  if (_pts.game === 'blitzards') {
    drawBottles(ctx);
  }

  // Aim line (when not shooting)
  const cue = _pts.balls.find(b => b.isCue && !b.pocketed);
  if (cue && !_pts.shotInProgress && !_pts.placingCueBall && _pts.currentTurn === 'player') {
    drawAimLine(ctx, cue);
  }

  // Balls
  for (const ball of _pts.balls) {
    if (!ball.pocketed) drawBall(ctx, ball);
  }

  // Power meter
  if (_pts.powerCharging && _pts.currentTurn === 'player') {
    drawPowerMeter(ctx);
  }

  // Place cue ball indicator
  if (_pts.placingCueBall && _pts.currentTurn === 'player') {
    ctx.strokeStyle = '#79d4ff';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(_pts.cueBallPosX || headX, _pts.cueBallPosY || PT_MID_Y, PT_BALL_R + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawBall(ctx, ball) {
  const { x, y, color, num, isStripe } = ball;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(x + 2, y + 3, PT_BALL_R, PT_BALL_R * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();

  if (isStripe) {
    // White ball with stripe band
    ctx.fillStyle = '#f0f0f0';
    ctx.beginPath(); ctx.arc(x, y, PT_BALL_R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, PT_BALL_R, Math.PI * 0.25, Math.PI * 0.75); ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, PT_BALL_R, Math.PI * 1.25, Math.PI * 1.75); ctx.fill();
  } else {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, PT_BALL_R, 0, Math.PI * 2); ctx.fill();
  }

  // Gloss highlight
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(x - PT_BALL_R * 0.3, y - PT_BALL_R * 0.3, PT_BALL_R * 0.35, PT_BALL_R * 0.25, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // Number on ball
  if (num > 0) {
    const fontSize = PT_BALL_R * 0.85;
    ctx.font = `bold ${fontSize}px "Space Mono", monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = isStripe ? '#1a1a1a' : 'rgba(255,255,255,0.9)';
    if (!isStripe && (color === '#f5d800' || color === '#d6521a')) ctx.fillStyle = '#1a1a1a';
    ctx.fillText(num <= 9 ? String(num) : String(num), x, y + 0.5);
  }
}

function drawAimLine(ctx, cue) {
  const angle = _pts.aimAngle;
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const hustleActive = !_pts.voidHustleUsed;
  const lineLen = hustleActive && _pts.activeHustle === 'deadeye' ? 600 : 200;

  // Main aim line
  ctx.strokeStyle = 'rgba(255, 220, 80, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.moveTo(cue.x, cue.y);

  // Find first collision along aim line
  let endX = cue.x + dx * lineLen, endY = cue.y + dy * lineLen;
  let hitBall = null, hitDist = lineLen;
  for (const b of _pts.balls) {
    if (b.pocketed || b.isCue) continue;
    // Ray-circle intersection
    const ex = b.x - cue.x, ey = b.y - cue.y;
    const proj = ex * dx + ey * dy;
    if (proj < 0) continue;
    const perp2 = ex * ex + ey * ey - proj * proj;
    const r2 = (PT_BALL_R * 2) * (PT_BALL_R * 2);
    if (perp2 < r2) {
      const d = proj - Math.sqrt(r2 - perp2);
      if (d > 0 && d < hitDist) { hitDist = d; hitBall = b; endX = cue.x + dx * d; endY = cue.y + dy * d; }
    }
  }

  // Cushion clipping
  if (!hitBall) {
    const checks = [
      { cond: dx < 0, t: (PT_PLAY_X1 + PT_BALL_R - cue.x) / dx },
      { cond: dx > 0, t: (PT_PLAY_X2 - PT_BALL_R - cue.x) / dx },
      { cond: dy < 0, t: (PT_PLAY_Y1 + PT_BALL_R - cue.y) / dy },
      { cond: dy > 0, t: (PT_PLAY_Y2 - PT_BALL_R - cue.y) / dy },
    ];
    for (const c of checks) {
      if (c.cond && c.t > 0 && c.t < hitDist) {
        hitDist = c.t;
        endX = cue.x + dx * c.t;
        endY = cue.y + dy * c.t;
      }
    }
  }

  ctx.lineTo(endX, endY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Ghost ball at collision point
  if (hitBall) {
    ctx.strokeStyle = 'rgba(255,220,80,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(endX, endY, PT_BALL_R, 0, Math.PI * 2);
    ctx.stroke();

    // Arc Calc: show deflection line for salvager
    if (_pts.activeHustle === 'arc_calc') {
      const nx = (hitBall.x - endX) / (PT_BALL_R * 2);
      const ny = (hitBall.y - endY) / (PT_BALL_R * 2);
      const defDx = nx, defDy = ny;
      ctx.strokeStyle = 'rgba(120, 255, 120, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(hitBall.x, hitBall.y);
      ctx.lineTo(hitBall.x + defDx * 100, hitBall.y + defDy * 100);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function drawPowerMeter(ctx) {
  const W = PT_TABLE_W;
  const meterX = W - 30, meterY1 = PT_PLAY_Y1 + 20, meterH = PT_PLAY_Y2 - PT_PLAY_Y1 - 40;
  const fillH = meterH * (_pts.power / PT_MAX_POWER);

  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(meterX - 6, meterY1 - 2, 20, meterH + 4);

  const gradient = ctx.createLinearGradient(meterX, meterY1 + meterH, meterX, meterY1);
  gradient.addColorStop(0, '#56d364');
  gradient.addColorStop(0.6, '#ffcc5a');
  gradient.addColorStop(1, '#f85149');
  ctx.fillStyle = gradient;
  ctx.fillRect(meterX, meterY1 + meterH - fillH, 8, fillH);

  ctx.strokeStyle = '#79d4ff';
  ctx.lineWidth = 1;
  ctx.strokeRect(meterX - 1, meterY1 - 1, 10, meterH + 2);

  ctx.fillStyle = '#79d4ff';
  ctx.font = '9px "Space Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('PWR', meterX + 4, meterY1 - 8);
}

function drawBottles(ctx) {
  const now = Date.now();
  for (const bottle of _pts.bottles) {
    if (bottle.shattered) {
      // Shatter animation
      if (bottle.fragments && now - bottle.shatterTime < 800) {
        const progress = (now - bottle.shatterTime) / 800;
        for (const frag of bottle.fragments) {
          const fx = bottle.x + Math.cos(frag.angle) * frag.speed * progress * 30;
          const fy = bottle.y + Math.sin(frag.angle) * frag.speed * progress * 30;
          ctx.globalAlpha = 1 - progress;
          ctx.fillStyle = bottle.color;
          ctx.beginPath();
          ctx.moveTo(fx, fy);
          ctx.lineTo(fx + 6 * (1 - progress), fy + 3 * (1 - progress));
          ctx.lineTo(fx + 3 * (1 - progress), fy + 8 * (1 - progress));
          ctx.closePath();
          ctx.fill();

          // Flash
          ctx.fillStyle = `rgba(255,255,200,${(1 - progress) * 0.8})`;
          ctx.beginPath();
          ctx.arc(bottle.x, bottle.y, 20 * progress, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      continue;
    }

    // Bottle body
    const pulse = 0.6 + 0.4 * Math.sin(now * 0.003 + bottle.phase);
    ctx.save();
    ctx.translate(bottle.x, bottle.y);

    // Glow
    const grd = ctx.createRadialGradient(0, 0, 2, 0, 0, 14);
    grd.addColorStop(0, bottle.color + 'cc');
    grd.addColorStop(1, 'transparent');
    ctx.fillStyle = grd;
    ctx.globalAlpha = pulse;
    ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    // Bottle shape
    ctx.fillStyle = bottle.color + 'aa';
    ctx.strokeStyle = bottle.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-4, -10, 8, 16, 3);
    ctx.fill(); ctx.stroke();

    // Neck
    ctx.beginPath();
    ctx.roundRect(-2, -14, 4, 6, 1);
    ctx.fill(); ctx.stroke();

    // Cap glint
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath(); ctx.arc(-1, -12, 1, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  }
}

// ─── SHOT INPUT (mouse/touch) ──────────────────────────────────────────────────

function attachShotControls() {
  if (!_canvas) return;

  _canvas.onmousemove = (e) => {
    if (_pts.shotInProgress || _pts.currentTurn !== 'player') return;
    const rect = _canvas.getBoundingClientRect();
    const scaleX = PT_TABLE_W / rect.width, scaleY = PT_TABLE_H / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    if (_pts.placingCueBall) {
      _pts.cueBallPosX = Math.max(PT_PLAY_X1 + PT_BALL_R, Math.min(mx, PT_PLAY_X2 - PT_BALL_R));
      _pts.cueBallPosY = Math.max(PT_PLAY_Y1 + PT_BALL_R, Math.min(my, PT_PLAY_Y2 - PT_BALL_R));
      return;
    }

    const cue = _pts.balls.find(b => b.isCue && !b.pocketed);
    if (!cue) return;
    _pts.aimAngle = Math.atan2(my - cue.y, mx - cue.x);
  };

  _canvas.onmousedown = (e) => {
    if (_pts.shotInProgress || _pts.currentTurn !== 'player') return;
    const rect = _canvas.getBoundingClientRect();
    const scaleX = PT_TABLE_W / rect.width, scaleY = PT_TABLE_H / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    if (_pts.placingCueBall) {
      placeCueBall(mx, my);
      return;
    }
    _pts.powerCharging = true;
    _pts.power = 0;
    _pts.powerDir = 1;
    startPowerCharge();
  };

  _canvas.onmouseup = () => {
    if (_pts.powerCharging) {
      _pts.powerCharging = false;
      shoot();
    }
  };

  // Touch support
  _canvas.ontouchstart = (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = _canvas.getBoundingClientRect();
    const scaleX = PT_TABLE_W / rect.width, scaleY = PT_TABLE_H / rect.height;
    const mx = (touch.clientX - rect.left) * scaleX;
    const my = (touch.clientY - rect.top) * scaleY;
    if (_pts.placingCueBall) { placeCueBall(mx, my); return; }
    _pts.powerCharging = true; _pts.power = 0; _pts.powerDir = 1;
    startPowerCharge();
  };
  _canvas.ontouchmove = (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = _canvas.getBoundingClientRect();
    const scaleX = PT_TABLE_W / rect.width, scaleY = PT_TABLE_H / rect.height;
    const mx = (touch.clientX - rect.left) * scaleX;
    const my = (touch.clientY - rect.top) * scaleY;
    if (_pts.placingCueBall) {
      _pts.cueBallPosX = Math.max(PT_PLAY_X1 + PT_BALL_R, Math.min(mx, PT_PLAY_X2 - PT_BALL_R));
      _pts.cueBallPosY = Math.max(PT_PLAY_Y1 + PT_BALL_R, Math.min(my, PT_PLAY_Y2 - PT_BALL_R));
      return;
    }
    const cue = _pts.balls.find(b => b.isCue && !b.pocketed);
    if (cue) _pts.aimAngle = Math.atan2(my - cue.y, mx - cue.x);
  };
  _canvas.ontouchend = (e) => {
    e.preventDefault();
    if (_pts.powerCharging) { _pts.powerCharging = false; shoot(); }
  };
}

let _powerInterval = null;
function startPowerCharge() {
  clearInterval(_powerInterval);
  _powerInterval = setInterval(() => {
    if (!_pts.powerCharging) { clearInterval(_powerInterval); return; }
    _pts.power += _pts.powerDir * 0.5;
    if (_pts.power >= PT_MAX_POWER) { _pts.power = PT_MAX_POWER; _pts.powerDir = -1; }
    if (_pts.power <= 0) { _pts.power = 0; _pts.powerDir = 1; }
  }, 16);
}

function shoot() {
  clearInterval(_powerInterval);
  const cue = _pts.balls.find(b => b.isCue && !b.pocketed);
  if (!cue || _pts.shotInProgress) return;

  let power = _pts.power;
  if (_pts.activeHustle === 'lucky_roll') power = Math.min(PT_MAX_POWER, power * 1.3);
  if (_pts.activeHustle === 'power_break' && _pts.round <= 1) power = Math.min(PT_MAX_POWER, power * 1.5);

  cue.vx = Math.cos(_pts.aimAngle) * power;
  cue.vy = Math.sin(_pts.aimAngle) * power;
  _pts.power = 0;
  _pts.shotInProgress = true;
  _pts.pocketedThisTurn = [];
  _pts.foulThisTurn = false;
  // Reset bottle collision flags
  if (_pts.bottles) _pts.bottles.forEach(b => b._collidedThisShot = false);
  _pts.activeHustle = null;
  ptAddLog('You shoot.');
}

function placeCueBall(mx, my) {
  const cue = _pts.balls.find(b => b.isCue);
  if (!cue) return;
  const x = Math.max(PT_PLAY_X1 + PT_BALL_R + 5, Math.min(mx, PT_PLAY_X2 - PT_BALL_R - 5));
  const y = Math.max(PT_PLAY_Y1 + PT_BALL_R + 5, Math.min(my, PT_PLAY_Y2 - PT_BALL_R - 5));
  // Check no overlap with other balls
  for (const b of _pts.balls) {
    if (b.pocketed || b.isCue) continue;
    const dx = b.x - x, dy = b.y - y;
    if (Math.sqrt(dx * dx + dy * dy) < PT_BALL_R * 2.2) { ptShowMsg('Too close to another ball.'); return; }
  }
  cue.pocketed = false; cue.x = x; cue.y = y; cue.vx = 0; cue.vy = 0;
  _pts.placingCueBall = false;
  ptAddLog('Cue ball placed.');
  updateGameUI();
}

// ─── POST-SHOT RESOLUTION ──────────────────────────────────────────────────────

function onShotSettled() {
  const game = _pts.game;
  if (game === 'eight_ball') resolveEightBall();
  else if (game === 'nine_ball') resolveNineBall();
  else if (game === 'straight_pool') resolveStraightPool();
  else if (game === 'blitzards') resolveBlitzards();
}

function resolveEightBall() {
  const pts = _pts;
  const pocketed = pts.pocketedThisTurn.filter(p => !p.ball.isCue);

  // Assign groups on first pocket
  if (!pts.playerGroup && pocketed.length > 0 && pts.currentTurn === 'player') {
    const firstBall = pocketed[0].ball;
    pts.playerGroup = firstBall.isStripe ? 'stripe' : 'solid';
    pts.opponentGroup = firstBall.isStripe ? 'solid' : 'stripe';
    ptAddLog(`Groups assigned: You = ${pts.playerGroup}s, ${pts.opponent.name} = ${pts.opponentGroup}s.`);
  }

  // Check 8-ball pocketed
  const eight = pocketed.find(p => p.ball.num === 8);
  if (eight) {
    const myBalls = pts.balls.filter(b => !b.pocketed && !b.isCue && (pts.playerGroup === 'solid' ? b.num < 8 : b.num > 8 && b.num <= 15));
    if (pts.currentTurn === 'player') {
      if (pts.foulThisTurn || myBalls.length > 0) {
        endGame(false, `You pocketed the 8-ball too early — you lose!`);
      } else {
        endGame(true, `You sank the 8-ball! Victory!`);
      }
    } else {
      const theirBalls = pts.balls.filter(b => !b.pocketed && !b.isCue && (pts.opponentGroup === 'solid' ? b.num < 8 : b.num > 8 && b.num <= 15));
      if (pts.foulThisTurn || theirBalls.length > 0) {
        endGame(true, `${pts.opponent.name} pocketed the 8-ball too early — you win!`);
      } else {
        endGame(false, `${pts.opponent.name} sank the 8-ball!`);
      }
    }
    return;
  }

  const goodPockets = pocketed.filter(p => {
    if (pts.currentTurn === 'player') return pts.playerGroup ? (pts.playerGroup === 'solid' ? !p.ball.isStripe && p.ball.num !== 8 : p.ball.isStripe) : true;
    return true;
  });

  if (!pts.foulThisTurn && goodPockets.length > 0 && pts.currentTurn === 'player') {
    ptAddLog(`Good pocket! Continue your turn.`);
    updateGameUI(); return;
  }

  switchTurn();
}

function resolveNineBall() {
  const pts = _pts;
  const pocketed = pts.pocketedThisTurn.filter(p => !p.ball.isCue);

  // Win condition
  if (pocketed.find(p => p.ball.num === 9)) {
    if (pts.foulThisTurn) {
      if (pts.currentTurn === 'player') {
        ptAddLog('Foul on the 9 — ball returns to table.');
        const nine = pts.balls.find(b => b.num === 9);
        if (nine) { nine.pocketed = false; nine.x = (PT_PLAY_X1 + PT_PLAY_X2) / 2; nine.y = PT_MID_Y; }
      }
    } else {
      endGame(pts.currentTurn === 'player', pts.currentTurn === 'player' ? 'You sank the 9-ball! Rack it!' : `${pts.opponent.name} sank the 9!`);
      return;
    }
  }

  if (!pts.foulThisTurn && pocketed.length > 0 && pts.currentTurn === 'player') {
    pts.lowestBall = Math.min(...pts.balls.filter(b => !b.pocketed && !b.isCue && b.num > 0).map(b => b.num));
    ptAddLog(`Continue your turn!`);
    updateGameUI(); return;
  }

  pts.lowestBall = Math.min(...pts.balls.filter(b => !b.pocketed && !b.isCue && b.num > 0).map(b => b.num));
  if (pts.foulThisTurn) ptAddLog(`${pts.currentTurn === 'player' ? 'Foul' : `${pts.opponent.name} fouls`} — ball in hand!`);
  switchTurn();
}

function resolveStraightPool() {
  const pts = _pts;
  const pocketed = pts.pocketedThisTurn.filter(p => !p.ball.isCue);

  if (pts.foulThisTurn) {
    if (pts.currentTurn === 'player') { pts.playerScore = Math.max(0, pts.playerScore - 1); ptAddLog(`Scratch! –1 pt. Your score: ${pts.playerScore}`); }
    else { pts.opponentScore = Math.max(0, pts.opponentScore - 1); }
    switchTurn(); return;
  }

  if (pts.currentTurn === 'player') {
    const goodPockets = pocketed.filter(p => pts.calledBall ? p.ball.num === pts.calledBall : true);
    pts.playerScore += goodPockets.length;
    if (goodPockets.length) ptAddLog(`+${goodPockets.length} pts! Your score: ${pts.playerScore}/${pts.scoreTarget}`);
    if (pts.playerScore >= pts.scoreTarget) { endGame(true, `You reached ${pts.scoreTarget} points! Straight pool champion!`); return; }
    if (goodPockets.length > 0) { pts.calledBall = null; updateGameUI(); return; }
  } else {
    const oppPocketed = pocketed.length;
    pts.opponentScore += oppPocketed;
    if (pts.opponentScore >= pts.scoreTarget) { endGame(false, `${pts.opponent.name} reached ${pts.scoreTarget} points.`); return; }
  }

  pts.calledBall = null;
  switchTurn();
}

function resolveBlitzards() {
  const pts = _pts;
  const pocketed = pts.pocketedThisTurn.filter(p => !p.ball.isCue);

  if (pts.foulThisTurn) {
    if (pts.currentTurn === 'player') ptAddLog(`Turn forfeit due to bottle or foul!`);
    switchTurn(); return;
  }

  if (pts.currentTurn === 'player' && pocketed.length > 0) {
    pts.blitzScore += pocketed.length;
    ptAddLog(`+${pocketed.length} pts! Your score: ${pts.blitzScore}/${pts.blitzTargetScore}`);
    if (pts.blitzScore >= pts.blitzTargetScore) {
      endGame(true, `${pts.blitzScore} points! Blitzards winner!`); return;
    }
    updateGameUI(); return;
  } else if (pts.currentTurn === 'opponent' && pocketed.length > 0) {
    pts.opponentBlitzScore += pocketed.length;
    if (pts.opponentBlitzScore >= pts.blitzTargetScore) {
      endGame(false, `${pts.opponent.name} scored ${pts.opponentBlitzScore} points!`); return;
    }
  }

  // Respawn bottles if all shattered
  const alive = pts.bottles.filter(b => !b.shattered).length;
  if (alive === 0) spawnBlitzardsBottles();

  switchTurn();
}

function switchTurn() {
  _pts.pocketedThisTurn = [];
  _pts.foulThisTurn = false;
  _pts.calledBall = null;

  if (_pts.currentTurn === 'player') {
    _pts.currentTurn = 'opponent';
    ptAddLog(`${_pts.opponent.name}'s turn...`);
    updateGameUI();
    setTimeout(() => runOpponentTurn(), 1200);
  } else {
    _pts.currentTurn = 'player';
    ptAddLog(`Your turn.`);
    updateGameUI();
  }
}

// ─── AI OPPONENT ──────────────────────────────────────────────────────────────

function runOpponentTurn() {
  const pts = _pts;
  const cue = pts.balls.find(b => b.isCue && !b.pocketed);
  if (!cue) {
    // Place cue ball for AI
    cue && (cue.pocketed = false);
    const oppCue = pts.balls.find(b => b.isCue);
    if (oppCue) {
      oppCue.pocketed = false;
      oppCue.x = PT_PLAY_X1 + 80;
      oppCue.y = PT_MID_Y + (Math.random() - 0.5) * 100;
    }
  }

  const arch = pts.opponent.archetype;
  const targetBall = findOpponentTarget();

  if (!targetBall) { switchTurn(); return; }

  // Calculate aim toward target ball
  const aimX = targetBall.x, aimY = targetBall.y;
  const cueBall = pts.balls.find(b => b.isCue && !b.pocketed);
  if (!cueBall) { switchTurn(); return; }

  let angle = Math.atan2(aimY - cueBall.y, aimX - cueBall.x);
  // Add some inaccuracy based on archetype
  const accuracy = { shark: 0.05, nervous: 0.22, reckless: 0.28, drunk: 0.42 }[arch] || 0.15;
  angle += (Math.random() - 0.5) * accuracy;

  const powerBase = { shark: 0.65, nervous: 0.45, reckless: 0.85, drunk: 0.6 }[arch] || 0.55;
  const power = PT_MAX_POWER * (powerBase + (Math.random() - 0.5) * 0.2);

  cueBall.vx = Math.cos(angle) * power;
  cueBall.vy = Math.sin(angle) * power;
  pts.shotInProgress = true;
  pts.pocketedThisTurn = [];
  pts.foulThisTurn = false;
  if (pts.bottles) pts.bottles.forEach(b => b._collidedThisShot = false);
}

function findOpponentTarget() {
  const pts = _pts;
  const activeBalls = pts.balls.filter(b => !b.pocketed && !b.isCue);
  if (!activeBalls.length) return null;

  if (pts.game === 'eight_ball' && pts.opponentGroup) {
    const myBalls = activeBalls.filter(b => pts.opponentGroup === 'solid' ? !b.isStripe && b.num !== 8 : b.isStripe);
    return myBalls.length > 0 ? myBalls[Math.floor(Math.random() * myBalls.length)] : activeBalls.find(b => b.num === 8) || activeBalls[0];
  }
  if (pts.game === 'nine_ball') {
    return activeBalls.sort((a, b) => a.num - b.num)[0];
  }
  if (pts.game === 'blitzards') {
    // Avoid bottles
    const safe = activeBalls.filter(b => {
      const nearBottle = pts.bottles.some(bt => !bt.shattered && Math.abs(bt.x - b.x) < 40 && Math.abs(bt.y - b.y) < 40);
      return !nearBottle;
    });
    return safe.length > 0 ? safe[Math.floor(Math.random() * safe.length)] : activeBalls[0];
  }
  return activeBalls[Math.floor(Math.random() * activeBalls.length)];
}

// ═══════════════════════════════════════════════════════════
//  GAME INITS
// ═══════════════════════════════════════════════════════════

function initEightBall() {
  _pts.playerGroup = null; _pts.opponentGroup = null;
  _pts.currentTurn = 'player'; _pts.calledBall = null;
  _pts.balls = rackBalls(15, true);
  placeCueBallAtDefault();
  mountGameCanvas();
}

function initNineBall() {
  _pts.lowestBall = 1; _pts.currentTurn = 'player';
  _pts.balls = rackNineBall();
  placeCueBallAtDefault();
  mountGameCanvas();
}

function initStraightPool() {
  _pts.playerScore = 0; _pts.opponentScore = 0;
  _pts.scoreTarget = 30; _pts.currentTurn = 'player'; _pts.calledBall = null;
  _pts.balls = rackBalls(15, true);
  placeCueBallAtDefault();
  mountGameCanvas();
}

function initBlitzards() {
  _pts.blitzScore = 0; _pts.opponentBlitzScore = 0;
  _pts.blitzTargetScore = 10; _pts.currentTurn = 'player';
  _pts.balls = rackBalls(10, false);
  placeCueBallAtDefault();
  spawnBlitzardsBottles();
  mountGameCanvas();
}

function rackBalls(count, includeEight) {
  const balls = [createBall(0, PT_PLAY_X1 + (PT_PLAY_X2 - PT_PLAY_X1) * 0.25, PT_MID_Y)];
  // Triangle rack
  const rackX = PT_PLAY_X1 + (PT_PLAY_X2 - PT_PLAY_X1) * 0.72;
  const rackY = PT_MID_Y;
  const positions = triangleRack(rackX, rackY, Math.min(count, 15));
  const nums = shuffleArr(Array.from({ length: count }, (_, i) => i + 1));
  if (includeEight && nums.includes(8)) {
    // 8 ball in center of rack
    const centerIdx = Math.floor(positions.length / 2);
    const eightIdx = nums.indexOf(8);
    [nums[centerIdx], nums[eightIdx]] = [nums[eightIdx], nums[centerIdx]];
  }
  positions.forEach((p, i) => balls.push(createBall(nums[i] || i + 1, p.x, p.y)));
  return balls;
}

function rackNineBall() {
  const balls = [createBall(0, PT_PLAY_X1 + (PT_PLAY_X2 - PT_PLAY_X1) * 0.25, PT_MID_Y)];
  const rackX = PT_PLAY_X1 + (PT_PLAY_X2 - PT_PLAY_X1) * 0.72;
  const positions = diamondRack(rackX, PT_MID_Y);
  const nums = shuffleArr([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  // 1 at front, 9 in center
  nums.splice(nums.indexOf(1), 1); nums.unshift(1);
  const nineIdx = Math.floor(positions.length / 2);
  const nineNum = nums.indexOf(9); [nums[nineIdx], nums[nineNum]] = [nums[nineNum], nums[nineIdx]];
  positions.forEach((p, i) => balls.push(createBall(nums[i] || i + 1, p.x, p.y)));
  return balls;
}

function triangleRack(cx, cy, count) {
  const sp = PT_BALL_R * 2.1;
  const rows = Math.ceil((-1 + Math.sqrt(1 + 8 * count)) / 2);
  const positions = [];
  let n = 0;
  for (let row = 0; row < rows && n < count; row++) {
    for (let col = 0; col <= row && n < count; col++) {
      positions.push({
        x: cx + row * sp * Math.cos(Math.PI / 6),
        y: cy + (col - row / 2) * sp,
      });
      n++;
    }
  }
  return positions;
}

function diamondRack(cx, cy) {
  const sp = PT_BALL_R * 2.15;
  return [
    { x: cx, y: cy },
    { x: cx + sp * 0.87, y: cy - sp * 0.5 }, { x: cx + sp * 0.87, y: cy + sp * 0.5 },
    { x: cx + sp * 1.74, y: cy - sp }, { x: cx + sp * 1.74, y: cy }, { x: cx + sp * 1.74, y: cy + sp },
    { x: cx + sp * 2.61, y: cy - sp * 0.5 }, { x: cx + sp * 2.61, y: cy + sp * 0.5 },
    { x: cx + sp * 3.48, y: cy },
  ];
}

function placeCueBallAtDefault() {
  const cue = _pts.balls.find(b => b.isCue);
  if (cue) { cue.x = PT_PLAY_X1 + (PT_PLAY_X2 - PT_PLAY_X1) * 0.25; cue.y = PT_MID_Y; }
}

function spawnBlitzardsBottles() {
  const count = 4 + Math.floor(Math.random() * 3); // 4-6 bottles
  _pts.bottles = [];
  const margin = 60;
  for (let i = 0; i < count; i++) {
    let x, y, valid;
    let attempts = 0;
    do {
      valid = true;
      x = PT_PLAY_X1 + margin + Math.random() * (PT_PLAY_X2 - PT_PLAY_X1 - margin * 2);
      y = PT_PLAY_Y1 + margin + Math.random() * (PT_PLAY_Y2 - PT_PLAY_Y1 - margin * 2);
      // Not too close to balls
      for (const b of _pts.balls) {
        if (b.pocketed) continue;
        const dx = b.x - x, dy = b.y - y;
        if (Math.sqrt(dx * dx + dy * dy) < 40) { valid = false; break; }
      }
      // Not too close to other bottles
      for (const bt of _pts.bottles) {
        const dx = bt.x - x, dy = bt.y - y;
        if (Math.sqrt(dx * dx + dy * dy) < 55) { valid = false; break; }
      }
      attempts++;
    } while (!valid && attempts < 50);

    _pts.bottles.push({
      x, y, shattered: false,
      color: BOTTLE_COLORS[i % BOTTLE_COLORS.length],
      phase: Math.random() * Math.PI * 2,
      fragments: [], shatterTime: 0,
    });
  }
}

function shuffleArr(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── CANVAS MOUNT ─────────────────────────────────────────────────────────────

function mountGameCanvas() {
  const game = PT_GAME_REGISTRY[_pts.game];
  const hero = _state.roster.find(a => a.id === _state.selectedActorId || a.role === 'player');
  const hustle = VOID_HUSTLES[hero?.classId] || VOID_HUSTLES._default;

  _overlay.innerHTML = `
    <div class="pt-container pt-game-screen">
      <div class="pt-header pt-game-header">
        <div class="pt-header-left">
          <div class="pt-title">${_tableData.name}</div>
          <div class="pt-subtitle">${game.name} vs <strong>${_pts.opponent.name}</strong> · Wager: ${_pts.playerBet}¢</div>
        </div>
        <div class="pt-header-right">
          <div class="pt-credits-display">
            <span class="pt-label">CREDITS</span>
            <span class="pt-credits-val" id="ptCreditsVal">${_pts.playerCredits}</span>
          </div>
        </div>
      </div>
      <div class="pt-game-body">
        <div class="pt-canvas-wrap">
          <canvas id="ptCanvas" width="${PT_TABLE_W}" height="${PT_TABLE_H}"></canvas>
          <div class="pt-canvas-hint" id="ptCanvasHint">Move mouse to aim · Hold click to charge power · Release to shoot</div>
        </div>
        <div class="pt-game-sidebar" id="ptGameSidebar">
          ${game.renderGameUI()}
        </div>
      </div>
      <div class="pt-action-bar">
        <div class="pt-action-left">
          <div class="pt-turn-indicator ${_pts.currentTurn === 'player' ? 'pt-your-turn' : 'pt-opp-turn'}" id="ptTurnIndicator">
            ${_pts.currentTurn === 'player' ? '▶ YOUR TURN' : `▶ ${_pts.opponent.name.toUpperCase()}'S TURN`}
          </div>
        </div>
        <div class="pt-action-btns" id="ptActionBtns">
          ${_pts.currentTurn === 'player' && !_pts.voidHustleUsed ?
            `<button class="pt-btn pt-btn-hustle" id="ptHustleBtn" title="${hustle.desc}">${hustle.label} ◈</button>` : ''}
          ${_pts.currentTurn === 'player' && _pts.game === 'straight_pool' && !_pts.calledBall ?
            `<div class="pt-call-shot" id="ptCallArea">
              Call ball: <select id="ptCallSelect">
                <option value="">—</option>
                ${_pts.balls.filter(b => !b.pocketed && !b.isCue).map(b => `<option value="${b.num}">Ball ${b.num}</option>`).join('')}
              </select>
            </div>` : ''}
        </div>
        <div class="pt-action-right">
          <button class="pt-btn pt-btn-leave" id="ptLeaveGameBtn">Leave</button>
        </div>
      </div>
      <div class="pt-message-bar" id="ptMessageBar">${_pts.message || '&nbsp;'}</div>
      <div class="pt-log" id="ptLog">${_pts.log.slice(-5).map(l => `<div>${l}</div>`).join('')}</div>
    </div>`;

  _canvas = document.getElementById('ptCanvas');
  _ctx = _canvas.getContext('2d');
  attachShotControls();
  startRenderLoop();

  document.getElementById('ptLeaveGameBtn').onclick = () => confirmLeave();
  document.getElementById('ptHustleBtn')?.addEventListener('click', () => activateHustle(hustle, hero));
  document.getElementById('ptCallSelect')?.addEventListener('change', (e) => {
    _pts.calledBall = e.target.value ? parseInt(e.target.value) : null;
  });

  updateGameUI();
}

function updateGameUI() {
  const sidebar = document.getElementById('ptGameSidebar');
  if (sidebar) sidebar.innerHTML = PT_GAME_REGISTRY[_pts.game]?.renderGameUI() || '';
  const cred = document.getElementById('ptCreditsVal');
  if (cred) cred.textContent = _pts.playerCredits;
  const turn = document.getElementById('ptTurnIndicator');
  if (turn) {
    turn.className = `pt-turn-indicator ${_pts.currentTurn === 'player' ? 'pt-your-turn' : 'pt-opp-turn'}`;
    turn.textContent = _pts.currentTurn === 'player' ? '▶ YOUR TURN' : `▶ ${_pts.opponent.name.toUpperCase()}'S TURN`;
  }
  const log = document.getElementById('ptLog');
  if (log) log.innerHTML = _pts.log.slice(-5).map(l => `<div>${l}</div>`).join('');
  const msg = document.getElementById('ptMessageBar');
  if (msg) msg.textContent = _pts.message || '\u00a0';
  const hint = document.getElementById('ptCanvasHint');
  if (hint) hint.style.display = _pts.currentTurn !== 'player' ? 'none' : '';

  // Refresh action buttons
  const hero = _state.roster.find(a => a.id === _state.selectedActorId || a.role === 'player');
  const hustle = VOID_HUSTLES[hero?.classId] || VOID_HUSTLES._default;
  const btns = document.getElementById('ptActionBtns');
  if (btns) {
    btns.innerHTML = `
      ${_pts.currentTurn === 'player' && !_pts.voidHustleUsed ?
        `<button class="pt-btn pt-btn-hustle" id="ptHustleBtn" title="${hustle.desc}">${hustle.label} ◈</button>` : ''}
      ${_pts.currentTurn === 'player' && _pts.game === 'straight_pool' && !_pts.calledBall ?
        `<div class="pt-call-shot" id="ptCallArea">
          Call ball: <select id="ptCallSelect">
            <option value="">—</option>
            ${_pts.balls.filter(b => !b.pocketed && !b.isCue).map(b => `<option value="${b.num}">Ball ${b.num}</option>`).join('')}
          </select>
        </div>` : ''}
    `;
    document.getElementById('ptHustleBtn')?.addEventListener('click', () => activateHustle(hustle, hero));
    document.getElementById('ptCallSelect')?.addEventListener('change', (e) => {
      _pts.calledBall = e.target.value ? parseInt(e.target.value) : null;
    });
  }
}

// ─── GAME-SPECIFIC UI RENDERS ─────────────────────────────────────────────────

function renderEightBallUI() {
  const pts = _pts;
  const playerBalls = pts.balls.filter(b => !b.pocketed && !b.isCue && (
    pts.playerGroup === 'solid' ? !b.isStripe && b.num !== 8 :
    pts.playerGroup === 'stripe' ? b.isStripe :
    b.num > 0 && b.num !== 8
  ));
  const oppBalls = pts.balls.filter(b => !b.pocketed && !b.isCue && (
    pts.opponentGroup === 'solid' ? !b.isStripe && b.num !== 8 :
    pts.opponentGroup === 'stripe' ? b.isStripe :
    b.num > 0 && b.num !== 8
  ));
  const eight = pts.balls.find(b => b.num === 8 && !b.pocketed);

  return `
    <div class="pt-sidebar-section">
      <div class="pt-sidebar-title">8-BALL</div>
      <div class="pt-score-row">
        <div class="pt-score-col pt-you">
          <div class="pt-score-label">YOU</div>
          <div class="pt-group-tag">${pts.playerGroup || '—'}</div>
          <div class="pt-balls-left">${playerBalls.length} left</div>
          <div class="pt-mini-balls">${playerBalls.map(b => `<div class="pt-mini-ball" style="background:${b.color}">${b.num}</div>`).join('')}</div>
        </div>
        <div class="pt-8ball-center">${eight ? '<div class="pt-eight-ball">8</div>' : '<div class="pt-eight-pocketed">●</div>'}</div>
        <div class="pt-score-col pt-opp">
          <div class="pt-score-label">${pts.opponent?.name || 'OPP'}</div>
          <div class="pt-group-tag">${pts.opponentGroup || '—'}</div>
          <div class="pt-balls-left">${oppBalls.length} left</div>
          <div class="pt-mini-balls">${oppBalls.map(b => `<div class="pt-mini-ball" style="background:${b.color}">${b.num}</div>`).join('')}</div>
        </div>
      </div>
    </div>`;
}

function renderNineBallUI() {
  const pts = _pts;
  const remaining = pts.balls.filter(b => !b.pocketed && !b.isCue && b.num > 0).map(b => b.num).sort((a, b) => a - b);
  return `
    <div class="pt-sidebar-section">
      <div class="pt-sidebar-title">9-BALL</div>
      <div class="pt-nine-info">
        <div class="pt-next-ball">Hit first: <strong class="pt-highlight">${pts.lowestBall || '—'}</strong></div>
        <div class="pt-remaining-balls">
          ${remaining.map(n => `<div class="pt-mini-ball ${n === pts.lowestBall ? 'pt-target-ball' : ''}" style="background:${BALL_COLORS[n] || '#888'}">${n}</div>`).join('')}
        </div>
      </div>
    </div>`;
}

function renderStraightPoolUI() {
  const pts = _pts;
  return `
    <div class="pt-sidebar-section">
      <div class="pt-sidebar-title">STRAIGHT POOL</div>
      <div class="pt-straight-scores">
        <div class="pt-score-big">
          <div class="pt-score-num">${pts.playerScore}</div>
          <div class="pt-score-sub">YOU</div>
        </div>
        <div class="pt-score-divider">vs</div>
        <div class="pt-score-big pt-opp-score">
          <div class="pt-score-num">${pts.opponentScore}</div>
          <div class="pt-score-sub">${pts.opponent?.name || 'OPP'}</div>
        </div>
      </div>
      <div class="pt-score-target">Race to <strong>${pts.scoreTarget}</strong></div>
      <div class="pt-progress-bar"><div class="pt-progress-fill" style="width:${(pts.playerScore/pts.scoreTarget)*100}%"></div></div>
      ${pts.calledBall ? `<div class="pt-called-ball">Called: Ball <strong>${pts.calledBall}</strong></div>` : '<div class="pt-call-hint">Select a ball to call your shot</div>'}
    </div>`;
}

function renderBlitzardsUI() {
  const pts = _pts;
  const alive = pts.bottles.filter(b => !b.shattered).length;
  return `
    <div class="pt-sidebar-section">
      <div class="pt-sidebar-title pt-blitz-title">💥 BLITZARDS</div>
      <div class="pt-straight-scores">
        <div class="pt-score-big">
          <div class="pt-score-num pt-blitz-score">${pts.blitzScore}</div>
          <div class="pt-score-sub">YOU</div>
        </div>
        <div class="pt-score-divider">vs</div>
        <div class="pt-score-big pt-opp-score">
          <div class="pt-score-num">${pts.opponentBlitzScore}</div>
          <div class="pt-score-sub">${pts.opponent?.name || 'OPP'}</div>
        </div>
      </div>
      <div class="pt-score-target">Race to <strong>${pts.blitzTargetScore}</strong> pts</div>
      <div class="pt-bottles-status">
        <span class="pt-bottle-icon">🍾</span> ${alive} bottles on table
      </div>
      <div class="pt-blitz-rules">
        <div class="pt-rule">● Hit bottle = –2 pts + turn lost</div>
        <div class="pt-rule">● Pocket bottle = forfeit turn</div>
        <div class="pt-rule">● Pocket ball = +1 pt</div>
      </div>
    </div>`;
}

// ─── VOID HUSTLE (Class Ability) ──────────────────────────────────────────────

function activateHustle(hustle, hero) {
  if (_pts.voidHustleUsed) return;
  _pts.voidHustleUsed = true;
  _pts.activeHustle = hustle.id;
  ptAddLog(`You activate ${hustle.label}!`);

  if (hustle.id === 'premonition') {
    // Show pocket predictions overlay
    const predictions = _pts.balls.filter(b => !b.pocketed && !b.isCue).map(b => {
      const nearPocket = POCKET_POSITIONS.reduce((best, p) => {
        const d = Math.sqrt((b.x - p.x) ** 2 + (b.y - p.y) ** 2);
        return d < best.d ? { p, d } : best;
      }, { p: POCKET_POSITIONS[0], d: Infinity });
      return `Ball ${b.num} → ${['TL','TM','TR','BL','BM','BR'][POCKET_POSITIONS.indexOf(nearPocket.p)]}`;
    }).join(', ');
    _pts.message = `Premonition: ${predictions}`;
  } else {
    _pts.message = `${hustle.label} activated! ${hustle.desc}`;
  }
  updateGameUI();
}

// ─── GAME END ──────────────────────────────────────────────────────────────────

function endGame(playerWon, message) {
  stopAnimation();
  _pts.phase = 'game_over';
  ptAddLog(message);
  syncCredits();
  maybeGossip();

  let delta = 0;
  if (playerWon) {
    delta = _pts.playerBet * 2;
    _pts.playerCredits += delta;
    _pts.opponent.credits -= _pts.playerBet;
    if (_tableData.onPlayerWinFlag) _state.flags[_tableData.onPlayerWinFlag] = true;
    ptAddLog(`You win ${delta}¢!`);
  } else {
    _pts.opponent.credits += _pts.playerBet * 2;
    ptAddLog(`You lose ${_pts.playerBet}¢.`);
  }

  syncCredits(); saveGamblers();

  const net = _pts.playerCredits - _sessionStartCredits;
  _overlay.innerHTML = `
    <div class="pt-container pt-end-screen">
      <div class="pt-end-icon">${playerWon ? '🎱' : '●'}</div>
      <div class="pt-end-title">${playerWon ? 'RACK AND ROLL' : 'SCRATCHED OUT'}</div>
      <div class="pt-end-result">${message}</div>
      <div class="pt-end-net ${net >= 0 ? 'pt-net-win' : 'pt-net-loss'}">
        Session: ${net >= 0 ? '+' : ''}${net}¢
      </div>
      <div class="pt-end-btns">
        <button class="pt-btn pt-btn-primary" id="ptRematchBtn">Rematch</button>
        <button class="pt-btn" id="ptLobbyBtn">Change Game</button>
        <button class="pt-btn pt-btn-leave" id="ptEndLeaveBtn">Leave Table</button>
      </div>
    </div>`;

  document.getElementById('ptRematchBtn').onclick = () => {
    if (_pts.playerCredits < _tableData.minBet) { ptShowMsg('Not enough credits.'); return; }
    startBetPhase(_pts.opponent);
  };
  document.getElementById('ptLobbyBtn').onclick = () => renderLobby();
  document.getElementById('ptEndLeaveBtn').onclick = () => closeTable();
}

function confirmLeave() {
  stopAnimation();
  const net = _pts.playerCredits - _sessionStartCredits;
  _overlay.innerHTML = `
    <div class="pt-container pt-leave-confirm">
      <div class="pt-leave-title">Rack down?</div>
      <div class="pt-leave-stats">
        <div>Credits when you sat down: <strong>${_sessionStartCredits}¢</strong></div>
        <div>Credits now: <strong>${_pts.playerCredits}¢</strong></div>
        <div class="${net >= 0 ? 'pt-net-win' : 'pt-net-loss'}">Net: ${net >= 0 ? '+' : ''}${net}¢</div>
      </div>
      <div class="pt-leave-btns">
        <button class="pt-btn" id="ptStayBtn">Keep Playing</button>
        <button class="pt-btn pt-btn-primary" id="ptConfirmLeave">Leave</button>
      </div>
    </div>`;
  document.getElementById('ptStayBtn').onclick = () => {
    if (_pts.game && _pts.phase === 'playing') { mountGameCanvas(); }
    else renderLobby();
  };
  document.getElementById('ptConfirmLeave').onclick = () => closeTable();
}

function closeTable() {
  stopAnimation(); clearInterval(_powerInterval);
  syncCredits(); saveGamblers();
  if (_overlay) { _overlay.remove(); _overlay = null; }
  _canvas = null; _ctx = null;
  _api.renderAll();
}

// ─── GOSSIP ───────────────────────────────────────────────────────────────────

function maybeGossip() {
  const pool = _tableData.gossipPool || [];
  if (!pool.length || Math.random() > 0.35) return;
  const opp = _pts.opponent;
  if (!opp) return;
  const gossip = opp._def?.gossipDialogue || {};
  for (const key of pool) {
    if (gossip[key] && !_pts.gossipShown.has(key)) {
      _pts.gossipShown.add(key);
      const toast = document.createElement('div');
      toast.className = 'pt-gossip-toast';
      toast.innerHTML = `<span class="pt-gossip-speaker">${opp.name}</span><span class="pt-gossip-line">${gossip[key]}</span>`;
      _overlay?.appendChild(toast);
      ptAddLog(`[${opp.name}] ${gossip[key]}`);
      setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 600); }, 4200);
      return;
    }
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function syncCredits()  { _state.resources.credits = _pts.playerCredits; }
function saveGamblers() {
  if (!_state.gamblerCredits) _state.gamblerCredits = {};
  if (_pts.opponent) _state.gamblerCredits[_pts.opponent.gamblerId] = _pts.opponent.credits;
}
function ptAddLog(msg)  { _pts.log.push(msg); if (_pts.log.length > 20) _pts.log.shift(); _pts.message = msg; }
function ptShowMsg(msg) { _pts.message = msg; const el = document.getElementById('ptMessageBar'); if (el) el.textContent = msg; }

function injectStyles() {
  if (document.getElementById('poolTableStyles')) return;
  const link = document.createElement('link');
  link.id = 'poolTableStyles'; link.rel = 'stylesheet'; link.href = 'css/PoolTable.css';
  document.head.appendChild(link);
}

export function resetPoolGamblerCredits(state, data) {
  if (!state.gamblerCredits) return;
  (data.tables || []).filter(t => t.type === 'other').flatMap(t => t.seats || []).forEach(s => {
    const g = (data.gamblers || []).find(x => x.id === s.gamblerId);
    if (g && state.gamblerCredits[s.gamblerId] !== undefined)
      state.gamblerCredits[s.gamblerId] = Math.max(state.gamblerCredits[s.gamblerId], Math.floor(g.creditReset * 0.7));
  });
}
