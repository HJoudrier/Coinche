// Application : écrans, salon (places, QR code), partie solo / hôte / invité.
import {
  h, clear, toast, openModal, openPanel, confirmDialog, segmented, preloadCardImages,
} from './ui/dom.js';
import { GameView } from './ui/game.js';
import { statsBody } from './ui/statsview.js';
import { settingsBody, rulesBody } from './ui/settingsview.js';
import { GameHost, randomId } from './host.js';
import {
  HostNet, GuestNet, normalizeCode, peerAvailable, backgroundTicker,
} from './network.js';
import {
  getSettings, updateSettings, onSettingsChange, OPTIONS, safeGet, safeSet,
} from './settings.js';
import { HELP_DESCRIPTIONS } from './advisor.js';
import { saveFinishedGame } from './stats.js';
import qrcode from '../vendor/qrcode.mjs';
import {
  SEAT_LABELS, lobbyFreeSeats, gameFreeSeats, placement, lobbyTable, gameTable, partnerOf,
} from './lobby.js';

const app = document.getElementById('app');
const SAVE_KEY = 'coinche.saved.v1';
const TOKEN_KEY = 'coinche.token';
const GUEST_KEY = 'coinche.guest.v1'; // partie en ligne rejointe : {code, at}, pour y revenir après un rechargement
const GUEST_MAX_AGE = 3 * 3600 * 1000;
const ROLE = ['vous', 'adversaire', 'partenaire', 'adversaire'];

const session = {
  mode: null, // 'lobby' | 'solo' | 'host' | 'guest'
  host: null,
  hostNet: null,
  guestNet: null,
  game: null,
  lobby: null,
  conns: {},
  pending: new Map(), // invités connectés qui n'ont pas encore choisi leur place : jeton → {conn, name, token}
  reaper: null,
  guestCode: null,
  wakeLock: null,
  onlineLock: null,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanName = (s) => String(s || '').replace(/[<>]/g, '').trim().slice(0, 16);

function myToken() {
  let t = safeGet(TOKEN_KEY);
  if (!t) { t = randomId(16); safeSet(TOKEN_KEY, t); }
  return t;
}

// --- partie en ligne rejointe : retour automatique après un rechargement de la page
function rememberGuest(code) {
  const v = JSON.stringify({ code, at: Date.now() });
  try { sessionStorage.setItem(GUEST_KEY, v); } catch { /* indisponible */ }
  safeSet(GUEST_KEY, v);
}

function forgetGuest() {
  try { sessionStorage.removeItem(GUEST_KEY); } catch { /* indisponible */ }
  safeSet(GUEST_KEY, 'null');
}

/** Code de la partie rejointe récemment (`tabOnly` : seulement dans cet onglet), sinon null. */
function recentGuest(tabOnly) {
  let raw = null;
  try { raw = sessionStorage.getItem(GUEST_KEY); } catch { /* indisponible */ }
  if (!raw && !tabOnly) raw = safeGet(GUEST_KEY);
  try {
    const g = JSON.parse(raw || 'null');
    return g && g.code && Date.now() - g.at < GUEST_MAX_AGE ? g.code : null;
  } catch {
    return null;
  }
}

/**
 * Verrou tenu pendant une partie en ligne : sur ordinateur, il évite que le navigateur gèle
 * l'onglet quand le joueur ouvre une autre page (sans effet sur les téléphones).
 */
function holdOnlineLock() {
  if (session.onlineLock || !navigator.locks) return;
  try {
    navigator.locks.request(`coinche-online-${randomId(8)}`, () => new Promise((resolve) => { session.onlineLock = resolve; }))
      .catch(() => {});
  } catch { /* non supporté */ }
}

function releaseOnlineLock() {
  if (session.onlineLock) session.onlineLock();
  session.onlineLock = null;
}

function stopReaper() {
  if (session.reaper) session.reaper.stop();
  session.reaper = null;
}

function setScreen(el) {
  clear(app);
  app.append(el);
  window.scrollTo(0, 0);
}

function closeOverlays() {
  for (const el of document.querySelectorAll('.modal-backdrop, .panel')) el.remove();
}

function hostConfig() {
  const st = getSettings();
  return {
    aiLevel: st.aiLevel, bidTimer: st.bidTimer, playTimer: st.playTimer,
    targetScore: st.targetScore, robotSpeed: st.robotSpeed, counterCallFrom: st.counterCallFrom,
    mcSamples: st.mcSamples,
  };
}

function teardown() {
  if (session.mode === 'guest') forgetGuest(); // départ volontaire
  if (session.game) { session.game.destroy(); session.game = null; }
  if (session.host) { session.host.destroy(); session.host = null; }
  if (session.hostNet) {
    for (const c of session.hostNet.conns) session.hostNet.send(c, { t: 'ended' });
    const net = session.hostNet;
    setTimeout(() => net.close(), 300);
    session.hostNet = null;
  }
  if (session.guestNet) { session.guestNet.close(); session.guestNet = null; }
  stopReaper();
  releaseOnlineLock();
  session.lobby = null;
  session.mode = null;
  session.conns = {};
  session.pending.clear();
  session.guestTable = null;
  releaseWakeLock();
  closeOverlays();
}

// ---------------------------------------------------------------------------
// Accueil
// ---------------------------------------------------------------------------
function loadSaved() {
  try {
    const s = JSON.parse(safeGet(SAVE_KEY) || 'null');
    return s && s.state && s.state.phase !== 'gameOver' ? s : null;
  } catch {
    return null;
  }
}

function showHome() {
  teardown();
  const saved = loadSaved();
  const online = recentGuest(false);
  const st = getSettings();
  const suits = h('div', { class: 'logo-suits' },
    h('span', null, '♠'), h('span', { class: 'red' }, '♥'), h('span', null, '♣'), h('span', { class: 'red' }, '♦'));
  setScreen(h('div', { class: 'screen home' },
    h('div', { class: 'logo' }, suits, h('h1', null, 'Coinche'),
      h('p', { class: 'muted' }, 'Sans annonces · contre des robots ou entre amis')),
    h('div', { class: 'menu' },
      online ? h('button', { class: 'btn primary', onClick: () => showJoin(online, '', { auto: true }) },
        'Revenir à la partie en ligne', h('small', null, `Code ${online}`)) : null,
      saved ? h('button', { class: `btn ${online ? '' : 'primary'}`, onClick: resumeSolo },
        'Reprendre la partie', h('small', null, `Manche ${saved.state.history.length + 1} · ${saved.state.scores[0]} – ${saved.state.scores[1]}`)) : null,
      h('button', { class: `btn ${saved || online ? '' : 'primary'}`, onClick: showLobby }, 'Nouvelle partie'),
      h('button', { class: 'btn', onClick: () => showJoin('') }, 'Rejoindre une partie'),
      h('div', { class: 'menu-row' },
        h('button', { class: 'btn', onClick: () => openStats(null) }, '📊 Stats'),
        h('button', { class: 'btn', onClick: () => openSettings(showHome) }, '⚙️ Réglages'),
        h('button', { class: 'btn', onClick: openRules }, '📖 Règles'))),
    h('p', { class: 'muted small center' }, `Joueur : ${st.playerName}`)));
}

// ---------------------------------------------------------------------------
// Panneaux
// ---------------------------------------------------------------------------
function openSettings(onClose) {
  openPanel('Paramètres', settingsBody({ inGame: !!session.host, isGuest: session.mode === 'guest' }), {
    onClose: typeof onClose === 'function' ? onClose : null,
  });
}

function openRules() {
  openPanel('Règles du jeu', rulesBody());
}

function openStats(view) {
  const live = view ? { history: view.history, names: view.names, seat: view.seat, target: view.target } : null;
  openPanel('Statistiques', statsBody(live));
}

function openHelpQuick() {
  const st = getSettings();
  const bd = h('div', { class: 'desc' }, HELP_DESCRIPTIONS.bid[st.bidHelp]);
  const pd = h('div', { class: 'desc' }, HELP_DESCRIPTIONS.play[st.playHelp]);
  const m = openModal([
    h('h3', null, 'Aides'),
    h('div', { class: 'field' }, h('label', null, 'Enchères'),
      segmented(OPTIONS.help, st.bidHelp, (v) => { updateSettings({ bidHelp: v }); bd.textContent = HELP_DESCRIPTIONS.bid[v]; }, { small: true }), bd),
    h('div', { class: 'field' }, h('label', null, 'Jeu de la carte'),
      segmented(OPTIONS.help, st.playHelp, (v) => { updateSettings({ playHelp: v }); pd.textContent = HELP_DESCRIPTIONS.play[v]; }, { small: true }), pd),
    h('button', { class: 'btn', onClick: () => m.close() }, 'Fermer'),
  ]);
}

// ---------------------------------------------------------------------------
// Salon (hôte)
// ---------------------------------------------------------------------------
function showLobby() {
  teardown();
  session.mode = 'lobby';
  // last : dernière place de chaque invité (jeton → place), rendue s'il se reconnecte
  session.lobby = { kinds: ['local', 'robot', 'robot', 'robot'], guests: {}, last: {}, code: null, opening: false, error: null };
  setScreen(h('div', { class: 'screen lobby' }));
  renderLobby();
}

function renderLobby() {
  const L = session.lobby;
  if (!L) return;
  const root = app.firstChild;
  clear(root);
  const st = getSettings();
  root.append(h('div', { class: 'screen-head' },
    h('button', { class: 'icon-btn', 'aria-label': 'Retour', onClick: showHome }, '←'),
    h('h2', null, 'Nouvelle partie')));
  root.append(h('p', { class: 'muted small' }, 'Choisissez qui occupe chaque place. Une place « Invité » est réservée à un joueur qui rejoint la table en scannant le QR code.'));

  const rows = h('div', { class: 'seats-config' });
  for (const seat of [2, 1, 3]) {
    const g = L.guests[seat];
    const remote = L.kinds[seat] === 'remote';
    rows.append(h('div', { class: `seat-row ${seat === 2 ? 'partner' : 'opp'}` },
      h('div', { class: 'sr-info' },
        h('b', null, SEAT_LABELS[seat]), h('span', { class: 'muted small' }, ` · ${ROLE[seat]}`),
        remote ? h('div', { class: `sr-status ${g ? 'ok' : ''}` }, g ? `✓ ${g.name} est connecté` : 'En attente d\'un joueur…') : null),
      segmented([['robot', '🤖 Robot'], ['remote', '👤 Invité']], L.kinds[seat], (v) => setSeatKind(seat, v), { small: true })));
  }
  rows.append(h('div', { class: 'seat-row me' },
    h('div', { class: 'sr-info' }, h('b', null, 'Sud'), h('span', { class: 'muted small' }, ` · vous (${st.playerName})`))));
  root.append(rows);
  if (session.pending.size) {
    root.append(h('div', { class: 'pending-guests' }, [...session.pending.values()].map((p) =>
      h('div', { class: 'sr-status ok' }, `✓ ${p.name} est connecté et choisit sa place…`))));
  }

  if (L.kinds.includes('remote')) {
    if (L.error) {
      root.append(h('div', { class: 'error-box' }, L.error,
        h('button', { class: 'btn small', onClick: () => { L.error = null; ensureRoom(); renderLobby(); } }, 'Réessayer')));
    } else if (!L.code) {
      root.append(h('div', { class: 'invite loading' }, 'Création de la partie en ligne…'));
    } else {
      root.append(inviteBox(L.code));
    }
  }

  const lvl = OPTIONS.aiLevel.find(([v]) => v === st.aiLevel)[1];
  const timers = st.bidTimer || st.playTimer
    ? `temps : ${st.bidTimer ? `${st.bidTimer} s` : '∞'} enchère / ${st.playTimer ? `${st.playTimer} s` : '∞'} carte`
    : 'sans limite de temps';
  root.append(h('div', { class: 'game-summary' },
    h('div', null, `Partie en ${st.targetScore} points · robots ${lvl.toLowerCase()} · ${timers}`),
    h('button', { class: 'btn small ghost', onClick: () => openSettings(renderLobby) }, 'Modifier')));

  root.append(h('button', { class: 'btn primary big', onClick: startFromLobby }, 'Lancer la partie'));
}

function setSeatKind(seat, kind) {
  const L = session.lobby;
  L.kinds[seat] = kind;
  if (kind === 'robot' && L.guests[seat]) {
    const g = L.guests[seat];
    delete L.guests[seat];
    delete L.last[g.token];
    g.conn.seat = undefined;
    session.hostNet.send(g.conn, { t: 'kicked' });
    // une seule autre place libre : il s'y assoit ; plusieurs (ou aucune) : il choisit
    const p = placement(lobbyFreeSeats(L));
    if (p.seat !== undefined) seatGuest(g.conn, g.name, g.token, p.seat, { announce: false });
    else session.pending.set(g.token, g);
  }
  if (kind === 'remote') ensureRoom();
  settleSeats();
  renderLobby();
  broadcastTable();
}

async function ensureRoom() {
  const L = session.lobby;
  if (!L || L.code || L.opening) return;
  if (!peerAvailable()) {
    L.error = 'Le module de jeu en ligne n\'a pas pu être chargé.';
    renderLobby();
    return;
  }
  L.opening = true;
  const net = new HostNet({
    signaling: getSettings().signaling,
    onMessage: onHostMessage,
    onDisconnect: onHostDisconnect,
    onError: (e) => toast(e.message),
  });
  session.hostNet = net;
  try {
    const code = await net.open();
    if (session.lobby !== L) { net.close(); return; }
    L.code = code;
    stopReaper();
    session.reaper = backgroundTicker(5000, () => net.reapSilent(20000));
  } catch (e) {
    if (session.hostNet === net) session.hostNet = null;
    L.error = e.message;
  }
  L.opening = false;
  if (session.lobby === L) renderLobby();
}

function joinUrl(code) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('join', code);
  return u.toString();
}

function inviteBox(code) {
  const url = joinUrl(code);
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const local = location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast('Lien copié'); } catch { toast(url, 5000); }
  };
  const share = () => navigator.share({ title: 'Coinche', text: `Rejoins ma partie de coinche (code ${code})`, url }).catch(() => {});
  return h('div', { class: 'invite' },
    h('div', { class: 'qr', html: qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true, alt: 'QR code pour rejoindre la partie' }) }),
    h('div', { class: 'invite-info' },
      h('div', { class: 'muted small' }, 'Scannez pour rejoindre, ou saisissez le code :'),
      h('div', { class: 'code' }, code),
      h('div', { class: 'row-btns' },
        h('button', { class: 'btn small', onClick: copy }, 'Copier le lien'),
        navigator.share ? h('button', { class: 'btn small', onClick: share }, 'Partager') : null),
      local ? h('div', { class: 'note' }, 'Le jeu est ouvert en local : pour que d\'autres téléphones puissent scanner le QR code, ouvrez-le depuis son adresse publique (par ex. GitHub Pages). Le code reste utilisable depuis la page publique.') : null));
}

function onHostMessage(conn, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'hello') { onHello(conn, msg); return; }
  if (msg.t === 'sit') { onSit(conn, msg); return; }
  if (msg.t === 'presence') {
    // l'invité a caché ou réaffiché sa page
    if (session.host && conn.seat !== undefined && session.conns[conn.seat] === conn) session.host.setAway(conn.seat, !!msg.away);
    return;
  }
  if (msg.t === 'action' && session.host && conn.seat !== undefined && session.conns[conn.seat] === conn) {
    const res = session.host.act(conn.seat, msg.action || {});
    if (!res.ok && res.error) session.hostNet.send(conn, { t: 'error', message: res.error });
  }
}

/** Places qu'un invité peut prendre maintenant : celles du salon, ou, partie lancée, celles tenues par un robot. */
function freeSeatsNow() {
  if (session.host) return gameFreeSeats(session.host.seats);
  if (session.lobby) return lobbyFreeSeats(session.lobby);
  return [];
}

function refuseGuest(conn) {
  session.hostNet.send(conn, { t: 'full' });
  setTimeout(() => { try { conn.close(); } catch { /* ignore */ } }, 300);
}

function onHello(conn, msg) {
  const name = cleanName(msg.name) || 'Invité';
  const token = String(msg.token || '').slice(0, 40);
  conn.token = token;
  const L = session.lobby;
  if (session.host) {
    // il retrouve sa place grâce à son jeton ; sinon il arrive comme nouveau venu
    const seat = session.host.seats.findIndex((s) => s.kind === 'remote' && s.token === token);
    if (seat >= 0) { seatGuest(conn, name, token, seat, { announce: false }); return; }
  } else if (L) {
    const seat = Object.keys(L.guests).map(Number).find((s) => L.guests[s].token === token);
    if (seat !== undefined) { seatGuest(conn, name, token, seat, { announce: false }); return; }
  } else { refuseGuest(conn); return; }
  // nouveau venu : une seule place libre (ou celle qu'il vient de quitter) et il s'y assoit,
  // sinon il voit la table et choisit parmi les places libres
  const old = session.pending.get(token);
  if (old && old.conn !== conn) { try { old.conn.close(); } catch { /* ignore */ } }
  session.pending.delete(token);
  const p = placement(freeSeatsNow(), L ? L.last[token] : undefined);
  if (p.full) { refuseGuest(conn); return; }
  if (p.seat !== undefined) { seatGuest(conn, name, token, p.seat); return; }
  session.pending.set(token, { conn, name, token });
  conn.seat = undefined;
  if (L) renderLobby();
  broadcastTable();
}

/** Assoit un invité à `seat` (salon ou partie en cours) et le prévient. */
function seatGuest(conn, name, token, seat, { announce = true } = {}) {
  const net = session.hostNet;
  session.pending.delete(token);
  if (session.host) {
    const seats = session.host.seats;
    const old = session.conns[seat];
    if (old && old !== conn) { try { old.close(); } catch { /* ignore */ } }
    session.conns[seat] = conn;
    conn.seat = seat;
    if (seats[seat].token !== token) {
      seats[seat].token = token;
      session.host.setName(seat, name);
    }
    net.send(conn, { t: 'welcome', seat });
    session.host.attach(seat, (v) => net.send(conn, { t: 'view', view: v }));
    session.host.setConnected(seat, true);
    return;
  }
  const L = session.lobby;
  const prev = L.guests[seat];
  if (prev && prev.conn !== conn) { try { prev.conn.close(); } catch { /* ignore */ } }
  L.guests[seat] = { conn, name, token };
  L.last[token] = seat;
  conn.seat = seat;
  net.send(conn, { t: 'welcome', seat });
  if (!prev && announce) toast(`${name} a rejoint la table (${SEAT_LABELS[seat]})`);
  renderLobby();
  broadcastTable();
}

/** Un invité choisit sa place (ou en change, tant que la partie n'est pas lancée). */
function onSit(conn, msg) {
  const net = session.hostNet;
  const seat = Number(msg.seat);
  const token = conn.token;
  if (!net || !token || !Number.isInteger(seat)) return;
  const pend = session.pending.get(token);
  const waiting = pend && pend.conn === conn;
  let name;
  if (waiting) name = pend.name;
  else if (conn.seat !== undefined && session.lobby) {
    const g = session.lobby.guests[conn.seat];
    if (!g || g.conn !== conn) return;
    name = g.name;
  } else return; // partie lancée : on ne change plus de place
  if (conn.seat === seat) return;
  if (!freeSeatsNow().includes(seat)) {
    net.send(conn, { t: 'error', message: 'Cette place vient d\'être prise.' });
    broadcastTable();
    return;
  }
  if (!waiting) delete session.lobby.guests[conn.seat];
  seatGuest(conn, name, token, seat, { announce: waiting });
  settleSeats();
}

/**
 * Les invités en attente de choix n'ont plus à choisir quand il ne reste qu'une place : on les y assoit.
 * Partie lancée, s'il n'en reste aucune, la table est complète pour eux.
 */
function settleSeats() {
  if (!session.pending.size) return;
  const free = freeSeatsNow();
  if (free.length === 1) {
    const next = session.pending.values().next().value;
    seatGuest(next.conn, next.name, next.token, free[0]);
  } else if (!free.length && session.host) {
    for (const p of session.pending.values()) refuseGuest(p.conn);
    session.pending.clear();
  }
}

function onHostDisconnect(conn) {
  if (conn.seat === undefined) {
    // invité qui n'avait pas encore choisi sa place
    const p = conn.token && session.pending.get(conn.token);
    if (p && p.conn === conn) {
      session.pending.delete(conn.token);
      if (session.lobby) renderLobby();
    }
    return;
  }
  if (session.host) {
    if (session.conns[conn.seat] === conn) {
      delete session.conns[conn.seat];
      session.host.attach(conn.seat, null);
      session.host.setConnected(conn.seat, false);
    }
  } else if (session.lobby) {
    const g = session.lobby.guests[conn.seat];
    if (g && g.conn === conn) {
      delete session.lobby.guests[conn.seat];
      toast(`${g.name} a quitté la table`);
      settleSeats();
      renderLobby();
      broadcastTable();
    }
  }
}

/** Envoie à chaque invité la table (qui est où, quelles places sont libres) : à ceux qui choisissent, et dans le salon à ceux déjà assis. */
function broadcastTable() {
  const net = session.hostNet;
  if (!net) return;
  const L = session.lobby;
  const table = session.host ? gameTable(session.host.seats) : L ? lobbyTable(L, getSettings().playerName) : null;
  if (!table) return;
  if (L) for (const s of Object.keys(L.guests)) net.send(L.guests[s].conn, { t: 'lobby', seats: table, you: Number(s) });
  for (const p of session.pending.values()) net.send(p.conn, { t: 'lobby', seats: table, you: null });
}

async function startFromLobby() {
  const L = session.lobby;
  const st = getSettings();
  const empty = lobbyFreeSeats(L);
  if (empty.length) {
    const wait = [...session.pending.values()].map((p) => p.name);
    const note = wait.length ? ` ${wait.join(', ')} n'${wait.length > 1 ? 'ont' : 'a'} pas encore choisi ${wait.length > 1 ? 'leur place' : 'sa place'} et ne pourr${wait.length > 1 ? 'ont' : 'a'} pas jouer.` : '';
    const ok = await confirmDialog(`${empty.length > 1 ? 'Des places invitées sont libres : elles seront tenues' : 'Une place invitée est libre : elle sera tenue'} par un robot.${note} Lancer quand même ?`, { ok: 'Lancer' });
    if (!ok || session.lobby !== L) return;
  }
  const seats = [0, 1, 2, 3].map((s) => {
    if (s === 0) return { kind: 'local', name: st.playerName };
    if (L.kinds[s] === 'remote' && L.guests[s]) return { kind: 'remote', name: L.guests[s].name, token: L.guests[s].token, connected: true };
    return { kind: 'robot', name: SEAT_LABELS[s] };
  });
  session.conns = {};
  for (const s of Object.keys(L.guests)) session.conns[s] = L.guests[s].conn;
  const online = seats.some((s) => s.kind === 'remote');
  session.lobby = null;
  // ceux qui n'ont pas choisi de place restent à la porte : la table est complète
  if (session.hostNet) for (const p of session.pending.values()) refuseGuest(p.conn);
  session.pending.clear();
  if (!online && session.hostNet) {
    session.hostNet.close();
    session.hostNet = null;
    stopReaper();
  }
  startHostGame({ seats, online });
}

// ---------------------------------------------------------------------------
// Partie (solo ou hôte)
// ---------------------------------------------------------------------------
function startHostGame({ seats, online, saved = null }) {
  const host = saved ? GameHost.restore(saved) : new GameHost({ seats, config: hostConfig() });
  if (saved) Object.assign(host.config, { ...hostConfig(), targetScore: host.config.targetScore });
  session.host = host;
  session.mode = online ? 'host' : 'solo';
  if (online) {
    holdOnlineLock();
    host.setAway(0, document.visibilityState === 'hidden');
  }
  host.onChange = (hh) => {
    if (session.pending.size) { settleSeats(); broadcastTable(); }
    if (session.mode === 'solo') {
      if (hh.state.phase === 'gameOver') safeSet(SAVE_KEY, 'null');
      else safeSet(SAVE_KEY, JSON.stringify(hh.toJSON()));
    }
  };
  mountGame({
    send: (a) => {
      const r = host.act(0, a);
      if (!r.ok && session.game) session.game.actionFailed(r.error);
    },
    canReplay: true,
  });
  host.attach(0, (v) => session.game && session.game.update(v));
  for (const s of [1, 2, 3]) {
    const conn = session.conns[s];
    if (conn && host.seats[s].kind === 'remote') host.attach(s, (v) => session.hostNet && session.hostNet.send(conn, { t: 'view', view: v }));
  }
  host.start();
}

function resumeSolo() {
  const saved = loadSaved();
  if (!saved) { showHome(); return; }
  teardown();
  startHostGame({ seats: saved.seats, online: false, saved });
}

function replay() {
  const old = session.host;
  if (!old) { showLobby(); return; }
  const seats = old.seats.map((s) => ({ ...s }));
  if (session.game) session.game.destroy();
  old.destroy();
  for (const s of seats) if (s.kind === 'local') s.name = getSettings().playerName;
  const online = session.mode === 'host';
  startHostGame({ seats, online });
}

function mountGame({ send, canReplay }) {
  if (session.game) session.game.destroy();
  closeOverlays();
  const gv = new GameView({
    send,
    onMenu: openGameMenu,
    onStats: (v) => openStats(v),
    onGameOver: recordGameOver,
    onReplay: replay,
    onHome: showHome,
    canReplay,
  });
  session.game = gv;
  setScreen(gv.root);
  requestWakeLock();
}

function recordGameOver(v) {
  saveFinishedGame({
    id: v.gameId,
    names: v.names,
    mySeat: v.seat,
    scores: v.scores,
    winner: v.winner,
    target: v.target,
    history: v.history,
    online: session.mode !== 'solo',
  });
  if (session.mode === 'solo') safeSet(SAVE_KEY, 'null');
}

function openGameMenu() {
  const v = session.game && session.game.view;
  let m;
  const item = (label, fn) => h('button', { class: 'menu-item', onClick: () => { m.close(); fn(); } }, label);
  m = openModal([
    h('div', { class: 'menu-list' },
      item('🃏 Dernier pli', () => session.game.showLastTrick()),
      getSettings().bidHelp >= 3 ? item('📜 Annonces de la donne', () => session.game.showAuction()) : null,
      item('📊 Statistiques', () => openStats(v)),
      item('💡 Aides', openHelpQuick),
      item('⚙️ Paramètres', () => openSettings()),
      item('📖 Règles', openRules),
      session.mode === 'host' ? item('📱 Inviter (QR code)', showInviteModal) : null,
      item('🚪 Quitter la partie', quitGame)),
  ], { cls: 'menu-modal' });
}

function showInviteModal() {
  const net = session.hostNet;
  if (!net || !net.code) { toast('Partie en ligne indisponible'); return; }
  const seats = session.host.seats;
  const m = openModal([
    h('h3', null, 'Inviter'),
    h('p', { class: 'muted small' }, 'Un joueur peut reprendre sa place, ou choisir une place invitée tenue par un robot (il voit alors qui est installé où).'),
    inviteBox(net.code),
    h('ul', { class: 'plain' }, seats.map((s, i) => (s.kind === 'remote'
      ? h('li', null, `${SEAT_LABELS[i]} : ${s.name} ${s.connected ? '✓ connecté' : '— hors ligne'}`) : null))),
    h('button', { class: 'btn', onClick: () => m.close() }, 'Fermer'),
  ]);
}

async function quitGame() {
  const msg = session.mode === 'solo'
    ? 'Quitter la partie ? Vous pourrez la reprendre depuis l\'accueil.'
    : session.mode === 'host' ? 'Quitter ? La partie sera arrêtée pour tous les joueurs.' : 'Quitter la partie ?';
  if (await confirmDialog(msg, { ok: 'Quitter' })) showHome();
}

// ---------------------------------------------------------------------------
// Invité
// ---------------------------------------------------------------------------
function showJoin(code, error = '', { auto = false } = {}) {
  teardown();
  const st = getSettings();
  const codeInput = h('input', {
    class: 'code-input', value: normalizeCode(code), placeholder: 'CODE', maxlength: 8,
    autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Code de la partie',
  });
  const nameInput = h('input', { value: st.playerName, maxlength: 16, 'aria-label': 'Votre nom', autocomplete: 'nickname' });
  const status = h('div', { class: `join-status ${error ? 'err' : ''}` }, error);
  const btn = h('button', { class: 'btn primary big' }, 'Rejoindre');
  const go = async () => {
    const c = normalizeCode(codeInput.value);
    if (c.length < 4) { status.textContent = 'Saisissez le code affiché par l\'hôte.'; status.className = 'join-status err'; return; }
    const name = cleanName(nameInput.value);
    if (name) updateSettings({ playerName: name });
    btn.disabled = true;
    status.className = 'join-status';
    status.textContent = 'Connexion à la partie…';
    try {
      await connectGuest(c);
      status.textContent = 'Connecté !';
    } catch (e) {
      status.className = 'join-status err';
      status.textContent = e.message;
      btn.disabled = false;
    }
  };
  btn.addEventListener('click', go);
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  setScreen(h('div', { class: 'screen join' },
    h('div', { class: 'screen-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Retour', onClick: showHome }, '←'),
      h('h2', null, 'Rejoindre une partie')),
    h('p', { class: 'muted' }, 'Scannez le QR code affiché par l\'hôte avec l\'appareil photo de votre téléphone, ou saisissez son code.'),
    h('div', { class: 'field' }, h('label', null, 'Code de la partie'), codeInput),
    h('div', { class: 'field' }, h('label', null, 'Votre nom'), nameInput),
    btn, status));
  if (auto && normalizeCode(code).length >= 4) {
    go();
    status.textContent = 'Retour à la partie…';
  } else if (normalizeCode(code).length >= 4 && !error) setTimeout(() => btn.focus(), 50);
}

async function connectGuest(code) {
  if (!peerAvailable()) throw new Error('Le module de jeu en ligne n\'a pas pu être chargé.');
  const net = new GuestNet({ signaling: getSettings().signaling, onMessage: onGuestMessage, onClose: onGuestClose });
  await net.connect(code);
  if (session.guestNet) session.guestNet.close();
  session.guestNet = net;
  session.guestTable = null;
  session.mode = 'guest';
  session.guestCode = code;
  rememberGuest(code);
  holdOnlineLock();
  sendHello();
}

/** Présentation à l'hôte (place retrouvée grâce au jeton), puis état de la page. */
function sendHello() {
  const net = session.guestNet;
  if (!net) return;
  net.send({ t: 'hello', name: getSettings().playerName, token: myToken() });
  net.send({ t: 'presence', away: document.visibilityState === 'hidden' });
}

function onGuestMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'welcome':
      if (!session.game) showGuestWaiting(session.guestTable || null, msg.seat);
      break;
    case 'lobby':
      session.guestTable = msg.seats;
      if (!session.game) showGuestWaiting(msg.seats, msg.you);
      break;
    case 'view':
      if (Date.now() - (session.guestSeenAt || 0) > 30000) { session.guestSeenAt = Date.now(); rememberGuest(session.guestCode); }
      if (!session.game) {
        mountGame({ send: (a) => session.guestNet && session.guestNet.send({ t: 'action', action: a }), canReplay: false });
      }
      session.game.update(msg.view);
      break;
    case 'error':
      if (session.game) session.game.actionFailed(msg.message);
      else toast(msg.message);
      break;
    case 'kicked':
      toast('L\'hôte a libéré votre place.');
      break;
    case 'full':
      showJoin(session.guestCode || '', 'La table est complète.');
      break;
    case 'ended':
      if (session.mode === 'guest') {
        const inGameOver = session.game && session.game.view && session.game.view.phase === 'gameOver';
        if (!inGameOver) { showHome(); toast('L\'hôte a arrêté la partie.', 3500); }
        else { forgetGuest(); session.guestNet.close(); session.guestNet = null; }
      }
      break;
    default:
      break;
  }
}

/**
 * Salle d'attente de l'invité : la table vue de dessus, avec les joueurs déjà installés.
 * Il touche une place libre pour s'y asseoir (ou en changer, tant que la partie n'est pas lancée).
 * @param {Array|null} table places de la table (voir lobby.js) ; null si l'hôte ne l'a pas encore envoyée
 * @param {number|null} you sa place, null tant qu'il n'a pas choisi
 */
function showGuestWaiting(table, you) {
  const sit = (seat) => session.guestNet && session.guestNet.send({ t: 'sit', seat });
  const seated = you !== null && you !== undefined;
  const cell = (seat) => {
    const s = table[seat];
    const mine = seat === you;
    const who = partnerOf(table, seat);
    const team = who.kind === 'none' ? null : h('span', { class: 'sc-team' }, `avec ${who.text}`);
    let body;
    if (s.free) {
      body = [
        h('span', { class: 'sc-name' }, 'Place libre'),
        s.replaced ? h('span', { class: 'sc-team' }, `celle de ${s.name}, tenue par un robot`) : null,
        team,
        h('span', { class: 'sc-act' }, seated ? 'Changer pour ici' : 'S\'asseoir ici'),
      ];
    } else {
      const icon = s.kind === 'robot' ? '🤖' : '👤';
      body = [
        h('span', { class: 'sc-name' }, `${icon} ${mine ? 'Vous' : s.name || 'Joueur'}`),
        mine ? h('span', { class: 'sc-team' }, s.name) : null,
        team,
      ];
    }
    const cls = `seat-cell pos-${seat} ${s.free ? 'free' : 'taken'} ${mine ? 'me' : ''}`;
    const label = h('span', { class: 'sc-label' }, s.kind === 'host' ? `${s.label} · hôte` : s.label);
    return s.free
      ? h('button', { class: cls, onClick: () => sit(seat), 'aria-label': `${s.label} : place libre` }, label, body)
      : h('div', { class: cls }, label, body);
  };
  const free = table ? table.filter((s) => s.free) : [];
  const intro = seated
    ? `Vous êtes assis en ${SEAT_LABELS[you]}${you === 2 ? ' : partenaire de l\'hôte' : you === 1 || you === 3 ? ' : adversaire de l\'hôte' : ''}.`
    : table ? 'Choisissez votre place à la table.' : 'Vous avez rejoint la table.';
  const hint = !table ? null
    : !seated && !free.length ? 'Aucune place libre pour l\'instant : l\'hôte peut en libérer une.'
      : seated && free.length ? 'Vous pouvez changer de place en touchant une place libre.' : null;
  setScreen(h('div', { class: 'screen waiting' },
    h('div', { class: 'screen-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Quitter', onClick: showHome }, '←'),
      h('h2', null, seated || !table ? 'Table rejointe' : 'Rejoindre la table')),
    h('p', null, intro),
    table ? h('div', { class: 'seat-table' }, [2, 3, 1, 0].map(cell)) : null,
    hint ? h('p', { class: 'muted small center' }, hint) : null,
    seated || !table ? h('div', { class: 'spinner' }) : null,
    seated || !table ? h('p', { class: 'muted center' }, 'En attente du lancement de la partie par l\'hôte…') : null));
}

let reconnecting = false;

function waitVisible() {
  return new Promise((resolve) => {
    if (document.visibilityState !== 'hidden') { resolve(); return; }
    const on = () => {
      if (document.visibilityState === 'hidden') return;
      document.removeEventListener('visibilitychange', on);
      resolve();
    };
    document.addEventListener('visibilitychange', on);
  });
}

/**
 * Liaison avec l'hôte perdue (page suspendue en arrière-plan, réseau coupé…) : reconnexion
 * automatique à la même place, sans limite de durée tant que l'invité ne quitte pas.
 * Les essais sont suspendus pendant que la page est cachée. Le bandeau n'apparaît que si
 * la reconnexion tarde.
 */
async function onGuestClose() {
  if (session.mode !== 'guest' || reconnecting) return;
  reconnecting = true;
  const text = h('span', null, 'Reconnexion à la partie…');
  const banner = h('div', { class: 'reconnect' }, text,
    h('button', { class: 'btn small', onClick: () => { banner.remove(); showHome(); } }, 'Quitter'));
  const showBanner = setTimeout(() => document.body.append(banner), 1500);
  const t0 = Date.now();
  try {
    for (let i = 0; session.mode === 'guest' && session.guestNet; i++) {
      await sleep([300, 1000, 2000][i] ?? 5000);
      await waitVisible();
      if (session.mode !== 'guest' || !session.guestNet) break;
      if (Date.now() - t0 > 60000) text.textContent = 'L\'hôte ne répond pas pour l\'instant — nouvel essai…';
      try {
        await session.guestNet.connect(session.guestCode);
        sendHello();
        if (Date.now() - t0 > 3000) toast('Reconnecté');
        return;
      } catch { /* nouvel essai */ }
    }
  } finally {
    clearTimeout(showBanner);
    banner.remove();
    reconnecting = false;
  }
}

/** Au retour sur la page : la liaison est-elle toujours là ? Sinon, reconnexion immédiate. */
async function checkGuestLink() {
  if (session.mode !== 'guest' || reconnecting || !session.guestNet) return;
  const net = session.guestNet;
  if (!net.conn) { onGuestClose(); return; }
  // plus de 20 s sans nouvelles (page suspendue) : l'hôte a fermé la liaison, on se reconnecte tout de suite
  if (Date.now() - net.lastHeard > 20000) { net.lost(); return; }
  await net.check(3000); // en cas d'échec, la liaison est déclarée perdue et onGuestClose prend le relais
}

// ---------------------------------------------------------------------------
// Divers
// ---------------------------------------------------------------------------
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !session.wakeLock) {
      session.wakeLock = await navigator.wakeLock.request('screen');
      session.wakeLock.addEventListener('release', () => { session.wakeLock = null; });
    }
  } catch { /* non supporté */ }
}

function releaseWakeLock() {
  try { if (session.wakeLock) session.wakeLock.release(); } catch { /* ignore */ }
  session.wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  const hidden = document.visibilityState === 'hidden';
  if (!hidden && session.game) requestWakeLock();
  if (session.mode === 'host' && session.host) session.host.setAway(0, hidden);
  if (session.mode === 'guest' && session.guestNet) {
    session.guestNet.send({ t: 'presence', away: hidden });
    if (!hidden) checkGuestLink();
  }
});

window.addEventListener('pageshow', (e) => { if (e.persisted) checkGuestLink(); });
window.addEventListener('online', () => checkGuestLink());
window.addEventListener('pagehide', (e) => {
  // page quittée (autre site dans le même onglet, fermeture) : l'hôte le sait tout de suite ;
  // au retour, la page rechargée revient d'elle-même à la table
  if (session.mode === 'guest' && session.guestNet && !e.persisted) session.guestNet.send({ t: 'bye' });
});

window.addEventListener('beforeunload', (e) => {
  if (session.mode === 'host' || session.mode === 'guest') {
    e.preventDefault();
    e.returnValue = '';
  }
});

onSettingsChange((st) => {
  if (st.cardStyle === 'classic') preloadCardImages();
  if (session.host) {
    Object.assign(session.host.config, {
      aiLevel: st.aiLevel, bidTimer: st.bidTimer, playTimer: st.playTimer, robotSpeed: st.robotSpeed,
      counterCallFrom: st.counterCallFrom, mcSamples: st.mcSamples,
    });
  }
});

// Démarrage
if (getSettings().cardStyle === 'classic') preloadCardImages();
const params = new URLSearchParams(location.search);
const joinCode = params.get('join');
const rejoin = recentGuest(true);
if (joinCode) {
  history.replaceState(null, '', location.pathname);
  showJoin(joinCode, '', { auto: normalizeCode(joinCode) === rejoin });
} else if (rejoin) {
  // page rechargée ou restaurée pendant une partie en ligne : retour automatique à la table
  showJoin(rejoin, '', { auto: true });
} else {
  showHome();
}

// Accès pour les tests automatisés
window.__coinche = { session };
