// Cartes, valeurs et ordres de la coinche (jeu de 32 cartes).
// Une carte est une chaîne de 2 caractères : rang + couleur, ex. "JH" = Valet de cœur, "TS" = 10 de pique.

export const SUITS = ['S', 'H', 'C', 'D']; // ordre d'affichage (couleurs alternées)
export const RANKS = ['7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
export const TRUMPS = ['H', 'D', 'S', 'C', 'NT', 'AT']; // NT = sans atout, AT = tout atout

export const SUIT_SYMBOL = { H: '♥', D: '♦', S: '♠', C: '♣', NT: 'SA', AT: 'TA' };
export const SUIT_NAME = {
  H: 'Cœur', D: 'Carreau', S: 'Pique', C: 'Trèfle', NT: 'Sans atout', AT: 'Tout atout',
};
export const RANK_LABEL = { '7': '7', '8': '8', '9': '9', T: '10', J: 'V', Q: 'D', K: 'R', A: 'A' };
export const RANK_NAME = {
  '7': 'sept', '8': 'huit', '9': 'neuf', T: 'dix', J: 'valet', Q: 'dame', K: 'roi', A: 'as',
};

export const rankOf = (c) => c[0];
export const suitOf = (c) => c[1];
export const isRed = (s) => s === 'H' || s === 'D';

// Ordres du plus faible au plus fort.
const TRUMP_ORDER = ['7', '8', 'Q', 'K', 'T', 'A', '9', 'J'];
const PLAIN_ORDER = ['7', '8', '9', 'J', 'Q', 'K', 'T', 'A'];

const TRUMP_POINTS = { J: 20, '9': 14, A: 11, T: 10, K: 4, Q: 3, '8': 0, '7': 0 };
const PLAIN_POINTS = { A: 11, T: 10, K: 4, Q: 3, J: 2, '9': 0, '8': 0, '7': 0 };
const NT_POINTS = { A: 19, T: 10, K: 4, Q: 3, J: 2, '9': 0, '8': 0, '7': 0 };
const AT_POINTS = { J: 14, '9': 9, A: 6, T: 5, K: 3, Q: 1, '8': 0, '7': 0 };

export const LAST_TRICK_BONUS = 10; // « dix de der »
export const TOTAL_POINTS = 162;

/** Vrai si la carte est un atout pour ce contrat (en tout atout, toutes les couleurs le sont). */
export function isTrump(card, trump) {
  return trump === 'AT' || suitOf(card) === trump;
}

/** Utilise l'ordre « atout » (V,9,A,10,R,D,8,7) pour cette carte ? */
function usesTrumpOrder(card, trump) {
  return trump === 'AT' || suitOf(card) === trump;
}

export function cardPoints(card, trump) {
  const r = rankOf(card);
  if (trump === 'NT') return NT_POINTS[r];
  if (trump === 'AT') return AT_POINTS[r];
  return suitOf(card) === trump ? TRUMP_POINTS[r] : PLAIN_POINTS[r];
}

/** Force d'une carte dans sa couleur (0 = plus faible, 7 = plus forte). */
export function cardStrength(card, trump) {
  return usesTrumpOrder(card, trump)
    ? TRUMP_ORDER.indexOf(rankOf(card))
    : PLAIN_ORDER.indexOf(rankOf(card));
}

export function newDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
  return deck;
}

export const ALL_CARDS = Object.freeze(newDeck());

// Générateur pseudo-aléatoire sérialisable (mulberry32) : l'état est un entier.
export function nextRandom(stateHolder) {
  let t = (stateHolder.rng = (stateHolder.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function makeRng(seed = (Math.random() * 2 ** 32) >>> 0) {
  const holder = { rng: seed | 0 };
  return () => nextRandom(holder);
}

export function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Trie une main pour l'affichage : atout en premier, couleurs alternées, par force décroissante. */
export function sortHand(hand, trump = null) {
  let order = SUITS.slice();
  if (trump && SUITS.includes(trump)) {
    // atout d'abord puis on garde l'alternance rouge/noir autant que possible
    const rest = SUITS.filter((s) => s !== trump);
    const alt = [];
    let wantRed = !isRed(trump);
    const pool = rest.slice();
    while (pool.length) {
      const idx = pool.findIndex((s) => isRed(s) === wantRed);
      const pick = idx >= 0 ? pool.splice(idx, 1)[0] : pool.shift();
      alt.push(pick);
      wantRed = !isRed(pick);
    }
    order = [trump, ...alt];
  }
  // n'afficher que les couleurs présentes, en conservant l'alternance si possible
  const present = order.filter((s) => hand.some((c) => suitOf(c) === s));
  return hand.slice().sort((a, b) => {
    const sa = present.indexOf(suitOf(a));
    const sb = present.indexOf(suitOf(b));
    if (sa !== sb) return sa - sb;
    return cardStrength(b, trump) - cardStrength(a, trump);
  });
}

export function cardLabel(card) {
  return RANK_LABEL[rankOf(card)] + SUIT_SYMBOL[suitOf(card)];
}

export function trumpLabel(trump) {
  return SUITS.includes(trump) ? SUIT_SYMBOL[trump] : SUIT_SYMBOL[trump];
}

export const teamOf = (seat) => seat % 2;
export const partnerOf = (seat) => (seat + 2) % 4;
export const nextSeat = (seat) => (seat + 1) % 4;
