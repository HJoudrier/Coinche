// Aides au joueur : conseils d'enchères et de jeu, de niveau variable.
import {
  TRUMPS, SUITS, SUIT_SYMBOL, teamOf, suitOf, cardStrength, cardLabel,
} from './cards.js';
import {
  estimateStars, analyze, heuristicPlay, monteCarloPlay, toCtx, auctionForcedCards, auctionLengths,
} from './ai.js';
import { describeKnowledge } from './reading.js';
import { analyzeBid, explainAuction } from './bidding.js';
import { actionLabel } from './auction.js';

export const HELP_LEVELS = ['Aucune', 'Débutant', 'Intermédiaire', 'Expert'];

export const HELP_DESCRIPTIONS = {
  bid: [
    'Aucune aide pendant les enchères.',
    'Affiche la force de votre main pour chaque atout (étoiles).',
    'Enchère conseillée selon les conventions, et signification des annonces : touchez une bulle d\'annonce.',
    'Comme Intermédiaire, avec les significations et « ce que l\'on sait des mains » toujours dépliés, et l\'historique des annonces pendant toute la donne.',
  ],
  play: [
    'Aucune aide (les cartes interdites sont tout de même refusées).',
    'Met en évidence les cartes jouables.',
    'Cartes jouables + carte conseillée et sa raison.',
    'Conseil par simulation, atouts restants, cartes maîtresses, couleurs coupées et cartes révélées par les enchères.',
  ],
};

/**
 * Conseil d'enchère (pendant son tour). level : 1..3.
 * Retourne {stars:[{trump, stars, points}], action, label, explanation}.
 */
export function bidAdvice(view, level) {
  if (!level || !view.options) return null;
  const a = analyzeBid(view, 'medium');
  const stars = TRUMPS.map((t) => {
    const e = a.estimates[t];
    const total = e.points + (e.belote ? 20 : 0);
    return { trump: t, stars: estimateStars(total), points: Math.min(total, 182) };
  });
  const res = { stars, action: null, label: '', explanation: '' };
  if (level >= 2) {
    res.action = a.action;
    res.label = actionLabel(a.action);
    res.explanation = a.explanation;
  }
  return res;
}

const leaderOf = (view) => (view.dealer !== undefined && view.dealer !== null ? (view.dealer + 1) % 4 : null);

/** Signification des annonces de la donne (aide ≥ Intermédiaire). */
export function auctionMeanings(view) {
  return explainAuction(view.auction.history, view.names, leaderOf(view));
}

/** Ce que les annonces révèlent des trois autres mains, croisé avec la nôtre. */
export function knowledgeLines(view) {
  if (!view.auction || !view.auction.history.length) return [];
  return describeKnowledge(view.auction.history, view.names, leaderOf(view), view.seat, view.hand);
}

/**
 * Conseil de jeu. level : 2..3 (1 = cartes jouables seulement, géré par l'interface).
 * Retourne {card, reason, memory}.
 */
export function playAdvice(view, level) {
  if (!level || level < 2 || view.phase !== 'playing' || view.turn !== view.seat) return null;
  const ctx = toCtx(view);
  const info = analyze(ctx);
  const res = level >= 3 ? monteCarloPlay(ctx, { budgetMs: 90, maxSamples: 30 }) : heuristicPlay(ctx, info);
  const out = { card: res.card, reason: res.reason, memory: null };
  if (level >= 3) out.memory = memoryInfo(view, info);
  return out;
}

/** Mémoire des cartes : atouts restants, cartes maîtresses, couleurs coupées. */
export function memoryInfo(view, info = analyze(toCtx(view))) {
  const trump = view.contract.trump;
  const lines = [];
  if (SUITS.includes(trump)) {
    const outTrumps = info.unknown.filter((c) => suitOf(c) === trump).length;
    lines.push(`Atouts encore chez les autres : ${outTrumps}`);
  }
  const masters = [];
  for (const s of SUITS) {
    const remaining = [...info.unknown, ...view.hand].filter((c) => suitOf(c) === s);
    if (!remaining.length) continue;
    const top = remaining.reduce((a, b) => (cardStrength(b, trump) > cardStrength(a, trump) ? b : a));
    masters.push(`${cardLabel(top)}${view.hand.includes(top) ? ' (vous)' : ''}`);
  }
  if (masters.length) lines.push(`Cartes maîtresses : ${masters.join(' · ')}`);
  const voids = [];
  for (let s = 0; s < 4; s++) {
    if (s === view.seat || !info.voids[s].size) continue;
    voids.push(`${view.names[s]} : plus de ${[...info.voids[s]].map((x) => SUIT_SYMBOL[x]).join('')}`);
  }
  if (voids.length) lines.push(voids.join(' · '));
  // déductions des enchères encore valables (cartes non jouées, longueurs restantes)
  const ctx = toCtx(view);
  const forced = auctionForcedCards(ctx, info);
  const bySeat = {};
  for (const [c, s] of Object.entries(forced)) (bySeat[s] ||= []).push(cardLabel(c));
  const lens = auctionLengths(ctx, info);
  const deductions = [];
  for (let s = 0; s < 4; s++) {
    const parts = [];
    if (bySeat[s]) parts.push(`a encore ${bySeat[s].join(', ')}`);
    for (const [x, { min }] of Object.entries(lens[s] || {})) if (min > 0) parts.push(`au moins ${min} ${SUIT_SYMBOL[x]}`);
    if (parts.length) deductions.push(`${view.names[s]} ${parts.join(', ')}`);
  }
  if (deductions.length) lines.push(`D'après les annonces : ${deductions.join(' · ')}`);
  // déductions du jeu : appels, couleurs probablement épuisées, plafonds d'atout
  const partner = (view.seat + 2) % 4;
  for (let s = 0; s < 4; s++) {
    if (s === view.seat) continue;
    const sig = info.signals[s];
    if (sig) {
      const who = s === partner ? `${view.names[s]} (partenaire)` : view.names[s];
      lines.push(sig.mode === 'direct'
        ? `${who} : appel à ${SUIT_SYMBOL[sig.suit]} (défausse du ${cardLabel(sig.card)}) — il en a la carte maîtresse`
        : `${who} : contre-appel à ${SUIT_SYMBOL[sig.suit]} (défausse du ${cardLabel(sig.card)}) — pas de jeu dans cette couleur`);
    }
    const prob = [...info.probVoid[s]].filter((x) => !info.voids[s].has(x));
    if (prob.length) lines.push(`${view.names[s]} n'a probablement plus de ${prob.map((x) => SUIT_SYMBOL[x]).join('')} (grosse carte donnée sans prendre)`);
    const ceilT = info.ceil[s][trump];
    if (SUITS.includes(trump) && info.ceilCard[s][trump] && !info.voids[s].has(trump)
      && info.unknown.some((c) => suitOf(c) === trump && cardStrength(c, trump) >= ceilT)) {
      lines.push(`${view.names[s]} n'a pas d'atout plus fort que ${cardLabel(info.ceilCard[s][trump])} (n'a pas monté)`);
    }
  }
  const us = teamOf(view.seat);
  lines.push(`Points faits : nous ${view.cardPoints[us]} · eux ${view.cardPoints[1 - us]}`);
  return lines;
}
