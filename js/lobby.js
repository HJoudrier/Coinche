// Salon et places d'une partie en ligne : quelles places sont libres, comment les présenter
// à un invité qui arrive, et que faire de lui. Fonctions pures, sans DOM ni réseau.

export const SEAT_LABELS = ['Sud', 'Est', 'Nord', 'Ouest'];
/** Places que peut occuper un invité (l'hôte est toujours au Sud), partenaire de l'hôte d'abord. */
export const GUEST_SEATS = [2, 1, 3];

/**
 * Places libres dans le salon : réservées à un invité (« Invité ») et pas encore prises.
 * @param {{kinds: string[], guests: Object}} lobby
 */
export function lobbyFreeSeats(lobby) {
  return GUEST_SEATS.filter((s) => lobby.kinds[s] === 'remote' && !lobby.guests[s]);
}

/**
 * Places libres en cours de partie : une place d'invité absente dont un robot a pris le relais.
 * Un nouveau venu ne prend jamais la place d'un joueur que la table attend encore.
 * @param {Array<{kind:string, standIn?:boolean, connected?:boolean}>} seats
 */
export function gameFreeSeats(seats) {
  return GUEST_SEATS.filter((s) => seats[s].kind === 'remote' && seats[s].standIn && !seats[s].connected);
}

/**
 * Que faire d'un invité qui se présente ?
 * - `{seat}` : une place s'impose (celle qu'il occupait, ou la seule libre) ;
 * - `{choose: true}` : plusieurs places libres, il choisit ;
 * - `{full: true}` : plus aucune place libre.
 * @param {number[]} free places libres
 * @param {number} [preferred] place qu'il occupait avant de perdre sa liaison
 */
export function placement(free, preferred) {
  if (preferred !== undefined && free.includes(preferred)) return { seat: preferred };
  if (free.length === 0) return { full: true };
  if (free.length === 1) return { seat: free[0] };
  return { choose: true };
}

/**
 * La table telle que la voit un invité : pour chaque place, qui l'occupe et si elle est libre.
 * `kind` : 'host' (l'hôte, au Sud) | 'robot' | 'guest' (joueur en ligne, ou place qui lui est réservée).
 * @returns {Array<{seat:number, label:string, kind:'host'|'robot'|'guest', name:string|null, free:boolean, replaced?:boolean}>}
 */
export function lobbyTable(lobby, hostName) {
  return [0, 1, 2, 3].map((s) => {
    const label = SEAT_LABELS[s];
    if (s === 0) return { seat: s, label, kind: 'host', name: hostName, free: false };
    if (lobby.kinds[s] !== 'remote') return { seat: s, label, kind: 'robot', name: 'Robot', free: false };
    const g = lobby.guests[s];
    return { seat: s, label, kind: 'guest', name: g ? g.name : null, free: !g };
  });
}

/** Idem pendant la partie : une place libre garde le nom de son ancien occupant (`replaced`). */
export function gameTable(seats) {
  const free = gameFreeSeats(seats);
  return seats.map((s, i) => {
    const label = SEAT_LABELS[i];
    if (s.kind === 'local') return { seat: i, label, kind: 'host', name: s.name, free: false };
    if (s.kind === 'robot') return { seat: i, label, kind: 'robot', name: 'Robot', free: false };
    if (free.includes(i)) return { seat: i, label, kind: 'guest', name: s.name, free: true, replaced: true };
    return { seat: i, label, kind: 'guest', name: s.name, free: false };
  });
}

/** Avec qui l'on joue en s'asseyant à `seat` : le partenaire est en face, à (seat + 2) % 4. */
export function partnerOf(table, seat) {
  const p = table[(seat + 2) % 4];
  if (!p) return { kind: 'none', text: '' };
  if (p.free) return { kind: 'free', text: 'une place libre' };
  if (p.kind === 'robot') return { kind: 'robot', text: 'un robot' };
  return { kind: 'human', text: p.name || 'un joueur' };
}
