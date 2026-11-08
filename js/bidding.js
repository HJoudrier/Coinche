// Enchères par conventions (robots et conseils au joueur).
//
// 1re annonce dans une couleur = qualité de l'atout seulement (les as viennent plus tard) :
//   80  : valet ou 9 (l'un des deux manque) avec au moins 4 atouts, ou valet et 9 avec 3 atouts
//   90  : valet et 9 avec au moins 4 atouts
//   100 : valet, 9 et as d'atout (4 atouts), ou valet et 9 avec 5 atouts
//   110+: barrage avec 6 atouts ou plus dont le valet (120 avec le 9, 130 avec 7 atouts)
// Surenchère sur un adversaire : jusqu'à « valeur d'ouverture + 10 ».
// Soutien du partenaire : +10 par carte utile (as, valet ou 9 d'atout), belote +20.
// Second tour de l'ouvreur : +10 par as (belote +20).
import {
  SUITS, TRUMPS, SUIT_SYMBOL, SUIT_NAME, suitOf, teamOf, partnerOf,
} from './cards.js';
import { CAPOT, GENERALE, bidLabel } from './auction.js';
import { evaluateHand, defenseScore } from './ai.js';

const isColor = (t) => SUITS.includes(t);
const S = (t) => SUIT_SYMBOL[t];
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

export function trumpProfile(hand, T) {
  const has = (r) => hand.includes(r + T);
  return {
    n: hand.filter((c) => suitOf(c) === T).length,
    J: has('J'),
    N: has('9'),
    A: has('A'),
    belote: has('K') && has('Q'),
    sideAces: SUITS.filter((s) => s !== T && hand.includes(`A${s}`)).length,
  };
}

// Ordre des cartes maîtresses en sans atout et en tout atout.
const NT_ORDER = { NT: ['A', 'T', 'K', 'Q', 'J', '9', '8', '7'], AT: ['J', '9', 'A', 'T', 'K', 'Q', '8', '7'] };
const RANK_WORD = { A: 'as', T: '10', K: 'roi', Q: 'dame', J: 'valet', 9: '9', 8: '8', 7: '7' };

/**
 * Levées sûres en sans atout / tout atout : les cartes maîtresses en tête de chaque couleur.
 * Si l'on entame la manche (`leads`), une longue couleur dont les maîtresses suffisent à faire
 * tomber celles des adversaires compte en entier : on garde la main et on encaisse toute la couleur.
 */
export function sureTricksNT(hand, T, leads = false) {
  const parts = [];
  let total = 0;
  let longIgnored = null;
  for (const s of SUITS) {
    const n = hand.filter((c) => suitOf(c) === s).length;
    if (!n) continue;
    let k = 0;
    for (const r of NT_ORDER[T]) { if (hand.includes(r + s)) k++; else break; }
    const solid = k >= Math.min(n, 8 - n) && n > k;
    const count = solid && leads ? n : k;
    if (solid && !leads && n >= 4) longIgnored = s;
    if (count) parts.push({ suit: s, n, k, count, long: solid && leads });
    total += count;
  }
  return { total, parts, longIgnored };
}

function describeTricks(st, T) {
  return st.parts.map((p) => (p.long
    ? `longue ${S(p.suit)} maîtresse (${p.n} levées)`
    : `${NT_ORDER[T].slice(0, p.k).map((r) => RANK_WORD[r]).join(', ')} ${S(p.suit)}`)).join(' ; ');
}

/** Valeur d'une annonce sans atout / tout atout selon le nombre de levées sûres. */
export function noTrumpValue(tricks) {
  if (tricks >= 8) return CAPOT;
  if (tricks >= 7) return 110;
  if (tricks >= 6) return 90;
  if (tricks >= 5) return 80;
  return null;
}

/**
 * Valeur d'ouverture d'une main pour un atout, selon la convention, ou null.
 * Retourne {value, kind, text} ; text est rédigé à la 2e personne pour les conseils.
 * `leads` : le joueur entame la première levée (il parle en premier).
 */
export function openingValue(hand, T, { loose = false, leads = false } = {}) {
  if (T === 'NT' || T === 'AT') {
    const st = sureTricksNT(hand, T, leads);
    const value = noTrumpValue(st.total);
    if (!value) return null;
    const name = T === 'NT' ? 'sans atout' : 'tout atout';
    let text = `${leads ? 'vous entamez la manche et ' : ''}vous avez ${st.total} levées sûres en ${name} (${describeTricks(st, T)})`;
    if (st.longIgnored) text += `. Votre longue ${S(st.longIgnored)} ne compte pas en entier car vous n'entamez pas`;
    return { value, kind: T === 'NT' ? 'SA' : 'TA', text, tricks: st.total };
  }
  const p = trumpProfile(hand, T);
  if (p.J && p.n >= 6) {
    const value = p.N ? (p.n >= 7 ? 130 : 120) : 110;
    return { value, kind: 'barrage', text: `vous avez ${p.n} atouts à ${S(T)} avec le valet${p.N ? ' et le 9' : ''}` };
  }
  if (p.J && p.N && p.n >= 4) {
    if (p.A || p.n >= 5) {
      return { value: 100, kind: 'V9+', text: `vous avez le valet, le 9${p.A ? ' et l\'as' : ''} de ${S(T)} (${p.n} atouts)` };
    }
    return { value: 90, kind: 'V9', text: `vous avez le valet et le 9 de ${S(T)} (${p.n} atouts)` };
  }
  if (p.J && p.N && p.n >= 3) {
    return { value: 80, kind: 'V9court', text: `vous avez le valet et le 9 de ${S(T)}, mais seulement ${p.n} atouts` };
  }
  if (p.J && (p.n >= 4 || (loose && p.n >= 3))) {
    return { value: 80, kind: 'V', text: `vous avez le valet de ${S(T)} sans le 9, avec ${p.n} atouts` };
  }
  if (p.N && (p.n >= 5 || (p.A && p.n >= 4) || (loose && p.n >= 4))) {
    return { value: 80, kind: '9', text: `vous avez le 9 de ${S(T)} sans le valet, avec ${p.n} atouts` };
  }
  return null;
}

/** Cartes utiles pour soutenir le partenaire à l'atout T : +10 par as, valet ou 9 d'atout ; belote +20. */
export function usefulCards(hand, T) {
  const notes = [];
  let points = 0;
  if (isColor(T)) {
    const p = trumpProfile(hand, T);
    const aces = p.sideAces + (p.A ? 1 : 0);
    if (aces) { points += 10 * aces; notes.push(`${aces} as`); }
    if (p.J) { points += 10; notes.push(`le valet ${S(T)}`); }
    if (p.N) { points += 10; notes.push(`le 9 ${S(T)}`); }
    if (p.belote) { points += 20; notes.push('la belote'); }
  } else if (T === 'NT') {
    const aces = SUITS.filter((s) => hand.includes(`A${s}`)).length;
    if (aces) { points += 10 * aces; notes.push(`${aces} as`); }
  } else {
    const jacks = SUITS.filter((s) => hand.includes(`J${s}`)).length;
    if (jacks) { points += 10 * jacks; notes.push(plural(jacks, 'valet')); }
  }
  return { points, notes };
}

/** As montrés au second tour par l'ouvreur (+10 par as hors atout, as d'atout s'il n'a pas servi à l'ouverture, belote +20). */
export function acesToShow(hand, T, openingKind) {
  const notes = [];
  let points = 0;
  if (!isColor(T)) return { points, notes };
  const p = trumpProfile(hand, T);
  let aces = p.sideAces;
  if (p.A && ['V', 'V9', 'V9court', 'barrage'].includes(openingKind)) aces++;
  if (aces) { points += 10 * aces; notes.push(`${aces} as`); }
  if (p.belote) { points += 20; notes.push('la belote'); }
  return { points, notes };
}

function lastBidOf(history, seat, trump = null) {
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.seat === seat && h.type === 'bid' && (trump === null || h.trump === trump)) return h;
  }
  return null;
}

function teamLastIn(history, team, trump) {
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.type === 'bid' && teamOf(h.seat) === team && h.trump === trump) return h;
  }
  return null;
}

/** Ce que l'équipe a « montré » à l'atout T (annonces libres), pour repérer une surenchère forcée. */
function shownValue(history, team, trump) {
  let current = null;
  let shown = 0;
  for (const h of history) {
    if (h.type !== 'bid') continue;
    if (teamOf(h.seat) === team && h.trump === trump) {
      const forced = current && teamOf(current.seat) !== team;
      shown = Math.max(shown, forced ? h.value - 10 : h.value);
    }
    current = h;
  }
  return shown;
}

/**
 * Analyse d'enchère : {action, estimates, explanation}.
 * view : vue du moteur en phase d'enchères (hand, seat, auction, options).
 */
export function analyzeBid(view, level = 'medium', rand = Math.random) {
  const { hand, seat, auction, options, names } = view;
  const partner = partnerOf(seat);
  const myTeam = teamOf(seat);
  const hist = auction.history;
  const current = auction.current;
  const estimates = {};
  for (const t of TRUMPS) estimates[t] = evaluateHand(hand, t);
  const out = (action, explanation) => ({ action, estimates, explanation });
  const pname = names ? names[partner] : 'votre partenaire';
  // Le premier à parler entame aussi la première levée.
  const leads = view.dealer !== undefined && view.dealer !== null && (view.dealer + 1) % 4 === seat;

  // Phase de surcoinche
  if (auction.mult > 1) {
    if (options.surcoinche && level !== 'easy') {
      const e = estimates[current.trump];
      if (e.points + (e.belote ? 20 : 0) >= current.value + 30) {
        return out({ type: 'surcoinche' }, 'Votre jeu est très solide : surcoinchez !');
      }
    }
    return out({ type: 'pass' }, 'Laissez la coinche.');
  }

  const required = current ? current.value + 10 : 80;
  const myBids = hist.filter((h) => h.seat === seat && h.type === 'bid');
  const partnerLast = lastBidOf(hist, partner);
  const teamLast = (() => {
    for (let i = hist.length - 1; i >= 0; i--) if (hist[i].type === 'bid' && teamOf(hist[i].seat) === myTeam) return hist[i];
    return null;
  })();
  const over = (v) => (current ? `surenchère sur ${current.value} ${S(current.trump)} : ` : '');
  const candidates = [];

  // 1) Soutien du partenaire (une seule fois par couleur)
  if (partnerLast && !myBids.some((b) => b.trump === partnerLast.trump)) {
    const T = partnerLast.trump;
    const sup = usefulCards(hand, T);
    if (sup.points >= 10) {
      const base = teamLastIn(hist, myTeam, T).value;
      candidates.push({
        prio: 3,
        value: base + sup.points,
        trump: T,
        why: `${pname} a annoncé ${base} ${S(T)} ; vous avez ${sup.notes.join(', ')} : +${sup.points} (10 par carte utile, belote 20) → ${base + sup.points} ${S(T)}.`,
      });
    }
  }

  // 2) Second tour de l'ouvreur : annoncer ses as dans sa couleur
  const forgetAces = level === 'easy' && rand() < 0.5;
  if (myBids.length && teamLast && !forgetAces) {
    const T = teamLast.trump;
    const mine = myBids.filter((b) => b.trump === T);
    const firstInT = hist.find((h) => h.type === 'bid' && teamOf(h.seat) === myTeam && h.trump === T);
    const iOpened = firstInT && firstInT.seat === seat;
    if (iOpened && mine.length === 1) {
      const op = openingValue(hand, T, { loose: true, leads });
      const show = acesToShow(hand, T, op ? op.kind : 'V');
      if (show.points >= 10) {
        candidates.push({
          prio: 2,
          value: teamLast.value + show.points,
          trump: T,
          why: `Second tour : annoncez ${show.notes.join(' et ')} : +${show.points} → ${teamLast.value + show.points} ${S(T)}.`,
        });
      }
    }
  }

  // 3) Première annonce : ouverture, surenchère ou changement de couleur
  // En dernière position après trois « passe », on peut ouvrir plus léger (3 atouts suffisent).
  const lastChance = !current && hist.length === 3 && hist.every((h) => h.type === 'pass');
  if (!myBids.length) {
    for (const T of TRUMPS) {
      const op = openingValue(hand, T, { loose: lastChance || (level === 'easy' && rand() < 0.5), leads });
      if (!op) continue;
      let prio = 1;
      let prefix = '';
      if (partnerLast && T !== partnerLast.trump) {
        // changement de couleur : pas de soutien pour le partenaire et une couleur forte
        if (hand.filter((c) => suitOf(c) === partnerLast.trump).length > 1 || op.value < 90) continue;
        prio = 0;
        prefix = `peu de ${S(partnerLast.trump)} pour ${pname}, mais `;
      }
      let value = op.value;
      let compete = null;
      if (value < required) {
        // en concurrence, on ne reparlera peut-être pas : on compte aussi ses as (et la belote)
        const show = acesToShow(hand, T, op.kind);
        if (required > op.value + 10 + show.points) continue;
        if (required > op.value + 10) compete = show;
        value = required;
      }
      const opening = !current;
      let why;
      if (op.kind === 'SA' || op.kind === 'TA') why = `${op.text} : ${over(value)}annoncez ${bidLabel(value, T)}.`;
      else if (op.kind === 'barrage') why = `${op.text} : barrage à ${value} ${S(T)} pour gêner les adversaires.`;
      else if (lastChance && value === 80) {
        why = `${op.text} : les trois autres ont passé, vous pouvez ouvrir plus léger à 80 ${S(T)} en dernière position.`;
      } else if (opening) {
        why = `${op.text} : ouvrez à ${value} ${S(T)}.${['V', '9', 'V9court'].includes(op.kind) ? ' Votre partenaire complétera ; vos as viendront au second tour.' : ''}`;
      } else if (compete) {
        why = `${op.text}, plus ${compete.notes.join(' et ')} : en concurrence, comptez aussi vos as → ${over(value)}${value} ${S(T)}.`;
      } else why = `${op.text} : ${over(value)}${value} ${S(T)}.`;
      why = (prefix ? prefix : '') + why;
      candidates.push({
        prio, value, trump: T, why: why.charAt(0).toUpperCase() + why.slice(1), kind: op.kind, capotSure: op.value === CAPOT,
      });
    }
  }

  // Plafond / capot, puis choix
  for (const c of candidates) {
    if (c.value > 160 && !c.capotSure) {
      if (estimates[c.trump].sureTricks >= 7) { c.value = CAPOT; c.why += ' Assez de levées sûres : capot !'; } else c.value = 160;
    }
  }
  const legal = candidates.filter((c) => options.values.includes(c.value) && c.value >= required);
  if (legal.length) {
    legal.sort((a, b) => b.prio - a.prio || b.value - a.value);
    const best = legal[0];
    return out({ type: 'bid', value: best.value, trump: best.trump }, best.why);
  }

  // 4) Coincher les adversaires ?
  if (options.coinche && current && level !== 'easy' && current.value < CAPOT) {
    let d = defenseScore(hand, current.trump, current.value);
    if (level === 'hard' && current.value - shownValue(hist, teamOf(current.seat), current.trump) >= 20) d += 0.5;
    if (d >= (level === 'hard' ? 4.7 : 5)) {
      return out({ type: 'coinche' },
        `Les adversaires annoncent ${current.value} ${S(current.trump)} mais vous avez de la longueur ou les gros atouts à ${S(current.trump)} : coinchez.`);
    }
  }

  // 5) Passer, avec la raison
  let explanation = 'Aucune couleur avec le valet ou le 9 bien accompagné : passez.';
  if (partnerLast && !myBids.some((b) => b.trump === partnerLast.trump)) {
    explanation = `Rien pour soutenir ${pname} à ${S(partnerLast.trump)} (ni as, ni valet ou 9 d'atout) : passez.`;
  } else if (myBids.length) {
    explanation = current && teamOf(current.seat) === myTeam
      ? 'Vous avez déjà montré votre jeu : passez.'
      : `Votre équipe a déjà montré tout son jeu : pas de quoi dépasser ${current ? current.value : ''} ${current ? S(current.trump) : ''}.`;
  } else if (current) {
    const best = TRUMPS.map((t) => openingValue(hand, t, { leads })).filter(Boolean).sort((a, b) => b.value - a.value)[0];
    explanation = best
      ? `${best.text.charAt(0).toUpperCase() + best.text.slice(1)}, mais cela ne suffit pas pour dépasser ${current.value} : passez.`
      : `Pas de couleur à annoncer au-dessus de ${current.value} : passez.`;
  }
  return out({ type: 'pass' }, explanation);
}

export function chooseBid(view, level = 'medium', rand = Math.random) {
  return analyzeBid(view, level, rand).action;
}

// ---------------------------------------------------------------------------
// Lecture des annonces (informations publiques uniquement)
// ---------------------------------------------------------------------------
function openingMeaning(v, T, leads = false) {
  if (T === 'NT' || T === 'AT') {
    const n = v >= CAPOT ? 8 : v >= 110 ? 7 : v >= 90 ? 6 : 5;
    const what = T === 'NT' ? 'as, 10, roi…' : 'valet, 9, as…';
    return `${T === 'NT' ? 'sans atout' : 'tout atout'} : au moins ${n} levées sûres (cartes maîtresses : ${what})${leads ? ' ; il entame, sa longue couleur maîtresse compte en entier' : ''}`;
  }
  if (v === CAPOT) return `capot : compte faire tous les plis à ${S(T)}`;
  if (v === GENERALE) return `générale : compte faire seul tous les plis à ${S(T)}`;
  if (v <= 80) return `valet ou 9 de ${S(T)} avec au moins 4 atouts (ou valet et 9 avec 3 atouts)`;
  if (v === 90) return `valet et 9 de ${S(T)}, au moins 4 atouts`;
  if (v === 100) return `valet, 9 et as de ${S(T)} (4 atouts), ou valet et 9 avec 5 atouts`;
  if (v <= 130) return `barrage : au moins 6 atouts à ${S(T)} avec le valet${v >= 120 ? ' et le 9' : ''}`;
  return `jeu exceptionnel à ${S(T)}`;
}

/**
 * Signification de chaque annonce selon la convention.
 * Retourne un tableau parallèle à `history` : {seat, type, label, text}.
 */
export function explainAuction(history, names, leader = null) {
  const res = [];
  let current = null;
  const seatBids = [[], [], [], []];
  for (const e of history) {
    const s = e.seat;
    const t = teamOf(s);
    const p = partnerOf(s);
    let text;
    if (e.type === 'pass') {
      const pBid = seatBids[p][seatBids[p].length - 1];
      if (pBid && !seatBids[s].some((b) => b.trump === pBid.trump)) {
        text = `rien pour soutenir ${names[p]} à ${S(pBid.trump)} (ni as, ni valet ou 9 d'atout)`;
      } else if (!seatBids[s].length) {
        text = current
          ? `pas de couleur assez forte pour dépasser ${current.value}`
          : 'pas de couleur avec le valet ou le 9 bien accompagné';
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
      } else if (mineT.length) {
        const raise = v - teamLastT.value;
        const opened = seatBids[s][0] && seatBids[s][0].trump === T
          && !(seatBids[p].some((b) => b.trump === T && b.order < seatBids[s][0].order));
        text = opened && mineT.length === 1
          ? `second tour : +${raise} = ses as (${Math.round(raise / 10)} × 10, belote = +20)`
          : `remonte à ${v} en concurrence`;
      } else if (pLast && pLast.trump !== T) {
        text = `nouvelle couleur : peu de ${S(pLast.trump)}, mais ${openingMeaning(Math.max(90, forced ? v - 10 : v), T, s === leader)}`;
      } else if (!current && res.length === 3 && res.every((r) => r.type === 'pass') && v === 80) {
        text = `ouverture en dernière position : valet de ${S(T)} avec 3 atouts, ou 9 avec 4 atouts`;
      } else if (forced && v === current.value + 10) {
        text = `surenchère : ${openingMeaning(Math.min(v - 10, 100), T, s === leader)}, ou mieux${v > 90 && SUITS.includes(T) ? ' (as compris)' : ''}`;
      } else {
        text = openingMeaning(v, T, s === leader);
      }
      const entry = { trump: T, value: v, order: res.length };
      seatBids[s].push(entry);
      current = { seat: s, value: v, trump: T };
    }
    const label = e.type === 'bid' ? bidLabel(e.value, e.trump)
      : e.type === 'pass' ? 'Passe' : e.type === 'coinche' ? 'Coinche' : 'Surcoinche';
    res.push({ seat: s, type: e.type, label, text: text.charAt(0).toUpperCase() + text.slice(1) });
  }
  return res;
}

export const CONVENTION_SUMMARY = [
  ['80', 'Valet ou 9 d\'atout (l\'un des deux manque) avec au moins 4 atouts, ou valet et 9 avec seulement 3 atouts. Les as ne comptent pas dans la première annonce.'],
  ['90', 'Valet et 9 d\'atout avec au moins 4 atouts. Sur un 80 adverse, 90 peut aussi être une simple surenchère avec le valet ou le 9.'],
  ['100', 'Valet, 9 et as d\'atout (4 atouts), ou valet et 9 avec 5 atouts.'],
  ['110-130', 'Barrage : au moins 6 atouts avec le valet (120 avec le 9, 130 avec 7 atouts).'],
  ['Soutien', 'Le partenaire monte de 10 par carte utile : chaque as, le valet ou le 9 d\'atout ; la belote vaut 20. Sans rien, il passe.'],
  ['2e tour', 'L\'ouvreur annonce ses as : +10 par as (belote +20) sur l\'enchère de son équipe.'],
  ['Concurrence', 'Pour dépasser une enchère adverse, on peut monter de 10 au-dessus de sa valeur d\'ouverture, et compter aussi ses as (+10 chacun).'],
  ['Nouvelle couleur', 'Peu de cartes dans la couleur du partenaire mais une couleur très forte (valet et 9, ou 6 atouts).'],
  ['4e position', 'Après trois « passe », on peut ouvrir à 80 plus légèrement : le valet avec 3 atouts, ou le 9 avec 4 atouts.'],
  ['SA / TA', 'On compte ses levées sûres, c\'est-à-dire ses cartes maîtresses (as, 10, roi… en sans atout ; valet, 9, as… en tout atout) : 5 levées = 80, 6 = 90, 7 = 110, 8 = capot. Celui qui parle en premier entame la manche : sa longue couleur maîtresse compte alors en entier, car il garde la main et encaisse toute la couleur.'],
  ['Coinche', 'Longueur à l\'atout adverse avec le valet ou le 9 : le contrat adverse a de bonnes chances de chuter.'],
];

export { SUIT_NAME };
