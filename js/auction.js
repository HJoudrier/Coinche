// Enchères : 80 → 180, Capot, Générale à ♥ ♦ ♠ ♣, Sans atout, Tout atout ; coinche et surcoinche.
import { teamOf, nextSeat, TRUMPS, SUIT_SYMBOL } from './cards.js';

export const CAPOT = 250;
export const GENERALE = 500;
export const BID_VALUES = [80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, CAPOT, GENERALE];

export function bidValueLabel(v) {
  if (v === CAPOT) return 'Capot';
  if (v === GENERALE) return 'Générale';
  return String(v);
}

export function bidLabel(value, trump) {
  return `${bidValueLabel(value)} ${SUIT_SYMBOL[trump]}`;
}

export function actionLabel(a) {
  switch (a.type) {
    case 'pass': return 'Passe';
    case 'coinche': return 'Coinche !';
    case 'surcoinche': return 'Surcoinche !';
    case 'bid': return bidLabel(a.value, a.trump);
    default: return '';
  }
}

export function newAuction(dealer) {
  const first = nextSeat(dealer);
  return {
    dealer,
    turn: first,
    history: [], // {seat, type, value?, trump?}
    current: null, // {seat, value, trump}
    mult: 1,
    coincheBy: null,
    surcoincheBy: null,
    passCount: 0,
    pendingSurcoinche: null, // sièges de l'équipe preneuse pouvant encore surcoincher
    finished: false,
  };
}

/** Actions possibles pour `seat`. Retourne {pass, bids:[values], minValue, coinche, surcoinche}. */
export function auctionOptions(a, seat) {
  const none = { pass: false, minValue: null, values: [], coinche: false, surcoinche: false };
  if (a.finished || a.turn !== seat) return none;
  if (a.mult > 1) {
    return {
      ...none,
      pass: true,
      surcoinche: a.mult === 2 && teamOf(seat) === teamOf(a.current.seat),
    };
  }
  const values = BID_VALUES.filter((v) => !a.current || v > a.current.value);
  return {
    pass: true,
    minValue: values.length ? values[0] : null,
    values,
    coinche: !!a.current && teamOf(a.current.seat) !== teamOf(seat),
    surcoinche: false,
  };
}

export function isAuctionActionLegal(a, seat, action) {
  const o = auctionOptions(a, seat);
  switch (action.type) {
    case 'pass': return o.pass;
    case 'coinche': return o.coinche;
    case 'surcoinche': return o.surcoinche;
    case 'bid': return o.values.includes(action.value) && TRUMPS.includes(action.trump);
    default: return false;
  }
}

/** Applique l'action (mutation). Lève une erreur si illégale. */
export function applyAuction(a, seat, action) {
  if (!isAuctionActionLegal(a, seat, action)) throw new Error('Enchère illégale');
  const entry = { seat, type: action.type };
  if (action.type === 'bid') { entry.value = action.value; entry.trump = action.trump; }
  a.history.push(entry);

  if (a.mult > 1) {
    // Phase de surcoinche : seuls les preneurs parlent.
    if (action.type === 'surcoinche') {
      a.mult = 4;
      a.surcoincheBy = seat;
      a.finished = true;
      return a;
    }
    a.pendingSurcoinche.shift();
    if (!a.pendingSurcoinche.length) a.finished = true;
    else a.turn = a.pendingSurcoinche[0];
    return a;
  }

  if (action.type === 'bid') {
    a.current = { seat, value: action.value, trump: action.trump };
    a.passCount = 0;
    a.turn = nextSeat(seat);
  } else if (action.type === 'pass') {
    a.passCount++;
    if ((a.current && a.passCount >= 3) || (!a.current && a.passCount >= 4)) {
      a.finished = true;
    } else {
      a.turn = nextSeat(seat);
    }
  } else if (action.type === 'coinche') {
    a.mult = 2;
    a.coincheBy = seat;
    a.pendingSurcoinche = [nextSeat(seat), (seat + 3) % 4];
    a.turn = a.pendingSurcoinche[0];
  }
  return a;
}

/** Contrat issu des enchères, ou null si tout le monde a passé. */
export function auctionResult(a) {
  if (!a.finished || !a.current) return null;
  return {
    seat: a.current.seat,
    team: teamOf(a.current.seat),
    value: a.current.value,
    trump: a.current.trump,
    mult: a.mult,
    coincheBy: a.coincheBy,
    surcoincheBy: a.surcoincheBy,
  };
}

export function contractLabel(c) {
  if (!c) return '';
  const m = c.mult === 4 ? ' surcoinché' : c.mult === 2 ? ' coinché' : '';
  return bidLabel(c.value, c.trump) + m;
}
