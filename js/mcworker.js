// Calcul Monte-Carlo hors du fil principal : l'écran reste fluide pendant la réflexion.
import { monteCarloPlay } from './ai.js';

self.onmessage = (e) => {
  const { id, ctx, opts } = e.data;
  try {
    self.postMessage({ id, res: monteCarloPlay(ctx, opts || {}) });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
