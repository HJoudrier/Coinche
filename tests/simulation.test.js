import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, getView } from '../js/engine.js';
import { chooseCard } from '../js/ai.js';
import { chooseBid } from '../js/bidding.js';
import { makeRng } from '../js/cards.js';

/** Joue une partie complète entre robots. levels[seat] = niveau. */
export function playGame(seed, levels, { maxRounds = 60, hardOpts = { maxSamples: 8, budgetMs: 1e9 } } = {}) {
  const rand = makeRng(seed + 1);
  const state = createGame({ seed, target: 1000 });
  let guard = 0;
  while (state.phase !== 'gameOver' && state.history.length < maxRounds) {
    if (++guard > 20000) throw new Error('boucle infinie');
    if (state.phase === 'roundEnd') {
      const r = state.roundResult;
      assert.equal(r.cardPoints[0] + r.cardPoints[1], 162, 'total 162');
      assert.equal(r.tricksBySeat.reduce((a, b) => a + b, 0), 8);
      applyAction(state, null, { type: 'next' });
      continue;
    }
    const seat = state.turn;
    const view = getView(state, seat);
    const level = levels[seat];
    const action = state.phase === 'bidding'
      ? chooseBid(view, level, rand)
      : { type: 'play', card: chooseCard(view, level, rand, hardOpts) };
    const res = applyAction(state, seat, action);
    assert.ok(res.ok, `action refusée : ${JSON.stringify(action)} → ${res.error}`);
  }
  return state;
}

test('parties complètes robots (moyen) sans erreur', () => {
  let rounds = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const s = playGame(seed, ['medium', 'medium', 'medium', 'medium']);
    rounds += s.history.length;
    assert.ok(s.phase === 'gameOver' || s.history.length >= 60);
  }
  assert.ok(rounds > 100);
});

test('parties avec niveaux mélangés (facile / difficile)', () => {
  for (let seed = 100; seed < 104; seed++) {
    const s = playGame(seed, ['hard', 'easy', 'hard', 'easy']);
    assert.ok(s.history.length > 0);
  }
});

test('la vue ne révèle pas les mains adverses', () => {
  const state = createGame({ seed: 7 });
  const v = getView(state, 0);
  assert.equal(v.hand.length, 8);
  assert.equal(JSON.stringify(v).includes(JSON.stringify(state.hands[1])), false);
});
