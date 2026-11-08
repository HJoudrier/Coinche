// Intelligence artificielle : jeu de la carte (3 niveaux) et évaluation des mains.
// Les enchères par conventions sont dans bidding.js.
// L'IA ne voit que la « vue » d'un joueur (sa main + les informations publiques).
import {
  SUITS, ALL_CARDS, SUIT_SYMBOL,
  suitOf, rankOf, cardPoints, cardStrength, teamOf, partnerOf, cardLabel,
} from './cards.js';
import { legalCards, trickWinnerSeat, trickPoints } from './rules.js';
import { scoreRound } from './scoring.js';

export const LEVELS = ['easy', 'medium', 'hard'];
const isColor = (t) => SUITS.includes(t);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const isTrumpCard = (c, trump) => isColor(trump) && suitOf(c) === trump;

// ---------------------------------------------------------------------------
// Connaissance : cartes jouées, cartes inconnues, chicanes observées.
// ctx = {seat, hand, trick, tricks, contract}
// ---------------------------------------------------------------------------
export function analyze(ctx) {
  const { hand, trick, tricks, contract } = ctx;
  const trump = contract.trump;
  const played = new Set();
  const voids = [new Set(), new Set(), new Set(), new Set()];
  const all = tricks.map((t) => t.cards);
  if (trick.length) all.push(trick);
  for (const tc of all) {
    const lead = suitOf(tc[0].card);
    for (let i = 0; i < tc.length; i++) {
      const { seat: s, card } = tc[i];
      played.add(card);
      if (i === 0 || suitOf(card) === lead) continue;
      voids[s].add(lead);
      if (isColor(trump) && lead !== trump && suitOf(card) !== trump) {
        // ne fournit pas et ne coupe pas alors que son partenaire n'était pas maître : plus d'atout
        if (trickWinnerSeat(tc.slice(0, i), trump) !== partnerOf(s)) voids[s].add(trump);
      }
    }
  }
  const handSet = new Set(hand);
  const unknown = ALL_CARDS.filter((c) => !played.has(c) && !handSet.has(c));
  return { trump, played, voids, unknown };
}

function higherUnknown(card, info) {
  const s = suitOf(card);
  const st = cardStrength(card, info.trump);
  return info.unknown.filter((u) => suitOf(u) === s && cardStrength(u, info.trump) > st);
}

export function isMaster(card, info) {
  return higherUnknown(card, info).length === 0;
}

/** Un adversaire jouant après nous peut-il battre `card` (qui serait maîtresse du pli) ? */
function canBeBeaten(card, lead, oppsAfter, info) {
  const { trump, voids, unknown } = info;
  const unknownLead = unknown.filter((u) => suitOf(u) === lead).length;
  const unknownTrumps = isColor(trump) ? unknown.filter((u) => suitOf(u) === trump) : [];
  for (const opp of oppsAfter) {
    const mayFollow = !voids[opp].has(lead) && unknownLead > 0;
    if (mayFollow && suitOf(card) === lead && higherUnknown(card, info).length) return true;
    if (!isColor(trump) || lead === trump) continue;
    const mayCut = !voids[opp].has(trump) && unknownTrumps.length > 0
      && (!mayFollow || unknownLead <= 1);
    if (!mayCut) continue;
    if (suitOf(card) !== trump) return true;
    if (unknownTrumps.some((u) => cardStrength(u, trump) > cardStrength(card, trump))) return true;
  }
  return false;
}

function discardCost(c, info, hand) {
  const { trump } = info;
  let cost = cardPoints(c, trump);
  if (isTrumpCard(c, trump)) cost += 25 + cardStrength(c, trump) * 3;
  else if (isMaster(c, info)) cost += hand.length > 2 ? 12 : 3;
  // 10 non protégé : on préfère s'en débarrasser plutôt que de le voir tomber sous l'as
  if (!isColor(trump) || !isTrumpCard(c, trump)) {
    const sameSuit = hand.filter((x) => suitOf(x) === suitOf(c)).length;
    cost += sameSuit * 0.3; // garder les longueurs, créer des chicanes
  }
  return cost;
}

function minBy(arr, f) {
  let best = arr[0];
  let bv = f(best);
  for (let i = 1; i < arr.length; i++) {
    const v = f(arr[i]);
    if (v < bv) { bv = v; best = arr[i]; }
  }
  return best;
}
const maxBy = (arr, f) => minBy(arr, (x) => -f(x));

// ---------------------------------------------------------------------------
// Jeu heuristique (niveau moyen) — renvoie {card, reason}
// ---------------------------------------------------------------------------
export function heuristicPlay(ctx, info = analyze(ctx)) {
  const { seat, hand, trick, contract } = ctx;
  const trump = contract.trump;
  const legal = legalCards(hand, trick, trump, seat);
  if (legal.length === 1) return { card: legal[0], reason: 'Seule carte jouable.' };
  if (!trick.length) return leadCard(ctx, legal, info);

  const k = trick.length;
  const lead = suitOf(trick[0].card);
  const myTeam = teamOf(seat);
  const after = [];
  for (let j = 1; j <= 3 - k; j++) after.push((seat + j) % 4);
  const oppsAfter = after.filter((s) => teamOf(s) !== myTeam);
  const winSeat = trickWinnerSeat(trick, trump);
  const winCard = trick.find((t) => t.seat === winSeat).card;
  const pts = trickPoints(trick, trump);
  const wins = (c) => trickWinnerSeat([...trick, { seat, card: c }], trump) === seat;

  if (winSeat === partnerOf(seat)) {
    const safe = !canBeBeaten(winCard, lead, oppsAfter, info);
    if (safe) {
      const nonTrump = legal.filter((c) => !isTrumpCard(c, trump));
      const pool = nonTrump.length ? nonTrump : legal;
      const card = maxBy(pool, (c) => {
        let v = cardPoints(c, trump);
        if (isTrumpCard(c, trump)) v -= 30 + cardStrength(c, trump);
        else if (isMaster(c, info) && hand.length > 2) v -= rankOf(c) === 'T' ? 2 : 14;
        return v;
      });
      return {
        card,
        reason: cardPoints(card, trump) >= 10
          ? 'Votre partenaire est maître : chargez le pli en points.'
          : 'Votre partenaire est maître : jouez une petite carte.',
      };
    }
    const safeWin = legal.filter((c) => wins(c) && !canBeBeaten(c, lead, oppsAfter, info)
      && !isTrumpCard(c, trump));
    if (safeWin.length && pts >= 10) {
      return { card: minBy(safeWin, (c) => cardStrength(c, trump)), reason: 'Assurez le pli avec une carte maîtresse.' };
    }
    return { card: minBy(legal, (c) => discardCost(c, info, hand)), reason: 'Le pli est incertain : ne chargez pas.' };
  }

  // Un adversaire est maître du pli
  const winners = legal.filter(wins);
  const safe = winners.filter((c) => !canBeBeaten(c, lead, oppsAfter, info));
  if (safe.length) {
    const nonTrump = safe.filter((c) => !isTrumpCard(c, trump));
    let card;
    if (nonTrump.length) {
      card = k === 3 ? maxBy(nonTrump, (c) => cardPoints(c, trump) * 10 - cardStrength(c, trump))
        : minBy(nonTrump, (c) => cardStrength(c, trump));
    } else {
      card = minBy(safe, (c) => cardStrength(c, trump));
    }
    const cut = isTrumpCard(card, trump) && lead !== trump;
    return {
      card,
      reason: cut ? 'Coupez avec le plus petit atout suffisant.' : 'Vous pouvez remporter ce pli à coup sûr.',
    };
  }
  if (winners.length) {
    const trumpWinners = winners.filter((c) => isTrumpCard(c, trump));
    if (trumpWinners.length && lead !== trump && (pts >= 4 || k >= 2)) {
      return { card: minBy(trumpWinners, (c) => cardStrength(c, trump)), reason: 'Coupez pour prendre la main.' };
    }
    if (k === 2 || pts >= 10) {
      const card = maxBy(winners, (c) => cardStrength(c, trump) - (isTrumpCard(c, trump) ? 20 : 0));
      return { card, reason: 'Tentez de prendre le pli.' };
    }
  }
  return {
    card: minBy(legal, (c) => discardCost(c, info, hand)),
    reason: winners.length ? 'Laissez passer : jouez petit.' : 'Vous ne pouvez pas prendre : défaussez une petite carte.',
  };
}

function leadCard(ctx, legal, info) {
  const { seat, hand, contract } = ctx;
  const trump = contract.trump;
  const myTeam = teamOf(seat);
  const takerTeam = contract.team === myTeam;
  const opps = [(seat + 1) % 4, (seat + 3) % 4];
  const partner = partnerOf(seat);

  if (isColor(trump)) {
    const myTrumps = hand.filter((c) => suitOf(c) === trump);
    const unknownTrumps = info.unknown.filter((c) => suitOf(c) === trump);
    const oppsMayHaveTrump = unknownTrumps.length > 0 && opps.some((o) => !info.voids[o].has(trump));
    if (takerTeam && myTrumps.length && oppsMayHaveTrump) {
      const masters = myTrumps.filter((c) => isMaster(c, info));
      if (masters.length) {
        return { card: maxBy(masters, (c) => cardStrength(c, trump)), reason: 'Faites tomber les atouts adverses avec votre atout maître.' };
      }
      if (contract.seat === seat && myTrumps.length >= 3) {
        return { card: minBy(myTrumps, (c) => cardStrength(c, trump)), reason: 'Preneur : rejouez atout pour épuiser ceux des adversaires.' };
      }
      if (contract.seat === partner && ctx.tricks.length === 0) {
        return { card: minBy(myTrumps, (c) => cardStrength(c, trump)), reason: 'Rejouez atout pour votre partenaire preneur.' };
      }
    }
    // cartes maîtresses hors atout qui ne risquent pas d'être coupées
    const sideMasters = hand.filter((c) => suitOf(c) !== trump && isMaster(c, info)
      && !(unknownTrumps.length && opps.some((o) => info.voids[o].has(suitOf(c)) && !info.voids[o].has(trump))));
    if (sideMasters.length) {
      return { card: maxBy(sideMasters, (c) => cardPoints(c, trump)), reason: 'Jouez votre carte maîtresse.' };
    }
    // faire couper le partenaire
    const partnerCuts = !info.voids[partner].has(trump) && unknownTrumps.length > 0;
    if (partnerCuts) {
      const forPartner = hand.filter((c) => suitOf(c) !== trump && info.voids[partner].has(suitOf(c)));
      if (forPartner.length) {
        return { card: minBy(forPartner, (c) => cardPoints(c, trump)), reason: 'Votre partenaire n\'a plus cette couleur : faites-le couper.' };
      }
    }
    const side = hand.filter((c) => suitOf(c) !== trump);
    if (side.length) {
      const card = minBy(side, (c) => {
        let v = cardPoints(c, trump);
        const s = suitOf(c);
        const aceOut = info.unknown.includes('A' + s);
        if (aceOut && hand.includes('T' + s)) v += 12; // ne pas exposer un 10 non protégé
        if (!takerTeam && opps.some((o) => info.voids[o].has(s) && !info.voids[o].has(trump))) v += 15;
        return v;
      });
      return { card, reason: 'Ouvrez avec une petite carte pour ne pas donner de points.' };
    }
    return { card: minBy(legal, (c) => cardStrength(c, trump)), reason: 'Il ne vous reste que des atouts.' };
  }

  // Sans atout / tout atout : jouer les maîtresses, sinon une petite carte de la couleur la plus longue
  const masters = hand.filter((c) => isMaster(c, info));
  if (masters.length) {
    return { card: maxBy(masters, (c) => cardPoints(c, trump)), reason: 'Encaissez vos cartes maîtresses.' };
  }
  const len = (s) => hand.filter((c) => suitOf(c) === s).length;
  const card = minBy(hand, (c) => cardPoints(c, trump) * 2 - len(suitOf(c)));
  return { card, reason: 'Ouvrez petit dans votre couleur longue.' };
}

// ---------------------------------------------------------------------------
// Monte-Carlo (niveau difficile)
// ---------------------------------------------------------------------------
function sampleHands(ctx, info, rand) {
  const others = [0, 1, 2, 3].filter((s) => s !== ctx.seat);
  const need = {};
  for (const s of others) need[s] = ctx.handCounts[s];
  const forced = {};
  if (ctx.belote && ctx.belote.played === 1 && ctx.belote.seat !== ctx.seat) {
    const tr = ctx.contract.trump;
    for (const c of ['K' + tr, 'Q' + tr]) if (info.unknown.includes(c)) forced[c] = ctx.belote.seat;
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    const hands = { [others[0]]: [], [others[1]]: [], [others[2]]: [] };
    const cap = { ...need };
    let ok = true;
    const cards = info.unknown.slice();
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    const eligible = (c) => (forced[c] !== undefined ? [forced[c]]
      : others.filter((s) => attempt < 25 ? !info.voids[s].has(suitOf(c)) : true));
    cards.sort((a, b) => eligible(a).length - eligible(b).length);
    for (const c of cards) {
      const el = eligible(c).filter((s) => cap[s] > 0);
      if (!el.length) { ok = false; break; }
      let total = 0;
      for (const s of el) total += cap[s];
      let r = rand() * total;
      let pick = el[el.length - 1];
      for (const s of el) { r -= cap[s]; if (r < 0) { pick = s; break; } }
      hands[pick].push(c);
      cap[pick]--;
    }
    if (ok) {
      const res = [];
      for (let s = 0; s < 4; s++) res[s] = s === ctx.seat ? ctx.hand.slice() : hands[s];
      return res;
    }
  }
  return null;
}

function beloteTeamFor(ctx, hands, played) {
  const tr = ctx.contract.trump;
  if (!isColor(tr)) return null;
  if (ctx.belote) return teamOf(ctx.belote.seat);
  const K = 'K' + tr;
  const Q = 'Q' + tr;
  if (played.has(K) || played.has(Q)) return null; // déjà joué sans annonce : pas de belote
  for (let s = 0; s < 4; s++) if (hands[s].includes(K) && hands[s].includes(Q)) return teamOf(s);
  return null;
}

/** Joue la manche jusqu'au bout avec la politique heuristique. Renvoie l'écart de score pour `forTeam`. */
export function rollout(ctx, hands, firstCard, forTeam, beloteTeam) {
  const { contract } = ctx;
  const trump = contract.trump;
  const h = hands.map((x) => x.slice());
  let trick = ctx.trick.slice();
  const tricks = ctx.tricks.slice();
  const cardPts = [0, 0];
  const tricksBySeat = [0, 0, 0, 0];
  for (const t of tricks) { cardPts[teamOf(t.winner)] += t.points; tricksBySeat[t.winner]++; }
  let turn = ctx.seat;
  let card = firstCard;
  for (;;) {
    h[turn].splice(h[turn].indexOf(card), 1);
    trick.push({ seat: turn, card });
    if (trick.length === 4) {
      const w = trickWinnerSeat(trick, trump);
      const last = tricks.length === 7;
      const pts = trickPoints(trick, trump) + (last ? 10 : 0);
      cardPts[teamOf(w)] += pts;
      tricksBySeat[w]++;
      tricks.push({ leader: trick[0].seat, cards: trick, winner: w, points: pts });
      trick = [];
      if (last) break;
      turn = w;
    } else {
      turn = (turn + 1) % 4;
    }
    card = heuristicPlay({ seat: turn, hand: h[turn], trick, tricks, contract }).card;
  }
  const res = scoreRound({ contract, cardPoints: cardPts, tricksBySeat, beloteTeam });
  return res.score[forTeam] - res.score[1 - forTeam];
}

export function monteCarloPlay(ctx, { budgetMs = 140, maxSamples = 60, rand = Math.random } = {}) {
  const info = analyze(ctx);
  const legal = legalCards(ctx.hand, ctx.trick, ctx.contract.trump, ctx.seat);
  const base = heuristicPlay(ctx, info);
  if (legal.length === 1) return base;
  const totals = new Map(legal.map((c) => [c, 0]));
  const start = now();
  let n = 0;
  const myTeam = teamOf(ctx.seat);
  while (n < maxSamples && (n < 6 || now() - start < budgetMs)) {
    const hands = sampleHands(ctx, info, rand);
    if (!hands) break;
    const bt = beloteTeamFor(ctx, hands, info.played);
    for (const c of legal) totals.set(c, totals.get(c) + rollout(ctx, hands, c, myTeam, bt));
    n++;
  }
  if (!n) return base;
  let best = base.card;
  let bv = totals.get(base.card) + 1e-6 * n; // à égalité, garder le choix heuristique
  for (const [c, v] of totals) if (v > bv) { bv = v; best = c; }
  return {
    card: best,
    reason: best === base.card ? base.reason
      : `Après ${n} simulations de la donne, ${cardLabel(best)} est la carte qui rapporte le plus en moyenne.`,
    samples: n,
  };
}

/** Choix de la carte selon le niveau. view = vue du moteur (ou ctx équivalent). */
export function chooseCard(view, level = 'medium', rand = Math.random, opts = {}) {
  const ctx = toCtx(view);
  const legal = legalCards(ctx.hand, ctx.trick, ctx.contract.trump, ctx.seat);
  if (legal.length === 1) return legal[0];
  if (level === 'easy') {
    if (rand() < 0.55) return legal[Math.floor(rand() * legal.length)];
    return heuristicPlay(ctx).card;
  }
  if (level === 'hard') return monteCarloPlay(ctx, { rand, ...opts }).card;
  return heuristicPlay(ctx).card;
}

export function toCtx(view) {
  return {
    seat: view.seat,
    hand: view.hand,
    trick: view.trick,
    tricks: view.tricks,
    contract: view.contract,
    belote: view.belote,
    handCounts: view.handCounts,
  };
}

// ---------------------------------------------------------------------------
// Évaluation des mains et enchères
// ---------------------------------------------------------------------------

/** Estime les points que l'équipe peut réaliser avec cet atout (partenaire moyen). */
export function evaluateHand(hand, trump) {
  const notes = [];
  const bySuit = {};
  for (const s of SUITS) bySuit[s] = hand.filter((c) => suitOf(c) === s);
  const has = (r, s) => hand.includes(r + s);
  let e = 38; // valeur de référence (apport moyen du partenaire)
  let belote = false;
  let sureTricks = 0;

  if (isColor(trump)) {
    const n = bySuit[trump].length;
    if (has('J', trump)) { e += 25; notes.push(`valet ${SUIT_SYMBOL[trump]}`); } else e -= 8;
    if (has('9', trump)) {
      e += has('J', trump) ? 16 : n >= 3 ? 12 : 6;
      notes.push(`9 ${SUIT_SYMBOL[trump]}`);
    }
    if (has('A', trump)) e += 10;
    if (has('T', trump)) e += 7;
    for (const r of ['K', 'Q', '8', '7']) if (has(r, trump)) e += 3;
    if (n >= 4) e += (n - 3) * 10;
    if (n <= 1) e -= 30;
    else if (n === 2 && !has('J', trump)) e -= 10;
    if (n >= 3) notes.push(`${n} atouts`);
    belote = has('K', trump) && has('Q', trump);
    if (belote) notes.push('belote');
    let aces = 0;
    for (const s of SUITS) {
      if (s === trump) continue;
      const len = bySuit[s].length;
      if (has('A', s)) {
        e += 12; aces++;
        if (has('T', s)) e += 9;
      } else if (has('T', s) && len >= 2) e += 3;
      if (len === 0 && n >= 3) e += 8;
      else if (len === 1 && !has('A', s) && n >= 3) e += 4;
    }
    if (aces) notes.push(`${aces} as extérieur${aces > 1 ? 's' : ''}`);
    // levées sûres (pour le capot)
    const order = ['J', '9', 'A', 'T', 'K', 'Q', '8', '7'];
    let top = 0;
    for (const r of order) { if (has(r, trump)) top++; else break; }
    sureTricks = top >= 3 ? n : top;
    for (const s of SUITS) {
      if (s === trump) continue;
      const seq = ['A', 'T', 'K', 'Q'];
      for (const r of seq) { if (has(r, s)) sureTricks++; else break; }
    }
  } else if (trump === 'NT') {
    let aces = 0;
    for (const s of SUITS) {
      const len = bySuit[s].length;
      if (has('A', s)) {
        e += 19; aces++;
        if (has('T', s)) e += 12;
        if (has('T', s) && has('K', s)) e += 5;
        if (len >= 4) e += (len - 3) * 6;
      } else if (has('T', s) && has('K', s)) e += 2;
      else e -= 8;
    }
    if (aces) notes.push(`${aces} as`);
    for (const s of SUITS) {
      for (const r of ['A', 'T', 'K', 'Q']) { if (has(r, s)) sureTricks++; else break; }
    }
  } else {
    let jacks = 0;
    for (const s of SUITS) {
      if (has('J', s)) {
        e += 22; jacks++;
        if (has('9', s)) e += 12;
        if (has('9', s) && has('A', s)) e += 5;
      } else {
        if (has('9', s)) e += bySuit[s].length >= 3 ? 6 : 2;
        e -= 6;
      }
    }
    if (jacks) notes.push(`${jacks} valet${jacks > 1 ? 's' : ''}`);
    for (const s of SUITS) {
      for (const r of ['J', '9', 'A', 'T']) { if (has(r, s)) sureTricks++; else break; }
    }
  }
  // Calibrage (simulations) : convertit l'évaluation brute en points d'équipe espérés.
  const [a, b] = CALIBRATION[isColor(trump) ? 'color' : trump];
  return { points: Math.round(a + b * e), raw: e, belote, notes, sureTricks };
}

// points espérés ≈ a + b × évaluation brute (régression sur des parties simulées)
const CALIBRATION = { color: [51.3, 0.595], NT: [62.4, 0.493], AT: [55.6, 0.554] };

/**
 * Force défensive contre un contrat adverse (calibrée sur des parties simulées) :
 * la longueur d'atout et la possession du valet / du 9 sont les meilleurs indicateurs de chute.
 * Renvoie un score ; coincher à partir de ~5 (contrat couleur).
 */
export function defenseScore(hand, trump, value = 80) {
  const has = (r, s) => hand.includes(r + s);
  let sc = 0;
  if (isColor(trump)) {
    const n = hand.filter((c) => suitOf(c) === trump).length;
    sc = n + (has('J', trump) ? 1.5 : 0) + (has('9', trump) ? 1.2 : 0);
    for (const s of SUITS) if (s !== trump && has('A', s)) sc += 0.5;
  } else if (trump === 'NT') {
    for (const s of SUITS) if (has('A', s)) sc += 1.4 + (has('T', s) ? 0.6 : 0);
  } else {
    for (const s of SUITS) if (has('J', s)) sc += 1.6 + (has('9', s) ? 0.6 : 0);
  }
  if (value >= 120) sc += 0.5;
  if (value >= 140) sc += 0.5;
  return sc;
}

export function estimateStars(points) {
  if (points < 80) return 0;
  if (points < 90) return 1;
  if (points < 100) return 2;
  if (points < 110) return 3;
  if (points < 125) return 4;
  return 5;
}

