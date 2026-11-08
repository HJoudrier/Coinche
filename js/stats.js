// Statistiques de manche, de partie et historique de toutes les parties.
import { teamOf } from './cards.js';
import { CAPOT, GENERALE } from './auction.js';
import { safeGet, safeSet } from './settings.js';

const HISTORY_KEY = 'coinche.history.v1';
const MAX_GAMES = 100;

/** Statistiques agrégées sur les manches d'une partie. */
export function computeGameStats(history) {
  const teams = [0, 1].map(() => ({
    taken: 0, success: 0, failed: 0, coinched: 0, coincheWon: 0, coinchedAgainst: 0,
    belotes: 0, capots: 0, scored: 0, cardPoints: 0, tricks: 0, bestRound: 0,
  }));
  const players = [0, 1, 2, 3].map(() => ({ taken: 0, success: 0, tricks: 0, bids: 0, coinches: 0, belotes: 0 }));
  const byTrump = {};
  for (const r of history) {
    const c = r.contract;
    const t = c.team;
    const d = 1 - t;
    teams[t].taken++;
    if (r.success) teams[t].success++; else teams[t].failed++;
    players[c.seat].taken++;
    if (r.success) players[c.seat].success++;
    if (c.mult > 1) {
      teams[d].coinched++;
      teams[t].coinchedAgainst++;
      if (!r.success) teams[d].coincheWon++;
    }
    if (r.beloteTeam !== null && r.beloteTeam !== undefined) {
      teams[r.beloteTeam].belotes++;
      if (r.beloteSeat !== null) players[r.beloteSeat].belotes++;
    }
    if (r.capot) teams[t].capots++;
    for (const k of [0, 1]) {
      teams[k].scored += r.score[k];
      teams[k].cardPoints += r.cardPoints[k];
      teams[k].bestRound = Math.max(teams[k].bestRound, r.score[k]);
    }
    for (let s = 0; s < 4; s++) {
      players[s].tricks += r.tricksBySeat[s];
      teams[teamOf(s)].tricks += r.tricksBySeat[s];
    }
    for (const a of r.auction || []) {
      if (a.type === 'bid') players[a.seat].bids++;
      if (a.type === 'coinche') players[a.seat].coinches++;
    }
    const key = c.trump;
    byTrump[key] = byTrump[key] || { taken: 0, success: 0 };
    byTrump[key].taken++;
    if (r.success) byTrump[key].success++;
  }
  const n = history.length;
  for (const tm of teams) {
    tm.avgCardPoints = n ? Math.round(tm.cardPoints / n) : 0;
    tm.successRate = tm.taken ? tm.success / tm.taken : null;
  }
  for (const p of players) p.successRate = p.taken ? p.success / p.taken : null;
  return {
    rounds: n,
    teams,
    players,
    byTrump,
    series: history.map((r) => r.totals),
  };
}

/** Résumé d'une manche du point de vue d'un joueur. */
export function roundSummary(record, mySeat) {
  const us = teamOf(mySeat);
  return {
    us,
    them: 1 - us,
    ourContract: record.contract.team === us,
    won: record.contract.team === us ? record.success : !record.success,
    capot: record.capot,
    special: record.contract.value === CAPOT ? 'capot' : record.contract.value === GENERALE ? 'générale' : null,
  };
}

// ---------------------------------------------------------------------------
// Historique de toutes les parties (navigateur)
// ---------------------------------------------------------------------------
export function loadHistory() {
  try {
    const h = JSON.parse(safeGet(HISTORY_KEY) || '[]');
    return Array.isArray(h) ? h : [];
  } catch {
    return [];
  }
}

export function clearHistory() {
  safeSet(HISTORY_KEY, '[]');
}

/** Enregistre une partie terminée. id unique pour éviter les doublons. */
export function saveFinishedGame({ id, names, mySeat, scores, winner, target, history, online }) {
  const all = loadHistory();
  if (all.some((g) => g.id === id)) return;
  all.push({
    id,
    date: new Date().toISOString(),
    names,
    mySeat,
    scores,
    winner,
    target,
    online: !!online,
    rounds: history.map((r) => ({
      contract: r.contract,
      success: r.success,
      score: r.score,
      cardPoints: r.cardPoints,
      tricksBySeat: r.tricksBySeat,
      beloteTeam: r.beloteTeam,
      beloteSeat: r.beloteSeat,
      capot: r.capot,
      auction: (r.auction || []).filter((a) => a.type !== 'pass'),
      totals: r.totals,
    })),
  });
  while (all.length > MAX_GAMES) all.shift();
  safeSet(HISTORY_KEY, JSON.stringify(all));
}

/** Statistiques cumulées sur toutes les parties enregistrées, du point de vue du joueur local. */
export function lifetimeStats(games = loadHistory()) {
  const s = {
    games: games.length, wins: 0, rounds: 0, roundsWon: 0,
    myContracts: 0, mySuccess: 0, teamContracts: 0, teamSuccess: 0,
    coinches: 0, coinchesWon: 0, belotes: 0, capots: 0, tricks: 0,
    avgPoints: 0, bestGame: null,
  };
  let pts = 0;
  for (const g of games) {
    const us = teamOf(g.mySeat);
    if (g.winner === us) s.wins++;
    for (const r of g.rounds) {
      s.rounds++;
      if (r.score[us] > r.score[1 - us]) s.roundsWon++;
      pts += r.cardPoints[us];
      s.tricks += r.tricksBySeat[g.mySeat] + r.tricksBySeat[(g.mySeat + 2) % 4];
      if (r.contract.seat === g.mySeat) {
        s.myContracts++;
        if (r.success) s.mySuccess++;
      }
      if (r.contract.team === us) {
        s.teamContracts++;
        if (r.success) s.teamSuccess++;
        if (r.capot && r.success) s.capots++;
      }
      if (r.beloteTeam === us) s.belotes++;
      if (r.contract.mult > 1 && r.contract.team !== us) {
        s.coinches++;
        if (!r.success) s.coinchesWon++;
      }
    }
    const diff = g.scores[us] - g.scores[1 - us];
    if (!s.bestGame || diff > s.bestGame.diff) s.bestGame = { diff, date: g.date, scores: g.scores, us };
  }
  s.avgPoints = s.rounds ? Math.round(pts / s.rounds) : 0;
  return s;
}

export const pct = (x) => (x === null || x === undefined || Number.isNaN(x) ? '—' : `${Math.round(x * 100)} %`);
