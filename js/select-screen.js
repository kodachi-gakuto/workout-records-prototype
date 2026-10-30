// 種目を選ぶ画面と、種目の登録・編集（下から出る画面）・削除の確認
// 行を左にずらすと「編集」「削除」が出る。縦のスクロールはブラウザーに任せる（touch-action: pan-y）。
// 名前の欄は、押した処理の中で同期して focus() する（iOS は、そうしないとキーボードが出ない）。
import {
  exercisesByPart, findExercise, todaySetCount, addExercise, updateExercise, deleteExercise,
  hasSameName, tidyName, cutName, isPart, NAME_MAX,
} from './records.js';
import { PARTS, todayString } from './store.js';
import { esc } from './ui.js';

const SLOP = 10; // これだけ動いたら、横か縦かを決める
let savedY = 0; // 記録の画面を開く前のスクロールの位置（戻ったときに使う）

const capsHtml = (attr) => PARTS.map((p) =>
  `<button type="button" class="cap" data-${attr}="${p.id}">${esc(p.label)}</button>`).join('');

export function mountSelect(root, ctx, { restore = false } = {}) {
  const today = todayString();
  let active = PARTS[0].id; // 今見ている部位（黒のボタン）
  let locked = null; // 部位のボタンを押したあと、指でスクロールするまで選んだままにする部位
  let openRow = null; // 左にずらして開いている行（1行だけ）
  let drag = null; // { row, fg, pointerId, x, y, dx, max, mode: null | 'x' }
  let suppressClick = false; // ずらした・閉じた操作のあとの click を、行を押した扱いにしない
  let edit = null; // 登録・編集の画面：{ id（新しいときは null）, part }
  let confirmId = null; // 削除の確認をしている種目
  let pageY = 0; // 下から出る画面を開く前のスクロールの位置
  let alive = true;

  root.innerHTML = `
    <main class="sel">
      <div class="navb" id="sel-bar">
        <button type="button" class="back" id="sel-home">‹ ホーム</button>
        <span class="mid" id="sel-mid" aria-hidden="true">種目を選ぶ</span>
        <button type="button" class="plus" id="sel-add" aria-label="新しい種目を登録">＋</button>
      </div>
      <h1 class="big" id="sel-title">種目を選ぶ</h1>
      <div class="chips" id="sel-chips" role="group" aria-label="部位">${capsHtml('part')}</div>
      <div id="sel-list"></div>
    </main>
    <div class="ov" id="sel-edit" hidden>
      <div class="esheet" id="ed-panel" role="dialog" aria-modal="true" aria-labelledby="ed-ttl">
        <div class="eh">
          <button type="button" class="cl" id="ed-cancel">キャンセル</button>
          <h2 id="ed-ttl">新しい種目</h2>
          <button type="button" class="ok" id="ed-ok">追加</button>
        </div>
        <div class="eb">
          <label class="fl" for="ed-name">名前</label>
          <input class="nm-in" id="ed-name" type="text" enterkeyhint="done"
            autocomplete="off" autocorrect="off" spellcheck="false" aria-describedby="ed-err">
          <p class="err" id="ed-err" hidden><span class="ei" aria-hidden="true">!</span>同じ名前の種目があります</p>
          <p class="fl pl" id="ed-part-lab">部位</p>
          <div class="pick" id="ed-parts" role="group" aria-labelledby="ed-part-lab">${capsHtml('pick')}</div>
          <button type="button" class="edel" id="ed-del" hidden>種目を削除</button>
        </div>
      </div>
    </div>
    <div class="ov" id="sel-confirm" hidden>
      <div class="asheet" role="alertdialog" aria-modal="true" aria-labelledby="cf-ttl" aria-describedby="cf-sub">
        <div class="ag">
          <p class="at" id="cf-ttl"></p>
          <p class="as" id="cf-sub">この種目のこれまでの記録も、すべて消えます</p>
          <button type="button" class="adel" id="cf-del">削除</button>
        </div>
        <button type="button" class="acan" id="cf-cancel">キャンセル</button>
      </div>
    </div>`;

  const $ = (id) => document.getElementById(id);
  const bar = $('sel-bar');
  const chips = $('sel-chips');
  const list = $('sel-list');
  const editOv = $('sel-edit');
  const panel = $('ed-panel');
  const input = $('ed-name');
  const okBtn = $('ed-ok');
  const confirmOv = $('sel-confirm');

  // ---- 一覧 ----
  function rowHtml(e) {
    const n = todaySetCount(ctx.getData(), e.id, today);
    return `<div class="erow" data-id="${esc(e.id)}">
        <div class="acts" aria-hidden="true">
          <button type="button" class="ed" data-act="edit" tabindex="-1">編集</button>
          <button type="button" class="dl" data-act="del" tabindex="-1">削除</button>
        </div>
        <button type="button" class="fg" data-act="open">
          <span class="tx"><span class="nm">${esc(e.name)}</span>${n ? `<span class="cnt"><span class="ck" aria-hidden="true">✓</span> ${n}セット</span>` : ''}</span>
          <span class="chev" aria-hidden="true">›</span>
        </button>
      </div>`;
  }

  function renderList() {
    openRow = null;
    drag = null;
    list.innerHTML = exercisesByPart(ctx.getData(), today).map((g) => `
      <section class="psec" data-sec="${esc(g.id ?? '')}">
        <h2 class="lab">${esc(g.label)}</h2>
        <div class="pcard">${g.exercises.length ? g.exercises.map(rowHtml).join('') : '<p class="none">まだ種目がありません</p>'}</div>
      </section>`).join('');
  }

  // ---- 上のバーと部位のボタン ----
  function setActive(id) {
    if (id === active) return;
    active = id;
    for (const b of chips.querySelectorAll('[data-part]')) {
      const on = b.dataset.part === id;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    }
    // 大きい文字で横にスクロールするときは、黒のボタンが見えるようにする
    if (chips.scrollWidth > chips.clientWidth) {
      const b = chips.querySelector(`[data-part="${id}"]`);
      chips.scrollTo({ left: b.offsetLeft - (chips.clientWidth - b.offsetWidth) / 2, behavior: 'smooth' });
    }
  }

  const stickyBottom = () => bar.offsetHeight + chips.offsetHeight;

  // 見出しが部位のボタンの下まで来た部位のうち、いちばん下のもの（部位なしは数えない）
  function partAtScroll() {
    const line = stickyBottom() + 16;
    const secs = [...list.querySelectorAll('.psec')].filter((sec) => isPart(sec.dataset.sec));
    // いちばん下までスクロールしたら、最後の部位にする（見出しが上まで来なくても）
    const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1;
    if (atEnd && window.scrollY > 0 && secs.length) return secs[secs.length - 1].dataset.sec;
    let cur = PARTS[0].id;
    for (const sec of secs) {
      if (sec.getBoundingClientRect().top <= line) cur = sec.dataset.sec;
    }
    return cur;
  }

  function onScroll() {
    const barH = bar.offsetHeight;
    $('sel-mid').classList.toggle('show', $('sel-title').getBoundingClientRect().bottom <= barH);
    chips.classList.toggle('stuck', window.scrollY > 0 && chips.getBoundingClientRect().top <= barH + 1);
    setActive(locked ?? partAtScroll());
  }

  function placeChips() {
    chips.style.top = `${bar.offsetHeight}px`;
    onScroll();
  }

  function onChip(e) {
    const b = e.target.closest('[data-part]');
    if (!b) return;
    const id = b.dataset.part;
    locked = id;
    setActive(id);
    const sec = list.querySelector(`.psec[data-sec="${id}"]`);
    const y = window.scrollY + sec.getBoundingClientRect().top - stickyBottom() - 8;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }

  // 指でスクロールしたら、押した部位の選択をやめる
  const unlock = () => { locked = null; };

  // ---- 行を左にずらす ----
  function setX(row, x, animate) {
    const fg = row.querySelector('.fg');
    fg.style.transition = animate ? '' : 'none';
    fg.style.transform = x ? `translateX(${x}px)` : '';
  }

  function setActsFocusable(row, on) {
    const acts = row.querySelector('.acts');
    acts.setAttribute('aria-hidden', String(!on));
    for (const b of acts.querySelectorAll('button')) b.tabIndex = on ? 0 : -1;
  }

  function closeRow(animate = true) {
    if (!openRow) return;
    setX(openRow, 0, animate);
    setActsFocusable(openRow, false);
    openRow = null;
  }

  // 開いている行があるとき、ほかの所を押すと閉じる（行を押していたら、その行は開かない）
  function onDocDown(e) {
    suppressClick = false;
    if (!openRow || !editOv.hidden || !confirmOv.hidden) return;
    if (openRow.querySelector('.acts').contains(e.target)) return;
    const onRow = e.target.closest?.('.erow');
    closeRow();
    if (onRow) suppressClick = true;
  }

  function onDown(e) {
    if (suppressClick || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const fg = e.target.closest('.fg');
    if (!fg) return;
    const row = fg.closest('.erow');
    drag = { row, fg, pointerId: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, max: row.querySelector('.acts').offsetWidth, mode: null };
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.mode) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      // 横の動きがはっきりしたときだけずらす。それ以外は縦のスクロールに任せる
      if (!(Math.abs(dx) >= SLOP && Math.abs(dx) > Math.abs(dy) * 1.5)) {
        drag = null;
        return;
      }
      drag.mode = 'x';
      suppressClick = true;
      drag.fg.setPointerCapture?.(e.pointerId);
    }
    drag.dx = Math.min(0, Math.max(-drag.max, dx));
    setX(drag.row, drag.dx, false);
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { row, mode, dx, max } = drag;
    drag = null;
    if (mode !== 'x') return;
    // ずらしたあとの click だけを止め、残った印はすぐ外す（次に押したときに効かないように）
    setTimeout(() => { suppressClick = false; }, 0);
    if (dx < -max / 2) {
      setX(row, -max, true);
      openRow = row;
      setActsFocusable(row, true);
    } else {
      setX(row, 0, true);
    }
  }

  function onListClick(e) {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const id = btn.closest('.erow').dataset.id;
    if (btn.dataset.act === 'open') {
      savedY = window.scrollY;
      ctx.go(`#/record/${encodeURIComponent(id)}`);
    } else if (btn.dataset.act === 'edit') {
      closeRow(false);
      openEdit(id);
    } else if (btn.dataset.act === 'del') {
      closeRow();
      openConfirm(id);
    }
  }

  // ---- 下から出る画面（共通） ----
  function syncBody() {
    document.body.classList.toggle('sheet-open', !editOv.hidden || !confirmOv.hidden);
  }

  function restoreY(y) {
    window.scrollTo(0, y);
    // キーボードが閉じきったあとにもう一度（iOS は閉じるときにスクロールの位置を動かすことがある）
    setTimeout(() => {
      if (alive && editOv.hidden && confirmOv.hidden) window.scrollTo(0, y);
    }, 350);
  }

  // 後ろの一覧がスクロールしないようにする（登録・編集の画面の中は、はみ出すときだけスクロールできる）
  function blockScroll(e) {
    const eb = e.target.closest?.('.eb');
    if (eb && eb.scrollHeight > eb.clientHeight) return;
    e.preventDefault();
  }

  // ---- 登録・編集 ----
  function nameState() {
    // 編集で名前にさわっていなければ、元の名前のまま（26文字以上でも切らない）
    if (edit.orig !== null && !edit.touched) return { name: edit.orig, dup: false, ok: edit.part !== null };
    const name = tidyName(input.value);
    const dup = name !== '' && hasSameName(ctx.getData(), name, edit.id);
    return { name, dup, ok: name !== '' && !dup && edit.part !== null };
  }

  function validate() {
    const s = nameState();
    $('ed-err').hidden = !s.dup;
    input.setAttribute('aria-invalid', String(s.dup));
    okBtn.disabled = !s.ok;
  }

  function renderPick() {
    for (const b of $('ed-parts').querySelectorAll('[data-pick]')) {
      const on = b.dataset.pick === edit.part;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  // 押した処理の中から呼ぶ（同期して focus() するため）
  function openEdit(id) {
    const e = id ? findExercise(ctx.getData(), id) : null;
    if (id && !e) return;
    edit = { id: e ? e.id : null, part: e ? (isPart(e.part) ? e.part : null) : active, orig: e ? e.name : null, touched: false };
    pageY = window.scrollY;
    $('ed-ttl').textContent = e ? '種目の編集' : '新しい種目';
    okBtn.textContent = e ? '保存' : '追加';
    $('ed-del').hidden = !e;
    input.value = e ? e.name : '';
    renderPick();
    validate();
    editOv.hidden = false;
    syncBody();
    input.focus({ preventScroll: true });
  }

  function closeEdit() {
    if (editOv.hidden) return;
    input.blur();
    editOv.hidden = true;
    edit = null;
    syncBody();
    restoreY(pageY);
  }

  function onNameInput(e) {
    // 変換の途中は切らない（変換が終わったときに切る）
    if (edit) edit.touched = true;
    if (!e.isComposing) fitName();
    validate();
  }

  function fitName() {
    const cut = cutName(input.value);
    if (cut !== input.value) input.value = cut;
  }

  function onNameEnd() {
    if (edit) edit.touched = true;
    fitName();
    validate();
  }

  // キーボードの「完了」は閉じるだけ（追加はしない）
  function onNameKey(e) {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    input.blur();
  }

  function onPick(e) {
    const b = e.target.closest('[data-pick]');
    if (!b || !edit) return;
    edit.part = b.dataset.pick;
    renderPick();
    validate();
  }

  function onOk() {
    if (!edit) return;
    const s = nameState();
    if (!s.ok) return;
    const data = ctx.getData();
    ctx.commit(edit.id
      ? updateExercise(data, edit.id, { name: s.name, part: edit.part })
      : addExercise(data, { name: s.name, part: edit.part }).data);
    renderList();
    closeEdit();
  }

  // ---- 削除の確認 ----
  function openConfirm(id) {
    const e = findExercise(ctx.getData(), id);
    if (!e) return;
    confirmId = e.id;
    input.blur();
    $('cf-ttl').textContent = `「${e.name}」を削除`;
    confirmOv.hidden = false;
    syncBody();
  }

  function closeConfirm() {
    confirmOv.hidden = true;
    confirmId = null;
    syncBody();
  }

  function onConfirmDel() {
    if (confirmId === null) return;
    ctx.commit(deleteExercise(ctx.getData(), confirmId));
    closeConfirm();
    renderList();
    if (!editOv.hidden) closeEdit();
    else onScroll();
  }

  // ---- つなぐ ----
  const vv = window.visualViewport;
  const onViewport = () => placeChips();
  $('sel-home').addEventListener('click', () => ctx.replace('#/'));
  $('sel-add').addEventListener('click', () => {
    closeRow(false);
    openEdit(null);
  });
  chips.addEventListener('click', onChip);
  list.addEventListener('pointerdown', onDown);
  list.addEventListener('pointermove', onMove);
  list.addEventListener('pointerup', onUp);
  list.addEventListener('pointercancel', onUp);
  list.addEventListener('click', onListClick);
  $('ed-cancel').addEventListener('click', closeEdit);
  okBtn.addEventListener('click', onOk);
  input.addEventListener('input', onNameInput);
  input.addEventListener('compositionend', onNameEnd);
  input.addEventListener('keydown', onNameKey);
  $('ed-parts').addEventListener('click', onPick);
  $('ed-del').addEventListener('click', () => { if (edit?.id) openConfirm(edit.id); });
  $('cf-del').addEventListener('click', onConfirmDel);
  $('cf-cancel').addEventListener('click', closeConfirm);
  // 確認のシートの後ろ（暗い所）を押したら、キャンセルと同じ
  confirmOv.addEventListener('click', (e) => { if (e.target === confirmOv) closeConfirm(); });
  confirmOv.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  editOv.addEventListener('touchmove', blockScroll, { passive: false });
  document.addEventListener('pointerdown', onDocDown, true);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('touchmove', unlock, { passive: true });
  window.addEventListener('wheel', unlock, { passive: true });
  window.addEventListener('resize', onViewport);
  vv?.addEventListener('resize', onViewport);

  renderList();
  active = null;
  setActive(PARTS[0].id);
  placeChips();
  if (restore) {
    window.scrollTo(0, savedY);
    onScroll();
  }

  return {
    unmount() {
      alive = false;
      document.body.classList.remove('sheet-open');
      document.removeEventListener('pointerdown', onDocDown, true);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('touchmove', unlock);
      window.removeEventListener('wheel', unlock);
      window.removeEventListener('resize', onViewport);
      vv?.removeEventListener('resize', onViewport);
    },
    flush() {},
  };
}
