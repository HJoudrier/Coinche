// Calculs lourds hors du fil principal : Monte-Carlo des robots et analyses cartes sur table.
import { monteCarloPlay } from './ai.js';
import {
  analyzeRound, bestScores, optimalLine, solverMove, makeScoreSolvers,
} from './solver.js';

// solveurs conservés entre deux coups d'une même vérification (tables de transposition partagées)
const solverCache = new Map();
function cachedSolvers(record, mySeat, trump, capotTeam) {
  const key = `${record.hands.map((h) => h.join('')).join('|')}:${record.dealer}:${mySeat}:${trump}:${capotTeam}`;
  if (!solverCache.has(key)) {
    if (solverCache.size > 6) solverCache.delete(solverCache.keys().next().value);
    solverCache.set(key, makeScoreSolvers(record, mySeat, trump, capotTeam));
  }
  return solverCache.get(key);
}

self.onmessage = (e) => {
  const {
    id, type, ctx, opts = {}, record, mySeat, trump, line,
  } = e.data;
  try {
    let res;
    if (type === 'solve') res = analyzeRound(record, mySeat, opts);
    else if (type === 'scores') res = bestScores(record, mySeat, trump, opts);
    else if (type === 'line') {
      res = optimalLine(record, mySeat, trump, { ...opts, solvers: cachedSolvers(record, mySeat, trump, opts.capotTeam ?? null) });
    } else if (type === 'move') {
      const r = solverMove(record, mySeat, trump, line, { ...opts, solvers: cachedSolvers(record, mySeat, trump, opts.capotTeam ?? null) });
      res = { seat: r.seat, card: r.card };
    } else res = monteCarloPlay(ctx, opts);
    self.postMessage({ id, res });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
