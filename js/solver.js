// Analyse « cartes sur table » d'une manche : min-max booléen avec coupures.
// Question posée : les preneurs peuvent-ils forcer la réussite de leur contrat si chacun
// voit les quatre mains et joue parfaitement ?
import {
  ALL_CARDS, SUITS, suitOf, cardStrength, cardPoints, teamOf, LAST_TRICK_BONUS,
} from './cards.js';
import { trickWinnerSeat, trickPoints } from './rules.js';
import { CAPOT, GENERALE } from './auction.js';
import { heuristicPlay } from './ai.js';
import { replaySteps } from './replay.js';

const IDX = new Map(ALL_CARDS.map((c, i) => [c, i]));
const ABORT = { aborted: true };

/** Ce qu'il faut aux preneurs pour réussir : {mode:'points'|'capot'|'generale', need}. */
export function contractGoal(record) {
  const c = record.contract;
  if (c.value === GENERALE) return { mode: 'generale', need: 0 };
  if (c.value === CAPOT) return { mode: 'capot', need: 0 };
  const belote = record.beloteTeam === c.team ? 20 : 0;
  return { mode: 'points', need: Math.max(82, c.value - belote) };
}

/**
 * Crée un solveur pour une manche (mains de départ, contrat, belote).
 * La table de transposition est partagée entre toutes les positions analysées.
 */
export function createSolver(record, { nodeLimit = 5e6 } = {}) {
  const trump = record.contract.trump;
  const takerTeam = record.contract.team;
  const takerSeat = record.contract.seat;
  const { mode, need } = contractGoal(record);
  const isColor = SUITS.includes(trump);
  const trumpSuit = isColor ? SUITS.indexOf(trump) : -1;

  const suit = new Int8Array(32);
  const str = new Int8Array(32);
  const pts = new Int8Array(32);
  const suitMask = [0, 0, 0, 0];
  const bySuit = [[], [], [], []]; // cartes de chaque couleur, de la plus faible à la plus forte
  ALL_CARDS.forEach((c, i) => {
    suit[i] = SUITS.indexOf(suitOf(c));
    str[i] = cardStrength(c, trump);
    pts[i] = cardPoints(c, trump);
    suitMask[suit[i]] |= (1 << i);
    bySuit[suit[i]].push(i);
  });
  for (const l of bySuit) l.sort((a, b) => str[a] - str[b]);

  // c bat-elle la carte maîtresse `best`, la couleur demandée étant `lead` ?
  const beats = (c, best, lead) => {
    if (isColor) {
      const cT = suit[c] === trumpSuit;
      const bT = suit[best] === trumpSuit;
      if (cT !== bT) return cT;
      if (cT) return str[c] > str[best];
    }
    if (suit[c] !== lead) return false;
    if (suit[best] !== lead) return true;
    return str[c] > str[best];
  };

  // ---- état de la recherche (modifié puis restauré) ----
  const hands = [0, 0, 0, 0];
  const tSeat = [0, 0, 0, 0];
  const tCard = [0, 0, 0, 0];
  let tLen = 0;
  let winSeat = -1;
  let winCard = -1;
  let takerPts = 0;
  let remPts = 0;
  let tricksDone = 0;
  let broken = false; // capot / générale déjà manqué dans la position de départ
  let nodes = 0; // compteur pour la limite (remis à zéro entre deux résolutions)
  let allNodes = 0; // total des positions examinées
  const tt = new Map();

  /** Coups légaux (masque), mêmes règles que legalCards (js/rules.js). */
  function legalMask(seat) {
    const hand = hands[seat];
    if (!tLen) return hand;
    const lead = suit[tCard[0]];
    const follow = hand & suitMask[lead];
    const higher = (m) => {
      let out = 0;
      for (let x = m; x; x &= x - 1) {
        const i = 31 - Math.clz32(x & -x);
        if (str[i] > str[winCard]) out |= (1 << i);
      }
      return out;
    };
    if (trump === 'NT') return follow || hand;
    if (trump === 'AT') {
      if (!follow) return hand;
      return higher(follow) || follow;
    }
    if (lead === trumpSuit) {
      if (!follow) return hand;
      return higher(follow) || follow;
    }
    if (follow) return follow;
    if (winSeat === ((seat + 2) & 3)) return hand; // partenaire maître : libre
    const trumps = hand & suitMask[trumpSuit];
    if (!trumps) return hand;
    if (suit[winCard] === trumpSuit) return higher(trumps) || trumps;
    return trumps;
  }

  /** Coups à essayer, ordonnés ; les cartes équivalentes (voisines, mêmes points) ne sont gardées qu'une fois. */
  function orderedMoves(seat) {
    const legal = legalMask(seat);
    const list = [];
    for (let x = legal; x; x &= x - 1) {
      const i = 31 - Math.clz32(x & -x);
      // équivalence : la carte immédiatement plus forte de la même couleur, dans la même main,
      // avec les mêmes points et sans carte encore en jeu entre les deux
      const order = bySuit[suit[i]];
      const pos = order.indexOf(i);
      let skip = false;
      for (let j = pos + 1; j < order.length; j++) {
        const c = order[j];
        const inHand = hands[seat] & (1 << c);
        if (inHand) { skip = (legal & (1 << c)) !== 0 && pts[c] === pts[i]; break; }
        const elsewhere = (hands[0] | hands[1] | hands[2] | hands[3]) & (1 << c);
        let inTrick = false;
        for (let k = 0; k < tLen; k++) if (tCard[k] === c) inTrick = true;
        if (elsewhere || inTrick) break;
      }
      if (skip) continue;
      let score;
      const lead = tLen ? suit[tCard[0]] : suit[i];
      const wins = !tLen || beats(i, winCard, lead);
      if (wins) score = 100 + pts[i] + str[i];
      else score = -pts[i] - str[i] * 0.1;
      list.push([score, i]);
    }
    list.sort((a, b) => b[0] - a[0]);
    return list.map((x) => x[1]);
  }

  function node(turn) {
    allNodes++;
    if (++nodes > nodeLimit) throw ABORT;
    if (tLen === 0) {
      if (mode === 'points') {
        if (takerPts >= need) return true;
        if (takerPts + remPts + (tricksDone < 8 ? LAST_TRICK_BONUS : 0) < need) return false;
      }
      if (tricksDone === 8) return mode === 'points' ? takerPts >= need : true;
      const key = `${hands[0]},${hands[1]},${hands[2]},${hands[3]},${turn},${takerPts}`;
      const cached = tt.get(key);
      if (cached !== undefined) return cached;
      const r = search(turn);
      tt.set(key, r);
      return r;
    }
    return search(turn);
  }

  function search(turn) {
    const maximizing = teamOf(turn) === takerTeam;
    for (const c of orderedMoves(turn)) {
      const r = playAndEval(turn, c);
      if (maximizing && r) return true;
      if (!maximizing && !r) return false;
    }
    return !maximizing;
  }

  /** Joue c pour `turn`, évalue la suite, puis restaure l'état. */
  function playAndEval(turn, c) {
    const bit = 1 << c;
    const prevWinSeat = winSeat;
    const prevWinCard = winCard;
    hands[turn] &= ~bit;
    remPts -= pts[c];
    tSeat[tLen] = turn;
    tCard[tLen] = c;
    if (tLen === 0 || beats(c, winCard, suit[tCard[0]])) { winSeat = turn; winCard = c; }
    tLen++;
    let r;
    if (tLen < 4) {
      r = node((turn + 1) & 3);
    } else {
      // pli complet
      let p = 0;
      for (let k = 0; k < 4; k++) p += pts[tCard[k]];
      tricksDone++;
      if (tricksDone === 8) p += LAST_TRICK_BONUS;
      const w = winSeat;
      const gain = teamOf(w) === takerTeam ? p : 0;
      const savedCards = tCard.slice();
      const savedSeats = tSeat.slice();
      if ((mode === 'capot' && teamOf(w) !== takerTeam) || (mode === 'generale' && w !== takerSeat)) {
        r = false;
      } else {
        takerPts += gain;
        tLen = 0;
        winSeat = -1;
        winCard = -1;
        r = node(w);
        takerPts -= gain;
      }
      for (let k = 0; k < 4; k++) { tCard[k] = savedCards[k]; tSeat[k] = savedSeats[k]; }
      tLen = 4;
      tricksDone--;
    }
    tLen--;
    winSeat = prevWinSeat;
    winCard = prevWinCard;
    hands[turn] |= bit;
    remPts += pts[c];
    return r;
  }

  /** Place la position « après k cartes de la séquence `steps` ». Renvoie le joueur au trait. */
  function setPosition(steps, k) {
    for (let s = 0; s < 4; s++) {
      hands[s] = 0;
      for (const c of record.hands[s]) hands[s] |= (1 << IDX.get(c));
    }
    remPts = 0;
    for (let s = 0; s < 4; s++) for (const c of record.hands[s]) remPts += pts[IDX.get(c)];
    takerPts = 0;
    tricksDone = 0;
    broken = false;
    tLen = 0;
    winSeat = -1;
    winCard = -1;
    let turn = (record.dealer + 1) % 4;
    for (let i = 0; i < k; i++) {
      const { seat, card } = steps[i];
      const c = IDX.get(card);
      hands[seat] &= ~(1 << c);
      remPts -= pts[c];
      tSeat[tLen] = seat;
      tCard[tLen] = c;
      if (tLen === 0 || beats(c, winCard, suit[tCard[0]])) { winSeat = seat; winCard = c; }
      tLen++;
      turn = (seat + 1) % 4;
      if (tLen === 4) {
        let p = 0;
        for (let j = 0; j < 4; j++) p += pts[tCard[j]];
        tricksDone++;
        if (tricksDone === 8) p += LAST_TRICK_BONUS;
        if (teamOf(winSeat) === takerTeam) takerPts += p;
        if ((mode === 'capot' && teamOf(winSeat) !== takerTeam) || (mode === 'generale' && winSeat !== takerSeat)) broken = true;
        turn = winSeat;
        tLen = 0;
        winSeat = -1;
        winCard = -1;
      }
    }
    return turn;
  }

  /** Les preneurs peuvent-ils forcer la réussite depuis la position après k cartes ? (null si trop long) */
  function takersWinAt(steps, k) {
    const turn = setPosition(steps, k);
    if (broken) return false;
    if (k >= 32) return mode === 'points' ? takerPts >= need : true;
    try {
      return node(turn);
    } catch (e) {
      if (e === ABORT) return null;
      throw e;
    }
  }

  /** Coups légaux au trait après k cartes, avec leur résultat cartes sur table. */
  function movesAt(steps, k) {
    const turn = setPosition(steps, k);
    const out = [];
    const legal = legalMask(turn);
    const saved = { hands: hands.slice(), tSeat: tSeat.slice(), tCard: tCard.slice(), tLen, winSeat, winCard, takerPts, remPts, tricksDone };
    for (let x = legal; x; x &= x - 1) {
      const i = 31 - Math.clz32(x & -x);
      let r;
      try { r = playAndEval(turn, i); } catch (e) { if (e === ABORT) r = null; else throw e; }
      // restaurer exactement (un abandon peut laisser l'état incohérent)
      for (let s = 0; s < 4; s++) { hands[s] = saved.hands[s]; tSeat[s] = saved.tSeat[s]; tCard[s] = saved.tCard[s]; }
      ({ tLen, winSeat, winCard, takerPts, remPts, tricksDone } = saved);
      out.push({ card: ALL_CARDS[i], takersWin: r });
    }
    return { seat: turn, moves: out };
  }

  return {
    takersWinAt,
    movesAt,
    turnAt: (steps, k) => setPosition(steps, k),
    legalAt(steps, k) {
      const turn = setPosition(steps, k);
      const out = [];
      for (let x = legalMask(turn); x; x &= x - 1) out.push(ALL_CARDS[31 - Math.clz32(x & -x)]);
      return { seat: turn, cards: out };
    },
    goal: { mode, need },
    get nodes() { return allNodes; },
    resetNodes() { nodes = 0; },
  };
}

/** Regroupe une suite de cartes jouées en plis (gagnant, points, 10 de der). */
export function stepsToTricks(steps, trump) {
  const tricks = [];
  for (let i = 0; i + 4 <= steps.length; i += 4) {
    const cards = steps.slice(i, i + 4).map(({ seat, card }) => ({ seat, card }));
    const winner = trickWinnerSeat(cards, trump);
    const points = trickPoints(cards, trump) + (tricks.length === 7 ? LAST_TRICK_BONUS : 0);
    tricks.push({ leader: cards[0].seat, cards, winner, points });
  }
  return tricks;
}

/**
 * Analyse d'une manche du point de vue de `mySeat`.
 * Retourne {winnable, lost, undetermined, mistake, line, nodes, ms}.
 *  - winnable : cartes sur table, l'équipe du joueur pouvait obtenir le bon résultat
 *    (réussir son contrat, ou faire chuter celui des adversaires) ;
 *  - mistake : première carte de l'équipe du joueur après laquelle la manche n'était plus gagnable ;
 *  - line : enregistrement de la partie gagnante (cartes réelles jusqu'à l'erreur, puis jeu gagnant).
 */
export function analyzeRound(record, mySeat, { nodeLimit = 5e6 } = {}) {
  const t0 = Date.now();
  const us = teamOf(mySeat);
  const usTakers = record.contract.team === us;
  const good = (takersWin) => (takersWin === null ? null : usTakers ? takersWin : !takersWin);
  const solver = createSolver(record, { nodeLimit });
  const steps = replaySteps(record);
  const startTW = solver.takersWinAt(steps, 0);
  const lost = usTakers ? !record.success : record.success;
  const base = { lost, usTakers, goal: solver.goal, nodes: 0, ms: 0 };
  const finish = (o) => ({ ...base, ...o, nodes: solver.nodes, ms: Date.now() - t0 });
  if (startTW === null) return finish({ undetermined: true });
  const winnable = good(startTW);
  if (!winnable || !lost || steps.length < 32) return finish({ winnable });

  // première carte de notre équipe qui fait basculer la manche
  let k = -1;
  for (let i = 0; i < 32; i++) {
    if (teamOf(steps[i].seat) !== us) continue;
    solver.resetNodes();
    const after = good(solver.takersWinAt(steps, i + 1));
    if (after === null) return finish({ winnable, undetermined: true });
    if (!after) { k = i; break; }
  }
  if (k < 0) return finish({ winnable });
  const at = solver.movesAt(steps, k);
  const alternatives = at.moves.filter((m) => good(m.takersWin)).map((m) => m.card);
  const mistake = {
    step: k, trick: Math.floor(k / 4) + 1, seat: steps[k].seat, card: steps[k].card, alternatives,
  };

  // ligne gagnante : cartes réelles jusqu'à l'erreur, puis notre équipe joue gagnant, les adversaires comme les robots
  const line = steps.slice(0, k).map((s) => ({ seat: s.seat, card: s.card }));
  for (let i = k; i < 32; i++) {
    solver.resetNodes();
    const ours = teamOf(solver.turnAt(line, i)) === us;
    const { seat, moves } = ours ? solver.movesAt(line, i) : { seat: solver.turnAt(line, i), moves: [] };
    const hand = record.hands[seat].filter((c) => !line.some((s) => s.card === c));
    const done = stepsToTricks(line, record.contract.trump);
    const trick = line.slice(done.length * 4).map(({ seat: s, card }) => ({ seat: s, card }));
    const robot = heuristicPlay({ seat, hand, trick, tricks: done, contract: record.contract }).card;
    let card;
    if (teamOf(seat) === us) {
      const winning = moves.filter((m) => good(m.takersWin)).map((m) => m.card);
      card = winning.includes(robot) ? robot : (i === k && alternatives.length ? alternatives[0] : winning[0]);
      if (!card) card = robot; // ne devrait pas arriver (position gagnante)
    } else {
      card = robot;
    }
    line.push({ seat, card });
  }
  const tricks = stepsToTricks(line, record.contract.trump);
  const pts = [0, 0];
  for (const t of tricks) pts[teamOf(t.winner)] += t.points;
  return finish({
    winnable,
    mistake,
    line: { ...record, tricks, cardPoints: pts, startStep: k },
  });
}
