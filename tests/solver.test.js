import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, getView } from '../js/engine.js';
import { chooseCard } from '../js/ai.js';
import { chooseBid } from '../js/bidding.js';
import { makeRng, teamOf } from '../js/cards.js';
import { legalCards } from '../js/rules.js';
import { replaySteps } from '../js/replay.js';
import {
  createSolver, analyzeRound, contractGoal, stepsToTricks,
} from '../js/solver.js';

function rounds(seed, n) {
  const rand = makeRng(seed);
  const st = createGame({ seed, target: 9999 });
  while (st.history.length < n) {
    if (st.phase === 'roundEnd') { applyAction(st, null, { type: 'next' }); continue; }
    const s = st.turn;
    const v = getView(st, s);
    const a = st.phase === 'bidding' ? chooseBid(v, 'medium', rand) : { type: 'play', card: chooseCard(v, 'medium', rand) };
    applyAction(st, s, a);
  }
  return st.history;
}

const sorted = (a) => a.slice().sort();

test('coups légaux du solveur identiques aux règles du jeu', () => {
  for (const r of rounds(3, 12)) {
    const solver = createSolver(r);
    const steps = replaySteps(r);
    const hands = r.hands.map((h) => h.slice());
    let trick = [];
    for (let k = 0; k < 32; k++) {
      const { seat, cards } = solver.legalAt(steps, k);
      assert.equal(seat, steps[k].seat);
      const expected = legalCards(hands[seat], trick, r.contract.trump, seat);
      assert.deepEqual(sorted(cards), sorted(expected), `position ${k}`);
      hands[seat].splice(hands[seat].indexOf(steps[k].card), 1);
      trick.push({ seat, card: steps[k].card });
      if (trick.length === 4) trick = [];
    }
  }
});

/** Recherche exhaustive sans coupure (référence) depuis la position après k cartes. */
function bruteForce(r, steps, k) {
  const solver = createSolver(r);
  const goal = contractGoal(r);
  const team = r.contract.team;
  const rec = (line) => {
    if (line.length === 32) {
      const tricks = stepsToTricks(line, r.contract.trump);
      if (goal.mode === 'capot') return tricks.every((t) => teamOf(t.winner) === team);
      if (goal.mode === 'generale') return tricks.every((t) => t.winner === r.contract.seat);
      const pts = tricks.filter((t) => teamOf(t.winner) === team).reduce((s, t) => s + t.points, 0);
      return pts >= goal.need;
    }
    const { seat, cards } = solver.legalAt(line, line.length);
    const results = cards.map((c) => rec([...line, { seat, card: c }]));
    return teamOf(seat) === team ? results.some(Boolean) : results.every(Boolean);
  };
  return rec(steps.slice(0, k));
}

test('fins de partie : min-max avec coupures = recherche exhaustive', () => {
  let checked = 0;
  for (const r of rounds(8, 15)) {
    const steps = replaySteps(r);
    for (const k of [24, 21, 20, 18]) {
      const solver = createSolver(r);
      assert.equal(solver.takersWinAt(steps, k), bruteForce(r, steps, k), `manche ${r.round}, après ${k} cartes`);
      checked++;
    }
  }
  assert.ok(checked >= 40);
});

test('analyse d\'une manche perdue : ligne gagnante légale et coup décisif de notre équipe', () => {
  let analysed = 0;
  let winnable = 0;
  for (const r of rounds(21, 25)) {
    for (const mySeat of [0, 1]) {
      const a = analyzeRound(r, mySeat);
      if (a.undetermined) continue;
      analysed++;
      if (!a.lost) assert.equal(a.mistake, undefined);
      if (a.winnable && a.lost) {
        winnable++;
        assert.equal(teamOf(a.mistake.seat), teamOf(mySeat));
        assert.ok(!a.mistake.alternatives.includes(a.mistake.card));
        assert.ok(a.mistake.alternatives.length > 0);
        // la ligne est légale et donne le bon résultat
        const steps = replaySteps(a.line);
        const solver = createSolver(r);
        for (let k = 0; k < 32; k++) assert.ok(solver.legalAt(steps, k).cards.includes(steps[k].card));
        const goal = contractGoal(r);
        const t = r.contract.team;
        const ok = goal.mode === 'points' ? a.line.cardPoints[t] >= goal.need
          : a.line.tricks.every((x) => (goal.mode === 'capot' ? teamOf(x.winner) === t : x.winner === r.contract.seat));
        assert.equal(ok, teamOf(mySeat) === t, 'la ligne gagnante donne le résultat voulu');
        // les cartes avant l'erreur sont celles réellement jouées
        const real = replaySteps(r);
        for (let k = 0; k < a.mistake.step; k++) assert.equal(steps[k].card, real[k].card);
      }
    }
  }
  assert.ok(analysed > 20);
  assert.ok(winnable > 0, 'au moins une manche perdue était gagnable');
});

/** Points maximaux des preneurs par recherche exhaustive (référence). */
function bruteMax(r, steps, k) {
  const solver = createSolver(r);
  const team = r.contract.team;
  const rec = (line) => {
    if (line.length === 32) {
      return stepsToTricks(line, r.contract.trump).filter((t) => teamOf(t.winner) === team).reduce((s, t) => s + t.points, 0);
    }
    const { seat, cards } = solver.legalAt(line, line.length);
    const vals = cards.map((c) => rec([...line, { seat, card: c }]));
    return teamOf(seat) === team ? Math.max(...vals) : Math.min(...vals);
  };
  return rec(steps.slice(0, k));
}

test('score maximal (alpha-bêta) = recherche exhaustive en fin de partie', () => {
  let n = 0;
  for (const r of rounds(13, 12)) {
    const steps = replaySteps(r);
    for (const k of [24, 21, 19]) {
      assert.equal(createSolver(r).maxTakerPointsAt(steps, k), bruteMax(r, steps, k), `manche ${r.round}, après ${k} cartes`);
      n++;
    }
  }
  assert.ok(n >= 30);
});

test('score maximal cohérent avec le solveur oui/non', async () => {
  const { bestScores } = await import('../js/solver.js');
  for (const r of rounds(17, 6)) {
    const full = createSolver(r).maxTakerPointsAt([], 0);
    assert.ok(full >= 0 && full <= 162);
    // les preneurs atteignent un seuil x si et seulement si x <= score maximal
    let checked = 0;
    for (const x of [full - 1, full, full + 1, 82, 100, 120]) {
      if (x < 82 || x > 162) continue;
      // contrat fictif dont le besoin vaut exactement x
      const rr = { ...r, contract: { ...r.contract, value: x }, beloteTeam: null };
      assert.equal(createSolver(rr).takersWinAt([], 0), x <= full, `seuil ${x}, maximum ${full}`);
      checked++;
    }
    assert.ok(checked >= 3);
    const b = bestScores(r, 0, r.contract.trump);
    assert.equal(b.us + b.them, 162);
  }
});

test('la partie optimale atteint exactement le score maximal annoncé', async () => {
  const { bestScores, optimalLine } = await import('../js/solver.js');
  for (const r of rounds(29, 3)) {
    const b = bestScores(r, 0, r.contract.trump);
    const capotTeam = b.bestUs === 250 ? 0 : b.bestThem === 250 ? 1 : null;
    const o = optimalLine(r, 0, r.contract.trump, { capotTeam });
    assert.equal(o.cardPoints[0], b.us);
    assert.equal(o.cardPoints[1], b.them);
    if (capotTeam !== null) assert.ok(o.record.tricks.every((t) => teamOf(t.winner) === capotTeam));
  }
});
