// Lecture des annonces : signification de chaque enchère selon la convention, et
// ce que l'on peut en déduire sur les mains (informations publiques uniquement).
import {
  SUITS, SUIT_SYMBOL, RANK_LABEL, teamOf, partnerOf, suitOf, rankOf,
} from './cards.js';
import { CAPOT, GENERALE, bidLabel } from './auction.js';

const S = (t) => SUIT_SYMBOL[t];
const isColor = (t) => SUITS.includes(t);
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const DEFAULT_NAMES = ['Sud', 'Est', 'Nord', 'Ouest'];
const short = (c) => `${RANK_LABEL[rankOf(c)]}${S(suitOf(c))}`;

/** Levées sûres annoncées par une enchère SA / TA. */
export function noTrumpTricksFor(v) {
  if (v >= CAPOT) return 8;
  if (v >= 110) return 7;
  if (v >= 90) return 6;
  return 5;
}

function openingMeaning(v, T, leads = false) {
  if (!isColor(T)) {
    const what = T === 'NT' ? 'as, 10, roi…' : 'valet, 9, as…';
    return `${T === 'NT' ? 'sans atout' : 'tout atout'} : au moins ${noTrumpTricksFor(v)} levées sûres (cartes maîtresses : ${what})${leads ? ' ; il entame, sa longue couleur maîtresse compte en entier' : ''}`;
  }
  if (v === CAPOT) return `capot : compte faire tous les plis à ${S(T)}`;
  if (v === GENERALE) return `générale : compte faire seul tous les plis à ${S(T)}`;
  if (v <= 80) return `valet ou 9 de ${S(T)} avec au moins 4 atouts (ou valet et 9 avec 3 atouts)`;
  if (v === 90) return `valet et 9 de ${S(T)}, au moins 4 atouts`;
  if (v === 100) return `valet, 9 et as de ${S(T)} (4 atouts), ou valet et 9 avec 5 atouts`;
  if (v <= 130) return `barrage : au moins 6 atouts à ${S(T)} avec le valet${v >= 120 ? ' et le 9' : ''}`;
  return `jeu exceptionnel à ${S(T)}`;
}

/** Indices garantis par une ouverture (cartes certaines, alternatives, longueur). */
function openingClaim(v, T) {
  if (!isColor(T)) return { tricks: { [T]: noTrumpTricksFor(v) } };
  const J = `J${T}`;
  const N = `9${T}`;
  if (v <= 80) return { oneOf: [[J, N]], minLen: { [T]: 3 } };
  if (v <= 100) return { has: [J, N], minLen: { [T]: 4 } };
  if (v === 110) return { has: [J], minLen: { [T]: 6 } };
  if (v <= 130) return { has: [J, N], minLen: { [T]: v === 130 ? 7 : 6 } };
  return { has: [J] };
}

/**
 * Signification de chaque annonce selon la convention.
 * Retourne un tableau parallèle à `history` : {seat, type, label, text, claim}.
 * `leader` : siège qui entame la première levée (le premier à parler).
 */
export function explainAuction(history, names = DEFAULT_NAMES, leader = null) {
  const res = [];
  let current = null;
  const seatBids = [[], [], [], []];
  for (const e of history) {
    const s = e.seat;
    const t = teamOf(s);
    const p = partnerOf(s);
    let text;
    let claim = {};
    if (e.type === 'pass') {
      const pBid = seatBids[p][seatBids[p].length - 1];
      if (pBid && !seatBids[s].some((b) => b.trump === pBid.trump)) {
        text = `rien pour soutenir ${names[p]} à ${S(pBid.trump)} (ni as, ni valet ou 9 d'atout)`;
        claim = { noSupport: pBid.trump };
      } else if (!seatBids[s].length) {
        text = current
          ? `pas de couleur assez forte pour dépasser ${current.value}`
          : 'pas de couleur avec le valet ou le 9 bien accompagné';
        if (!current) claim = { noOpening: true };
      } else text = 'plus rien à montrer';
    } else if (e.type === 'coinche') {
      text = current ? `pense que ${names[current.seat]} et son partenaire chuteront à ${bidLabel(current.value, current.trump)}` : 'coinche';
    } else if (e.type === 'surcoinche') {
      text = 'certain de réussir le contrat malgré la coinche';
    } else {
      const T = e.trump;
      const v = e.value;
      const forced = current && teamOf(current.seat) !== t;
      const pBidsT = seatBids[p].filter((b) => b.trump === T);
      const mineT = seatBids[s].filter((b) => b.trump === T);
      let teamLastT = null;
      for (const b of [...seatBids[s], ...seatBids[p]]) if (b.trump === T && (!teamLastT || b.order > teamLastT.order)) teamLastT = b;
      const pLast = seatBids[p][seatBids[p].length - 1];
      if (pBidsT.length && !mineT.length) {
        const raise = v - teamLastT.value;
        const k = Math.round(raise / 10);
        text = `soutien de ${names[p]} : +${raise} = ${plural(k, 'carte')} utile${k > 1 ? 's' : ''} (as, valet ou 9 d'atout ; belote = +20)${forced ? ', en concurrence' : ''}`;
        claim = { useful: { trump: T, count: k } };
      } else if (mineT.length) {
        const raise = v - teamLastT.value;
        const opened = seatBids[s][0] && seatBids[s][0].trump === T
          && !(seatBids[p].some((b) => b.trump === T && b.order < seatBids[s][0].order));
        if (opened && mineT.length === 1) {
          text = `second tour : +${raise} = ses as (${Math.round(raise / 10)} × 10, belote = +20)`;
          claim = { aces: Math.round(raise / 10), maybeBelote: raise >= 20 };
        } else text = `remonte à ${v} en concurrence`;
      } else if (pLast && pLast.trump !== T && T === 'AT' && isColor(pLast.trump)) {
        // passage à tout atout : avec les cartes montrées par le partenaire, l'équipe tient les 4 valets
        const partnerJacks = new Set();
        for (const r of res) {
          if (r.seat === p && r.claim.has) for (const c of r.claim.has) if (c[0] === 'J') partnerJacks.add(c);
        }
        const mine = SUITS.filter((x) => !partnerJacks.has(`J${x}`)).map((x) => `J${x}`);
        text = `passage à tout atout : avec les cartes montrées par ${names[p]}, l'équipe tient les 4 valets (${s === leader ? 'il entame' : 'valets'} ${mine.map(short).join(' ')})`;
        claim = { has: mine.length <= 3 ? mine : [], tricks: { AT: 5 } };
      } else if (pLast && pLast.trump !== T) {
        text = `nouvelle couleur : peu de ${S(pLast.trump)}, mais ${openingMeaning(Math.max(90, forced ? v - 10 : v), T, s === leader)}`;
        claim = isColor(T) ? { has: [`J${T}`], minLen: { [T]: 4 }, maxLen: { [pLast.trump]: 1 } } : openingClaim(Math.max(90, v), T);
      } else if (!current && res.length === 3 && res.every((r) => r.type === 'pass') && v === 80) {
        text = `ouverture en dernière position : valet de ${S(T)} avec 3 atouts, ou 9 avec 4 atouts`;
        claim = { oneOf: [[`J${T}`, `9${T}`]], minLen: { [T]: 3 } };
      } else if (forced && v === current.value + 10) {
        if (!isColor(T)) {
          text = `surenchère : ${openingMeaning(Math.min(v - 10, 110), T, s === leader)}, ou mieux`;
          claim = openingClaim(Math.min(v - 10, 110), T);
        } else {
          text = v - 10 <= 80
            ? `surenchère : ${openingMeaning(80, T)}, ou mieux`
            : `surenchère : au moins le valet ou le 9 de ${S(T)}, avec des as ou un jeu plus fort`;
          claim = { oneOf: [[`J${T}`, `9${T}`]], minLen: { [T]: 3 } };
        }
      } else {
        text = openingMeaning(v, T, s === leader);
        claim = openingClaim(v, T);
      }
      seatBids[s].push({ trump: T, value: v, order: res.length });
      current = { seat: s, value: v, trump: T };
    }
    const label = e.type === 'bid' ? bidLabel(e.value, e.trump)
      : e.type === 'pass' ? 'Passe' : e.type === 'coinche' ? 'Coinche' : 'Surcoinche';
    res.push({ seat: s, type: e.type, label, text: text.charAt(0).toUpperCase() + text.slice(1), claim });
  }
  return res;
}

/**
 * Ce que l'on sait de chaque joueur d'après toutes ses annonces.
 * Retourne un tableau [siège] de {has:Set, oneOf:[[a,b]], minLen:{}, maxLen:{}, tricks:{}, aces, useful:[], noOpening, noSupport:Set, suits:Set}.
 */
export function auctionKnowledge(history, leader = null) {
  const k = [0, 1, 2, 3].map(() => ({
    has: new Set(), oneOf: [], minLen: {}, maxLen: {}, tricks: {}, aces: 0, maybeBelote: false, useful: [],
    noOpening: false, noSupport: new Set(), suits: new Set(),
  }));
  for (const e of explainAuction(history, DEFAULT_NAMES, leader)) {
    const kn = k[e.seat];
    const c = e.claim;
    for (const card of c.has || []) kn.has.add(card);
    for (const pair of c.oneOf || []) {
      if (!pair.some((x) => kn.has.has(x)) && !kn.oneOf.some((q) => q[0] === pair[0] && q[1] === pair[1])) kn.oneOf.push(pair);
    }
    for (const [s, n] of Object.entries(c.minLen || {})) { kn.minLen[s] = Math.max(kn.minLen[s] || 0, n); kn.suits.add(s); }
    for (const [s, n] of Object.entries(c.maxLen || {})) kn.maxLen[s] = Math.min(kn.maxLen[s] ?? 8, n);
    for (const [t, n] of Object.entries(c.tricks || {})) { kn.tricks[t] = Math.max(kn.tricks[t] || 0, n); kn.suits.add(t); }
    if (c.aces) { kn.aces += c.aces; kn.maybeBelote = kn.maybeBelote || !!c.maybeBelote; }
    if (c.useful) kn.useful.push(c.useful);
    if (c.noOpening) kn.noOpening = true;
    if (c.noSupport) kn.noSupport.add(c.noSupport);
  }
  // une alternative tranchée par une carte certaine disparaît
  for (const kn of k) kn.oneOf = kn.oneOf.filter((pair) => !pair.some((x) => kn.has.has(x)));
  return k;
}

/** Cartes que `seat` détient à coup sûr, vu depuis une main `myHand` (les alternatives se résolvent si l'on tient l'une des deux cartes). */
export function knownCards(knowledge, seat, myHand = []) {
  const kn = knowledge[seat];
  const out = new Set();
  for (const c of kn.has) if (!myHand.includes(c)) out.add(c);
  for (const [a, b] of kn.oneOf) {
    if (myHand.includes(a) && !myHand.includes(b)) out.add(b);
    else if (myHand.includes(b) && !myHand.includes(a)) out.add(a);
  }
  return out;
}

/** Couleurs annoncées (à la couleur) par l'équipe adverse de `seat`. */
export function opponentSuits(knowledge, seat) {
  const out = new Set();
  for (const s of [(seat + 1) % 4, (seat + 3) % 4]) {
    for (const x of knowledge[s].suits) if (isColor(x)) out.add(x);
  }
  return out;
}

/** Résumé lisible de ce que l'on sait des trois autres joueurs, croisé avec sa propre main. */
export function describeKnowledge(history, names, leader, mySeat, myHand = []) {
  const kn = auctionKnowledge(history, leader);
  const lines = [];
  for (const s of [partnerOf(mySeat), (mySeat + 1) % 4, (mySeat + 3) % 4]) {
    const k = kn[s];
    const parts = [];
    const certain = knownCards(kn, s, myHand);
    const bySuit = {};
    for (const c of certain) (bySuit[suitOf(c)] ||= []).push(c);
    const suits = new Set([...Object.keys(bySuit), ...Object.keys(k.minLen)]);
    for (const x of SUITS) {
      if (!suits.has(x)) continue;
      const items = [];
      if (bySuit[x]) {
        const resolved = bySuit[x].filter((c) => !k.has.has(c));
        items.push(bySuit[x].map(short).join(' et ')
          + (resolved.length ? ` (vous avez ${k.oneOf.flat().filter((c) => suitOf(c) === x && myHand.includes(c)).map(short).join(', ')})` : ''));
      } else {
        const pair = k.oneOf.find((q) => suitOf(q[0]) === x);
        if (pair) items.push(`${short(pair[0])} ou ${short(pair[1])}`);
      }
      if (k.minLen[x]) items.push(`au moins ${k.minLen[x]} ${S(x)}`);
      parts.push(items.join(', '));
    }
    for (const [x, n] of Object.entries(k.maxLen)) parts.push(`au plus ${n} ${S(x)}`);
    if (k.tricks.NT) parts.push(`${k.tricks.NT} levées sûres en sans atout (des as)`);
    if (k.tricks.AT) parts.push(`${k.tricks.AT} levées sûres en tout atout (des valets)`);
    for (const u of k.useful) parts.push(`${plural(u.count, 'carte')} utile${u.count > 1 ? 's' : ''} à ${S(u.trump)} (as, valet ou 9)`);
    if (k.aces) parts.push(`${k.aces} as${k.maybeBelote ? ' (ou la belote à la place de 2 as)' : ''}`);
    for (const x of k.noSupport) parts.push(`ni as ni valet/9 de ${S(x)}`);
    if (k.noOpening && !parts.length) parts.push('aucune couleur forte (a passé d\'entrée)');
    const role = s === partnerOf(mySeat) ? 'partenaire' : 'adversaire';
    lines.push({ seat: s, text: `${names[s]} (${role}) : ${parts.length ? parts.join(' ; ') : 'rien de connu'}` });
  }
  return lines;
}
