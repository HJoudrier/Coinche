// Partie en ligne en pair-à-pair (WebRTC via PeerJS).
// L'hôte fait autorité : il exécute le moteur et envoie à chaque invité sa vue.
//
// Protocole (JSON) :
//   invité → hôte : {t:'hello', name, token} | {t:'action', action} | {t:'ping'}
//   hôte → invité : {t:'welcome', seat, code} | {t:'lobby', seats} | {t:'view', view}
//                   {t:'error', message} | {t:'full'} | {t:'pong'}

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

  /** Ferme les connexions silencieuses depuis plus de `ms`. */
  reapSilent(ms = 20000) {
    const now = Date.now();
    for (const c of [...this.conns]) {
      if (now - (c.lastSeen || now) > ms) {
        this.conns.delete(c);
        try { c.close(); } catch { /* déjà fermée */ }
        this.onDisconnect(c);
      }
    }
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
    this.pingTimer = null;
    this.closedByUser = false;
  }

  connect(code) {
    if (!peerAvailable()) return Promise.reject(new Error('Bibliothèque réseau indisponible'));
    this.disposePeer();
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
          this.pingTimer = setInterval(() => this.send({ t: 'ping' }), 5000);
          resolve();
        });
        conn.on('data', (msg) => { if (!msg || msg.t !== 'pong') this.onMessage(msg); });
        const closed = () => {
          if (this.conn !== conn) return;
          this.conn = null;
          clearInterval(this.pingTimer);
          if (!this.closedByUser) this.onClose();
        };
        conn.on('close', closed);
        conn.on('error', closed);
      });
    });
  }

  send(msg) {
    try { if (this.conn && this.conn.open) this.conn.send(msg); } catch (e) { console.warn(e); }
  }

  disposePeer() {
    clearInterval(this.pingTimer);
    if (this.conn) { try { this.conn.close(); } catch { /* ignore */ } }
    this.conn = null;
    if (this.peer) { try { this.peer.destroy(); } catch { /* ignore */ } }
    this.peer = null;
  }

  close() {
    this.closedByUser = true;
    this.disposePeer();
  }
}
