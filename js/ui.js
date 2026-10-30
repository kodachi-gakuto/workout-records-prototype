// 画面の小さな部品（文字のエスケープ・上の案内・前回のセットの一覧）
import { weightParts, repsParts } from './records.js';

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// [{ text, unit?, extra?, tight?, caret? }] を、数字と小さい単位の HTML にする
export function partsHtml(parts) {
  return (parts ?? []).map((p, i) => {
    const cls = [p.extra ? 'ex' : '', i > 0 && !p.tight ? 'gap' : ''].filter(Boolean).join(' ');
    return `<span${cls ? ` class="${cls}"` : ''}>${esc(p.text)}${p.caret ? '<i class="caret"></i>' : ''}${p.unit ? `<small class="u">${esc(p.unit)}</small>` : ''}</span>`;
  }).join('');
}

// セットごとの縦の一覧（記録の画面の「前回」と、履歴の画面のカード）
export function setListHtml(sets) {
  const rows = sets.map((s, i) =>
    `<span>${i + 1}</span><span>${partsHtml(weightParts(s))}</span><span>${partsHtml(repsParts(s))}</span><span></span>`).join('');
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
