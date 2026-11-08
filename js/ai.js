// Intelligence artificielle : jeu de la carte (3 niveaux) et évaluation des mains.
// Les enchères par conventions sont dans bidding.js.
// L'IA ne voit que la « vue » d'un joueur (sa main + les informations publiques).
import {
  SUITS, ALL_CARDS, SUIT_SYMBOL,
  suitOf, rankOf, cardPoints, cardStrength, teamOf, partnerOf, cardLabel,
} from './cards.js';
import { legalCards, trickWinnerSeat, trickPoints } from './rules.js';
import { scoreRound } from './scoring.js';
import { auctionKnowledge, knownCards } from './reading.js';

export const LEVELS = ['easy', 'medium', 'hard'];
const isColor = (t) => SUITS.includes(t);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const isTrumpCard = (c, trump) => isColor(trump) && suitOf(c) === trump;

// ---------------------------------------------------------------------------
// Connaissance : cartes jouées, cartes inconnues, chicanes observées.
// ctx = {seat, hand, trick, tricks, contract}
// ---------------------------------------------------------------------------
/** Réglages du jeu des robots (ajustés par simulations). */
export const TUNING = {
  takerMinTrumps: 2, // le preneur sans atout maître rejoue atout s'il en a au moins autant
  partnerLeadsTrump: 'always', // le partenaire du preneur rejoue atout dès qu'il a la main
  quietNeutral: false, // défausse sans signal : préférer V/D plutôt qu'une petite carte (coûte des points)
  signals: true, // appels et contre-appels
  partnerKnownTrick: true, // petit atout quand le partenaire tient l'atout maître
  useProbVoid: true, // tenir compte des couleurs probablement épuisées (10 sec…)
  chargeMin: 3, // partenaire maître : on le charge d'une carte valant au moins 3 points, sinon on signale
  followCalls: true, // entamer la couleur appelée par le partenaire
  mcPrior: 10, // Monte-Carlo : avance (en points d'écart moyen) accordée à la carte de la stratégie
  mcPriorTrumpDraw: 25, // … et quand l'équipe preneuse fait tomber les atouts
  mcSamples: 500, // nombre maximal de donnes simulées par décision (niveau difficile)
  mcBudgetMs: 3000, // temps maximal de réflexion par décision
};

/** Petite carte (aucun point) : sert aux appels et contre-appels lors des défausses. */
export const isSmall = (card, trump) => cardPoints(card, trump) === 0;

/** Mode de signalisation d'un joueur : contre-appels pour l'équipe preneuse à partir du seuil, sinon appels directs. */
export function signalMode(seat, contract, conv) {
  const from = conv && conv.counterFrom !== undefined && conv.counterFrom !== null ? conv.counterFrom : 100;
  return teamOf(seat) === contract.team && contract.value >= from ? 'counter' : 'direct';
}

/** Carte la plus forte d'une couleur (as en couleur ordinaire et sans atout, valet à l'atout et en tout atout). */
function topCardOf(suit, trump) {
  return (trump === 'AT' || suit === trump ? 'J' : 'A') + suit;
}

/**
 * Ce que l'on sait des mains d'après le jeu :
 * - voids : couleurs épuisées (n'a pas fourni / n'a pas coupé) ;
 * - probVoid : couleurs probablement épuisées (grosse carte donnée à l'adversaire : 10 sec, 9 sec…) ;
 * - ceil : force maximale (exclue) encore possible dans une couleur (obligation de monter non respectée) ;
 * - signals : premier appel / contre-appel de chaque joueur (première petite défausse) ;
 * - likely / notHave : cartes probables ou exclues (annonces, appels).
 */
export function analyze(ctx) {
  const { hand, trick, tricks, contract } = ctx;
  const trump = contract.trump;
  const played = new Set();
  const voids = [0, 1, 2, 3].map(() => new Set());
  const probVoid = [0, 1, 2, 3].map(() => new Set());
  const ceil = [{}, {}, {}, {}];
  const ceilCard = [{}, {}, {}, {}];
  const signals = [null, null, null, null];
  const all = tricks.map((t) => t.cards);
  if (trick.length) all.push(trick);
  const setCeil = (s, suit, card) => {
    const st = cardStrength(card, trump);
    if (ceil[s][suit] === undefined || st < ceil[s][suit]) { ceil[s][suit] = st; ceilCard[s][suit] = card; }
  };
  for (const tc of all) {
    const lead = suitOf(tc[0].card);
    for (let i = 0; i < tc.length; i++) {
      const { seat: s, card } = tc[i];
      played.add(card);
      if (i === 0) continue;
      const before = tc.slice(0, i);
      const winSeat = trickWinnerSeat(before, trump);
      const winCard = before.find((x) => x.seat === winSeat).card;
      const partnerWinning = winSeat === partnerOf(s);
      if (suitOf(card) === lead) {
        // obligation de monter (atout demandé, tout atout) : jouer plus bas = rien de plus fort dans la couleur
        const mustRise = (isColor(trump) && lead === trump) || trump === 'AT';
        if (mustRise && suitOf(winCard) === lead && cardStrength(card, trump) < cardStrength(winCard, trump)) setCeil(s, lead, winCard);
        // grosse carte donnée à l'adversaire sans prendre : c'était sans doute la dernière de la couleur
        const nowWin = trickWinnerSeat([...before, { seat: s, card }], trump);
        if (!partnerWinning && nowWin !== s && cardPoints(card, trump) >= 10) probVoid[s].add(lead);
        continue;
      }
      voids[s].add(lead);
      if (isColor(trump) && lead !== trump) {
        if (suitOf(card) !== trump) {
          // ne fournit pas et ne coupe pas alors que son partenaire n'était pas maître : plus d'atout
          if (!partnerWinning) voids[s].add(trump);
        } else if (!partnerWinning && suitOf(winCard) === trump && cardStrength(card, trump) < cardStrength(winCard, trump)) {
          // sous-coupe : il n'avait pas d'atout plus fort que celui qui menait
          setCeil(s, trump, winCard);
        }
      }
      // première petite défausse = appel ou contre-appel
      if (!isTrumpCard(card, trump) && signals[s] === null && isSmall(card, trump)) {
        signals[s] = { suit: suitOf(card), card, mode: signalMode(s, contract, ctx.conv) };
      }
    }
  }
  const handSet = new Set(hand);
  const unknown = ALL_CARDS.filter((c) => !played.has(c) && !handSet.has(c));
  const unknownSet = new Set(unknown);
  const likely = [0, 1, 2, 3].map(() => new Set());
  const notHave = [0, 1, 2, 3].map(() => new Set());
  // annonces : cartes révélées par les enchères
  const kn = auctionKn(ctx);
  if (kn) {
    for (let s = 0; s < 4; s++) {
      if (s === ctx.seat) continue;
      for (const c of knownCards(kn, s, hand)) if (unknownSet.has(c) && !voids[s].has(suitOf(c))) likely[s].add(c);
    }
  }
  // appels : l'appel direct promet la carte maîtresse de la couleur, le contre-appel la nie
  for (let s = 0; s < 4; s++) {
    const sig = signals[s];
    if (!sig || s === ctx.seat) continue;
    const top = topCardOf(sig.suit, trump);
    if (!unknownSet.has(top)) continue;
    if (sig.mode === 'direct') likely[s].add(top); else notHave[s].add(top);
  }
  return {
    trump, played, voids, unknown, probVoid, ceil, ceilCard, signals, likely, notHave,
  };
}

/** Connaissance tirée des enchères (calculée une fois, réutilisée dans les simulations via ctx.kn). */
export function auctionKn(ctx) {
  if (ctx.kn !== undefined) return ctx.kn;
  if (!ctx.auction || !ctx.auction.length) return null;
  const leader = ctx.dealer !== undefined && ctx.dealer !== null ? (ctx.dealer + 1) % 4 : null;
  return auctionKnowledge(ctx.auction, leader);
}

/** Couleur épuisée, sûre ou probable. */
const outOf = (info, s, suit) => info.voids[s].has(suit) || (TUNING.useProbVoid && info.probVoid && info.probVoid[s].has(suit));

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
  // défausse (on ne peut pas fournir) : occasion d'appeler ou de contre-appeler
  const discarding = !hand.some((c) => suitOf(c) === lead);
  const freePool = discarding ? legal.filter((c) => !isTrumpCard(c, trump)) : [];
  const discard = (fallbackReason) => {
    const sig = signalDiscard(ctx, info, freePool);
    if (sig) return sig;
    return { card: quietDiscard(ctx, info, freePool), reason: fallbackReason };
  };

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
      if (freePool.length && cardPoints(card, trump) < TUNING.chargeMin) return discard('Votre partenaire est maître : défaussez une petite carte.');
      return {
        card,
        reason: cardPoints(card, trump) >= 10
          ? 'Votre partenaire est maître : chargez le pli en points.'
          : cardPoints(card, trump) >= TUNING.chargeMin
            ? 'Votre partenaire est maître : donnez-lui des points.'
            : 'Votre partenaire est maître : jouez une petite carte.',
      };
    }
    const safeWin = legal.filter((c) => wins(c) && !canBeBeaten(c, lead, oppsAfter, info)
      && !isTrumpCard(c, trump));
    if (safeWin.length && pts >= 10) {
      return { card: minBy(safeWin, (c) => cardStrength(c, trump)), reason: 'Assurez le pli avec une carte maîtresse.' };
    }
    if (freePool.length) return discard('Le pli est incertain : ne chargez pas.');
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
  if (freePool.length && !winners.length) return discard('Vous ne pouvez pas prendre : défaussez une petite carte.');
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
  const pSig = info.signals ? info.signals[partner] : null;
  const called = pSig && pSig.mode === 'direct' && pSig.suit !== trump ? pSig.suit : null;
  const refused = pSig && pSig.mode === 'counter' ? pSig.suit : null;
  const partnerKnown = info.likely ? info.likely[partner] : new Set();
  // un adversaire qui a de l'atout coupera-t-il cette couleur ?
  const unknownTrumps = isColor(trump) ? info.unknown.filter((c) => suitOf(c) === trump) : [];
  const oppTrumpsLeft = unknownTrumps.filter((c) => !partnerKnown.has(c));
  const cutRisk = (suit) => isColor(trump) && suit !== trump && oppTrumpsLeft.length > 0
    && opps.some((o) => outOf(info, o, suit) && !info.voids[o].has(trump));

  if (isColor(trump)) {
    const myTrumps = hand.filter((c) => suitOf(c) === trump);
    const oppsMayHaveTrump = oppTrumpsLeft.length > 0 && opps.some((o) => !info.voids[o].has(trump));
    // 1) L'équipe preneuse fait tomber les atouts adverses
    if (takerTeam && myTrumps.length && oppsMayHaveTrump) {
      const masters = myTrumps.filter((c) => isMaster(c, info));
      if (masters.length) {
        return { card: maxBy(masters, (c) => cardStrength(c, trump)), reason: 'Faites tomber les atouts adverses avec votre atout maître.' };
      }
      const topOut = maxBy(unknownTrumps, (c) => cardStrength(c, trump));
      if (TUNING.partnerKnownTrick && topOut && partnerKnown.has(topOut)) {
        return {
          card: minBy(myTrumps, (c) => cardStrength(c, trump)),
          reason: `Votre partenaire a ${cardLabel(topOut)} : jouez petit atout. L'adversaire devra monter et votre partenaire prendra (un 9 adverse peut tomber).`,
        };
      }
      if (contract.seat === seat && myTrumps.length >= TUNING.takerMinTrumps) {
        return { card: minBy(myTrumps, (c) => cardStrength(c, trump)), reason: 'Preneur : jouez atout pour faire tomber ceux des adversaires avant de jouer vos as.' };
      }
      if (contract.seat === partner && (TUNING.partnerLeadsTrump === 'always'
        || (TUNING.partnerLeadsTrump === 'first' && ctx.tricks.length === 0))) {
        return { card: minBy(myTrumps, (c) => cardStrength(c, trump)), reason: 'Rejouez atout pour votre partenaire preneur : il faut épuiser les atouts adverses.' };
      }
    }
    // 2) Couleur appelée par le partenaire (il en a la carte maîtresse)
    if (called && TUNING.followCalls) {
      const inCalled = hand.filter((c) => suitOf(c) === called);
      if (inCalled.length && !cutRisk(called) && info.unknown.includes(topCardOf(called, trump))) {
        return { card: minBy(inCalled, (c) => cardStrength(c, trump)), reason: `Votre partenaire a appelé à ${SUIT_SYMBOL[called]} : jouez cette couleur, il a la carte maîtresse.` };
      }
    }
    // 3) Cartes maîtresses hors atout qui ne risquent pas d'être coupées
    const sideMasters = hand.filter((c) => suitOf(c) !== trump && isMaster(c, info) && !cutRisk(suitOf(c)));
    if (sideMasters.length) {
      return { card: maxBy(sideMasters, (c) => cardPoints(c, trump)), reason: 'Jouez votre carte maîtresse (les atouts adverses sont tombés ou la couleur ne sera pas coupée).' };
    }
    // 4) Faire couper le partenaire
    const partnerCuts = !info.voids[partner].has(trump) && unknownTrumps.length > 0;
    if (partnerCuts) {
      const forPartner = hand.filter((c) => suitOf(c) !== trump && outOf(info, partner, suitOf(c)));
      if (forPartner.length) {
        return { card: minBy(forPartner, (c) => cardPoints(c, trump)), reason: 'Votre partenaire n\'a plus cette couleur : faites-le couper.' };
      }
    }
    const side = hand.filter((c) => suitOf(c) !== trump);
    if (side.length) {
      const card = minBy(side, (c) => {
        let v = cardPoints(c, trump);
        const su = suitOf(c);
        const aceOut = info.unknown.includes(`A${su}`);
        if (aceOut && hand.includes(`T${su}`)) v += 12; // ne pas exposer un 10 non protégé
        if (cutRisk(su)) v += takerTeam ? 8 : 15;
        if (su === refused) v += 20; // contre-appel du partenaire : pas cette couleur
        return v;
      });
      return {
        card,
        reason: refused && suitOf(card) !== refused
          ? `Votre partenaire a fait un contre-appel à ${SUIT_SYMBOL[refused]} : ouvrez ailleurs, avec une petite carte.`
          : 'Ouvrez avec une petite carte pour ne pas donner de points.',
      };
    }
    return { card: minBy(legal, (c) => cardStrength(c, trump)), reason: 'Il ne vous reste que des atouts.' };
  }

  // Sans atout / tout atout : jouer les maîtresses, sinon la couleur appelée, sinon petit dans la couleur longue
  const masters = hand.filter((c) => isMaster(c, info));
  if (masters.length) {
    return { card: maxBy(masters, (c) => cardPoints(c, trump)), reason: 'Encaissez vos cartes maîtresses.' };
  }
  if (called && hand.some((c) => suitOf(c) === called) && info.unknown.includes(topCardOf(called, trump))) {
    return { card: minBy(hand.filter((c) => suitOf(c) === called), (c) => cardStrength(c, trump)), reason: `Votre partenaire a appelé à ${SUIT_SYMBOL[called]} : jouez cette couleur.` };
  }
  const len = (su) => hand.filter((c) => suitOf(c) === su).length;
  const card = minBy(hand, (c) => cardPoints(c, trump) * 2 - len(suitOf(c)) + (suitOf(c) === refused ? 20 : 0));
  return { card, reason: 'Ouvrez petit dans votre couleur longue.' };
}

/**
 * Défausse porteuse d'un signal (première petite défausse de la manche) :
 * appel direct = petite carte de la couleur dont on a la carte maîtresse ;
 * contre-appel = petite carte d'une couleur où l'on n'a rien.
 */
function signalDiscard(ctx, info, pool) {
  const { seat, hand, contract } = ctx;
  const trump = contract.trump;
  if (!TUNING.signals || (info.signals && info.signals[seat])) return null;
  const small = pool.filter((c) => !isTrumpCard(c, trump) && isSmall(c, trump));
  if (!small.length) return null;
  const strong = (su) => hand.some((c) => suitOf(c) === su && !isTrumpCard(c, trump) && isMaster(c, info));
  const mode = signalMode(seat, contract, ctx.conv);
  if (mode === 'direct') {
    const calls = small.filter((c) => strong(suitOf(c)));
    if (calls.length) {
      const card = minBy(calls, (c) => cardStrength(c, trump));
      return { card, reason: `Appel : défaussez une petite carte à ${SUIT_SYMBOL[suitOf(card)]} pour demander cette couleur à votre partenaire (vous en avez la carte maîtresse).` };
    }
  } else {
    const weak = small.filter((c) => !strong(suitOf(c)));
    if (weak.length) {
      const len = (su) => hand.filter((c) => suitOf(c) === su).length;
      const card = minBy(weak, (c) => -len(suitOf(c)) * 10 + cardStrength(c, trump));
      return { card, reason: `Contre-appel (contrat à ${contract.value}) : défaussez à ${SUIT_SYMBOL[suitOf(card)]}, où vous n'avez rien, pour que votre partenaire joue ailleurs.` };
    }
  }
  return null;
}

/** Défausse sans signal : on évite une petite carte qui serait lue comme un faux appel. */
function quietDiscard(ctx, info, pool) {
  const { hand, contract } = ctx;
  const trump = contract.trump;
  if (!TUNING.quietNeutral || (info.signals && info.signals[ctx.seat])) return minBy(pool, (c) => discardCost(c, info, hand));
  const neutral = pool.filter((c) => !isTrumpCard(c, trump) && !isSmall(c, trump) && cardPoints(c, trump) <= 4 && !isMaster(c, info));
  if (neutral.length) return minBy(neutral, (c) => discardCost(c, info, hand));
  return minBy(pool, (c) => discardCost(c, info, hand));
}

// ---------------------------------------------------------------------------
// Monte-Carlo (niveau difficile)
// ---------------------------------------------------------------------------
/**
 * Cartes encore cachées dont on connaît le détenteur grâce aux enchères
 * (ex. 90 ♥ annoncé = valet et 9 de ♥). Ignore les déductions contredites par le jeu.
 * Retourne {carte: siège}.
 */
export function auctionForcedCards(ctx, info = analyze(ctx)) {
  const out = {};
  const kn = auctionKn(ctx);
  if (!kn) return out;
  const unknown = new Set(info.unknown);
  for (let s = 0; s < 4; s++) {
    if (s === ctx.seat) continue;
    const cards = [...knownCards(kn, s, ctx.hand)].filter((c) => unknown.has(c) && !info.voids[s].has(suitOf(c)));
    if (ctx.handCounts && cards.length > ctx.handCounts[s]) continue;
    for (const c of cards) out[c] = s;
  }
  return out;
}

/**
 * Longueurs annoncées encore à respecter dans les mains cachées : {siège: {couleur: {min, max}}},
 * corrigées des cartes déjà jouées par ce joueur.
 */
export function auctionLengths(ctx, info = analyze(ctx)) {
  const out = {};
  const kn = auctionKn(ctx);
  if (!kn) return out;
  const playedBy = [0, 1, 2, 3].map(() => ({}));
  const all = ctx.tricks.map((t) => t.cards);
  if (ctx.trick.length) all.push(ctx.trick);
  for (const tc of all) for (const { seat, card } of tc) playedBy[seat][suitOf(card)] = (playedBy[seat][suitOf(card)] || 0) + 1;
  for (let s = 0; s < 4; s++) {
    if (s === ctx.seat) continue;
    const req = {};
    for (const [x, n] of Object.entries(kn[s].minLen)) {
      const left = n - (playedBy[s][x] || 0);
      if (left > 0 && !info.voids[s].has(x)) req[x] = { min: left, max: 8 };
    }
    for (const [x, n] of Object.entries(kn[s].maxLen)) {
      const left = Math.max(0, n - (playedBy[s][x] || 0));
      req[x] = { min: req[x] ? req[x].min : 0, max: left };
    }
    if (Object.keys(req).length) out[s] = req;
  }
  return out;
}

function lengthsOk(hands, lengths) {
  for (const [s, req] of Object.entries(lengths)) {
    for (const [x, { min, max }] of Object.entries(req)) {
      const n = hands[s].filter((c) => suitOf(c) === x).length;
      if (n < min || n > max) return false;
    }
  }
  return true;
}

/**
 * Poids relatifs « telle carte cachée est chez tel joueur », d'après toutes les déductions :
 * annonces (couleur annoncée, as montrés, sans atout / tout atout, passes), appels et contre-appels,
 * couleurs probablement épuisées. 1 = neutre ; les impossibilités sûres sont traitées à part.
 */
export function cardWeights(ctx, info, kn = auctionKn(ctx)) {
  const W = [0, 1, 2, 3].map(() => new Map());
  const unknown = new Set(info.unknown);
  const mul = (s, c, f) => { if (unknown.has(c)) W[s].set(c, (W[s].get(c) ?? 1) * f); };
  const suitCards = (x) => info.unknown.filter((c) => suitOf(c) === x);
  for (let s = 0; s < 4; s++) {
    if (s === ctx.seat) continue;
    if (kn) {
      const k = kn[s];
      for (const x of Object.keys(k.minLen)) for (const c of suitCards(x)) mul(s, c, 1.6);
      for (const x of Object.keys(k.maxLen)) for (const c of suitCards(x)) mul(s, c, 0.4);
      if (k.tricks.NT) for (const x of SUITS) { mul(s, `A${x}`, 2.5); mul(s, `T${x}`, 1.5); }
      if (k.tricks.AT) for (const x of SUITS) { mul(s, `J${x}`, 2.5); mul(s, `9${x}`, 1.5); }
      if (k.aces) for (const x of SUITS) mul(s, `A${x}`, 1.6);
      for (const u of k.useful) {
        for (const x of SUITS) mul(s, `A${x}`, 1.3);
        if (isColor(u.trump)) { mul(s, `J${u.trump}`, 1.6); mul(s, `9${u.trump}`, 1.6); }
      }
      if (k.noOpening) for (const x of SUITS) { mul(s, `J${x}`, 0.75); mul(s, `9${x}`, 0.75); }
      for (const x of k.noSupport) {
        for (const y of SUITS) mul(s, `A${y}`, 0.5);
        if (isColor(x)) { mul(s, `J${x}`, 0.3); mul(s, `9${x}`, 0.3); }
      }
    }
    for (const c of info.likely[s]) mul(s, c, 25); // cartes annoncées, as promis par un appel direct
    for (const c of info.notHave[s]) mul(s, c, 0.1); // contre-appel : pas l'as
    for (const x of info.probVoid[s]) if (!info.voids[s].has(x)) for (const c of suitCards(x)) mul(s, c, 0.12);
  }
  return W;
}

/**
 * Tire une répartition des cartes cachées : contraintes sûres respectées (chicanes, plafonds,
 * belote annoncée), puis chaque carte placée selon les poids de cardWeights.
 */
export function sampleHands(ctx, info, rand, weights = null, lengths = {}) {
  const others = [0, 1, 2, 3].filter((s) => s !== ctx.seat);
  const need = {};
  for (const s of others) need[s] = ctx.handCounts[s];
  const forced = {};
  if (ctx.belote && ctx.belote.played === 1 && ctx.belote.seat !== ctx.seat) {
    const tr = ctx.contract.trump;
    for (const c of [`K${tr}`, `Q${tr}`]) if (info.unknown.includes(c)) forced[c] = ctx.belote.seat;
  }
  const w = (s, c) => (weights ? (weights[s].get(c) ?? 1) : 1);
  for (let attempt = 0; attempt < 30; attempt++) {
    const strict = attempt < 25;
    const weighted = attempt < 22;
    const hands = { [others[0]]: [], [others[1]]: [], [others[2]]: [] };
    const cap = { ...need };
    let ok = true;
    const cards = info.unknown.slice();
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    const elig = new Map();
    for (const c of cards) {
      if (forced[c] !== undefined) { elig.set(c, [forced[c]]); continue; }
      const su = suitOf(c);
      elig.set(c, others.filter((s) => !strict || (!info.voids[s].has(su)
        && !(info.ceil[s][su] !== undefined && cardStrength(c, info.trump) >= info.ceil[s][su]))));
    }
    const maxW = (c) => Math.max(...elig.get(c).map((s) => w(s, c)));
    cards.sort((a, b) => elig.get(a).length - elig.get(b).length || maxW(b) - maxW(a));
    for (const c of cards) {
      const el = elig.get(c).filter((s) => cap[s] > 0);
      if (!el.length) { ok = false; break; }
      let total = 0;
      const ws = el.map((s) => { const v = cap[s] * (weighted ? w(s, c) : 1); total += v; return v; });
      let r = rand() * total;
      let pick = el[el.length - 1];
      for (let i = 0; i < el.length; i++) { r -= ws[i]; if (r < 0) { pick = el[i]; break; } }
      hands[pick].push(c);
      cap[pick]--;
    }
    if (ok && attempt < 15 && !lengthsOk(hands, lengths)) ok = false;
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

/**
 * Joue la manche jusqu'au bout : chaque joueur simulé choisit ses cartes avec l'algorithme
 * complet du robot (règles, mémoire du jeu, lecture des annonces, appels). Renvoie l'écart de score pour `forTeam`.
 */
export function rollout(ctx, hands, firstCard, forTeam, beloteTeam, kn = auctionKn(ctx)) {
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
    card = heuristicPlay({
      seat: turn, hand: h[turn], trick, tricks, contract, conv: ctx.conv, kn, dealer: ctx.dealer,
    }).card;
  }
  const res = scoreRound({ contract, cardPoints: cardPts, tricksBySeat, beloteTeam });
  return res.score[forTeam] - res.score[1 - forTeam];
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

/**
 * Élimination progressive : une carte est écartée quand, sur les mêmes donnes simulées,
 * elle fait nettement moins bien que la meilleure (écart moyen + 2,5 erreurs-types < 0).
 */
function eliminate(active, vals, baseCard, prior) {
  const bonus = (c) => (c === baseCard ? prior : 0);
  const best = active.reduce((a, b) => (mean(vals.get(b)) + bonus(b) > mean(vals.get(a)) + bonus(a) ? b : a));
  const bv = vals.get(best);
  return active.filter((c) => {
    if (c === best) return true;
    const cv = vals.get(c);
    const n = Math.min(cv.length, bv.length);
    const d = [];
    for (let i = 0; i < n; i++) d.push(cv[i] + bonus(c) - bv[i] - bonus(best));
    const m = mean(d);
    const sd = Math.sqrt(d.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, n - 1));
    return m + 2.5 * (sd / Math.sqrt(n)) >= 0;
  });
}

/**
 * Monte-Carlo : jusqu'à `maxSamples` donnes tirées selon les déductions, chaque carte jouable
 * évaluée en jouant la fin de la manche avec l'algorithme du robot ; les cartes nettement
 * inférieures sont éliminées en cours de route.
 */
export function monteCarloPlay(ctx, {
  budgetMs = TUNING.mcBudgetMs, maxSamples = TUNING.mcSamples, minSamples = 40,
  rand = Math.random, useAuction = true,
} = {}) {
  const kn = useAuction ? auctionKn(ctx) : null;
  const ctxK = { ...ctx, kn, auction: useAuction ? ctx.auction : [] };
  const info = analyze(ctxK);
  const legal = legalCards(ctx.hand, ctx.trick, ctx.contract.trump, ctx.seat);
  const base = heuristicPlay(ctxK, info);
  if (legal.length === 1) return base;
  const weights = cardWeights(ctxK, info, kn);
  const lengths = useAuction ? auctionLengths(ctxK, info) : {};
  const myTeam = teamOf(ctx.seat);
  // prime à la carte de la stratégie : les simulations ne s'en écartent que si l'écart est net
  const trumpDraw = !ctx.trick.length && isTrumpCard(base.card, ctx.contract.trump) && ctx.contract.team === myTeam;
  const prior = trumpDraw ? TUNING.mcPriorTrumpDraw : TUNING.mcPrior;
  const vals = new Map(legal.map((c) => [c, []]));
  let active = legal.slice();
  const start = now();
  let n = 0;
  while (n < maxSamples && active.length > 1 && (n < minSamples || now() - start < budgetMs)) {
    const hands = sampleHands(ctxK, info, rand, weights, lengths);
    if (!hands) break;
    const bt = beloteTeamFor(ctxK, hands, info.played);
    for (const c of active) vals.get(c).push(rollout(ctxK, hands, c, myTeam, bt, kn));
    n++;
    if (n >= minSamples && n % 20 === 0) active = eliminate(active, vals, base.card, prior);
  }
  if (!n) return base;
  const score = (c) => mean(vals.get(c)) + (c === base.card ? prior : 0);
  const best = active.reduce((a, b) => (score(b) > score(a) ? b : a));
  return {
    card: best,
    reason: best === base.card ? base.reason
      : `Après ${n} donnes simulées (tirées selon les annonces et le jeu), ${cardLabel(best)} est la carte qui rapporte le plus en moyenne.`,
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
    auction: view.auction ? view.auction.history : [],
    dealer: view.dealer,
    conv: { counterFrom: view.config && view.config.counterCallFrom !== undefined ? view.config.counterCallFrom : 100 },
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

