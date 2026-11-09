// Partie en ligne : joueur absent (page cachée, liaison perdue), remplacement par un robot
// sur décision des joueurs présents, retour du joueur, et ramassage des liaisons silencieuses.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { GameHost } from '../js/host.js';
import { HostNet } from '../js/network.js';
import { createGame } from '../js/engine.js';

const CONFIG = {
  aiLevel: 'medium', bidTimer: 0, playTimer: 0, targetScore: 1000, robotSpeed: 'fast', counterCallFrom: 100, mcSamples: 100,
};

/** Hôte (Sud), invité à Nord, robots à Est et Ouest ; Nord parle en premier (donneur Est). */
function makeHost() {
  const seats = [
    { kind: 'local', name: 'Moi' },
    { kind: 'robot', name: 'Est' },
    { kind: 'remote', name: 'Nord', token: 'abc', connected: true },
    { kind: 'robot', name: 'Ouest' },
  ];
  const host = new GameHost({ seats, config: CONFIG, state: createGame({ seed: 7, dealer: 1, names: seats.map((s) => s.name) }) });
  host.start();
  assert.equal(host.state.turn, 2);
  return host;
}

test('un invité absent garde sa place : la table l\'attend, aucun robot ne joue', (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.after(() => mock.timers.reset());
  const host = makeHost();
  host.setConnected(2, false);
  assert.equal(host.presenceOf(2), 'away');
  assert.ok(host.isHuman(2));
  mock.timers.tick(60000);
  assert.equal(host.state.turn, 2, 'personne n\'a joué à sa place');
  assert.equal(host.state.auction.history.length, 0);
  const info = host.viewFor(0).seatsInfo[2];
  assert.equal(info.presence, 'away');
  assert.ok(info.awayMs >= 60000);
  assert.ok(host.state.events.some((e) => e.kind === 'presence' && /Nord est absent/.test(e.text)));
  host.destroy();
});

test('page cachée : absent ; page de nouveau visible : de retour', () => {
  const host = makeHost();
  host.setAway(2, true);
  assert.equal(host.presenceOf(2), 'away');
  host.setAway(2, false);
  assert.equal(host.presenceOf(2), 'online');
  assert.equal(host.viewFor(0).seatsInfo[2].awayMs, 0);
  host.destroy();
});

test('un joueur présent peut faire jouer un robot pour l\'absent, jusqu\'à son retour', (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.after(() => mock.timers.reset());
  const host = makeHost();
  host.setAway(2, true);
  const res = host.act(0, { type: 'standIn', seat: 2 });
  assert.ok(res.ok, res.error);
  assert.equal(host.presenceOf(2), 'robot');
  assert.ok(!host.isHuman(2));
  mock.timers.tick(5000);
  assert.ok(host.state.auction.history.some((a) => a.seat === 2), 'le robot a parlé pour Nord');
  // retour du joueur : il reprend sa place
  host.setAway(2, false);
  assert.equal(host.presenceOf(2), 'online');
  assert.ok(host.isHuman(2));
  assert.ok(host.state.events.some((e) => /reprend sa place/.test(e.text)));
  host.destroy();
});

test('remplacement refusé : joueur présent, hôte, demande de l\'absent lui-même, robot', () => {
  const host = makeHost();
  assert.equal(host.act(0, { type: 'standIn', seat: 2 }).ok, false, 'Nord est à la table');
  host.setAway(0, true);
  assert.equal(host.act(2, { type: 'standIn', seat: 0 }).ok, false, 'l\'hôte ne peut pas être remplacé');
  host.setAway(0, false);
  host.setConnected(2, false);
  assert.equal(host.act(2, { type: 'standIn', seat: 2 }).ok, false, 'pas soi-même');
  assert.equal(host.act(1, { type: 'standIn', seat: 2 }).ok, false, 'un robot ne décide pas');
  assert.equal(host.act(0, { type: 'standIn', seat: 9 }).ok, false);
  assert.equal(host.presenceOf(2), 'away');
  host.destroy();
});

test('reconnexion d\'un joueur remplacé : il reprend sa place', () => {
  const host = makeHost();
  host.setConnected(2, false);
  host.act(0, { type: 'standIn', seat: 2 });
  assert.equal(host.presenceOf(2), 'robot');
  host.setConnected(2, true);
  assert.equal(host.presenceOf(2), 'online');
  host.destroy();
});

test('fin de manche : « Manche suivante » attend un absent, pas un joueur remplacé', () => {
  const host = makeHost();
  host.clearTimer();
  host.state.phase = 'roundEnd';
  host.state.turn = null;
  host.setConnected(2, false);
  host.act(0, { type: 'ready' });
  assert.equal(host.state.phase, 'roundEnd');
  assert.deepEqual(host.viewFor(0).waitingFor, [2]);
  // remplacement décidé par l'hôte : la donne suivante commence
  host.act(0, { type: 'standIn', seat: 2 });
  assert.equal(host.state.phase, 'bidding');
  host.destroy();
});

function fakeConn() {
  return { open: true, closed: false, close() { this.closed = true; this.open = false; } };
}

test('liaisons silencieuses fermées, mais pas au réveil d\'un hôte suspendu', () => {
  const lost = [];
  const net = new HostNet({ onDisconnect: (c) => lost.push(c) });
  const a = fakeConn();
  const b = fakeConn();
  net.conns.add(a);
  net.conns.add(b);
  const t0 = 1_000_000;
  a.lastSeen = t0;
  b.lastSeen = t0;
  assert.deepEqual(net.reapSilent(20000, t0), []);
  // ticks réguliers : b continue de parler, a se tait
  for (let t = t0 + 5000; t <= t0 + 20000; t += 5000) { b.lastSeen = t; net.reapSilent(20000, t); }
  assert.deepEqual(lost, []);
  b.lastSeen = t0 + 25000;
  assert.deepEqual(net.reapSilent(20000, t0 + 25000), [a]);
  assert.ok(a.closed);
  assert.deepEqual(lost, [a]);
  // l'hôte a été suspendu 3 min : personne n'est coupé à son réveil
  const late = t0 + 25000 + 180000;
  assert.deepEqual(net.reapSilent(20000, late), []);
  assert.equal(b.lastSeen, late);
  assert.ok(!b.closed);
  // sans nouvelles 20 s plus tard, la liaison est bien considérée perdue
  for (let t = late + 5000; t <= late + 25000; t += 5000) net.reapSilent(20000, t);
  assert.ok(b.closed);
});

test('message « bye » : la liaison est fermée aussitôt', () => {
  const lost = [];
  const net = new HostNet({ onDisconnect: (c) => lost.push(c) });
  const handlers = {};
  const conn = { ...fakeConn(), on(ev, fn) { handlers[ev] = fn; } };
  net.handleConn(conn);
  handlers.open();
  handlers.data({ t: 'bye' });
  assert.deepEqual(lost, [conn]);
  assert.ok(conn.closed);
});
