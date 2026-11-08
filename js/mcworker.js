// Calculs lourds hors du fil principal : Monte-Carlo des robots et analyse cartes sur table.
import { monteCarloPlay } from './ai.js';
import { analyzeRound } from './solver.js';

self.onmessage = (e) => {
  const { id, type, ctx, opts, record, mySeat } = e.data;
  try {
    const res = type === 'solve' ? analyzeRound(record, mySeat, opts || {}) : monteCarloPlay(ctx, opts || {});
    self.postMessage({ id, res });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
