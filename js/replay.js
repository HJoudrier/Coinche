// Rejeu d'une manche terminée : état de la donne après un nombre donné de cartes jouées.
import { teamOf, suitOf, rankOf } from './cards.js';

/** Les 32 cartes jouées dans l'ordre : {trick, pos, seat, card}. */
export function replaySteps(record) {
  const steps = [];
  (record.tricks || []).forEach((t, i) => {
    t.cards.forEach(({ seat, card }, pos) => steps.push({ trick: i, pos, seat, card }));
  });
  return steps;
}

/**
 * État après `step` cartes jouées (0 = début de la manche).
 * Retourne {step, total, trickIndex, trick, complete, winner, trickPoints, cardPoints, tricksWon, hands, last, belote}.
 */
export function replayState(record, step) {
  const steps = replaySteps(record);
  const total = steps.length;
  const k = Math.max(0, Math.min(total, step));
  const hands = record.hands.map((h) => h.slice());
  for (let i = 0; i < k; i++) {
    const { seat, card } = steps[i];
    const idx = hands[seat].indexOf(card);
    if (idx >= 0) hands[seat].splice(idx, 1);
  }
  const cardPoints = [0, 0];
  const tricksWon = [0, 0, 0, 0];
  const done = Math.floor(k / 4);
  for (let i = 0; i < done; i++) {
    const t = record.tricks[i];
    cardPoints[teamOf(t.winner)] += t.points;
    tricksWon[t.winner]++;
  }
  const last = k > 0 ? steps[k - 1] : null;
  const trickIndex = last ? last.trick : 0;
  const trick = last ? steps.slice(trickIndex * 4, k).map(({ seat, card }) => ({ seat, card })) : [];
  const complete = trick.length === 4;
  const t = record.tricks && record.tricks[trickIndex];

  // Belote / rebelote : roi et dame d'atout joués par le détenteur de la belote
  let belote = null;
  const trump = record.contract.trump;
  if (last && record.beloteSeat === last.seat && suitOf(last.card) === trump && ['K', 'Q'].includes(rankOf(last.card))) {
    const played = steps.slice(0, k).filter((s) => s.seat === last.seat && suitOf(s.card) === trump && ['K', 'Q'].includes(rankOf(s.card))).length;
    belote = played === 1 ? 'Belote' : 'Rebelote';
  }

  return {
    step: k,
    total,
    trickIndex,
    trick,
    complete,
    winner: complete && t ? t.winner : null,
    trickPoints: complete && t ? t.points : null,
    cardPoints,
    tricksWon,
    hands,
    last,
    belote,
  };
}
