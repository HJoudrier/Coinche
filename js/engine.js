// Moteur de partie : machine à états pure et sérialisable (JSON).
import {
  newDeck, shuffle, nextRandom, teamOf, nextSeat, sortHand, LAST_TRICK_BONUS,
} from './cards.js';
import {
  legalCards, trickWinnerSeat, trickPoints, hasBelote, isBeloteCard,
} from './rules.js';
import {
  newAuction, applyAuction, auctionOptions, auctionResult, actionLabel, contractLabel,
} from './auction.js';
import { scoreRound, gameWinner } from './scoring.js';

export const DEFAULT_NAMES = ['Sud', 'Est', 'Nord', 'Ouest'];

export function createGame({ seed, target = 1000, dealer, names } = {}) {
  const state = {
    v: 1,
    rng: (seed ?? Math.floor(Math.random() * 2 ** 31)) | 0,
    target,
    names: (names || DEFAULT_NAMES).slice(),
    scores: [0, 0],
    history: [],
    seq: 0,
    events: [],
    redeals: 0,
    winner: null,
  };
  state.dealer = dealer ?? Math.floor(nextRandom(state) * 4);
  startDeal(state);
  return state;
}

function pushEvent(state, seat, kind, text) {
  state.eventId = (state.eventId || 0) + 1;
  state.events.push({ id: state.eventId, seq: state.seq, seat, kind, text });
  if (state.events.length > 30) state.events.splice(0, state.events.length - 30);
}

function startDeal(state) {
  const deck = shuffle(newDeck(), () => nextRandom(state));
  state.hands = [0, 1, 2, 3].map((i) => sortHand(deck.slice(i * 8, i * 8 + 8)));
  state.initialHands = state.hands.map((h) => h.slice());
  state.auction = newAuction(state.dealer);
  state.contract = null;
  state.trick = [];
  state.tricks = [];
  state.lastTrick = null;
  state.belote = null;
  state.cardPoints = [0, 0];
  state.tricksBySeat = [0, 0, 0, 0];
  state.roundResult = null;
  state.phase = 'bidding';
  state.turn = state.auction.turn;
}

/** Ajoute un message public (ex. « temps écoulé »). */
export function addEvent(state, seat, kind, text) {
  pushEvent(state, seat, kind, text);
}

/** Actions légales (pour validation et IA). */
export function legalActionsFor(state, seat) {
  if (state.phase === 'bidding') return auctionOptions(state.auction, seat);
  if (state.phase === 'playing' && state.turn === seat) {
    return legalCards(state.hands[seat], state.trick, state.contract.trump, seat);
  }
  return null;
}

/**
 * Applique une action. Retourne {ok:true} ou {ok:false, error}.
 * Actions : {type:'bid', value, trump} | {type:'pass'} | {type:'coinche'} | {type:'surcoinche'}
 *           {type:'play', card} | {type:'next'} (manche suivante)
 */
export function applyAction(state, seat, action) {
  try {
    if (state.phase === 'bidding') return doBid(state, seat, action);
    if (state.phase === 'playing') return doPlay(state, seat, action);
    if (state.phase === 'roundEnd' && action.type === 'next') {
      state.dealer = nextSeat(state.dealer);
      state.seq++;
      startDeal(state);
      return { ok: true };
    }
    return { ok: false, error: 'Action impossible maintenant' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function doBid(state, seat, action) {
  if (state.auction.turn !== seat) return { ok: false, error: 'Ce n\'est pas votre tour' };
  applyAuction(state.auction, seat, action);
  state.seq++;
  pushEvent(state, seat, 'bid', actionLabel(action));
  if (!state.auction.finished) {
    state.turn = state.auction.turn;
    return { ok: true };
  }
  const contract = auctionResult(state.auction);
  if (!contract) {
    pushEvent(state, null, 'info', 'Tout le monde passe : nouvelle donne');
    state.redeals++;
    state.dealer = nextSeat(state.dealer);
    state.lastRedeal = state.seq;
    startDeal(state);
    return { ok: true, redeal: true };
  }
  state.contract = contract;
  pushEvent(state, contract.seat, 'contract', contractLabel(contract));
  const holder = [0, 1, 2, 3].find((s) => hasBelote(state.hands[s], contract.trump));
  state.belote = holder === undefined ? null : { seat: holder, played: 0 };
  state.hands = state.hands.map((h) => sortHand(h, contract.trump));
  state.phase = 'playing';
  state.turn = nextSeat(state.dealer);
  return { ok: true };
}

function doPlay(state, seat, action) {
  if (action.type !== 'play') return { ok: false, error: 'Action impossible maintenant' };
  if (state.turn !== seat) return { ok: false, error: 'Ce n\'est pas votre tour' };
  const { card } = action;
  const hand = state.hands[seat];
  const trump = state.contract.trump;
  if (!hand.includes(card)) return { ok: false, error: 'Carte absente de la main' };
  if (!legalCards(hand, state.trick, trump, seat).includes(card)) {
    return { ok: false, error: 'Carte non autorisée' };
  }
  hand.splice(hand.indexOf(card), 1);
  state.trick.push({ seat, card });
  state.seq++;

  if (state.belote && state.belote.seat === seat && isBeloteCard(card, trump)) {
    state.belote.played++;
    pushEvent(state, seat, 'belote', state.belote.played === 1 ? 'Belote' : 'Rebelote');
  }

  if (state.trick.length < 4) {
    state.turn = nextSeat(seat);
    return { ok: true };
  }

  // Pli complet
  const winner = trickWinnerSeat(state.trick, trump);
  const isLast = state.tricks.length === 7;
  const points = trickPoints(state.trick, trump) + (isLast ? LAST_TRICK_BONUS : 0);
  const done = { leader: state.trick[0].seat, cards: state.trick, winner, points, seq: state.seq };
  state.tricks.push(done);
  state.lastTrick = done;
  state.cardPoints[teamOf(winner)] += points;
  state.tricksBySeat[winner]++;
  state.trick = [];
  state.turn = winner;
  if (isLast) endRound(state);
  return { ok: true, trickDone: true };
}

function endRound(state) {
  const beloteTeam = state.belote ? teamOf(state.belote.seat) : null;
  const res = scoreRound({
    contract: state.contract,
    cardPoints: state.cardPoints,
    tricksBySeat: state.tricksBySeat,
    beloteTeam,
  });
  state.scores = [state.scores[0] + res.score[0], state.scores[1] + res.score[1]];
  const record = {
    round: state.history.length + 1,
    dealer: state.dealer,
    contract: { ...state.contract },
    auction: state.auction.history.slice(),
    cardPoints: state.cardPoints.slice(),
    tricksBySeat: state.tricksBySeat.slice(),
    beloteSeat: state.belote ? state.belote.seat : null,
    beloteTeam,
    success: res.success,
    reason: res.reason,
    score: res.score,
    capot: res.capot,
    generale: res.generale,
    totals: state.scores.slice(),
    hands: state.initialHands,
    redealsBefore: state.redeals,
  };
  state.redeals = 0;
  state.history.push(record);
  state.roundResult = record;
  state.winner = gameWinner(state.scores, state.target);
  state.phase = state.winner === null ? 'roundEnd' : 'gameOver';
  state.turn = null;
}

/** Vue d'un joueur : masque les mains des autres et les informations privées. */
export function getView(state, seat) {
  const a = state.auction;
  const playing = state.phase === 'playing';
  return {
    seat,
    phase: state.phase,
    names: state.names,
    scores: state.scores,
    target: state.target,
    dealer: state.dealer,
    round: state.history.length + (state.phase === 'roundEnd' || state.phase === 'gameOver' ? 0 : 1),
    turn: state.turn,
    hand: seat === null || seat === undefined ? [] : state.hands[seat].slice(),
    handCounts: state.hands.map((h) => h.length),
    auction: {
      history: a.history,
      current: a.current,
      mult: a.mult,
      coincheBy: a.coincheBy,
      surcoincheBy: a.surcoincheBy,
    },
    options: state.phase === 'bidding' && seat !== null ? auctionOptions(a, seat) : null,
    contract: state.contract,
    trick: state.trick,
    tricks: state.tricks,
    lastTrick: state.lastTrick,
    cardPoints: state.cardPoints,
    tricksBySeat: state.tricksBySeat,
    belote: state.belote && state.belote.played > 0 ? { ...state.belote } : null,
    legal: playing && state.turn === seat ? legalCards(state.hands[seat], state.trick, state.contract.trump, seat) : [],
    roundResult: state.roundResult,
    history: state.history,
    winner: state.winner,
    seq: state.seq,
    lastRedeal: state.lastRedeal ?? null,
    events: state.events.slice(-8),
  };
}

export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}
