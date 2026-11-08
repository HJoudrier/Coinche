// Paramètres utilisateur, sauvegardés dans le navigateur.
const KEY = 'coinche.settings.v1';

export const DEFAULT_SETTINGS = Object.freeze({
  playerName: 'Moi',
  aiLevel: 'medium', // easy | medium | hard
  bidHelp: 1, // 0 aucune, 1 débutant, 2 intermédiaire, 3 expert
  playHelp: 1,
  bidTimer: 0, // secondes, 0 = désactivé
  playTimer: 0,
  targetScore: 1000,
  robotSpeed: 'normal', // slow | normal | fast
  confirmPlay: false,
  signaling: '', // serveur PeerJS personnalisé (vide = serveur public)
  counterCallFrom: 100, // contrat à partir duquel l'équipe preneuse joue en contre-appels (999 = jamais)
  mcSamples: 500, // donnes simulées par décision pour le niveau difficile et l'aide experte
});

export const OPTIONS = {
  aiLevel: [
    ['easy', 'Facile'],
    ['medium', 'Moyen'],
    ['hard', 'Difficile'],
  ],
  help: [
    [0, 'Aucune'],
    [1, 'Débutant'],
    [2, 'Intermédiaire'],
    [3, 'Expert'],
  ],
  timer: [
    [0, 'Désactivé'],
    [10, '10 s'],
    [15, '15 s'],
    [20, '20 s'],
    [30, '30 s'],
    [45, '45 s'],
    [60, '60 s'],
  ],
  targetScore: [
    [500, '500 points'],
    [1000, '1000 points'],
    [1500, '1500 points'],
    [2000, '2000 points'],
  ],
  counterCall: [
    [80, 'Toujours (dès 80)'],
    [90, 'À partir de 90'],
    [100, 'À partir de 100'],
    [110, 'À partir de 110'],
    [120, 'À partir de 120'],
    [999, 'Jamais (appels directs)'],
  ],
  mcSamples: [
    [100, '100'],
    [250, '250'],
    [500, '500'],
    [1000, '1000'],
  ],
  robotSpeed: [
    ['slow', 'Lente'],
    ['normal', 'Normale'],
    ['fast', 'Rapide'],
  ],
};

export const ROBOT_DELAYS = {
  slow: { act: 1300, trick: 1900 },
  normal: { act: 750, trick: 1300 },
  fast: { act: 300, trick: 800 },
};

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* stockage indisponible */ }
}

let current = null;
const listeners = new Set();

export function loadSettings() {
  if (current) return current;
  let saved = {};
  try { saved = JSON.parse(safeGet(KEY) || '{}'); } catch { saved = {}; }
  current = { ...DEFAULT_SETTINGS, ...saved };
  return current;
}

export function getSettings() {
  return loadSettings();
}

export function updateSettings(patch) {
  current = { ...loadSettings(), ...patch };
  safeSet(KEY, JSON.stringify(current));
  for (const fn of listeners) fn(current);
  return current;
}

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export { safeGet, safeSet };
