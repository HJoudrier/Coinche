// Décompte d'une manche (« contrat + points faits »).
import { CAPOT, GENERALE } from './auction.js';

export const MIN_POINTS = 82; // toujours au moins 82 points de cartes (belote non comptée)
export const BELOTE_POINTS = 20;
export const CAPOT_POINTS = 250; // points faits lors d'un capot non annoncé

/**
 * @param {object} p
 * @param {object} p.contract  {seat, team, value, trump, mult}
 * @param {number[]} p.cardPoints   points de cartes (10 de der inclus) par équipe
 * @param {number[]} p.tricksBySeat nombre de plis par joueur
 * @param {number|null} p.beloteTeam équipe détenant la belote
 */
export function scoreRound({ contract, cardPoints, tricksBySeat, beloteTeam }) {
  const t = contract.team;
  const d = 1 - t;
  const tricksTeam = tricksBySeat[t] + tricksBySeat[t + 2];
  const capotMade = tricksTeam === 8;
  const generaleMade = tricksBySeat[contract.seat] === 8;
  const takerBelote = beloteTeam === t ? BELOTE_POINTS : 0;
  const pts = cardPoints[t];

  let success;
  let reason;
  if (contract.value === GENERALE) {
    success = generaleMade;
    reason = success ? 'Générale réalisée' : 'Le preneur n\'a pas fait tous les plis';
  } else if (contract.value === CAPOT) {
    success = capotMade;
    reason = success ? 'Capot réalisé' : 'Les preneurs n\'ont pas fait tous les plis';
  } else if (pts < MIN_POINTS) {
    success = false;
    reason = `${pts} points de cartes : moins de ${MIN_POINTS} (belote non comptée)`;
  } else if (pts + takerBelote < contract.value) {
    success = false;
    reason = `${pts + takerBelote} points${takerBelote ? ' (belote comprise)' : ''} pour un contrat de ${contract.value}`;
  } else {
    success = true;
    reason = capotMade
      ? 'Capot (non annoncé) !'
      : `${pts + takerBelote} points${takerBelote ? ' (belote comprise)' : ''} pour un contrat de ${contract.value}`;
  }

  const score = [0, 0];
  if (contract.mult === 1) {
    if (success) {
      const made = contract.value < CAPOT && capotMade ? CAPOT_POINTS : pts;
      score[t] = contract.value + made;
      score[d] = cardPoints[d];
    } else {
      score[d] = 160 + contract.value;
    }
  } else {
    score[success ? t : d] = 160 + contract.value * contract.mult;
  }
  if (beloteTeam !== null && beloteTeam !== undefined) score[beloteTeam] += BELOTE_POINTS;

  return {
    success,
    reason,
    score,
    capot: capotMade,
    generale: generaleMade && contract.value === GENERALE,
    tricksTeam: [tricksBySeat[0] + tricksBySeat[2], tricksBySeat[1] + tricksBySeat[3]],
  };
}

/** Équipe gagnante de la partie ou null si personne n'a encore gagné (ou égalité). */
export function gameWinner(scores, target) {
  const [a, b] = scores;
  if (a < target && b < target) return null;
  if (a === b) return null;
  return a > b ? 0 : 1;
}
