// Page de paramétrage : niveau de jeu, aides, temps limités, score cible…
import { h, segmented } from './dom.js';
import { getSettings, updateSettings, OPTIONS, DEFAULT_SETTINGS } from '../settings.js';
import { HELP_DESCRIPTIONS } from '../advisor.js';
import { CONVENTION_SUMMARY } from '../bidding.js';

const AI_DESC = {
  easy: 'Les robots jouent souvent au hasard et annoncent approximativement.',
  medium: 'Les robots suivent les principes classiques et retiennent les cartes jouées.',
  hard: 'Les robots simulent des centaines de donnes possibles avant de jouer et coinchent à bon escient.',
};

/** @param {{inGame?: boolean, isGuest?: boolean}} ctx */
export function settingsBody(ctx = {}) {
  const st = getSettings();
  const body = h('form', { class: 'settings', onSubmit: (e) => e.preventDefault() });
  const field = (label, control, desc, note) => h('div', { class: 'field' },
    h('label', null, label), control, desc ? h('div', { class: 'desc' }, desc) : null, note ? h('div', { class: 'note' }, note) : null);
  const descEl = (text) => h('div', { class: 'desc' }, text);

  const nameInput = h('input', {
    type: 'text', maxlength: 16, value: st.playerName, autocomplete: 'nickname',
    onInput: (e) => updateSettings({ playerName: e.target.value.trim() || DEFAULT_SETTINGS.playerName }),
  });
  body.append(h('h3', null, 'Joueur'), field('Votre nom', nameInput));

  const hostNote = ctx.inGame ? 'Appliqué à la prochaine partie.' : null;
  const guestNote = ctx.isGuest ? 'En ligne, ce sont les réglages de l\'hôte qui s\'appliquent.' : hostNote;

  const aiDesc = descEl(AI_DESC[st.aiLevel]);
  body.append(h('h3', null, 'Partie'),
    h('div', { class: 'field' }, h('label', null, 'Niveau des robots'),
      segmented(OPTIONS.aiLevel, st.aiLevel, (v) => { updateSettings({ aiLevel: v }); aiDesc.textContent = AI_DESC[v]; }),
      aiDesc, guestNote ? h('div', { class: 'note' }, guestNote) : null),
    field('Score à atteindre', segmented(OPTIONS.targetScore.map(([v]) => [v, String(v)]), st.targetScore, (v) => updateSettings({ targetScore: v })), null, guestNote),
    field('Vitesse des robots', segmented(OPTIONS.robotSpeed, st.robotSpeed, (v) => updateSettings({ robotSpeed: v })), null, guestNote));

  const bidDesc = descEl(HELP_DESCRIPTIONS.bid[st.bidHelp]);
  const playDesc = descEl(HELP_DESCRIPTIONS.play[st.playHelp]);
  body.append(h('h3', null, 'Aides'),
    h('div', { class: 'field' }, h('label', null, 'Aide aux enchères'),
      segmented(OPTIONS.help, st.bidHelp, (v) => { updateSettings({ bidHelp: v }); bidDesc.textContent = HELP_DESCRIPTIONS.bid[v]; }, { small: true }),
      bidDesc),
    h('div', { class: 'field' }, h('label', null, 'Aide au jeu'),
      segmented(OPTIONS.help, st.playHelp, (v) => { updateSettings({ playHelp: v }); playDesc.textContent = HELP_DESCRIPTIONS.play[v]; }, { small: true }),
      playDesc));

  const timerSelect = (key) => {
    const sel = h('select', { onChange: (e) => updateSettings({ [key]: Number(e.target.value) }) },
      OPTIONS.timer.map(([v, label]) => h('option', { value: v, selected: st[key] === v }, label)));
    return sel;
  };
  body.append(h('h3', null, 'Temps limité'),
    field('Pour chaque enchère', timerSelect('bidTimer'), 'À expiration, le joueur passe automatiquement.', guestNote),
    field('Pour jouer une carte', timerSelect('playTimer'), 'À expiration, une carte conseillée est jouée automatiquement.', guestNote));

  const ccSelect = h('select', { onChange: (e) => updateSettings({ counterCallFrom: Number(e.target.value) }) },
    OPTIONS.counterCall.map(([v, label]) => h('option', { value: v, selected: st.counterCallFrom === v }, label)));
  body.append(h('h3', null, 'Conventions de jeu'),
    field('Contre-appels de l\'équipe preneuse', ccSelect,
      'Lors d\'une défausse, la première petite carte est un signal. Appel direct : « joue cette couleur, j\'en ai l\'as ». Contre-appel : « je n\'ai rien ici, joue ailleurs ». La défense appelle toujours directement.',
      guestNote));

  body.append(h('h3', null, 'Confort'),
    h('label', { class: 'switch' },
      h('input', { type: 'checkbox', checked: st.confirmPlay, onChange: (e) => updateSettings({ confirmPlay: e.target.checked }) }),
      h('span', null, 'Toucher deux fois une carte pour la jouer')));

  body.append(h('details', { class: 'advanced' },
    h('summary', null, 'Avancé'),
    field('Serveur de mise en relation (PeerJS)',
      h('input', {
        type: 'text', placeholder: 'serveur public par défaut', value: st.signaling,
        onChange: (e) => updateSettings({ signaling: e.target.value.trim() }),
      }),
      'Laisser vide pour utiliser le serveur public gratuit de PeerJS. Format : hôte:port/chemin (ex. monserveur.fr:9000/).')));
  return body;
}

export function rulesBody() {
  return h('div', { class: 'rules' },
    h('h3', null, 'Principe'),
    h('p', null, 'La coinche se joue à 4, en deux équipes de deux partenaires assis face à face (Nord–Sud contre Est–Ouest), avec un jeu de 32 cartes. Le jeu tourne dans le sens inverse des aiguilles d\'une montre. Cette version se joue sans annonces (pas de tierce, cinquante, carré…).'),
    h('h3', null, 'Enchères'),
    h('ul', null,
      h('li', null, 'Chacun à son tour passe ou annonce un contrat plus élevé : 80, 90… 180, Capot (faire tous les plis) ou Générale (le preneur seul fait tous les plis).'),
      h('li', null, 'L\'atout choisi peut être ♥ cœur, ♦ carreau, ♣ trèfle, ♠ pique, SA (sans atout) ou TA (tout atout).'),
      h('li', null, 'Un adversaire peut coincher le dernier contrat (points ×2) ; l\'équipe preneuse peut alors surcoincher (×4).'),
      h('li', null, 'Les enchères s\'arrêtent après trois « passe » consécutifs. Si les quatre joueurs passent d\'entrée, on redistribue.')),
    h('h3', null, 'Conventions d\'enchères'),
    h('p', null, 'Les robots annoncent selon les conventions classiques : la première annonce montre la qualité de l\'atout, les as s\'annoncent ensuite. Les conseils d\'enchères suivent les mêmes règles. À partir de l\'aide « Intermédiaire », touchez une bulle d\'annonce pour en connaître la signification.'),
    h('table', { class: 'tbl conventions' },
      h('tbody', null, CONVENTION_SUMMARY.map(([k, txt]) => h('tr', null, h('td', null, h('b', null, k)), h('td', null, txt))))),
    h('h3', null, 'Valeur des cartes'),
    h('table', { class: 'tbl compact' },
      h('thead', null, h('tr', null, h('th', null, 'Carte'), h('th', null, 'Atout'), h('th', null, 'Non atout'), h('th', null, 'SA'), h('th', null, 'TA'))),
      h('tbody', null,
        [['Valet', 20, 2, 2, 14], ['9', 14, 0, 0, 9], ['As', 11, 11, 19, 6], ['10', 10, 10, 10, 5], ['Roi', 4, 4, 4, 3], ['Dame', 3, 3, 3, 1], ['8 et 7', 0, 0, 0, 0]]
          .map((r) => h('tr', null, r.map((c) => h('td', null, c)))))),
    h('p', { class: 'muted small' }, 'Ordre à l\'atout (et en tout atout) : V, 9, A, 10, R, D, 8, 7. Hors atout et en sans atout : A, 10, R, D, V, 9, 8, 7. Le dernier pli vaut 10 points de plus (« dix de der ») : il y a toujours 162 points en jeu.'),
    h('h3', null, 'Jeu de la carte'),
    h('ul', null,
      h('li', null, 'Il faut fournir la couleur demandée.'),
      h('li', null, 'À l\'atout, il faut monter (jouer plus fort) si on le peut. En tout atout, il faut monter dans la couleur demandée.'),
      h('li', null, 'Sans la couleur demandée : si son partenaire est maître, on joue ce que l\'on veut ; sinon on doit couper, surcouper si un adversaire a déjà coupé, ou à défaut sous-couper.'),
      h('li', null, 'Belote : le roi et la dame d\'atout dans la même main (contrat à la couleur) valent 20 points, toujours acquis à l\'équipe qui les détient.')),
    h('h3', null, 'Stratégie de jeu des robots'),
    h('ul', null,
      h('li', null, 'L\'équipe preneuse fait d\'abord tomber les atouts adverses, pour ne pas se faire couper ses as. Le partenaire du preneur rejoue atout dès qu\'il a la main.'),
      h('li', null, 'Si le partenaire tient le valet d\'atout (montré aux enchères), on entame un petit atout : l\'adversaire est obligé de monter et peut perdre son 9.'),
      h('li', null, 'Les robots retiennent ce que le jeu révèle : couleur non fournie (plus de cartes), grosse carte donnée sans prendre (10 sec, 9 sec), atout plus faible joué alors qu\'il fallait monter (pas d\'atout plus fort).'),
      h('li', null, 'Appels : à la première défausse, une petite carte (7, 8, 9) est un signal. Appel direct = « j\'ai l\'as de cette couleur, joue-la ». Contre-appel = « rien ici, joue ailleurs ». L\'équipe preneuse joue en contre-appels à partir du seuil choisi dans les paramètres (100 par défaut) ; la défense appelle toujours directement.')),
    h('h3', null, 'Réussite du contrat'),
    h('ul', null,
      h('li', null, h('b', null, 'Il faut toujours au moins 82 points de cartes, belote non comptée.'), ' Une enchère à 80 n\'est donc jamais remplie grâce à la belote.'),
      h('li', null, 'Au-delà de 80, la belote des preneurs compte pour atteindre la valeur du contrat (ex. 100 annoncé : 85 points + belote = réussi).'),
      h('li', null, 'Capot : l\'équipe preneuse doit faire les 8 plis. Générale : le preneur seul doit faire les 8 plis.')),
    h('h3', null, 'Décompte'),
    h('ul', null,
      h('li', null, 'Contrat réussi : les preneurs marquent contrat + points faits, la défense marque ses points.'),
      h('li', null, 'Contrat chuté : la défense marque 160 + le contrat.'),
      h('li', null, 'Coinché (×2) ou surcoinché (×4) : l\'équipe gagnante marque 160 + contrat × multiplicateur, l\'autre 0.'),
      h('li', null, 'Capot réalisé sans l\'avoir annoncé : les points faits comptent 250.'),
      h('li', null, 'La belote (20) s\'ajoute toujours au score de l\'équipe qui la détient.'),
      h('li', null, 'La première équipe qui atteint le score fixé (1000 par défaut) à la fin d\'une manche gagne la partie.')),
    h('h3', null, 'Jouer en ligne'),
    h('p', null, 'Dans « Nouvelle partie », passez une ou plusieurs places en « Invité » : un QR code et un code de partie s\'affichent. Vos amis le scannent avec leur téléphone pour rejoindre la table. Les places non occupées sont tenues par des robots.'));
}
