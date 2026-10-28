// 画面の小さな部品（文字のエスケープ・上の案内）

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// [{ text, unit?, extra?, tight? }] を、数字と小さい単位の HTML にする
export function partsHtml(parts) {
  return (parts ?? []).map((p, i) => {
    const cls = [p.extra ? 'ex' : '', i > 0 && !p.tight ? 'gap' : ''].filter(Boolean).join(' ');
    return `<span${cls ? ` class="${cls}"` : ''}>${esc(p.text)}${p.unit ? `<small class="u">${esc(p.unit)}</small>` : ''}</span>`;
  }).join('');
}

let topTimer = null;
export function showTopToast(text, ms = 2500) {
  const el = document.getElementById('toast-top');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(topTimer);
  topTimer = setTimeout(() => { el.hidden = true; }, ms);
}
