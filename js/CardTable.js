/**
 * VOID TABLE — Galactic Card Game System for Spaced
 * =====================================================
 * Entry point: openCardTable(tableId, state, data, api)
 *
 * Supported games:
 *   blackjack  — Player vs dealer NPC
 *   void_draw  — Original space card game (5-card, target 30)
 *
 * Adding a game: register it in GAME_REGISTRY below.
 * Each game module exports: { name, description, minPlayers, maxPlayers, init, render }
 */

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const SUITS = [
  { id: 'void',  label: 'VOID',  symbol: '◈', color: '#9b59ff' },
  { id: 'pulse', label: 'PULSE', symbol: '⚡', color: '#ffcc5a' },
  { id: 'drift', label: 'DRIFT', symbol: '~', color: '#79d4ff' },
  { id: 'flux',  label: 'FLUX',  symbol: '⊕', color: '#7ed9a0' },
];

// Standard face cards mapped to values
const FACE_VALUES = { J: 10, Q: 10, K: 10, A: 11 };
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

// NPC "think" delay ms per archetype
const THINK_DELAY = { shark: 1400, nervous: 900, reckless: 500, drunk: 1200 };

// Void Shift powers per class
const VOID_SHIFTS = {
  marshal:   { id: 'overcharge',   label: 'Overcharge',  desc: 'Force an opponent to discard their highest card.' },
  raider:    { id: 'overcharge',   label: 'Overcharge',  desc: 'Force an opponent to discard their highest card.' },
  salvager:  { id: 'strip_mine',   label: 'Strip Mine',  desc: 'Peek at two cards from any opponent before acting.' },
  voidseer:  { id: 'premonition',  label: 'Premonition', desc: 'See the top 3 cards of the draw deck before drawing.' },
  _default:  { id: 'lucky_draw',   label: 'Lucky Draw',  desc: 'Draw 3 cards from the deck, keep 1, discard 2.' },
};

// ─── DECK UTILITIES ───────────────────────────────────────────────────────────

function buildDeck() {
  const deck = [];
  SUITS.forEach(suit => {
    RANKS.forEach(rank => {
      const val = FACE_VALUES[rank] ?? parseInt(rank);
      deck.push({ suit: suit.id, rank, value: val, faceUp: false, id: `${rank}_${suit.id}` });
    });
  });
  return deck;
}

function buildVoidDeck() {
  // 40-card Void Draw deck: suits × values 1-10
  const deck = [];
  SUITS.forEach(suit => {
    for (let v = 1; v <= 10; v++) {
      deck.push({ suit: suit.id, rank: String(v), value: v, faceUp: false, id: `${v}_${suit.id}` });
    }
  });
  return deck;
}

function shuffle(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function handValue(cards) {
  // Blackjack: handle Aces
  let total = 0, aces = 0;
  cards.forEach(c => {
    if (!c.faceUp) return;
    if (c.rank === 'A') { aces++; total += 11; }
    else total += c.value;
  });
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function voidHandValue(cards) {
  return cards.reduce((s, c) => s + c.value, 0);
}

// ─── GAME STATE (module-level, reset each open) ────────────────────────────────

let _overlay    = null;   // DOM element
let _tableData  = null;   // current table definition
let _gamblers   = [];     // gambler definitions from data
let _state      = null;   // game state reference
let _data       = null;   // full game data reference
let _api        = null;   // engine API reference

let _tableState = {       // card game session state
  game: null,             // 'blackjack' | 'void_draw'
  phase: 'lobby',         // lobby | bet | playing | resolution | leaving
  playerCredits: 0,
  playerBet: 0,
  seats: [],              // [{ gamblerId, name, archetype, credits, hand, bet, status, voidShiftUsed }]
  deck: [],
  pot: 0,
  round: 0,
  playerHand: [],
  playerStatus: 'active', // active | stand | bust | win | lose
  voidShiftUsed: false,
  voidShiftPeeked: null,  // for strip_mine / premonition
  dealerIdx: 0,           // which seat is dealer (BJ)
  message: '',
  log: [],
  gossipShown: new Set(),
};

// ─── GAME REGISTRY ────────────────────────────────────────────────────────────
// To add a new game: add an entry here. No other file changes required.

const GAME_REGISTRY = {
  blackjack: {
    id: 'blackjack',
    name: 'Blackjack',
    subtitle: '21 — Beat the dealer without going over',
    icon: '♠',
    description: 'Get as close to 21 as possible. Beat the dealer\'s hand. Face cards = 10. Aces = 1 or 11. Dealer hits on 16 or less.',
    minPlayers: 1,
    maxPlayers: 5,
    initFn: initBlackjack,
    renderFn: renderBlackjack,
  },
  void_draw: {
    id: 'void_draw',
    name: 'Void Draw',
    subtitle: 'Target 30 — The game of the outer void',
    icon: '◈',
    description: 'Each player is dealt 5 cards. Target 30 without going over. Once per round you may swap up to 2 cards. Use your Void Shift ability once per session for a unique advantage.',
    minPlayers: 2,
    maxPlayers: 6,
    initFn: initVoidDraw,
    renderFn: renderVoidDraw,
  },
};

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────

export function openCardTable(tableId, state, data, api) {
  _state = state;
  _data  = data;
  _api   = api;

  // Load table and gamblers
  const tables   = data.tables   || [];
  const gamblers = data.gamblers || [];
  const table    = tables.find(t => t.id === tableId);
  if (!table) {
    console.warn('[CardTable] Table not found:', tableId);
    return;
  }

  _tableData = table;
  _gamblers  = gamblers;

  // Check requirements
  if (table.requiredFlag && !state.flags[table.requiredFlag]) {
    api.log(`The ${table.name} table is not accessible yet.`);
    return;
  }
  if (table.requiredFaction) {
    const standing = state.factions[table.requiredFaction] || 0;
    if (standing < (table.requiredFactionMin || 10)) {
      api.log(`You need higher standing with the right faction to sit at the ${table.name}.`);
      return;
    }
  }

  // Build session state
  _tableState = {
    game: null,
    phase: 'lobby',
    playerCredits: state.resources.credits,
    playerBet: Math.max(table.minBet, 10),
    seats: buildSeats(table, gamblers),
    deck: [],
    pot: 0,
    round: 0,
    playerHand: [],
    playerStatus: 'active',
    voidShiftUsed: false,
    voidShiftPeeked: null,
    dealerIdx: 0,
    message: '',
    log: [],
    gossipShown: new Set(),
  };

  // Reset NPC credit pools from saved state if available
  _tableState.seats.forEach(seat => {
    const savedCredits = state.gamblerCredits?.[seat.gamblerId];
    if (savedCredits !== undefined) seat.credits = savedCredits;
  });

  injectStyles();
  buildOverlay();
  renderLobby();
}

function buildSeats(table, gamblers) {
  return (table.seats || []).map(s => {
    const g = gamblers.find(x => x.id === s.gamblerId) || {
      id: s.gamblerId, name: 'Unknown', archetype: 'nervous',
      bluffFrequency: 0.1, foldThreshold: 0.4, aggressionBias: 0.2,
      creditReset: s.startingCredits || 200,
      tells: ['They reveal nothing.'],
      winDialogue: ['They collect their winnings.'],
      loseDialogue: ['They push their chips over.'],
      bustDialogue: ['They bust.'],
      gossipDialogue: {},
    };
    return {
      gamblerId: g.id,
      name: g.name,
      archetype: g.archetype,
      speciesId: g.speciesId,
      credits: s.startingCredits || g.creditReset || 200,
      hand: [],
      bet: 0,
      status: 'active',   // active | stand | bust | fold | win | lose
      voidShiftUsed: false,
      _def: g,            // full gambler definition
    };
  });
}

// ─── OVERLAY SHELL ────────────────────────────────────────────────────────────

function buildOverlay() {
  if (_overlay) _overlay.remove();
  _overlay = document.createElement('div');
  _overlay.id = 'voidTableOverlay';
  _overlay.className = 'vt-overlay';
  document.body.appendChild(_overlay);
}

function renderLobby() {
  const t = _tableData;
  const seats = _tableState.seats;
  const availGames = (t.availableGames || ['blackjack','void_draw']).map(id => GAME_REGISTRY[id]).filter(Boolean);

  _overlay.innerHTML = `
    <div class="vt-container vt-lobby">
      <div class="vt-header">
        <div class="vt-header-left">
          <div class="vt-title">${t.name}</div>
          <div class="vt-subtitle">${t.location}</div>
        </div>
        <div class="vt-header-right">
          <div class="vt-credits-display">
            <span class="vt-label">YOUR CREDITS</span>
            <span class="vt-credits-val" id="vtLobbyCredits">${_tableState.playerCredits}</span>
          </div>
          <button class="vt-btn vt-btn-leave" id="vtLeaveBtn">Leave Table</button>
        </div>
      </div>

      <div class="vt-lobby-body">
        <div class="vt-seats-section">
          <div class="vt-section-title">PLAYERS AT THE TABLE</div>
          <div class="vt-seat-cards" id="vtSeatCards">
            ${seats.map(seat => renderSeatCard(seat)).join('')}
          </div>
        </div>

        <div class="vt-games-section">
          <div class="vt-section-title">CHOOSE YOUR GAME</div>
          <div class="vt-game-cards">
            ${availGames.map(g => `
              <div class="vt-game-card" data-game="${g.id}">
                <div class="vt-game-icon">${g.icon}</div>
                <div class="vt-game-name">${g.name}</div>
                <div class="vt-game-sub">${g.subtitle}</div>
                <div class="vt-game-desc">${g.description}</div>
                <div class="vt-game-stakes">
                  Min <strong>${t.minBet}¢</strong> — Max <strong>${t.maxBet}¢</strong>
                </div>
                <button class="vt-btn vt-btn-primary vt-play-btn" data-game="${g.id}">Play ${g.name}</button>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="vt-atmosphere-bar">
        <span class="vt-atm-label">${atmosphereLabel(t.atmosphere)}</span>
        <span class="vt-credits-hint">Minimum bet: ${t.minBet}¢ · Maximum: ${t.maxBet}¢</span>
      </div>
    </div>
  `;

  document.getElementById('vtLeaveBtn').onclick = () => closeTable();
  document.querySelectorAll('.vt-play-btn').forEach(btn => {
    btn.onclick = () => startGame(btn.dataset.game);
  });
}

function renderSeatCard(seat) {
  const archetypeClass = `vt-arch-${seat.archetype}`;
  const archetypeLabel = { shark: '◆ Shark', nervous: '◇ Nervous', reckless: '⚠ Reckless', drunk: '~ Drunk' }[seat.archetype] || seat.archetype;
  return `
    <div class="vt-seat-card ${archetypeClass}">
      <div class="vt-seat-avatar">${seat.name.charAt(0).toUpperCase()}</div>
      <div class="vt-seat-info">
        <div class="vt-seat-name">${seat.name}</div>
        <div class="vt-seat-arch">${archetypeLabel}</div>
        <div class="vt-seat-credits">${seat.credits}¢</div>
      </div>
    </div>
  `;
}

function atmosphereLabel(atm) {
  return { dim: '🔅 Dim and smoky', tense: '⚡ Charged with tension', hostile: '🔴 Hostile territory', quiet: '◈ Quiet and watchful' }[atm] || atm || '◈ Void Table';
}

// ─── GAME START ───────────────────────────────────────────────────────────────

function startGame(gameId) {
  const game = GAME_REGISTRY[gameId];
  if (!game) return;
  _tableState.game = gameId;
  _tableState.phase = 'bet';
  _tableState.round = (_tableState.round || 0) + 1;
  game.initFn();
  renderBetPhase();
}

function renderBetPhase() {
  const t     = _tableData;
  const ts    = _tableState;
  const game  = GAME_REGISTRY[ts.game];
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  _overlay.innerHTML = `
    <div class="vt-container vt-bet-screen">
      <div class="vt-header">
        <div class="vt-header-left">
          <div class="vt-title">${t.name} — ${game.name}</div>
          <div class="vt-subtitle">Round ${ts.round}</div>
        </div>
        <div class="vt-header-right">
          <div class="vt-credits-display">
            <span class="vt-label">CREDITS</span>
            <span class="vt-credits-val">${ts.playerCredits}</span>
          </div>
          <button class="vt-btn vt-btn-leave" id="vtBackLobbyBtn">← Back</button>
        </div>
      </div>

      <div class="vt-bet-body">
        <div class="vt-bet-panel">
          <div class="vt-section-title">PLACE YOUR BET</div>
          <div class="vt-bet-display" id="vtBetDisplay">${ts.playerBet}¢</div>
          <input type="range" class="vt-bet-slider" id="vtBetSlider"
            min="${t.minBet}" max="${Math.min(t.maxBet, ts.playerCredits)}"
            value="${clamp(ts.playerBet, t.minBet, Math.min(t.maxBet, ts.playerCredits))}"
            step="${Math.max(1, Math.floor(t.minBet / 2))}"
          />
          <div class="vt-quick-bets">
            <button class="vt-btn vt-quick-btn" data-pct="0">Min (${t.minBet}¢)</button>
            <button class="vt-btn vt-quick-btn" data-pct="25">¼ Pot</button>
            <button class="vt-btn vt-quick-btn" data-pct="50">½ Pot</button>
            <button class="vt-btn vt-quick-btn" data-pct="100">All-In</button>
          </div>
          <button class="vt-btn vt-btn-primary vt-deal-btn" id="vtDealBtn">
            DEAL — ${ts.playerBet}¢
          </button>
        </div>

        <div class="vt-seats-preview">
          <div class="vt-section-title">OPPONENTS</div>
          ${ts.seats.map(s => `
            <div class="vt-seat-row vt-arch-${s.archetype}">
              <span class="vt-seat-dot"></span>
              <span class="vt-seat-name-sm">${s.name}</span>
              <span class="vt-seat-credits-sm">${s.credits}¢</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  const slider = document.getElementById('vtBetSlider');
  const display = document.getElementById('vtBetDisplay');
  const dealBtn = document.getElementById('vtDealBtn');

  slider.addEventListener('input', () => {
    ts.playerBet = parseInt(slider.value);
    display.textContent = ts.playerBet + '¢';
    dealBtn.textContent = `DEAL — ${ts.playerBet}¢`;
  });

  document.querySelectorAll('.vt-quick-btn').forEach(btn => {
    btn.onclick = () => {
      const pct = parseInt(btn.dataset.pct);
      const max = Math.min(t.maxBet, ts.playerCredits);
      const val = pct === 0 ? t.minBet : Math.floor(max * pct / 100);
      ts.playerBet = Math.max(t.minBet, Math.min(val, max));
      slider.value = ts.playerBet;
      display.textContent = ts.playerBet + '¢';
      dealBtn.textContent = `DEAL — ${ts.playerBet}¢`;
    };
  });

  dealBtn.onclick = () => {
    if (ts.playerCredits < ts.playerBet) {
      showMessage('Not enough credits.');
      return;
    }
    ts.playerCredits -= ts.playerBet;
    ts.phase = 'playing';
    syncCreditsToState();
    GAME_REGISTRY[ts.game].initFn();
    GAME_REGISTRY[ts.game].renderFn();
  };

  document.getElementById('vtBackLobbyBtn').onclick = () => {
    _tableState.game = null;
    _tableState.phase = 'lobby';
    renderLobby();
  };
}

// ─── BLACKJACK ────────────────────────────────────────────────────────────────

function initBlackjack() {
  const ts = _tableState;
  ts.deck = shuffle(buildDeck());
  ts.playerHand = [];
  ts.playerStatus = 'active';
  ts.dealerHand = [];
  ts.dealerStatus = 'active';

  // NPCs each place a bet proportional to archetype
  ts.seats.forEach(seat => {
    if (seat.credits <= 0) { seat.status = 'fold'; seat.bet = 0; return; }
    seat.hand = [];
    seat.status = 'active';
    seat.bet = npcBet(seat, _tableData);
    seat.credits -= seat.bet;
  });

  // Deal: player 2 cards, dealer 2 (one down), each NPC 2
  ts.playerHand = [deal(true), deal(true)];
  ts.dealerHand = [deal(true), deal(false)]; // dealer second card face down

  ts.seats.forEach(seat => {
    if (seat.status !== 'fold') seat.hand = [deal(true), deal(true)];
  });
}

function deal(faceUp = true) {
  const card = _tableState.deck.pop();
  if (card) card.faceUp = faceUp;
  return card;
}

function renderBlackjack() {
  const ts = _tableState;
  const playerVal = handValue(ts.playerHand);

  // Dealer shown value (only face-up cards)
  const dealerShown = ts.dealerHand.filter(c => c.faceUp);
  const dealerVal   = handValue(dealerShown);

  // Player class for void shift
  const hero = _state.roster.find(a => a.id === _state.selectedActorId || a.role === 'player');
  const classId = hero?.classId || '_default';
  const shift = VOID_SHIFTS[classId] || VOID_SHIFTS._default;

  const canHit   = ts.playerStatus === 'active' && playerVal < 21;
  const canStand = ts.playerStatus === 'active';
  const canShift = !ts.voidShiftUsed && ts.playerStatus === 'active';

  _overlay.innerHTML = `
    <div class="vt-container vt-game-screen">
      ${renderGameHeader('Blackjack', `Round ${ts.round}`)}
      <div class="vt-table-surface">

        <!-- Dealer area -->
        <div class="vt-dealer-zone">
          <div class="vt-zone-label">DEALER · ${dealerShown.length < ts.dealerHand.length ? '?' : dealerVal}</div>
          <div class="vt-hand" id="vtDealerHand">${ts.dealerHand.map(c => cardHTML(c)).join('')}</div>
        </div>

        <!-- NPC seats around table -->
        <div class="vt-npc-row">
          ${ts.seats.map((seat, i) => `
            <div class="vt-npc-seat ${seat.status === 'fold' || seat.status === 'bust' ? 'vt-npc-out' : ''}" id="vtNpcSeat${i}">
              <div class="vt-npc-name">${seat.name}</div>
              <div class="vt-hand vt-npc-hand">${seat.hand.map(c => cardHTML(c, true)).join('')}</div>
              <div class="vt-npc-credits">${seat.credits}¢</div>
              <div class="vt-npc-status vt-arch-${seat.archetype}" id="vtNpcStatus${i}">${npcStatusLabel(seat)}</div>
            </div>
          `).join('')}
        </div>

        <!-- Player area -->
        <div class="vt-player-zone">
          <div class="vt-zone-label">YOU · ${playerVal > 21 ? '<span class="vt-bust">BUST '+playerVal+'</span>' : playerVal}</div>
          <div class="vt-hand" id="vtPlayerHand">${ts.playerHand.map(c => cardHTML(c)).join('')}</div>
          <div class="vt-bet-chip">BET: ${ts.playerBet}¢</div>
        </div>

      </div>

      <!-- Action bar -->
      <div class="vt-action-bar">
        <div class="vt-action-left">
          <div class="vt-credits-chip">Credits: <strong>${ts.playerCredits}</strong></div>
        </div>
        <div class="vt-action-btns">
          ${canHit   ? `<button class="vt-btn vt-btn-primary" id="vtHitBtn">Hit</button>` : ''}
          ${canStand ? `<button class="vt-btn" id="vtStandBtn">Stand</button>` : ''}
          ${canShift ? `<button class="vt-btn vt-btn-shift" id="vtShiftBtn" title="${shift.desc}">${shift.label} ◈</button>` : ''}
          ${ts.playerStatus !== 'active' ? `<button class="vt-btn vt-btn-primary" id="vtNextRoundBtn">Next Round</button>` : ''}
        </div>
        <div class="vt-action-right">
          <button class="vt-btn vt-btn-sm vt-btn-leave" id="vtLeaveGameBtn">Leave</button>
        </div>
      </div>

      <!-- Message / log area -->
      <div class="vt-message-bar" id="vtMessageBar">${ts.message || '&nbsp;'}</div>
      <div class="vt-log" id="vtLog">${ts.log.slice(-4).map(l => `<div>${l}</div>`).join('')}</div>
    </div>
  `;

  // Wire buttons
  if (canHit) document.getElementById('vtHitBtn').onclick = () => bjHit();
  if (canStand) document.getElementById('vtStandBtn').onclick = () => bjStand();
  if (canShift) document.getElementById('vtShiftBtn').onclick = () => activateVoidShift('blackjack');
  if (ts.playerStatus !== 'active') {
    document.getElementById('vtNextRoundBtn').onclick = () => startNextRound();
  }
  document.getElementById('vtLeaveGameBtn').onclick = () => confirmLeave();
}

function bjHit() {
  const ts = _tableState;
  const card = deal(true);
  if (!card) return;
  ts.playerHand.push(card);
  const val = handValue(ts.playerHand);
  if (val > 21) {
    ts.playerStatus = 'bust';
    ts.message = `You bust with ${val}. Dealer wins.`;
    addLog(`You hit: ${cardLabel(card)} — total ${val}. BUST.`);
    setTimeout(() => bjResolveDealer(), 600);
  } else if (val === 21) {
    ts.playerStatus = 'stand';
    ts.message = '21! Standing automatically.';
    addLog(`You hit: ${cardLabel(card)} — total 21. Auto-stand.`);
    setTimeout(() => bjResolveDealer(), 600);
  } else {
    addLog(`You hit: ${cardLabel(card)} — total ${val}.`);
    renderBlackjack();
  }
}

function bjStand() {
  const ts = _tableState;
  ts.playerStatus = 'stand';
  addLog('You stand.');
  bjResolveDealer();
}

function bjResolveDealer() {
  const ts = _tableState;
  // Flip dealer's hole card
  ts.dealerHand.forEach(c => c.faceUp = true);

  // NPC turns (simple: they hit on <17)
  ts.seats.forEach(seat => {
    if (seat.status !== 'active') return;
    let v = handValue(seat.hand.map(c => ({...c, faceUp: true})));
    while (v < 17 && ts.deck.length > 0) {
      const nc = deal(true);
      if (nc) { seat.hand.push(nc); v = handValue(seat.hand); }
    }
    if (v > 21) seat.status = 'bust';
    else seat.status = 'stand';
  });

  // Dealer plays
  let dv = handValue(ts.dealerHand);
  while (dv <= 16 && ts.deck.length > 0) {
    const dc = deal(true);
    if (dc) { ts.dealerHand.push(dc); dv = handValue(ts.dealerHand); }
  }

  bjResolvePot();
}

function bjResolvePot() {
  const ts = _tableState;
  const playerVal = handValue(ts.playerHand);
  const dealerVal = handValue(ts.dealerHand);
  const dealerBust = dealerVal > 21;
  let result = '';
  let delta = 0;

  if (ts.playerStatus === 'bust') {
    result = 'BUST — Dealer wins.';
    delta = 0; // already deducted
  } else if (dealerBust) {
    result = 'Dealer busts! You win!';
    delta = ts.playerBet * 2;
    ts.playerCredits += delta;
  } else if (playerVal > dealerVal) {
    result = `You win! ${playerVal} beats dealer's ${dealerVal}.`;
    delta = ts.playerBet * 2;
    ts.playerCredits += delta;
  } else if (playerVal === dealerVal) {
    result = `Push — ${playerVal} each. Bet returned.`;
    delta = ts.playerBet;
    ts.playerCredits += delta;
  } else {
    result = `Dealer wins. ${dealerVal} beats your ${playerVal}.`;
  }

  // NPC payouts
  ts.seats.forEach(seat => {
    if (seat.status === 'bust' || seat.status === 'fold') return;
    const sv = handValue(seat.hand);
    if (dealerBust || sv > dealerVal) seat.credits += seat.bet * 2;
    else if (sv === dealerVal) seat.credits += seat.bet;
    // else they lose (already deducted)
  });

  ts.playerStatus = delta > 0 ? 'win' : ts.playerStatus === 'bust' ? 'bust' : 'lose';
  ts.message = result;
  addLog(result);
  syncCreditsToState();
  saveGamblerCredits();

  // Trigger gossip occasionally
  maybeShowGossip();

  // Set win flag if applicable
  if (delta > ts.playerBet && _tableData.onPlayerWinFlag) {
    _state.flags[_tableData.onPlayerWinFlag] = true;
  }

  renderBlackjack();
}

// ─── VOID DRAW ────────────────────────────────────────────────────────────────

function initVoidDraw() {
  const ts = _tableState;
  ts.deck = shuffle(buildVoidDeck());
  ts.playerHand = [];
  ts.playerStatus = 'active';
  ts.vdPhase = 'draw';  // draw | swap | reveal
  ts.vdSwapsLeft = 2;
  ts.vdSelectedCards = new Set(); // indices of selected cards for swap

  // NPCs place bets
  ts.seats.forEach(seat => {
    if (seat.credits <= 0) { seat.status = 'fold'; seat.bet = 0; return; }
    seat.hand = [];
    seat.status = 'active';
    seat.bet = npcBet(seat, _tableData);
    seat.credits -= seat.bet;
  });

  // Deal 5 cards each (all face-up for player, hidden for NPCs)
  for (let i = 0; i < 5; i++) {
    const card = deal(true);
    if (card) ts.playerHand.push(card);
  }
  ts.seats.forEach(seat => {
    if (seat.status === 'fold') return;
    seat.hand = [];
    for (let i = 0; i < 5; i++) {
      const card = deal(false); // NPC cards face down
      if (card) seat.hand.push(card);
    }
  });
}

function renderVoidDraw() {
  const ts = _tableState;
  const playerVal = voidHandValue(ts.playerHand);
  const overTarget = playerVal > 30;
  const hero = _state.roster.find(a => a.id === _state.selectedActorId || a.role === 'player');
  const classId = hero?.classId || '_default';
  const shift = VOID_SHIFTS[classId] || VOID_SHIFTS._default;

  const inSwapPhase = ts.vdPhase === 'draw' && ts.vdSwapsLeft > 0 && ts.playerStatus === 'active';
  const canConfirmSwap = inSwapPhase;
  const canStand = ts.playerStatus === 'active';
  const canShift = !ts.voidShiftUsed && ts.playerStatus === 'active';
  const isResolved = ts.vdPhase === 'reveal';

  _overlay.innerHTML = `
    <div class="vt-container vt-game-screen vt-void-draw">
      ${renderGameHeader('Void Draw', `Round ${ts.round} · Target: 30`)}
      <div class="vt-table-surface">

        <!-- NPC hands -->
        <div class="vt-npc-row">
          ${ts.seats.map((seat, i) => {
            const sv = isResolved ? voidHandValue(seat.hand) : '?';
            const revealClass = isResolved && !seat.hand.every(c => c.faceUp) ? 'vt-npc-reveal' : '';
            if(isResolved) seat.hand.forEach(c => c.faceUp = true);
            return `
            <div class="vt-npc-seat ${seat.status === 'fold' || seat.status === 'bust' ? 'vt-npc-out' : ''} ${revealClass}" id="vtNpcSeat${i}">
              <div class="vt-npc-name">${seat.name}</div>
              <div class="vt-hand vt-npc-hand">${seat.hand.map(c => cardHTML(c, !isResolved)).join('')}</div>
              <div class="vt-npc-credits">${seat.credits}¢</div>
              <div class="vt-npc-status vt-arch-${seat.archetype}" id="vtNpcStatus${i}">${isResolved ? `${sv > 30 ? 'BUST' : sv}` : npcStatusLabel(seat)}</div>
            </div>`;
          }).join('')}
        </div>

        <!-- Player hand -->
        <div class="vt-player-zone">
          <div class="vt-zone-label">
            YOUR HAND · <span class="${overTarget ? 'vt-bust' : playerVal === 30 ? 'vt-perfect' : ''}">${playerVal}${overTarget ? ' BUST' : playerVal === 30 ? ' PERFECT' : ''}</span>
            ${inSwapPhase ? `<span class="vt-swap-hint">Select up to 2 cards to swap (${ts.vdSwapsLeft} swap${ts.vdSwapsLeft!==1?'s':''} left)</span>` : ''}
          </div>
          <div class="vt-hand vt-player-hand-vd" id="vtPlayerHand">
            ${ts.playerHand.map((c, i) => `
              <div class="vt-card-wrap ${ts.vdSelectedCards.has(i) ? 'vt-card-selected' : ''}"
                data-idx="${i}"
                onclick="${inSwapPhase ? `vtToggleCard(${i})` : ''}"
                style="${inSwapPhase ? 'cursor:pointer' : ''}">
                ${cardHTML(c)}
              </div>
            `).join('')}
          </div>
          <div class="vt-bet-chip">BET: ${ts.playerBet}¢</div>
        </div>

      </div>

      <!-- Peek reveal if strip_mine or premonition used -->
      ${ts.voidShiftPeeked ? renderPeekPanel(ts.voidShiftPeeked) : ''}

      <!-- Action bar -->
      <div class="vt-action-bar">
        <div class="vt-action-left">
          <div class="vt-credits-chip">Credits: <strong>${ts.playerCredits}</strong></div>
        </div>
        <div class="vt-action-btns">
          ${inSwapPhase && ts.vdSelectedCards.size > 0
            ? `<button class="vt-btn vt-btn-primary" id="vtSwapBtn">Swap ${ts.vdSelectedCards.size} Card${ts.vdSelectedCards.size!==1?'s':''}</button>` : ''}
          ${inSwapPhase
            ? `<button class="vt-btn" id="vtSkipSwapBtn">Skip Swap</button>` : ''}
          ${!inSwapPhase && canStand && !isResolved
            ? `<button class="vt-btn vt-btn-primary" id="vtVdStandBtn">Lock In</button>` : ''}
          ${canShift && !isResolved
            ? `<button class="vt-btn vt-btn-shift" id="vtShiftBtn" title="${shift.desc}">${shift.label} ◈</button>` : ''}
          ${isResolved
            ? `<button class="vt-btn vt-btn-primary" id="vtNextRoundBtn">Next Round</button>` : ''}
        </div>
        <div class="vt-action-right">
          <button class="vt-btn vt-btn-sm vt-btn-leave" id="vtLeaveGameBtn">Leave</button>
        </div>
      </div>

      <div class="vt-message-bar" id="vtMessageBar">${ts.message || '&nbsp;'}</div>
      <div class="vt-log" id="vtLog">${ts.log.slice(-4).map(l => `<div>${l}</div>`).join('')}</div>
    </div>
  `;

  // Wire card selection (exposed globally for onclick in HTML)
  window.vtToggleCard = (idx) => {
    if (ts.vdSelectedCards.has(idx)) ts.vdSelectedCards.delete(idx);
    else if (ts.vdSelectedCards.size < 2) ts.vdSelectedCards.add(idx);
    renderVoidDraw();
  };

  if (document.getElementById('vtSwapBtn')) {
    document.getElementById('vtSwapBtn').onclick = () => vdSwapCards();
  }
  if (document.getElementById('vtSkipSwapBtn')) {
    document.getElementById('vtSkipSwapBtn').onclick = () => {
      ts.vdPhase = 'stand';
      ts.playerStatus = 'stand';
      addLog('You keep your hand.');
      vdRunNPCTurns();
    };
  }
  if (document.getElementById('vtVdStandBtn')) {
    document.getElementById('vtVdStandBtn').onclick = () => {
      ts.playerStatus = 'stand';
      addLog('You lock in your hand.');
      vdRunNPCTurns();
    };
  }
  if (document.getElementById('vtShiftBtn')) {
    document.getElementById('vtShiftBtn').onclick = () => activateVoidShift('void_draw');
  }
  if (document.getElementById('vtNextRoundBtn')) {
    document.getElementById('vtNextRoundBtn').onclick = () => startNextRound();
  }
  document.getElementById('vtLeaveGameBtn').onclick = () => confirmLeave();
}

function renderPeekPanel(peeked) {
  if (!peeked || !peeked.length) return '';
  return `
    <div class="vt-peek-panel">
      <div class="vt-section-title">◈ VOID SIGHT — ${peeked.label || 'Peeked Cards'}</div>
      <div class="vt-hand vt-peek-hand">
        ${peeked.cards.map(c => cardHTML({...c, faceUp: true})).join('')}
      </div>
    </div>
  `;
}

function vdSwapCards() {
  const ts = _tableState;
  const indices = [...ts.vdSelectedCards].sort((a, b) => b - a); // remove from end first
  indices.forEach(i => {
    const newCard = deal(true);
    if (newCard) ts.playerHand[i] = newCard;
  });
  ts.vdSelectedCards.clear();
  ts.vdSwapsLeft--;
  const val = voidHandValue(ts.playerHand);
  addLog(`Swapped ${indices.length} card${indices.length!==1?'s':''}. New total: ${val}.`);
  if (val > 30) {
    ts.playerStatus = 'bust';
    ts.message = `Bust! ${val} over 30.`;
    addLog(`BUST with ${val}.`);
    vdRunNPCTurns();
    return;
  }
  if (ts.vdSwapsLeft <= 0) {
    ts.vdPhase = 'stand';
  }
  renderVoidDraw();
}

function vdRunNPCTurns() {
  const ts = _tableState;
  // Each NPC decides whether to swap cards (simplified AI)
  ts.seats.forEach(seat => {
    if (seat.status !== 'active') return;
    seat.hand.forEach(c => c.faceUp = true);
    const val = voidHandValue(seat.hand);
    const shouldSwap = vdNPCShouldSwap(seat, val);
    if (shouldSwap && ts.deck.length >= 2) {
      // Swap worst card(s)
      const sorted = [...seat.hand].map((c,i) => ({c,i})).sort((a,b) => b.c.value - a.c.value);
      const swapCount = archetype_aggressiveness(seat.archetype) > 0.5 ? 2 : 1;
      for (let j = 0; j < swapCount; j++) {
        const worst = sorted[sorted.length - 1 - j];
        const nc = deal(false);
        if (nc) { nc.faceUp = false; seat.hand[worst.i] = nc; }
      }
    }
    seat.hand.forEach(c => c.faceUp = false); // back face down until reveal
  });
  vdResolve();
}

function vdNPCShouldSwap(seat, val) {
  if (val > 30) return false; // already bust — nothing to swap
  if (val >= 27) return false; // close enough, stand
  if (val < 20) return true;   // definitely swap
  // archetype influences threshold
  const th = { shark: 25, nervous: 22, reckless: 28, drunk: 23 }[seat.archetype] || 24;
  return val < th;
}

function archetype_aggressiveness(arch) {
  return { shark: 0.3, nervous: 0.1, reckless: 0.8, drunk: 0.6 }[arch] || 0.3;
}

function vdResolve() {
  const ts = _tableState;
  ts.vdPhase = 'reveal';

  const playerVal = voidHandValue(ts.playerHand);
  const playerBust = playerVal > 30 || ts.playerStatus === 'bust';

  // Reveal NPC hands and compute values
  ts.seats.forEach(seat => {
    if (seat.status === 'fold') return;
    seat.hand.forEach(c => c.faceUp = true);
    const sv = voidHandValue(seat.hand);
    if (sv > 30) seat.status = 'bust';
    else seat.status = 'stand';
  });

  // Find best NPC hand (not bust)
  const npcBestVals = ts.seats
    .filter(s => s.status !== 'bust' && s.status !== 'fold')
    .map(s => ({ seat: s, val: voidHandValue(s.hand) }))
    .sort((a, b) => b.val - a.val);

  let result = '';
  let delta = 0;

  if (playerBust) {
    result = `You bust with ${playerVal}.`;
    // Best NPC wins
    if (npcBestVals.length > 0) {
      npcBestVals[0].seat.credits += npcBestVals[0].seat.bet * 2;
    }
  } else {
    const bestNPC = npcBestVals.length > 0 ? npcBestVals[0].val : -1;
    const pot = ts.playerBet + ts.seats.reduce((s, seat) => s + (seat.bet || 0), 0);

    if (playerVal > bestNPC) {
      // Player wins
      delta = pot;
      ts.playerCredits += delta;
      result = playerVal === 30
        ? `PERFECT 30! You win the pot of ${pot}¢!`
        : `You win! ${playerVal} beats the field. +${pot}¢`;
      // NPC losers lose bets (already deducted)
    } else if (playerVal === bestNPC) {
      // Tie: split with all tied NPCs
      const tiedCount = npcBestVals.filter(n => n.val === playerVal).length + 1;
      delta = Math.floor(pot / tiedCount);
      ts.playerCredits += delta;
      result = `Tie at ${playerVal}. Pot split ${tiedCount} ways. +${delta}¢`;
      npcBestVals.filter(n => n.val === playerVal).forEach(n => n.seat.credits += delta);
    } else {
      // NPC wins
      result = `${npcBestVals[0].seat.name} wins with ${bestNPC} over your ${playerVal}.`;
      npcBestVals[0].seat.credits += npcBestVals[0].seat.bet * 2;
    }
  }

  ts.playerStatus = delta > 0 ? 'win' : playerBust ? 'bust' : 'lose';
  ts.message = result;
  addLog(result);
  syncCreditsToState();
  saveGamblerCredits();
  maybeShowGossip();

  if (delta > ts.playerBet && _tableData.onPlayerWinFlag) {
    _state.flags[_tableData.onPlayerWinFlag] = true;
  }

  renderVoidDraw();
}

// ─── VOID SHIFT ───────────────────────────────────────────────────────────────

function activateVoidShift(gameId) {
  const ts = _tableState;
  const hero = _state.roster.find(a => a.id === _state.selectedActorId || a.role === 'player');
  const classId = hero?.classId || '_default';
  const shift = VOID_SHIFTS[classId] || VOID_SHIFTS._default;

  ts.voidShiftUsed = true;
  addLog(`You activate ${shift.label}!`);

  if (shift.id === 'overcharge') {
    // Force random active opponent to discard highest card
    const targets = ts.seats.filter(s => s.status === 'active' && s.hand.length > 0);
    if (!targets.length) { addLog('No valid targets.'); return; }
    const target = targets[Math.floor(Math.random() * targets.length)];
    const highest = target.hand.reduce((best, c, i) => c.value > best.val ? {idx:i, val:c.value} : best, {idx:0, val:-1});
    target.hand.splice(highest.idx, 1);
    const replacement = deal(false);
    if (replacement) target.hand.push(replacement);
    ts.message = `Overcharge! ${target.name} forced to discard their highest card.`;
    addLog(ts.message);

  } else if (shift.id === 'strip_mine') {
    // Peek at two cards from a random opponent
    const targets = ts.seats.filter(s => s.status === 'active' && s.hand.length >= 2);
    if (!targets.length) { addLog('No valid targets.'); return; }
    const target = targets[Math.floor(Math.random() * targets.length)];
    const peeked = target.hand.slice(0, 2);
    ts.voidShiftPeeked = { label: `${target.name}'s cards`, cards: peeked };
    ts.message = `Strip Mine: You peek at ${target.name}'s cards.`;
    addLog(ts.message);

  } else if (shift.id === 'premonition') {
    // See top 3 cards of deck
    const top = ts.deck.slice(-3).reverse();
    ts.voidShiftPeeked = { label: 'Top of deck', cards: top };
    ts.message = 'Premonition: You see the top of the deck.';
    addLog(ts.message);

  } else if (shift.id === 'lucky_draw') {
    // Draw 3, keep 1 — implemented as: show 3 cards, player picks which to add
    const drawn = [deal(true), deal(true), deal(true)].filter(Boolean);
    if (!drawn.length) return;
    // For simplicity: keep the highest (could make interactive later)
    const best = drawn.reduce((b, c) => c.value > b.value ? c : b, drawn[0]);
    ts.playerHand.push(best);
    ts.message = `Lucky Draw: You drew 3 and kept the best (${cardLabel(best)}).`;
    addLog(ts.message);
    // Discard the others back
  }

  if (gameId === 'blackjack') renderBlackjack();
  else renderVoidDraw();
}

// ─── ROUND FLOW ───────────────────────────────────────────────────────────────

function startNextRound() {
  const ts = _tableState;
  // Check if anyone still has credits
  const activePlayers = ts.seats.filter(s => s.credits >= _tableData.minBet);
  if (ts.playerCredits < _tableData.minBet) {
    ts.message = "You're out of credits for this table.";
    showEndScreen(false);
    return;
  }
  if (activePlayers.length === 0) {
    ts.message = "The table has cleaned out. Well played.";
    showEndScreen(true);
    return;
  }
  ts.voidShiftPeeked = null;
  ts.phase = 'bet';
  renderBetPhase();
}

function showEndScreen(playerWon) {
  const ts = _tableState;
  const net = ts.playerCredits - _state.resources.credits;
  _overlay.innerHTML = `
    <div class="vt-container vt-end-screen">
      <div class="vt-end-icon">${playerWon ? '◈' : '◇'}</div>
      <div class="vt-end-title">${playerWon ? 'TABLE CLEARED' : 'TAPPED OUT'}</div>
      <div class="vt-end-result">${playerWon ? 'You emptied the table.' : "Your credits ran dry."}</div>
      <div class="vt-end-net ${net >= 0 ? 'vt-net-win' : 'vt-net-loss'}">
        Net: ${net >= 0 ? '+' : ''}${net}¢
      </div>
      <button class="vt-btn vt-btn-primary" id="vtEndLeaveBtn">Leave Table</button>
    </div>
  `;
  document.getElementById('vtEndLeaveBtn').onclick = () => closeTable();
}

function confirmLeave() {
  const ts = _tableState;
  const net = ts.playerCredits - _state.resources.credits;
  _overlay.innerHTML = `
    <div class="vt-container vt-leave-confirm">
      <div class="vt-leave-title">Leave the table?</div>
      <div class="vt-leave-stats">
        <div>Credits when you sat down: <strong>${_state.resources.credits}¢</strong></div>
        <div>Credits now: <strong>${ts.playerCredits}¢</strong></div>
        <div class="${net >= 0 ? 'vt-net-win' : 'vt-net-loss'}">Net: ${net >= 0 ? '+' : ''}${net}¢</div>
      </div>
      <div class="vt-leave-btns">
        <button class="vt-btn" id="vtStayBtn">Stay</button>
        <button class="vt-btn vt-btn-primary" id="vtConfirmLeaveBtn">Leave</button>
      </div>
    </div>
  `;
  document.getElementById('vtStayBtn').onclick = () => {
    if (_tableState.game) GAME_REGISTRY[_tableState.game]?.renderFn();
    else renderLobby();
  };
  document.getElementById('vtConfirmLeaveBtn').onclick = () => closeTable();
}

function closeTable() {
  syncCreditsToState();
  saveGamblerCredits();
  // Fire any pending gossip dialogue through main game API
  if (_tableData.narrativeNPC && _state.flags[`${_tableData.onPlayerWinFlag}`] && !_state.flags[`${_tableData.onPlayerWinFlag}_talked`]) {
    _state.flags[`${_tableData.onPlayerWinFlag}_talked`] = true;
  }
  if (_overlay) { _overlay.remove(); _overlay = null; }
  _api.renderAll();
}

// ─── NPC AI ───────────────────────────────────────────────────────────────────

function npcBet(seat, table) {
  const min = table.minBet;
  const max = Math.min(table.maxBet, seat.credits);
  const { archetype, _def: g } = seat;
  const aggression = g.aggressionBias ?? archetype_aggressiveness(archetype);
  let bet = min;
  if (archetype === 'shark') {
    bet = min + Math.floor((max - min) * 0.3);
  } else if (archetype === 'reckless') {
    bet = min + Math.floor((max - min) * (0.5 + Math.random() * 0.5));
  } else if (archetype === 'nervous') {
    bet = min + Math.floor((max - min) * 0.1 * Math.random());
  } else if (archetype === 'drunk') {
    bet = min + Math.floor((max - min) * Math.random());
  }
  return Math.max(min, Math.min(bet, max, seat.credits));
}

function npcStatusLabel(seat) {
  const map = { active: 'In', stand: 'Stand', bust: 'Bust', fold: 'Fold', win: 'Win!', lose: 'Loss' };
  return map[seat.status] || seat.status;
}

// ─── GOSSIP ───────────────────────────────────────────────────────────────────

function maybeShowGossip() {
  const ts = _tableState;
  const table = _tableData;
  const pool = table.gossipPool || [];
  if (!pool.length) return;

  // 30% chance to trigger gossip after a resolved hand
  if (Math.random() > 0.3) return;

  // Find a gambler with gossip that hasn't been shown yet
  for (const seat of ts.seats) {
    const g = seat._def;
    const gossip = g.gossipDialogue || {};
    for (const key of pool) {
      if (gossip[key] && !ts.gossipShown.has(key)) {
        ts.gossipShown.add(key);
        showGossipLine(seat.name, gossip[key]);
        return;
      }
    }
  }
}

function showGossipLine(npcName, line) {
  // Show a brief overlay toast with the gossip line
  const toast = document.createElement('div');
  toast.className = 'vt-gossip-toast';
  toast.innerHTML = `<span class="vt-gossip-speaker">${npcName}</span><span class="vt-gossip-line">${line}</span>`;
  _overlay.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 600); }, 4000);
  addLog(`[${npcName}] ${line}`);
}

// ─── CARD RENDERING ───────────────────────────────────────────────────────────

function cardHTML(card, forceBack = false) {
  if (!card) return '<div class="vt-card vt-card-empty"></div>';
  if (!card.faceUp || forceBack) return '<div class="vt-card vt-card-back"><div class="vt-card-back-pattern">◈</div></div>';

  const suit = SUITS.find(s => s.id === card.suit) || SUITS[0];
  const rankClass = card.rank === 'A' ? 'vt-rank-ace' : ['10','J','Q','K'].includes(card.rank) ? 'vt-rank-high' : '';
  return `
    <div class="vt-card vt-card-face ${rankClass}" style="--suit-color:${suit.color}">
      <div class="vt-card-corner vt-card-tl">
        <span class="vt-card-rank">${card.rank}</span>
        <span class="vt-card-suit-sm">${suit.symbol}</span>
      </div>
      <div class="vt-card-center">${suit.symbol}</div>
      <div class="vt-card-corner vt-card-br">
        <span class="vt-card-rank">${card.rank}</span>
        <span class="vt-card-suit-sm">${suit.symbol}</span>
      </div>
    </div>
  `;
}

function cardLabel(card) {
  if (!card) return '?';
  const suit = SUITS.find(s => s.id === card.suit);
  return `${card.rank}${suit?.symbol || ''}`;
}

// ─── UTILS ────────────────────────────────────────────────────────────────────

function addLog(msg) {
  _tableState.log.push(msg);
  if (_tableState.log.length > 20) _tableState.log.shift();
}

function showMessage(msg) {
  _tableState.message = msg;
  const el = document.getElementById('vtMessageBar');
  if (el) el.textContent = msg;
}

function syncCreditsToState() {
  _state.resources.credits = _tableState.playerCredits;
}

function saveGamblerCredits() {
  if (!_state.gamblerCredits) _state.gamblerCredits = {};
  _tableState.seats.forEach(seat => {
    _state.gamblerCredits[seat.gamblerId] = seat.credits;
  });
}

function renderGameHeader(gameName, sub) {
  return `
    <div class="vt-header">
      <div class="vt-header-left">
        <div class="vt-title">${_tableData.name}</div>
        <div class="vt-subtitle">${gameName} — ${sub}</div>
      </div>
      <div class="vt-header-right">
        <div class="vt-credits-display">
          <span class="vt-label">CREDITS</span>
          <span class="vt-credits-val">${_tableState.playerCredits}</span>
        </div>
      </div>
    </div>
  `;
}

// ─── GAMBLER CREDIT RESET (called by engine on long rest / travel) ─────────────

export function resetGamblerCredits(state, data) {
  if (!state.gamblerCredits) return;
  const gamblers = data.gamblers || [];
  const tables   = data.tables || [];
  const allSeats = tables.flatMap(t => t.seats || []);
  allSeats.forEach(s => {
    const g = gamblers.find(x => x.id === s.gamblerId);
    if (g && state.gamblerCredits[s.gamblerId] !== undefined) {
      // Restore up to creditReset amount
      state.gamblerCredits[s.gamblerId] = Math.max(
        state.gamblerCredits[s.gamblerId],
        Math.floor(g.creditReset * 0.7) // restore to at least 70% of starting amount
      );
    }
  });
}

// ─── STYLE INJECTION ──────────────────────────────────────────────────────────

function injectStyles() {
  if (document.getElementById('voidTableStyles')) return;
  const link = document.createElement('link');
  link.id   = 'voidTableStyles';
  link.rel  = 'stylesheet';
  link.href = 'css/CardTable.css';
  document.head.appendChild(link);
}
