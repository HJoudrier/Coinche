// Calculs lourds hors du fil principal : Monte-Carlo des robots et analyse cartes sur table.
import { monteCarloPlay } from './ai.js';
import { analyzeRound, bestScores } from './solver.js';

self.onmessage = (e) => {
  const {
    id, type, ctx, opts, record, mySeat, trump,
  } = e.data;
  try {
    let res;
    if (type === 'solve') res = analyzeRound(record, mySeat, opts || {});
    else if (type === 'scores') res = bestScores(record, mySeat, trump, opts || {});
    else res = monteCarloPlay(ctx, opts || {});
    self.postMessage({ id, res });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
