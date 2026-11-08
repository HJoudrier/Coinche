// Règles du jeu de la carte : cartes jouables, gagnant d'un pli, points.
import {
  suitOf, rankOf, cardStrength, cardPoints, isTrump, partnerOf, SUITS, LAST_TRICK_BONUS,
} from './cards.js';

const isColorTrump = (trump) => SUITS.includes(trump);

/** c bat-elle best, sachant la couleur demandée ? */
export function beats(c, best, lead, trump) {
  if (isColorTrump(trump)) {
    const cT = suitOf(c) === trump;
    const bT = suitOf(best) === trump;
    if (cT && !bT) return true;
    if (!cT && bT) return false;
    if (cT && bT) return cardStrength(c, trump) > cardStrength(best, trump);
  }
  if (suitOf(c) !== lead) return false;
  if (suitOf(best) !== lead) return true;
  return cardStrength(c, trump) > cardStrength(best, trump);
}

/** Index (dans le pli) de la carte gagnante. trick = [{seat, card}, ...] */
export function trickWinnerIndex(trick, trump) {
  const lead = suitOf(trick[0].card);
  let best = 0;
  for (let i = 1; i < trick.length; i++) {
    if (beats(trick[i].card, trick[best].card, lead, trump)) best = i;
  }
  return best;
}

export function trickWinnerSeat(trick, trump) {
  return trick[trickWinnerIndex(trick, trump)].seat;
}

export function trickPoints(trick, trump) {
  let p = 0;
  for (const t of trick) p += cardPoints(t.card, trump);
  return p;
}

/**
 * Cartes autorisées pour `seat` qui possède `hand`, le pli en cours étant `trick`.
 * Règles : fournir ; à l'atout monter si possible ; sans la couleur : libre si le
 * partenaire est maître, sinon couper / surcouper / sous-couper ; en tout atout il faut
 * monter dans la couleur demandée ; en sans atout il suffit de fournir.
 */
export function legalCards(hand, trick, trump, seat) {
  if (!trick.length) return hand.slice();
  const lead = suitOf(trick[0].card);
  const followers = hand.filter((c) => suitOf(c) === lead);
  const winIdx = trickWinnerIndex(trick, trump);
  const winCard = trick[winIdx].card;

  if (trump === 'NT') return followers.length ? followers : hand.slice();

  if (trump === 'AT') {
    if (!followers.length) return hand.slice();
    const higher = followers.filter((c) => cardStrength(c, trump) > cardStrength(winCard, trump));
    return higher.length ? higher : followers;
  }

  // Contrat à la couleur
  if (lead === trump) {
    if (!followers.length) return hand.slice();
    const higher = followers.filter((c) => cardStrength(c, trump) > cardStrength(winCard, trump));
    return higher.length ? higher : followers;
  }
  if (followers.length) return followers;

  const partnerWinning = trick[winIdx].seat === partnerOf(seat);
  if (partnerWinning) return hand.slice();

  const trumps = hand.filter((c) => suitOf(c) === trump);
  if (!trumps.length) return hand.slice();
  if (suitOf(winCard) === trump) {
    const over = trumps.filter((c) => cardStrength(c, trump) > cardStrength(winCard, trump));
    return over.length ? over : trumps;
  }
  return trumps;
}

export function isLegal(card, hand, trick, trump, seat) {
  return legalCards(hand, trick, trump, seat).includes(card);
}

/** Explique pourquoi une carte est refusée (pour l'aide au jeu). */
export function illegalReason(card, hand, trick, trump, seat) {
  if (isLegal(card, hand, trick, trump, seat)) return null;
  const lead = suitOf(trick[0].card);
  const hasLead = hand.some((c) => suitOf(c) === lead);
  if (hasLead && suitOf(card) !== lead) return 'Vous devez fournir la couleur demandée.';
  if (hasLead) return 'Vous devez monter (jouer plus fort) dans la couleur demandée.';
  const winIdx = trickWinnerIndex(trick, trump);
  const winCard = trick[winIdx].card;
  if (suitOf(card) !== trump) return 'Vous n\'avez pas la couleur : vous devez couper (jouer atout).';
  if (suitOf(winCard) === trump) return 'Vous devez surcouper (jouer un atout plus fort).';
  return 'Carte non autorisée.';
}

/** Le joueur possède-t-il la belote (roi + dame d'atout) ? Uniquement en contrat couleur. */
export function hasBelote(hand, trump) {
  if (!isColorTrump(trump)) return false;
  return hand.includes('K' + trump) && hand.includes('Q' + trump);
}

export function isBeloteCard(card, trump) {
  return isColorTrump(trump) && suitOf(card) === trump && (rankOf(card) === 'K' || rankOf(card) === 'Q');
}

export { LAST_TRICK_BONUS, isTrump };
