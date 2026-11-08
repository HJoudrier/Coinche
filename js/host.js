// Hôte de partie : fait tourner le moteur, pilote les robots et les timers,
// et diffuse à chaque joueur (local ou distant) sa propre vue.
import { createGame, applyAction, getView, addEvent } from './engine.js';
import { chooseBid, chooseCard, heuristicPlay, toCtx } from './ai.js';
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
    this.seats = seats.map((s) => ({ connected: s.kind !== 'remote', ...s }));
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

  isHuman(seat) {
    const s = this.seats[seat];
    return s.kind === 'local' || (s.kind === 'remote' && s.connected);
  }

  setConnected(seat, connected) {
    const s = this.seats[seat];
    if (s.kind !== 'remote' || s.connected === connected) return;
    s.connected = connected;
    addEvent(this.state, seat, 'info', connected ? `${s.name} est de retour` : `${s.name} s'est déconnecté (un robot le remplace)`);
    this.schedule();
    this.broadcast();
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
    v.seatsInfo = this.seats.map((s) => ({
      kind: s.kind === 'robot' ? 'robot' : 'human',
      name: s.name,
      connected: s.kind !== 'remote' || !!s.connected,
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
    const waiting = [0, 1, 2, 3].filter((s) => this.isHuman(s) && !this.ready.has(s));
    if (!waiting.length) {
      this.ready.clear();
      applyAction(this.state, null, { type: 'next' });
      this.lastWasTrick = false;
      this.schedule();
    }
    this.broadcast();
    return { ok: true };
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

  robotAct(seat) {
    if (this.destroyed || this.state.turn !== seat) return;
    const view = getView(this.state, seat);
    const level = this.seats[seat].kind === 'robot' ? this.config.aiLevel : 'medium';
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
      const view = getView(this.state, seat);
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
