// 画面の小さな部品（文字のエスケープ・上の案内・前回のセットの一覧）
import { weightParts, repsParts } from './records.js';

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// アイコン。枠（.icf）の高さを横の文字の行の高さと同じにし、絵は枠の真ん中に置く（大きさは em で、文字の設定についてくる）
const ICONS = {
  chevronLeft: '<svg class="i-chev" viewBox="0 0 11 19" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9.3 1.7L1.7 9.5l7.6 7.8"/></svg>',
  chevronRight: '<svg class="i-chevr" viewBox="0 0 7 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1.2 1.2L5.8 6l-4.6 4.8"/></svg>',
  chevronDown: '<svg class="i-chevd" viewBox="0 0 12 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1.2 1.2L6 5.8l4.8-4.6"/></svg>',
  plus: '<svg class="i-plus" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 1.5v15M1.5 9h15"/></svg>',
  plusInline: '<svg class="i-plusi" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M7 1.2v11.6M1.2 7h11.6"/></svg>',
  minusInline: '<svg class="i-plusi" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M1.2 7h11.6"/></svg>',
  xmark: '<svg class="i-x" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9"/></svg>',
  checkmark: '<svg class="i-check" viewBox="0 0 12 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.2 5.3l3.3 3.3L10.8 1.4"/></svg>',
  arrowUp: '<svg class="i-up" viewBox="0 0 8 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10V1.2M1 4.2L4 1.2l3 3"/></svg>',
};
// 丸の中に入れる小さな絵（打っている欄の左はしの丸）
export const GLYPHS = {
  copy: '<svg class="g-ccw" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.3 6.5A3.9 3.9 0 1 0 3.6 3.3M2.2 1.3v2.4h2.4"/></svg>',
  clear: '<svg class="g-x" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 2l6 6M8 2L2 8"/></svg>',
};
export function iconHtml(name) {
  return `<span class="icf" aria-hidden="true">${ICONS[name]}</span>`;
}

// [{ text, unit?, extra?, tight?, caret? }] を、数字と小さい単位の HTML にする
export function partsHtml(parts) {
  return (parts ?? []).map((p, i) => {
    const cls = [p.extra ? 'ex' : '', i > 0 && !p.tight ? 'gap' : ''].filter(Boolean).join(' ');
    return `<span${cls ? ` class="${cls}"` : ''}>${esc(p.text)}${p.caret ? '<i class="caret"></i>' : ''}${p.unit ? `<small class="u">${esc(p.unit)}</small>` : ''}</span>`;
  }).join('');
}

// 前回の一覧の1つの値。単位（kg・回）の左はしを全部の行でそろえるため、数字まで（左）と単位から（右）に分ける
function alignedHtml(parts) {
  const list = parts ?? [];
  const at = list.findIndex((p) => p.unit);
  if (at < 0) return `<span class="vn">${partsHtml(list)}</span><span class="vu"></span>`;
  const head = list.slice(0, at + 1).map((p, i) => (i === at ? { ...p, unit: undefined } : p));
  const tail = [{ text: '', unit: list[at].unit, tight: true }, ...list.slice(at + 1)];
  return `<span class="vn">${partsHtml(head)}</span><span class="vu">${partsHtml(tail)}</span>`;
}

// セットごとの縦の一覧（記録の画面の「前回」と、履歴の画面のカード）。列は「今回」の行と同じ
export function setListHtml(sets) {
  const rows = sets.map((s, i) =>
    `<div class="prow"><span>${i + 1}</span><span class="v">${alignedHtml(weightParts(s))}</span><span class="v">${alignedHtml(repsParts(s))}</span><span></span></div>`).join('');
  return `<div class="plist">${rows}</div>`;
}

let topTimer = null;
// 上の案内。title を渡すと、1行目に太字の title、2行目に text の2行にする
export function showTopToast(text, ms = 2500, { title = null } = {}) {
  const el = document.getElementById('toast-top');
  if (!el) return;
  el.classList.toggle('two', Boolean(title));
  if (title) {
    const b = document.createElement('b');
    b.textContent = title;
    const span = document.createElement('span');
    span.textContent = text;
    el.replaceChildren(b, span);
  } else {
    el.textContent = text;
  }
  el.hidden = false;
  clearTimeout(topTimer);
  topTimer = setTimeout(() => { el.hidden = true; }, ms);
}
