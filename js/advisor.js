// Aides au joueur : conseils d'enchères et de jeu, de niveau variable.
import {
  TRUMPS, SUITS, SUIT_SYMBOL, SUIT_NAME, partnerOf, teamOf, suitOf, cardStrength, cardLabel,
} from './cards.js';
import { analyzeBid, estimateStars, analyze, heuristicPlay, monteCarloPlay, toCtx } from './ai.js';
import { actionLabel, CAPOT } from './auction.js';

export const HELP_LEVELS = ['Aucune', 'Débutant', 'Intermédiaire', 'Expert'];

export const HELP_DESCRIPTIONS = {
  bid: [
    'Aucune aide pendant les enchères.',
    'Affiche la force de votre main pour chaque atout (étoiles).',
    'Force de la main + enchère conseillée.',
    'Conseil détaillé, points espérés et lecture des annonces des autres joueurs.',
  ],
  play: [
    'Aucune aide (les cartes interdites sont tout de même refusées).',
    'Met en évidence les cartes jouables.',
    'Cartes jouables + carte conseillée et sa raison.',
    'Conseil par simulation, atouts restants, cartes maîtresses et couleurs coupées.',
  ],
};

/**
 * Conseil d'enchère. level : 1..3.
 * Retourne {stars:[{trump, stars, points}], action, label, explanation, reading:[...]}.
 */
export function bidAdvice(view, level) {
  if (!level || !view.options) return null;
  const a = analyzeBid(view, 'medium');
  const stars = TRUMPS.map((t) => {
    const e = a.estimates[t];
    const total = e.points + (e.belote ? 20 : 0);
    return { trump: t, stars: estimateStars(total), points: Math.min(total, 182) };
  });
  const res = { stars, action: null, label: '', explanation: '', reading: [] };
  if (level >= 2) {
    res.action = a.action;
    res.label = actionLabel(a.action);
  }
  if (level >= 3) {
    res.explanation = a.explanation;
    res.reading = readAuction(view);
  }
  return res;
}

function readAuction(view) {
  const { seat, auction, names } = view;
  const partner = partnerOf(seat);
  const out = [];
  const last = {};
  for (const h of auction.history) if (h.type === 'bid') last[h.seat] = h;
  if (last[partner]) {
    const b = last[partner];
    if (b.value >= CAPOT) out.push(`${names[partner]} vise le ${b.value === CAPOT ? 'capot' : 'générale'} : soutenez-le sans surenchérir.`);
    else {
      out.push(SUITS.includes(b.trump)
        ? `${names[partner]} (partenaire) annonce ${b.value} ${SUIT_SYMBOL[b.trump]} : il a sans doute le valet ou le 9 à ${SUIT_NAME[b.trump]}. Vos as et vos atouts maîtres lui permettent de monter.`
        : `${names[partner]} (partenaire) annonce ${b.value} ${SUIT_NAME[b.trump]} : ${b.trump === 'NT' ? 'il compte sur ses as' : 'il compte sur ses valets'}.`);
    }
  }
  for (const s of [(seat + 1) % 4, (seat + 3) % 4]) {
    if (last[s]) {
      const b = last[s];
      out.push(`${names[s]} (adversaire) annonce ${b.value} ${SUIT_SYMBOL[b.trump]}${SUITS.includes(b.trump) ? ` : ses atouts sont forts à ${SUIT_NAME[b.trump]}` : ''}.`);
    }
  }
  if (auction.current && teamOf(auction.current.seat) !== teamOf(seat)) {
    out.push('Pour coincher, il faut de la longueur à l\'atout adverse (3-4 cartes) avec le valet ou le 9.');
  }
  return out;
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
  const us = teamOf(view.seat);
  lines.push(`Points faits : nous ${view.cardPoints[us]} · eux ${view.cardPoints[1 - us]}`);
  return lines;
}
