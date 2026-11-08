// Table de jeu : rendu de la vue d'un joueur et interactions (enchères, cartes, aides, timers).
import {
  h, clear, cardEl, toast, openModal, suitSpan, append,
} from './dom.js';
import {
  SUIT_SYMBOL, SUIT_NAME, TRUMPS, teamOf, sortHand, cardLabel,
} from '../cards.js';
import { BID_VALUES, bidValueLabel, actionLabel, contractLabel, bidLabel } from '../auction.js';
import { illegalReason } from '../rules.js';
import { bidAdvice, playAdvice } from '../advisor.js';
import { getSettings, onSettingsChange } from '../settings.js';

const REL = ['bottom', 'right', 'top', 'left'];
const TRUMP_ORDER_UI = ['H', 'D', 'C', 'S', 'NT', 'AT'];

export class GameView {
  /**
   * @param {object} o
   * @param {(action) => void} o.send
   * @param {() => void} o.onMenu
   * @param {(view) => void} o.onStats
   * @param {(view) => void} o.onGameOver  appelé une fois à la fin de la partie
   * @param {() => void} o.onReplay
   * @param {() => void} o.onHome
   * @param {boolean} o.canReplay
   */
  constructor(o) {
    this.o = o;
    this.view = null;
    this.selected = null;
    this.pending = false;
    this.bidSel = { value: null, trump: null };
    this.advice = null;
    this.adviceSeq = null;
    this.bidAdv = null;
    this.bidAdvSeq = null;
    this.shownRound = 0;
    this.trickKey = '';
    this.collectedSeq = null;
    this.lastEventId = null;
    this.tempBubbles = [null, null, null, null];
    this.hintOpen = false;
    this.roundModal = null;
    this.gameOverNotified = null;
    this.timerRaf = null;
    this.root = this.build();
    this.unsub = onSettingsChange(() => { this.advice = null; this.bidAdv = null; this.adviceSeq = null; this.bidAdvSeq = null; this.render(); });
  }

  destroy() {
    cancelAnimationFrame(this.timerRaf);
    if (this.unsub) this.unsub();
    if (this.roundModal) this.roundModal.close();
  }

  build() {
    this.scoreEl = h('div', { class: 'score' });
    this.contractEl = h('div', { class: 'contract-chip' });
    const top = h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Menu', onClick: () => this.o.onMenu() }, '☰'),
      this.scoreEl,
      this.contractEl);

    this.seats = REL.map((pos) => {
      const ring = h('i', { class: 'ring' });
      const initial = h('span', { class: 'initial' });
      const avatar = h('div', { class: 'avatar' }, initial, ring);
      const name = h('div', { class: 'name' });
      const badges = h('div', { class: 'badges' });
      const bubble = h('div', { class: 'bubble' });
      const el = h('div', { class: `seat ${pos}` }, avatar, name, badges, bubble);
      return { el, avatar, initial, ring, name, badges, bubble };
    });
    this.trickEl = h('div', { class: 'trick' });
    this.table = h('div', { class: 'table' }, this.trickEl, ...this.seats.map((s) => s.el));

    this.myTimer = h('div', { class: 'mytimer' }, h('i'));
    this.hintEl = h('div', { class: 'hint', onClick: () => { this.hintOpen = !this.hintOpen; this.renderHint(); } });
    this.handEl = h('div', { class: 'hand' });
    this.bidEl = h('div', { class: 'bidpanel' });
    return h('div', { class: 'game' }, top, this.table, this.myTimer, this.hintEl, this.handEl, this.bidEl);
  }

  rel(seat) {
    return (seat - this.view.seat + 4) % 4;
  }

  us() { return teamOf(this.view.seat); }

  update(view) {
    const prev = this.view;
    if (!prev || prev.gameId !== view.gameId) {
      this.shownRound = view.phase === 'roundEnd' || view.phase === 'gameOver' ? (view.roundResult ? view.roundResult.round - 1 : 0) : view.history.length;
      this.lastEventId = view.events.length ? view.events[view.events.length - 1].id : 0;
      this.trickKey = '';
      this.gameOverNotified = null;
      if (this.roundModal) { this.roundModal.close(); this.roundModal = null; }
    }
    if (!prev || prev.phase !== view.phase || prev.round !== view.round) {
      this.bidSel = { value: null, trump: null };
      this.selected = null;
    }
    this.view = view;
    this.pending = false;
    this.receivedAt = performance.now();
    this.handleEvents();
    this.render();
    this.handleRoundEnd();
  }

  handleEvents() {
    const v = this.view;
    for (const ev of v.events) {
      if (ev.id <= this.lastEventId) continue;
      if (ev.kind === 'info' || ev.seat === null || ev.seat === undefined) toast(ev.text);
      else if (ev.kind === 'belote' || ev.kind === 'contract' || ev.kind === 'timeout') {
        const rel = this.rel(ev.seat);
        this.tempBubbles[rel] = { text: ev.kind === 'timeout' ? '⏱ Temps écoulé' : ev.text, until: Date.now() + 2200, kind: ev.kind };
        setTimeout(() => this.renderSeats(), 2300);
      }
    }
    if (v.events.length) this.lastEventId = Math.max(this.lastEventId, v.events[v.events.length - 1].id);
  }

  render() {
    if (!this.view) return;
    this.renderTop();
    this.renderSeats();
    this.renderTrick();
    this.computeAdvice();
    this.renderHand();
    this.renderBid();
    this.renderHint();
    this.renderTimer();
  }

  // ------------------------------------------------------------------ barre du haut
  renderTop() {
    const v = this.view;
    const us = this.us();
    clear(this.scoreEl);
    append(this.scoreEl, [
      h('span', { class: 'sc us' }, h('small', null, 'Nous'), h('b', null, v.scores[us])),
      h('span', { class: 'sc them' }, h('small', null, 'Eux'), h('b', null, v.scores[1 - us])),
      h('span', { class: 'target' }, `/${v.target}`),
    ]);
    clear(this.contractEl);
    const c = v.contract || (v.phase === 'bidding' ? v.auction.current : null);
    if (v.phase === 'bidding' && !c) {
      this.contractEl.append(h('span', { class: 'muted' }, `Manche ${v.round} · enchères`));
    } else if (c) {
      const mult = v.contract ? v.contract.mult : v.auction.mult;
      const team = teamOf(c.seat) === us ? 'us' : 'them';
      append(this.contractEl, [
        h('span', { class: `dot ${team}` }),
        h('b', null, bidValueLabel(c.value), ' ', suitSpan(c.trump)),
        mult > 1 ? h('span', { class: 'mult' }, mult === 4 ? '×4' : '×2') : null,
        h('span', { class: 'who' }, v.names[c.seat]),
      ]);
    }
  }

  // ------------------------------------------------------------------ joueurs
  renderSeats() {
    const v = this.view;
    if (!v) return;
    const lastBid = {};
    if (v.phase === 'bidding') for (const a of v.auction.history) lastBid[a.seat] = a;
    const active = (v.phase === 'bidding' || v.phase === 'playing') ? v.turn : null;
    for (let s = 0; s < 4; s++) {
      const rel = this.rel(s);
      const seat = this.seats[rel];
      const info = v.seatsInfo ? v.seatsInfo[s] : { kind: 'human', connected: true };
      const name = v.names[s] || '';
      const team = teamOf(s) === this.us() ? 'us' : 'them';
      seat.el.className = `seat ${REL[rel]} ${team} ${active === s ? 'active' : ''} ${info.connected ? '' : 'offline'}`;
      seat.initial.textContent = info.kind === 'robot' ? '🤖' : (name.trim()[0] || '?').toUpperCase();
      seat.name.textContent = rel === 0 ? `${name} (vous)` : name;
      clear(seat.badges);
      if (v.dealer === s) seat.badges.append(h('span', { class: 'badge dealer', title: 'Donneur' }, 'D'));
      if (v.contract && v.contract.seat === s) seat.badges.append(h('span', { class: 'badge taker', title: 'Preneur' }, '★'));
      if (v.belote && v.belote.seat === s) seat.badges.append(h('span', { class: 'badge belote', title: 'Belote' }, 'B'));
      if (!info.connected) seat.badges.append(h('span', { class: 'badge off' }, 'hors ligne'));
      if (rel !== 0 && v.phase === 'playing') seat.badges.append(h('span', { class: 'badge count', title: 'Cartes en main' }, `${v.handCounts[s]}🂠`));

      const tb = this.tempBubbles[rel];
      let text = null;
      let cls = '';
      if (tb && tb.until > Date.now()) { text = tb.text; cls = tb.kind; } else this.tempBubbles[rel] = null;
      if (!text && lastBid[s]) {
        text = actionLabel(lastBid[s]);
        cls = lastBid[s].type;
      }
      seat.bubble.className = `bubble ${text ? 'show' : ''} ${cls}`;
      clear(seat.bubble);
      if (text) seat.bubble.append(renderBidText(text));
    }
  }

  // ------------------------------------------------------------------ pli
  renderTrick() {
    const v = this.view;
    let cards = [];
    let collectTo = null;
    let seq = null;
    if (v.trick.length) cards = v.trick;
    else if (v.lastTrick && v.lastTrick.seq === v.seq) {
      cards = v.lastTrick.cards;
      collectTo = v.lastTrick.winner;
      seq = v.lastTrick.seq;
    }
    const key = cards.map((c) => c.card).join(',');
    if (key !== this.trickKey) {
      const existing = new Map();
      for (const el of [...this.trickEl.children]) {
        if (!cards.some((c) => c.card === el.dataset.card) || el.classList.contains('collect')) el.remove();
        else existing.set(el.dataset.card, el);
      }
      for (const { seat, card } of cards) {
        if (existing.has(card)) continue;
        const rel = this.rel(seat);
        const el = cardEl(card, { class: `pos-${rel} enter` });
        this.trickEl.append(el);
      }
      this.trickKey = key;
    }
    if (collectTo !== null && this.collectedSeq !== seq) {
      this.collectedSeq = seq;
      const pause = v.trickPause || 1200;
      const myKey = key;
      setTimeout(() => {
        if (this.trickKey !== myKey) return;
        const rel = this.rel(collectTo);
        for (const el of this.trickEl.children) el.classList.add('collect', `to-${rel}`);
        setTimeout(() => {
          if (this.trickKey !== myKey) return;
          clear(this.trickEl);
          this.trickKey = '';
        }, 450);
      }, Math.max(500, pause - 350));
    }
  }

  // ------------------------------------------------------------------ aides
  computeAdvice() {
    const v = this.view;
    const st = getSettings();
    const myBidTurn = v.phase === 'bidding' && v.options && v.options.pass;
    if (myBidTurn && st.bidHelp > 0) {
      if (this.bidAdvSeq !== v.seq) {
        this.bidAdvSeq = v.seq;
        try { this.bidAdv = bidAdvice(v, st.bidHelp); } catch (e) { console.error(e); this.bidAdv = null; }
      }
    } else {
      this.bidAdv = null;
      this.bidAdvSeq = null;
    }
    const myPlayTurn = v.phase === 'playing' && v.turn === v.seat;
    if (myPlayTurn && st.playHelp >= 2) {
      if (this.adviceSeq !== v.seq) {
        this.adviceSeq = v.seq;
        this.advice = null;
        const seq = v.seq;
        setTimeout(() => {
          if (!this.view || this.view.seq !== seq) return;
          try { this.advice = playAdvice(this.view, getSettings().playHelp); } catch (e) { console.error(e); }
          this.renderHand();
          this.renderHint();
        }, 60);
      }
    } else {
      this.advice = null;
      this.adviceSeq = null;
    }
  }

  renderHint() {
    const v = this.view;
    const el = this.hintEl;
    clear(el);
    const st = getSettings();
    const lines = [];
    const more = [];
    if (this.bidAdv && v.phase === 'bidding') {
      const a = this.bidAdv;
      const stars = h('div', { class: 'stars-row' });
      for (const t of TRUMP_ORDER_UI) {
        const s = a.stars.find((x) => x.trump === t);
        stars.append(h('span', { class: 'st-item', title: `${SUIT_NAME[t]} : ~${s.points} pts` },
          suitSpan(t), h('span', { class: 'stars' }, '★'.repeat(s.stars) || '·')));
      }
      lines.push(stars);
      if (a.label) lines.push(h('div', null, '💡 Conseil : ', h('b', null, renderBidText(a.label))));
      if (a.explanation) lines.push(h('div', { class: 'why' }, a.explanation));
      for (const r of a.reading) more.push(h('div', { class: 'why' }, r));
    } else if (this.advice && v.phase === 'playing' && v.turn === v.seat) {
      lines.push(h('div', null, '💡 ', h('b', null, cardLabel(this.advice.card)), ' — ', this.advice.reason));
      if (this.advice.memory) for (const m of this.advice.memory) more.push(h('div', { class: 'why' }, m));
    } else if (v.phase === 'playing' && v.turn === v.seat && st.playHelp >= 2) {
      lines.push(h('div', { class: 'muted' }, '💡 Analyse…'));
    }
    if (!lines.length) { el.classList.remove('show'); return; }
    el.classList.add('show');
    append(el, lines);
    if (more.length) {
      el.append(h('div', { class: `more ${this.hintOpen ? 'open' : ''}` }, more));
      el.append(h('div', { class: 'toggle' }, this.hintOpen ? '▲ moins' : '▼ plus de détails'));
    }
  }

  // ------------------------------------------------------------------ main
  renderHand() {
    const v = this.view;
    const st = getSettings();
    clear(this.handEl);
    const myTurn = v.phase === 'playing' && v.turn === v.seat;
    const legal = new Set(v.legal);
    const trump = v.contract ? v.contract.trump : null;
    const hand = sortHand(v.hand, trump);
    this.handEl.className = `hand n${hand.length} ${myTurn ? 'myturn' : ''} ${myTurn && st.playHelp >= 1 ? 'show-legal' : ''}`;
    for (const card of hand) {
      const classes = [];
      if (myTurn) classes.push(legal.has(card) ? 'legal' : 'illegal');
      if (this.selected === card) classes.push('selected');
      if (myTurn && this.advice && this.advice.card === card && st.playHelp >= 2) classes.push('advised');
      const el = cardEl(card, { class: classes.join(' '), button: true });
      el.addEventListener('click', () => this.onCardClick(card, el));
      this.handEl.append(el);
    }
  }

  onCardClick(card, el) {
    const v = this.view;
    if (v.phase !== 'playing') return;
    if (v.turn !== v.seat) { toast('Ce n\'est pas encore à vous de jouer'); return; }
    if (this.pending) return;
    if (!v.legal.includes(card)) {
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
      toast(illegalReason(card, v.hand, v.trick, v.contract.trump, v.seat) || 'Carte non autorisée');
      return;
    }
    if (getSettings().confirmPlay && this.selected !== card) {
      this.selected = card;
      this.renderHand();
      return;
    }
    this.pending = true;
    this.selected = null;
    el.classList.add('played');
    this.o.send({ type: 'play', card });
  }

  // ------------------------------------------------------------------ enchères
  renderBid() {
    const v = this.view;
    clear(this.bidEl);
    const o = v.options;
    if (v.phase !== 'bidding' || !o || !o.pass) {
      this.bidEl.classList.remove('show');
      return;
    }
    this.bidEl.classList.add('show');
    const adv = this.bidAdv && this.bidAdv.action;
    const send = (action) => {
      if (this.pending) return;
      this.pending = true;
      this.o.send(action);
    };

    if (v.auction.mult > 1) {
      const c = v.auction.current;
      this.bidEl.append(
        h('div', { class: 'bid-title' }, `${v.names[v.auction.coincheBy]} a coinché ${bidLabel(c.value, c.trump)} !`),
        h('div', { class: 'bid-actions' },
          h('button', { class: `btn ${adv && adv.type === 'pass' ? 'advised' : ''}`, onClick: () => send({ type: 'pass' }) }, 'Passer'),
          o.surcoinche ? h('button', { class: `btn danger ${adv && adv.type === 'surcoinche' ? 'advised' : ''}`, onClick: () => send({ type: 'surcoinche' }) }, 'Surcoinche ×4') : null),
      );
      return;
    }

    if (this.bidSel.value === null || !o.values.includes(this.bidSel.value)) this.bidSel.value = o.minValue;
    const values = h('div', { class: 'bid-values' });
    for (const val of BID_VALUES) {
      const ok = o.values.includes(val);
      const b = h('button', {
        class: `chip ${this.bidSel.value === val ? 'sel' : ''} ${val > 180 ? 'long' : ''} ${adv && adv.type === 'bid' && adv.value === val ? 'advised' : ''}`,
        disabled: !ok,
        onClick: () => { this.bidSel.value = val; this.renderBid(); },
      }, bidValueLabel(val));
      values.append(b);
    }
    const trumps = h('div', { class: 'bid-trumps' });
    for (const t of TRUMP_ORDER_UI) {
      trumps.append(h('button', {
        class: `chip trump ${t === 'H' || t === 'D' ? 'red' : ''} ${this.bidSel.trump === t ? 'sel' : ''} ${adv && adv.type === 'bid' && adv.trump === t ? 'advised' : ''}`,
        title: SUIT_NAME[t],
        'aria-label': SUIT_NAME[t],
        onClick: () => { this.bidSel.trump = t; this.renderBid(); },
      }, SUIT_SYMBOL[t]));
    }
    const canBid = this.bidSel.value !== null && this.bidSel.trump;
    const actions = h('div', { class: 'bid-actions' },
      h('button', { class: `btn ${adv && adv.type === 'pass' ? 'advised' : ''}`, onClick: () => send({ type: 'pass' }) }, 'Passer'),
      o.coinche ? h('button', { class: `btn danger ${adv && adv.type === 'coinche' ? 'advised' : ''}`, onClick: () => send({ type: 'coinche' }) }, 'Coinche') : null,
      h('button', {
        class: 'btn primary grow',
        disabled: !canBid,
        onClick: () => canBid && send({ type: 'bid', value: this.bidSel.value, trump: this.bidSel.trump }),
      }, canBid ? renderBidText(`Annoncer ${bidLabel(this.bidSel.value, this.bidSel.trump)}`) : 'Choisissez un atout'));
    this.bidEl.append(values, h('div', { class: 'bid-row2' }, trumps, actions));
  }

  // ------------------------------------------------------------------ timers
  renderTimer() {
    cancelAnimationFrame(this.timerRaf);
    const v = this.view;
    for (const s of this.seats) s.ring.classList.remove('on', 'low');
    this.myTimer.classList.remove('show', 'low');
    if (!v.timer || v.timer.total <= 0) return;
    const end = this.receivedAt + v.timer.remaining;
    const total = v.timer.total;
    const rel = this.rel(v.timer.seat);
    const target = rel === 0 ? this.myTimer : this.seats[rel].ring;
    target.classList.add(rel === 0 ? 'show' : 'on');
    const tick = () => {
      const p = Math.max(0, Math.min(1, (end - performance.now()) / total));
      target.style.setProperty('--p', p.toFixed(4));
      target.classList.toggle('low', p < 0.25);
      if (p > 0 && this.view === v) this.timerRaf = requestAnimationFrame(tick);
    };
    tick();
  }

  /** L'action envoyée a été refusée (réseau ou règle). */
  actionFailed(message) {
    this.pending = false;
    if (message) toast(message);
    this.render();
  }

  // ------------------------------------------------------------------ fin de manche
  handleRoundEnd() {
    const v = this.view;
    if (v.phase === 'bidding' || v.phase === 'playing') {
      if (this.roundModal) { this.roundModal.close(); this.roundModal = null; }
      return;
    }
    const r = v.roundResult;
    if (!r) return;
    if (r.round > this.shownRound) {
      this.shownRound = r.round;
      const delay = (v.trickPause || 1200) + 250;
      setTimeout(() => this.showRoundModal(), delay);
    } else if (this.roundModal) {
      this.updateRoundModalFooter();
    }
    if (v.phase === 'gameOver' && this.gameOverNotified !== v.gameId) {
      this.gameOverNotified = v.gameId;
      if (this.o.onGameOver) this.o.onGameOver(v);
    }
  }

  showRoundModal() {
    const v = this.view;
    if (!v || !v.roundResult || (v.phase !== 'roundEnd' && v.phase !== 'gameOver')) return;
    if (this.roundModal) this.roundModal.close();
    const content = roundSummaryContent(v.roundResult, v.seat, v.names);
    this.footer = h('div', { class: 'modal-footer' });
    if (v.phase === 'gameOver') {
      const us = this.us();
      const won = v.winner === us;
      content.unshift(h('div', { class: `gameover ${won ? 'won' : 'lost'}` },
        h('div', { class: 'go-title' }, won ? '🏆 Victoire !' : 'Défaite'),
        h('div', { class: 'go-score' }, `Nous ${v.scores[us]} — Eux ${v.scores[1 - us]}`)));
    }
    this.roundModal = openModal([...content, this.footer], { dismissable: false, cls: 'round-modal' });
    this.updateRoundModalFooter();
  }

  updateRoundModalFooter() {
    const v = this.view;
    if (!this.footer) return;
    clear(this.footer);
    const statsBtn = h('button', { class: 'btn', onClick: () => this.o.onStats(this.view) }, '📊 Stats');
    if (v.phase === 'gameOver') {
      append(this.footer, [
        statsBtn,
        this.o.canReplay ? h('button', { class: 'btn primary', onClick: () => { this.roundModal.close(); this.roundModal = null; this.o.onReplay(); } }, 'Rejouer') : null,
        h('button', { class: 'btn', onClick: () => { this.roundModal.close(); this.roundModal = null; this.o.onHome(); } }, 'Accueil'),
      ]);
      return;
    }
    const iAmWaited = (v.waitingFor || []).includes(v.seat);
    const others = (v.waitingFor || []).filter((s) => s !== v.seat).map((s) => v.names[s]);
    append(this.footer, [
      statsBtn,
      iAmWaited
        ? h('button', { class: 'btn primary', onClick: () => this.o.send({ type: 'ready' }) }, 'Manche suivante ▶')
        : h('div', { class: 'waiting' }, others.length ? `En attente de ${others.join(', ')}…` : 'Nouvelle donne…'),
    ]);
  }

  showLastTrick() {
    const v = this.view;
    const t = v && v.lastTrick;
    if (!t) { toast('Aucun pli joué pour l\'instant'); return; }
    const grid = h('div', { class: 'last-trick' });
    for (const { seat, card } of t.cards) {
      grid.append(h('div', { class: `lt-item ${seat === t.winner ? 'win' : ''}` },
        cardEl(card), h('div', { class: 'lt-name' }, v.names[seat], seat === t.winner ? ' ✓' : '')));
    }
    const m = openModal([
      h('h3', null, 'Dernier pli'),
      grid,
      h('p', { class: 'muted center' }, `Remporté par ${v.names[t.winner]} · ${t.points} points`),
      h('button', { class: 'btn', onClick: () => m.close() }, 'Fermer'),
    ]);
  }
}

/** Texte d'enchère avec symboles colorés. */
export function renderBidText(text) {
  const frag = document.createDocumentFragment();
  for (const part of String(text).split(/([♥♦♠♣])/)) {
    if (!part) continue;
    if ('♥♦'.includes(part)) frag.append(h('span', { class: 'suit red' }, part));
    else if ('♠♣'.includes(part)) frag.append(h('span', { class: 'suit' }, part));
    else frag.append(part);
  }
  return frag;
}

/** Contenu du résumé de manche (réutilisé dans les statistiques). */
export function roundSummaryContent(r, mySeat, names) {
  const us = teamOf(mySeat);
  const them = 1 - us;
  const c = r.contract;
  const ours = c.team === us;
  const good = ours ? r.success : !r.success;
  const title = h('div', { class: `round-title ${good ? 'good' : 'bad'}` },
    h('span', null, `Manche ${r.round}`),
    h('span', { class: 'res' }, r.success ? '✓ Contrat réussi' : '✗ Contrat chuté'));
  const line = h('div', { class: 'round-contract' },
    h('b', null, names[c.seat]), ' : ', renderBidText(contractLabel(c)),
    h('div', { class: 'muted small' }, r.reason));
  const row = (label, a, b, cls = '') => h('tr', { class: cls }, h('td', null, label), h('td', null, a), h('td', null, b));
  const table = h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, h('th', null, ''), h('th', { class: 'us' }, 'Nous'), h('th', { class: 'them' }, 'Eux'))),
    h('tbody', null,
      row('Points de cartes', r.cardPoints[us], r.cardPoints[them]),
      row('Belote', r.beloteTeam === us ? 20 : '—', r.beloteTeam === them ? 20 : '—'),
      row('Plis', r.tricksBySeat[us] + r.tricksBySeat[us + 2], r.tricksBySeat[them] + r.tricksBySeat[them + 2]),
      row('Points marqués', `+${r.score[us]}`, `+${r.score[them]}`, 'strong'),
      row('Score total', r.totals[us], r.totals[them], 'total')));
  const tricks = h('div', { class: 'muted small' },
    'Plis : ', [0, 1, 2, 3].map((s) => `${names[s]} ${r.tricksBySeat[s]}`).join(' · '));
  const details = h('details', { class: 'hands' },
    h('summary', null, 'Voir les mains de la donne'),
    [0, 1, 2, 3].map((s) => h('div', { class: 'hand-line' },
      h('span', { class: 'hl-name' }, names[s]),
      h('span', { class: 'hl-cards' }, sortHand(r.hands[s], c.trump).map((x) => renderBidText(cardLabel(x) + ' '))))));
  return [title, line, table, tricks, details];
}
