// Hôte de partie : fait tourner le moteur, pilote les robots et les timers,
// et diffuse à chaque joueur (local ou distant) sa propre vue.
import { createGame, applyAction, getView, addEvent } from './engine.js';
import { chooseCard, heuristicPlay, toCtx } from './ai.js';
import { chooseBid } from './bidding.js';
import { monteCarloAsync } from './mcclient.js';
import { ROBOT_DELAYS } from './settings.js';

export function randomId(n = 10) {
  const chars = 'abcdefghijkmnopqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export class GameHost {
  /**
   * @param {object} o
   * @param {Array<{kind:'local'|'robot'|'remote', name:string, connected?:boolean}>} o.seats
   * @param {{aiLevel, bidTimer, playTimer, targetScore, robotSpeed}} o.config
   */
  constructor({ seats, config, state = null, gameId = null }) {
    // connected : liaison réseau ; away : page cachée ; standIn : un robot joue à sa place (décision des autres joueurs)
    this.seats = seats.map((s) => ({ connected: s.kind !== 'remote', ...s, away: false, standIn: false, awaySince: null }));
    this.config = { ...config };
    this.state = state || createGame({ target: config.targetScore, names: this.seats.map((s) => s.name) });
    this.gameId = gameId || randomId();
    this.listeners = [null, null, null, null];
    this.ready = new Set();
    this.timer = null;
    this.deadline = null;
    this.timerTotal = 0;
    this.lastWasTrick = false;
    this.onChange = null;
    this.destroyed = false;
  }

  attach(seat, fn) {
    this.listeners[seat] = fn;
    if (fn) fn(this.viewFor(seat));
  }

  /**
   * Joueur humain que la table attend. Un joueur absent (page cachée, connexion perdue) reste humain :
   * la table l'attend, sauf si les autres joueurs ont décidé de faire jouer un robot à sa place.
   */
  isHuman(seat) {
    const s = this.seats[seat];
    return s.kind === 'local' || (s.kind === 'remote' && !s.standIn);
  }

  /** 'online' | 'away' (absent : la table l'attend) | 'robot' (remplacé jusqu'à son retour). */
  presenceOf(seat) {
    const s = this.seats[seat];
    if (s.kind === 'robot') return 'online';
    if (s.standIn) return 'robot';
    if (s.away || (s.kind === 'remote' && !s.connected)) return 'away';
    return 'online';
  }

  /** Applique un changement de présence, annonce la transition et relance les robots si besoin. */
  updatePresence(seat, change) {
    const s = this.seats[seat];
    const before = this.presenceOf(seat);
    const wasHuman = this.isHuman(seat);
    change(s);
    // de retour (connecté, page visible) : il reprend sa place
    if (s.standIn && s.connected && !s.away) s.standIn = false;
    const after = this.presenceOf(seat);
    if (after === 'online') s.awaySince = null;
    else if (before === 'online') s.awaySince = Date.now();
    if (before === after) return;
    const text = after === 'away' ? (before === 'robot' ? `${s.name} est de nouveau absent` : `${s.name} est absent`)
      : after === 'robot' ? `Un robot joue pour ${s.name} jusqu'à son retour`
        : before === 'robot' ? `${s.name} reprend sa place` : `${s.name} est de retour`;
    addEvent(this.state, seat, 'presence', text);
    if (wasHuman !== this.isHuman(seat)) {
      if (this.state.phase === 'roundEnd') this.checkReady();
      else this.schedule();
    }
    this.broadcast();
  }

  setConnected(seat, connected) {
    const s = this.seats[seat];
    if (s.kind !== 'remote') return;
    this.updatePresence(seat, (x) => {
      x.connected = connected;
      if (connected) x.away = false; // l'invité précise ensuite si sa page est cachée
    });
  }

  setAway(seat, away) {
    if (this.seats[seat].kind === 'robot') return;
    this.updatePresence(seat, (x) => { x.away = !!away; });
  }

  /** Un joueur présent demande qu'un robot joue pour un joueur absent, jusqu'à son retour. */
  requestStandIn(by, target) {
    if (!Number.isInteger(target) || target < 0 || target > 3) return { ok: false, error: 'Place inconnue' };
    const t = this.seats[target];
    if (by === target) return { ok: false, error: 'Vous ne pouvez pas vous faire remplacer vous-même' };
    if (by >= 0 && (this.seats[by].kind === 'robot' || !this.isHuman(by))) return { ok: false, error: 'Action réservée aux joueurs présents' };
    if (t.kind !== 'remote') return { ok: false, error: 'Seul un joueur en ligne peut être remplacé' };
    const p = this.presenceOf(target);
    if (p === 'robot') return { ok: true };
    if (p !== 'away') return { ok: false, error: `${t.name} est à la table` };
    this.updatePresence(target, (x) => { x.standIn = true; });
    return { ok: true };
  }

  setName(seat, name) {
    this.seats[seat].name = name;
    this.state.names[seat] = name;
  }

  start() {
    this.schedule();
    this.broadcast();
  }

  viewFor(seat) {
    const v = getView(this.state, seat);
    v.gameId = this.gameId;
    const now = Date.now();
    v.seatsInfo = this.seats.map((s, i) => ({
      kind: s.kind === 'robot' ? 'robot' : 'human',
      name: s.name,
      connected: s.kind !== 'remote' || !!s.connected,
      presence: this.presenceOf(i),
      awayMs: s.awaySince !== null && s.awaySince !== undefined ? now - s.awaySince : 0,
      remote: s.kind === 'remote',
    }));
    v.timer = this.deadline && this.state.turn !== null && this.state.turn !== undefined
      ? { remaining: Math.max(0, this.deadline - Date.now()), total: this.timerTotal, seat: this.state.turn }
      : null;
    v.waitingFor = this.state.phase === 'roundEnd'
      ? [0, 1, 2, 3].filter((s) => this.isHuman(s) && !this.ready.has(s))
      : [];
    v.config = { ...this.config };
    v.trickPause = (ROBOT_DELAYS[this.config.robotSpeed] || ROBOT_DELAYS.normal).trick;
    return v;
  }

  broadcast() {
    for (let s = 0; s < 4; s++) {
      const fn = this.listeners[s];
      if (fn) {
        try { fn(this.viewFor(s)); } catch (e) { console.error(e); }
      }
    }
    if (this.onChange) this.onChange(this);
  }

  act(seat, action) {
    if (this.destroyed) return { ok: false, error: 'Partie terminée' };
    if (action.type === 'ready') return this.markReady(seat);
    if (action.type === 'standIn') return this.requestStandIn(seat, action.seat);
    if (this.state.turn !== seat) return { ok: false, error: 'Ce n\'est pas votre tour' };
    const res = applyAction(this.state, seat, action);
    if (res.ok) {
      this.lastWasTrick = !!res.trickDone;
      this.ready.clear();
      this.schedule();
      this.broadcast();
    }
    return res;
  }

  markReady(seat) {
    if (this.state.phase !== 'roundEnd') return { ok: false };
    this.ready.add(seat);
    this.checkReady(true);
    this.broadcast();
    return { ok: true };
  }

  /**
   * Fin de manche : passe à la donne suivante quand tous les joueurs humains sont prêts.
   * `fromReady` : appelé par un joueur prêt (ou l'avance automatique) ; sinon, s'il ne reste
   * aucun humain, l'avance automatique est programmée.
   */
  checkReady(fromReady = false) {
    if (this.state.phase !== 'roundEnd') return;
    const waiting = [0, 1, 2, 3].filter((s) => this.isHuman(s) && !this.ready.has(s));
    if (waiting.length) return;
    if (!fromReady && ![0, 1, 2, 3].some((s) => this.isHuman(s))) { this.schedule(); return; }
    this.ready.clear();
    applyAction(this.state, null, { type: 'next' });
    this.lastWasTrick = false;
    this.schedule();
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deadline = null;
  }

  schedule() {
    this.clearTimer();
    if (this.destroyed) return;
    const st = this.state;
    const delays = ROBOT_DELAYS[this.config.robotSpeed] || ROBOT_DELAYS.normal;
    if (st.phase === 'roundEnd') {
      if (![0, 1, 2, 3].some((s) => this.isHuman(s))) {
        this.timer = setTimeout(() => this.markReady(-1), 3000);
      }
      return;
    }
    if (st.phase !== 'bidding' && st.phase !== 'playing') return;
    const seat = st.turn;
    const extra = this.lastWasTrick ? delays.trick : 0;
    if (!this.isHuman(seat)) {
      // robot difficile : la réflexion (Monte-Carlo, en arrière-plan) commence tout de suite
      if (st.phase === 'playing' && this.levelOf(seat) === 'hard') {
        this.mc = { seq: st.seq, seat, promise: monteCarloAsync(toCtx(this.viewFor(seat)), this.mcOptions()) };
      }
      this.timer = setTimeout(() => this.robotAct(seat), Math.max(delays.act, extra + delays.act * 0.4));
      return;
    }
    const secs = st.phase === 'bidding' ? this.config.bidTimer : this.config.playTimer;
    if (secs > 0) {
      this.timerTotal = secs * 1000 + extra;
      this.deadline = Date.now() + this.timerTotal;
      this.timer = setTimeout(() => this.timeout(seat), this.timerTotal);
    }
  }

  levelOf(seat) {
    return this.seats[seat].kind === 'robot' ? this.config.aiLevel : 'medium';
  }

  mcOptions() {
    return { maxSamples: this.config.mcSamples || 500, budgetMs: 3000 };
  }

  robotAct(seat) {
    if (this.destroyed || this.state.turn !== seat) return;
    const view = this.viewFor(seat);
    const level = this.levelOf(seat);
    if (this.state.phase === 'playing' && level === 'hard') {
      const seq = this.state.seq;
      const mc = this.mc && this.mc.seq === seq && this.mc.seat === seat
        ? this.mc.promise : monteCarloAsync(toCtx(view), this.mcOptions());
      mc.then((res) => {
        if (this.destroyed || this.state.seq !== seq || this.state.turn !== seat) return;
        const r = this.act(seat, { type: 'play', card: res.card });
        if (!r.ok) this.act(seat, { type: 'play', card: getView(this.state, seat).legal[0] });
      });
      return;
    }
    let action;
    try {
      action = this.state.phase === 'bidding'
        ? chooseBid(view, level)
        : { type: 'play', card: chooseCard(view, level) };
    } catch (e) {
      console.error(e);
      action = this.state.phase === 'bidding' ? { type: 'pass' } : { type: 'play', card: view.legal[0] };
    }
    const res = this.act(seat, action);
    if (!res.ok) {
      console.warn('Action robot refusée', action, res.error);
      this.act(seat, this.state.phase === 'bidding' ? { type: 'pass' } : { type: 'play', card: getView(this.state, seat).legal[0] });
    }
  }

  timeout(seat) {
    if (this.destroyed || this.state.turn !== seat) return;
    addEvent(this.state, seat, 'timeout', 'Temps écoulé');
    if (this.state.phase === 'bidding') {
      this.act(seat, { type: 'pass' });
    } else {
      const view = this.viewFor(seat);
      this.act(seat, { type: 'play', card: heuristicPlay(toCtx(view)).card });
    }
  }

  destroy() {
    this.destroyed = true;
    this.clearTimer();
    this.listeners = [null, null, null, null];
  }

  toJSON() {
    return { state: this.state, seats: this.seats, config: this.config, gameId: this.gameId };
  }

  static restore(saved) {
    return new GameHost(saved);
  }
}
