// The R18+ badge for the title screen (traced from the Australian "Restricted"
// marking layout as vector art: no background outside the badge), and the
// panel it opens with each state's tattoo age law.
import { h, ui } from './dom';
import { AGE_LAWS, AGE_LAWS_CHECKED } from '../content/age-laws';
import { BRAND } from '../../shared/brand.mjs';

const BADGE_SVG = `
<svg viewBox="0 0 540 180" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <defs><clipPath id="r18clip"><rect x="2" y="2" width="536" height="176" rx="18"/></clipPath></defs>
  <g clip-path="url(#r18clip)">
    <rect x="2" y="2" width="536" height="176" fill="#fff"/>
    <rect x="2" y="2" width="270" height="176" fill="#000"/>
  </g>
  <rect x="2" y="2" width="536" height="176" rx="18" fill="none" stroke="#000" stroke-width="4"/>
  <path d="M93 6 L146 59 L93 112 L40 59 Z" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="miter"/>
  <text x="93" y="81" text-anchor="middle" fill="#fff" font-size="64" font-weight="700" font-family="'Barlow Semi Condensed','Arial Narrow',Arial,sans-serif">R</text>
  <text x="158" y="86" fill="#fff" font-size="52" font-weight="500" font-family="'Barlow Semi Condensed','Arial Narrow',Arial,sans-serif">18+</text>
  <rect x="2" y="134" width="270" height="4" fill="#fff"/>
  <text x="137" y="171" text-anchor="middle" fill="#fff" font-size="29" font-weight="500" letter-spacing="0.5" font-family="'Barlow Semi Condensed','Arial Narrow',Arial,sans-serif">RESTRICTED</text>
  <text x="284" y="83" fill="#000" font-size="38" font-weight="500" font-family="'Barlow Semi Condensed','Arial Narrow',Arial,sans-serif">Restricted to 18</text>
  <text x="284" y="122" fill="#000" font-size="38" font-weight="500" font-family="'Barlow Semi Condensed','Arial Narrow',Arial,sans-serif">and over</text>
</svg>`;

export function r18Badge(onOpen: () => void) {
  const btn = h('button', {
    class: 'r18 live',
    type: 'button',
    'aria-label': 'Restricted to 18 and over. Read the tattoo age laws in Australia.',
    onclick: onOpen,
  });
  btn.innerHTML = BADGE_SVG;
  return btn;
}

export function openAgeLaws() {
  document.querySelector('.age-sheet')?.remove();
  const close = () => {
    sheet.classList.add('is-gone');
    setTimeout(() => sheet.remove(), 300);
    removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
  addEventListener('keydown', onKey);
  const sheet = h(
    'div',
    { class: 'age-sheet live', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'age-title', onclick: (e: Event) => e.target === sheet && close() },
    h(
      'div',
      { class: 'age-sheet__panel panel' },
      h('button', { class: 'age-sheet__close', type: 'button', 'aria-label': 'Close', onclick: close }, '×'),
      h('span', { class: 'kicker' }, 'Restricted · 18+'),
      h('h2', { id: 'age-title', class: 'title', style: { fontSize: 'clamp(30px,8vw,46px)' } }, 'Tattoo age laws', h('br'), h('span', { class: 'title--grad' }, 'in Australia')),
      h('p', { class: 'age-sheet__lede' }, `${BRAND.studio} only tattoos clients aged 18 and over. ${BRAND.ageNote}`),
      h(
        'div',
        { class: 'age-laws' },
        ...AGE_LAWS.map((l) =>
          h(
            'article',
            { class: 'age-law' },
            h('h3', null, l.state, h('span', null, l.rule)),
            h('p', null, l.detail),
            h('p', { class: 'age-law__penalty' }, h('b', null, 'Consequence: '), l.penalty),
            h('a', { href: l.url, target: '_blank', rel: 'noopener' }, l.law),
          ),
        ),
      ),
      h('p', { class: 'age-sheet__fine' }, `General information only, not legal advice. Laws checked ${AGE_LAWS_CHECKED}; penalties change, so follow the links for the current law.`),
    ),
  );
  ui().append(sheet);
  (sheet.querySelector('.age-sheet__close') as HTMLElement).focus();
}
