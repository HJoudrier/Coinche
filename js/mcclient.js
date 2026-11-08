// Accès au calcul Monte-Carlo : dans un Web Worker si possible, sinon sur le fil principal (budget réduit).
import { monteCarloPlay, heuristicPlay } from './ai.js';
import { analyzeRound, bestScores } from './solver.js';

let worker = null;
let broken = false;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (broken || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./mcworker.js', import.meta.url), { type: 'module' });
  } catch {
    broken = true;
    return null;
  }
  worker.onmessage = (e) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    clearTimeout(p.timer);
    if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.res);
  };
  worker.onerror = () => {
    broken = true;
    worker = null;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('worker')); }
    pending.clear();
  };
  return worker;
}

/**
 * Monte-Carlo asynchrone. opts : {maxSamples, budgetMs}.
 * Repli : calcul direct limité si les Web Workers sont indisponibles, heuristique si le calcul n'aboutit pas.
 */
export function monteCarloAsync(ctx, opts = {}) {
  const plain = JSON.parse(JSON.stringify(ctx));
  const fallback = () => monteCarloPlay(plain, { ...opts, maxSamples: Math.min(opts.maxSamples || 500, 120), budgetMs: 500 });
  const w = getWorker();
  if (!w) return Promise.resolve().then(fallback);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(heuristicPlay(plain));
    }, (opts.budgetMs || 3000) + 5000);
    pending.set(id, { resolve, reject, timer });
    w.postMessage({ id, ctx: plain, opts });
  }).catch(fallback);
}

/** Analyse cartes sur table d'une manche (voir analyzeRound), dans le Worker si possible. */
export function analyzeRoundAsync(record, mySeat, opts = {}) {
  const plain = JSON.parse(JSON.stringify(record));
  const direct = () => analyzeRound(plain, mySeat, opts);
  const w = getWorker();
  if (!w) return Promise.resolve().then(direct);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ undetermined: true, timeout: true });
    }, 60000);
    pending.set(id, { resolve, reject, timer });
    w.postMessage({ id, type: 'solve', record: plain, mySeat, opts });
  }).catch(direct);
}

/** Score maximal cartes sur table pour un atout donné (voir bestScores), dans le Worker si possible. */
export function bestScoresAsync(record, mySeat, trump, opts = {}) {
  const plain = JSON.parse(JSON.stringify(record));
  const direct = () => bestScores(plain, mySeat, trump, { nodeLimit: 1e6, ...opts });
  const w = getWorker();
  if (!w) return Promise.resolve().then(direct);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ trump, us: null, them: null, timeout: true });
    }, 120000);
    pending.set(id, { resolve, reject, timer });
    w.postMessage({ id, type: 'scores', record: plain, mySeat, trump, opts });
  }).catch(direct);
}
