// Petits utilitaires DOM.
import { suitOf, rankOf, isRed, RANK_LABEL, SUIT_SYMBOL, SUITS, RANKS } from '../cards.js';
import { getSettings } from '../settings.js';

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of [children].flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let toastTimer = null;
export function toast(msg, ms = 2400) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/** Image du style « Classique » (jeu d'Adrian Kennard, domaine public, index français). */
export const cardImage = (card) => `vendor/cards/${card}.svg`;

const preloaded = [];
/** Charge à l'avance les 32 images pour éviter un affichage vide à la première apparition. */
export function preloadCardImages() {
  if (preloaded.length) return;
  for (const s of SUITS) {
    for (const r of RANKS) {
      const img = new Image();
      img.src = cardImage(r + s);
      preloaded.push(img);
    }
  }
}

/**
 * Élément carte.
 * Style « Classique » : image complète (symboles disposés comme sur un vrai jeu, figures illustrées,
 * index dans les quatre coins). Style « Lisible » : gros index, grand symbole et index retourné en bas.
 * Les mini-cartes (revue de la donne) gardent l'index seul, plus lisible à 36 pixels.
 */
export function cardEl(card, opts = {}) {
  if (!card || opts.back) return h('div', { class: `card back ${opts.class || ''}` });
  const s = suitOf(card);
  const r = rankOf(card);
  const face = ['J', 'Q', 'K'].includes(r);
  const mini = /(^|\s)mini(\s|$)/.test(opts.class || '');
  const style = mini ? 'mini' : (opts.style || getSettings().cardStyle || 'classic');
  const props = {
    class: `card ${isRed(s) ? 'red' : 'black'} ${face ? 'face' : ''} ${style === 'classic' ? 'classic' : ''} ${opts.class || ''}`,
    dataset: { card },
    role: opts.button ? 'button' : null,
    'aria-label': cardName(card),
  };
  if (style === 'classic') {
    return h('div', props, h('img', { class: 'face-img', src: cardImage(card), alt: '', draggable: 'false' }));
  }
  const index = (cls) => h('span', { class: cls }, h('span', { class: 'rk' }, RANK_LABEL[r]), h('span', { class: 'st' }, SUIT_SYMBOL[s]));
  if (style === 'mini') return h('div', props, index('idx'), h('span', { class: 'big' }, face ? RANK_LABEL[r] : SUIT_SYMBOL[s]));
  return h('div', props, index('idx'), index('idx idx-br'), h('span', { class: 'big' }, face ? RANK_LABEL[r] : SUIT_SYMBOL[s]));
}

const RANK_FULL = { '7': 'Sept', '8': 'Huit', '9': 'Neuf', T: 'Dix', J: 'Valet', Q: 'Dame', K: 'Roi', A: 'As' };
const SUIT_FULL = { H: 'cœur', D: 'carreau', S: 'pique', C: 'trèfle' };
export function cardName(card) {
  return `${RANK_FULL[rankOf(card)]} de ${SUIT_FULL[suitOf(card)]}`;
}

export function suitSpan(trump, cls = '') {
  const red = trump === 'H' || trump === 'D';
  return h('span', { class: `suit ${red ? 'red' : ''} ${cls}` }, SUIT_SYMBOL[trump]);
}

let zTop = 50;
const nextZ = () => String(++zTop);

/** Fenêtre modale (feuille en bas sur mobile). Retourne {el, close}. */
export function openModal(content, { onClose, dismissable = true, cls = '' } = {}) {
  const backdrop = h('div', { class: 'modal-backdrop', style: { zIndex: nextZ() } });
  const box = h('div', { class: `modal ${cls}`, role: 'dialog', 'aria-modal': 'true' });
  append(box, content);
  backdrop.append(box);
  const close = () => {
    backdrop.remove();
    if (onClose) onClose();
  };
  if (dismissable) {
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  }
  document.body.append(backdrop);
  return { el: box, backdrop, close };
}

/** Panneau plein écran (paramètres, statistiques, règles). */
export function openPanel(title, body, { onClose } = {}) {
  const panel = h('div', { class: 'panel', style: { zIndex: nextZ() } });
  const close = () => {
    panel.remove();
    if (onClose) onClose();
  };
  panel.append(
    h('div', { class: 'panel-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Retour', onClick: close }, '←'),
      h('h2', null, title)),
    h('div', { class: 'panel-body' }, body),
  );
  document.body.append(panel);
  return { el: panel, close };
}

export function confirmDialog(message, { ok = 'Confirmer', cancel = 'Annuler' } = {}) {
  return new Promise((resolve) => {
    let m;
    const done = (v) => { resolve(v); m.close(); };
    m = openModal([
      h('p', { class: 'confirm-msg' }, message),
      h('div', { class: 'row-btns' },
        h('button', { class: 'btn', onClick: () => done(false) }, cancel),
        h('button', { class: 'btn primary', onClick: () => done(true) }, ok)),
    ], { onClose: () => resolve(false) });
  });
}

/** Contrôle segmenté. options = [[value, label], ...] */
export function segmented(options, value, onChange, { small = false } = {}) {
  const wrap = h('div', { class: `seg ${small ? 'small' : ''}`, role: 'radiogroup' });
  for (const [v, label] of options) {
    const b = h('button', {
      type: 'button',
      class: v === value ? 'on' : '',
      role: 'radio',
      'aria-checked': v === value ? 'true' : 'false',
      onClick: () => {
        for (const x of wrap.children) { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); }
        b.classList.add('on');
        b.setAttribute('aria-checked', 'true');
        onChange(v);
      },
    }, label);
    wrap.append(b);
  }
  return wrap;
}
