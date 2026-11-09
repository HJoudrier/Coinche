// Partie en ligne en pair-à-pair (WebRTC via PeerJS).
// L'hôte fait autorité : il exécute le moteur et envoie à chaque invité sa vue.
//
// Protocole (JSON) :
//   invité → hôte : {t:'hello', name, token} | {t:'action', action} | {t:'ping'}
//                   {t:'presence', away} (page cachée ou visible) | {t:'bye'} (page fermée)
//   hôte → invité : {t:'welcome', seat, code} | {t:'lobby', seats} | {t:'view', view}
//                   {t:'error', message} | {t:'full'} | {t:'pong'} | {t:'ended'}

export const PEER_PREFIX = 'coinche-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeRoomCode(n = 6) {
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Appelle `fn` toutes les `ms` millisecondes. La cadence vient d'un petit Web Worker : ses timers sont
 * moins ralentis que ceux d'un onglet caché, ce qui garde le battement de cœur quand le joueur ouvre
 * une autre page (sur ordinateur ; un téléphone suspend la page entière). Repli sur setInterval.
 */
export function backgroundTicker(ms, fn) {
  let worker = null;
  let id = null;
  const fallback = () => {
    if (worker) { try { worker.terminate(); } catch { /* ignore */ } worker = null; }
    if (id === null) id = setInterval(fn, ms);
  };
  try {
    if (typeof Worker === 'function' && typeof Blob === 'function' && typeof URL !== 'undefined' && URL.createObjectURL) {
      const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${Number(ms)});`], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = () => { if (url) URL.revokeObjectURL(url); fn(); };
      worker.onerror = fallback;
    }
  } catch { worker = null; }
  if (!worker) fallback();
  return {
    stop() {
      if (worker) { try { worker.terminate(); } catch { /* ignore */ } worker = null; }
      if (id !== null) clearInterval(id);
      id = null;
    },
  };
}

export function peerAvailable() {
  return typeof window !== 'undefined' && typeof window.Peer === 'function';
}

/** Options PeerJS ; `signaling` = serveur personnalisé « hôte:port/chemin » (vide = serveur public). */
export function peerOptions(signaling) {
  const opts = {
    debug: 1,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    },
  };
  if (!signaling || !signaling.trim()) return opts;
  let url = signaling.trim();
  if (!/^https?:\/\//.test(url)) url = `${location.protocol === 'https:' ? 'https' : 'http'}://${url}`;
  const u = new URL(url);
  opts.host = u.hostname;
  opts.secure = u.protocol === 'https:';
  opts.port = u.port ? Number(u.port) : opts.secure ? 443 : 80;
  opts.path = u.pathname || '/';
  return opts;
}

function describeError(err) {
  const type = err && err.type;
  switch (type) {
    case 'peer-unavailable': return 'Partie introuvable : vérifiez le code ou demandez à l\'hôte de rouvrir la partie.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Impossible de joindre le serveur de mise en relation. Vérifiez votre connexion internet.';
    case 'browser-incompatible': return 'Ce navigateur ne permet pas le jeu en ligne (WebRTC).';
    case 'unavailable-id': return 'Code de partie déjà utilisé.';
    default: return (err && err.message) || 'Erreur réseau';
  }
}

export class HostNet {
  constructor({ signaling = '', onMessage, onDisconnect, onError } = {}) {
    this.signaling = signaling;
    this.onMessage = onMessage || (() => {});
    this.onDisconnect = onDisconnect || (() => {});
    this.onError = onError || (() => {});
    this.peer = null;
    this.code = null;
    this.conns = new Set();
  }

  open(preferredCode = null) {
    if (!peerAvailable()) return Promise.reject(new Error('Bibliothèque réseau indisponible'));
    return new Promise((resolve, reject) => {
      const attempt = (n, code) => {
        const peer = new window.Peer(PEER_PREFIX + code, peerOptions(this.signaling));
        let opened = false;
        peer.on('open', () => {
          opened = true;
          this.peer = peer;
          this.code = code;
          resolve(code);
        });
        peer.on('connection', (conn) => this.handleConn(conn));
        peer.on('disconnected', () => {
          // perte du serveur de signalisation : les connexions établies restent actives
          if (!peer.destroyed) setTimeout(() => { if (!peer.destroyed) peer.reconnect(); }, 2000);
        });
        peer.on('error', (err) => {
          if (!opened) {
            peer.destroy();
            if (err.type === 'unavailable-id' && n < 5) attempt(n + 1, makeRoomCode());
            else reject(new Error(describeError(err)));
            return;
          }
          if (err.type !== 'peer-unavailable') this.onError(new Error(describeError(err)));
        });
      };
      attempt(0, preferredCode || makeRoomCode());
    });
  }

  handleConn(conn) {
    conn.on('open', () => this.conns.add(conn));
    conn.on('data', (msg) => {
      conn.lastSeen = Date.now();
      if (msg && msg.t === 'ping') { this.send(conn, { t: 'pong' }); return; }
      if (msg && msg.t === 'bye') { this.drop(conn); return; }
      this.onMessage(conn, msg);
    });
    const closed = () => {
      if (!this.conns.has(conn)) return;
      this.conns.delete(conn);
      this.onDisconnect(conn);
    };
    conn.on('close', closed);
    conn.on('error', closed);
    conn.lastSeen = Date.now();
  }

  /** Ferme une connexion et la signale comme perdue. */
  drop(conn) {
    if (!this.conns.has(conn)) return;
    this.conns.delete(conn);
    try { conn.close(); } catch { /* déjà fermée */ }
    this.onDisconnect(conn);
  }

  /**
   * Ferme les connexions silencieuses depuis plus de `ms` (appelé toutes les `every` ms).
   * Si l'appel arrive très en retard, c'est l'hôte qui était suspendu (page cachée sur téléphone) :
   * on laisse aux invités le temps de se manifester au lieu de couper tout le monde au réveil.
   * @returns {Array} connexions fermées
   */
  reapSilent(ms = 20000, now = Date.now(), every = 5000) {
    const late = this.lastReap !== undefined && now - this.lastReap > every + 10000;
    this.lastReap = now;
    if (late) {
      for (const c of this.conns) c.lastSeen = now;
      return [];
    }
    const dropped = [];
    for (const c of [...this.conns]) {
      if (now - (c.lastSeen || now) > ms) {
        dropped.push(c);
        this.drop(c);
      }
    }
    return dropped;
  }

  send(conn, msg) {
    try { if (conn && conn.open) conn.send(msg); } catch (e) { console.warn(e); }
  }

  close() {
    for (const c of this.conns) { try { c.close(); } catch { /* ignore */ } }
    this.conns.clear();
    if (this.peer) this.peer.destroy();
    this.peer = null;
  }
}

export class GuestNet {
  constructor({ signaling = '', onMessage, onClose } = {}) {
    this.signaling = signaling;
    this.onMessage = onMessage || (() => {});
    this.onClose = onClose || (() => {});
    this.peer = null;
    this.conn = null;
    this.ticker = null;
    this.closedByUser = false;
    this.lastHeard = 0;
    this.waiters = [];
    this.probing = null;
  }

  connect(code) {
    if (!peerAvailable()) return Promise.reject(new Error('Bibliothèque réseau indisponible'));
    this.disposePeer();
    this.closedByUser = false;
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        this.disposePeer();
        reject(err instanceof Error && !err.type ? err : new Error(describeError(err)));
      };
      const timeout = setTimeout(() => fail(new Error('Délai de connexion dépassé. Vérifiez le code et votre réseau.')), 20000);
      const peer = new window.Peer(peerOptions(this.signaling));
      this.peer = peer;
      peer.on('error', (err) => { clearTimeout(timeout); fail(err); });
      peer.on('open', () => {
        const conn = peer.connect(PEER_PREFIX + normalizeCode(code), { reliable: true, serialization: 'json' });
        conn.on('open', () => {
          clearTimeout(timeout);
          settled = true;
          this.conn = conn;
          this.lastHeard = Date.now();
          if (this.ticker) this.ticker.stop();
          this.ticker = backgroundTicker(5000, () => this.tick());
          resolve();
        });
        conn.on('data', (msg) => {
          if (this.conn !== conn) return;
          this.lastHeard = Date.now();
          this.wake(true);
          if (!msg || msg.t !== 'pong') this.onMessage(msg);
        });
        const closed = () => {
          if (this.conn !== conn) return;
          this.lost();
        };
        conn.on('close', closed);
        conn.on('error', closed);
      });
    });
  }

  /** Battement de cœur : un ping toutes les 5 s ; sans nouvelles depuis 15 s, on vérifie la liaison. */
  tick() {
    if (!this.conn) return;
    this.send({ t: 'ping' });
    if (Date.now() - this.lastHeard > 15000) this.check();
  }

  /** Réveille les vérifications en attente : `alive` = l'hôte a répondu. */
  wake(alive) {
    const w = this.waiters;
    this.waiters = [];
    for (const fn of w) fn(alive);
  }

  /** Vérifie que l'hôte répond (un ping, une réponse attendue sous `ms`). Si non, la liaison est déclarée perdue. */
  check(ms = 3000) {
    if (!this.conn) return Promise.resolve(false);
    if (this.probing) return this.probing;
    const conn = this.conn;
    this.probing = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      this.waiters.push((alive) => { clearTimeout(timer); resolve(alive); });
      this.send({ t: 'ping' });
    }).then((ok) => {
      this.probing = null;
      if (!ok && this.conn === conn) this.lost();
      return ok;
    });
    return this.probing;
  }

  /** Liaison perdue : on la ferme et on prévient l'application (qui se reconnecte). */
  lost() {
    const conn = this.conn;
    this.conn = null;
    if (this.ticker) { this.ticker.stop(); this.ticker = null; }
    this.wake(false);
    if (conn) { try { conn.close(); } catch { /* ignore */ } }
    if (!this.closedByUser) this.onClose();
  }

  get connected() {
    return !!(this.conn && this.conn.open);
  }

  send(msg) {
    try { if (this.conn && this.conn.open) this.conn.send(msg); } catch (e) { console.warn(e); }
  }

  disposePeer() {
    if (this.ticker) { this.ticker.stop(); this.ticker = null; }
    const conn = this.conn;
    this.conn = null;
    this.wake(false);
    if (conn) { try { conn.close(); } catch { /* ignore */ } }
    if (this.peer) { try { this.peer.destroy(); } catch { /* ignore */ } }
    this.peer = null;
  }

  close() {
    this.closedByUser = true;
    this.disposePeer();
  }
}
