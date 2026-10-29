// 記録の画面
// 入力欄は本物の <input>（タップした要素そのものが input なので、1回でキーボードが出る）。
// フォーカスしている input は作り直さない（作り直すとキーボードが閉じる）。値が変わったときは表示の文字だけを書きかえる。
import {
  findExercise, findTodayWorkout, ensureTodayWorkout, updateSet, addSet, insertSet, removeSet,
  removeEmptySets, previousWorkout, bestWeight, cleanSets, emptySet, isEmptySet,
  sanitizeInput, parseNumber, numText, weightParts, repsParts, editParts, shortDate, mmss,
} from './records.js';
import { todayString } from './store.js';
import { esc, partsHtml } from './ui.js';

const WEIGHT_MODES = [['kg', 'kg'], ['bodyweight', '自重'], ['assist', '補助']];
const UNDO_MS = 3000;

export function mountRecord(root, ctx, exerciseId) {
  const exercise = findExercise(ctx.getData(), exerciseId);
  if (!exercise) {
    root.innerHTML = `<main class="missing"><p>種目が見つかりません</p><p><a href="#/">種目に戻る</a></p></main>`;
    return { unmount() {}, flush() {} };
  }

  const today = todayString();
  const prev = previousWorkout(ctx.getData(), exerciseId, today);
  const rest = mmss(exercise.restSec);
  // 今日の記録がまだないときの行（値を入れるまで保存しない）
  let pending = [];
  {
    const w = findTodayWorkout(ctx.getData(), exerciseId, today);
    // 保存された配列が空のときだけ消す（形のおかしいセットが残っているときは消さない）
    if (w && w.sets.length === 0) {
      ctx.commit({ ...ctx.getData(), workouts: ctx.getData().workouts.filter((x) => x !== w) });
    }
    if (!findTodayWorkout(ctx.getData(), exerciseId, today)) pending = [emptySet(prev?.sets[0]?.kind)];
  }

  // focus：{ input, index, field: 'w' | 'r' }
  let focus = null;
  let undo = null; // { set, index, timer }
  let prevOpen = true; // 開くたびに、いつも開いた状態から
  let alive = true;

  const workout = () => findTodayWorkout(ctx.getData(), exerciseId, today);
  const sets = () => {
    const w = workout();
    return w ? cleanSets(w.sets) : pending;
  };

  // ---- 書きこみ ----
  function write(index, patch) {
    const w = workout();
    if (w) {
      ctx.commit(updateSet(ctx.getData(), w.id, index, patch));
      return;
    }
    pending = pending.map((s, i) => (i === index ? { ...s, ...patch } : s));
    if (pending.some((s) => !isEmptySet(s))) {
      ctx.commit(ensureTodayWorkout(ctx.getData(), exerciseId, { today, sets: pending }).data);
      pending = [];
    }
  }

  function insertAt(index, set) {
    const w = workout();
    if (w) ctx.commit(insertSet(ctx.getData(), w.id, index, set));
    else pending.splice(index, 0, set);
  }

  function addRow() {
    endEditing();
    const list = sets();
    const kind = list.length ? list[list.length - 1].kind : (prev?.sets[0]?.kind ?? 'kg');
    const w = workout();
    if (w) ctx.commit(addSet(ctx.getData(), w.id, emptySet(kind)));
    else pending.push(emptySet(kind));
    renderRows();
  }

  function deleteRow(index) {
    endEditing();
    const set = sets()[index];
    if (!set) return;
    const w = workout();
    if (w) ctx.commit(removeSet(ctx.getData(), w.id, index));
    else pending.splice(index, 1);
    renderRows();
    showUndo(set, index);
  }

  // 空のセットを取り除いた data（記録がなければ null）
  function cleaned() {
    const w = workout();
    if (!w) return null;
    const next = removeEmptySets(ctx.getData(), w.id);
    const after = findTodayWorkout(next, exerciseId, today);
    return after && after.sets.length === w.sets.length ? null : next;
  }

  // ---- 表示 ----
  root.innerHTML = `
    <main class="rec">
      <div class="navb">
        <button type="button" class="back" id="rec-back">‹ 種目</button>
        <button type="button" class="save" id="rec-save">保存</button>
      </div>
      <div class="ttl-row">
        <h1 class="ttl">${esc(exercise.name)}</h1>
        <span class="bst" id="rec-best"></span>
      </div>
      <h2 class="lab">前回</h2>
      <div class="card prev" id="rec-prev"></div>
      <h2 class="lab">今回</h2>
      <div class="card" id="rec-sets"></div>
      <button type="button" class="addset" id="rec-add">＋ セットを追加</button>
    </main>
    <button type="button" class="tm" id="rec-timer" aria-label="休憩タイマー ${rest}">⏱<span>${rest}</span></button>`;

  const $ = (id) => document.getElementById(id);
  const kbar = $('kbar');
  const kseg = $('kseg');
  $('kbar-time').textContent = rest;

  function renderBest() {
    const best = bestWeight(ctx.getData(), exerciseId);
    const el = $('rec-best');
    el.hidden = best === null;
    el.innerHTML = best === null ? '' : `🏆 <b>${esc(best)}</b>kg`;
  }

  function renderPrev() {
    const el = $('rec-prev');
    if (!prev) {
      el.innerHTML = '<p class="first">初めての記録です</p>';
      return;
    }
    const rows = prev.sets.map((s, i) =>
      `<span>${i + 1}</span><span>${partsHtml(weightParts(s))}</span><span>${partsHtml(repsParts(s))}</span><span></span>`).join('');
    el.innerHTML = `
      <button type="button" class="hd" id="rec-fold" aria-expanded="${prevOpen}">
        <span>${esc(shortDate(prev.date))}</span><span class="chev" aria-hidden="true">${prevOpen ? '▾' : '▸'}</span>
      </button>
      ${prevOpen ? `<div class="plist">${rows}</div>` : ''}`;
    $('rec-fold').addEventListener('click', () => { prevOpen = !prevOpen; renderPrev(); });
  }

  // 欄に出す文字：{ parts, ph（空の欄の「重さ」「回数」）, long（小さめの文字） }
  // フォーカス中は、打っている文字を「自重+10kg」「10回 +補助1」の形でその場に出す
  function cellView(s, field, text) {
    const long = field === 'w' ? s.kind !== 'kg' : s.assistedReps !== null;
    if (text !== null) return { parts: editParts(s, field, text), ph: false, long };
    const parts = field === 'w' ? weightParts(s) : repsParts(s);
    return parts ? { parts, ph: false, long } : { parts: [{ text: field === 'w' ? '重さ' : '回数' }], ph: true, long: false };
  }

  // 欄の input に入れる数字（回数の欄は reps。手伝ってもらった回数はバーで増やす）
  const editValue = (s, field) => numText(field === 'w' ? s.weight : s.reps);

  function cellHtml(field, i) {
    const decimal = field === 'w';
    return `<div class="in" data-field="${field}">
      <span class="disp" aria-hidden="true"></span>
      <input type="text" inputmode="${decimal ? 'decimal' : 'numeric'}" ${decimal ? '' : 'pattern="[0-9]*"'}
        name="${field}${i + 1}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
        enterkeyhint="done" data-i="${i}" data-field="${field}" aria-label="${i + 1}セット目の${decimal ? '重さ' : '回数'}">
    </div>`;
  }

  // 行を作り直す（フォーカス中は呼ばない）
  function renderRows() {
    const list = sets();
    const el = $('rec-sets');
    el.innerHTML = list.length
      ? list.map((_, i) => `<div class="srow" data-i="${i}">
          <span class="no">${i + 1}</span>${cellHtml('w', i)}${cellHtml('r', i)}
          <button type="button" class="x" data-del="${i}" aria-label="${i + 1}セット目を消す">×</button>
        </div>`).join('')
      : '<p class="nosets">セットがありません</p>';
    updateCells();
  }

  // 表示の文字だけを書きかえる（input は作り直さない）
  function updateCells() {
    const list = sets();
    for (const row of $('rec-sets').querySelectorAll('.srow')) {
      const i = Number(row.dataset.i);
      if (!list[i]) continue;
      for (const cell of row.querySelectorAll('.in')) {
        const field = cell.dataset.field;
        const input = cell.querySelector('input');
        const isFocused = focus && focus.input === input;
        const v = cellView(list[i], field, isFocused ? input.value : null);
        const disp = cell.querySelector('.disp');
        disp.innerHTML = partsHtml(v.parts);
        disp.classList.toggle('ph', v.ph);
        cell.classList.toggle('long', v.long);
        // 読み上げ用に、今の値を入れておく（フォーカス中は打っている文字のまま）
        if (!isFocused) input.value = editValue(list[i], field);
      }
    }
  }

  // ---- キーボードの上のバー ----
  // 重さの欄：kg／自重／補助の切り替え。回数の欄：手伝ってもらった回数のステッパー（− 補助 N ＋）
  function renderSeg() {
    if (!focus) return;
    const s = sets()[focus.index];
    if (focus.field === 'w') {
      kseg.className = 'kseg';
      kseg.setAttribute('aria-label', '重さの種類');
      kseg.innerHTML = WEIGHT_MODES.map(([key, label]) =>
        `<button type="button" data-mode="${key}" aria-pressed="${key === s?.kind}">${label}</button>`).join('');
      return;
    }
    const n = s?.assistedReps ?? 0;
    kseg.className = 'kseg kstep';
    kseg.setAttribute('aria-label', '手伝ってもらった回数');
    kseg.innerHTML = `
      <button type="button" data-step="-1" aria-label="補助を1回減らす" aria-disabled="${n === 0}">−</button>
      <span class="n" aria-live="polite">補助 ${n}</span>
      <button type="button" data-step="1" aria-label="補助を1回増やす">＋</button>`;
  }

  function placeBar() {
    if (kbar.hidden) return;
    const vv = window.visualViewport;
    if (!vv) {
      kbar.classList.remove('vv');
      kbar.style.top = '';
      return;
    }
    kbar.classList.add('vv');
    kbar.style.top = `${vv.offsetTop + vv.height - kbar.offsetHeight}px`;
  }

  // フォーカスした行が、上のバー・下のバーとキーボードに隠れないようにする
  function keepVisible() {
    if (!focus) return;
    const r = focus.input.closest('.srow').getBoundingClientRect();
    const vv = window.visualViewport;
    const vTop = (vv ? vv.offsetTop : 0) + $('rec-back').closest('.navb').offsetHeight + 8;
    const vBottom = (vv ? vv.offsetTop + vv.height : window.innerHeight) - kbar.offsetHeight - 12;
    if (r.bottom > vBottom) window.scrollBy(0, r.bottom - vBottom);
    else if (r.top < vTop) window.scrollBy(0, r.top - vTop);
  }

  function onViewport() {
    placeBar();
    if (focus) keepVisible();
  }

  function openBar() {
    document.body.classList.add('kb-open');
    $('rec-save').classList.add('off');
    $('rec-save').setAttribute('aria-disabled', 'true');
    kbar.hidden = false;
    renderSeg();
    placeBar();
    keepVisible();
    // キーボードが出きったあとにもう一度合わせる
    setTimeout(onViewport, 350);
  }

  function closeBar() {
    if (!alive) return;
    document.body.classList.remove('kb-open');
    $('rec-save').classList.remove('off');
    $('rec-save').removeAttribute('aria-disabled');
    kbar.hidden = true;
  }

  // ---- 入力のイベント ----
  function onFocusIn(e) {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || !input.dataset.field) return;
    const index = Number(input.dataset.i);
    focus = { input, index, field: input.dataset.field };
    const s = sets()[index];
    input.value = s ? editValue(s, focus.field) : '';
    openBar();
    updateCells();
    renderBest();
  }

  // 行を作り直す前に、入力を終える（iOS ではボタンを押しても input のフォーカスが外れないため）
  function endEditing() {
    if (!focus) return;
    const { input } = focus;
    focus = null;
    closeBar();
    input.blur();
  }

  function onFocusOut() {
    // ほかの欄へ移るときは、続けてバーを出したままにする
    setTimeout(() => {
      if (!alive) return;
      const a = document.activeElement;
      if (a instanceof HTMLInputElement && root.contains(a) && a.dataset.field) return;
      focus = null;
      closeBar();
      updateCells();
    }, 0);
  }

  function onInput(e) {
    const input = e.target;
    if (!focus || focus.input !== input) return;
    const decimal = focus.field === 'w';
    const text = sanitizeInput(input.value, { decimal });
    if (text !== input.value) input.value = text;
    const n = parseNumber(text);
    write(focus.index, { [focus.field === 'w' ? 'weight' : 'reps']: n });
    updateCells();
    renderBest();
  }

  function onMode(mode) {
    if (!focus || focus.field !== 'w') return;
    const s = sets()[focus.index];
    if (!s) return;
    if (s.kind !== mode) {
      // 種類を変えたら、重さの数字の意味が変わるので空にする
      write(focus.index, { kind: mode, weight: null });
      focus.input.value = '';
    }
    // 自重：同じセットの回数の欄へ移る（キーボードは閉じない）。加重するときは重さの欄をもう一度押して重りの重さを打つ
    if (mode === 'bodyweight') {
      const reps = focus.input.closest('.srow').querySelector('input[data-field="r"]');
      reps.focus();
      if (document.activeElement === reps) return; // onFocusIn で表示を書きかえる
    }
    renderSeg();
    updateCells();
    renderBest();
  }

  // 手伝ってもらった回数を1つ増やす・減らす（0 は null で持つ）
  function onStep(delta) {
    if (!focus || focus.field !== 'r') return;
    const s = sets()[focus.index];
    if (!s) return;
    const n = Math.max(0, (s.assistedReps ?? 0) + delta);
    write(focus.index, { assistedReps: n === 0 ? null : n });
    renderSeg();
    updateCells();
  }

  // バーのボタンを押しても、input のフォーカスを外さない
  const keepFocus = (e) => e.preventDefault();
  function onBarClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'kbar-done') {
      focus?.input.blur();
      return;
    }
    // フォーカスが外れていたら戻す（クリックの中なので iOS でもキーボードが出る見込み、未確認）
    if (focus && document.activeElement !== focus.input) focus.input.focus();
    if (btn.dataset.mode) onMode(btn.dataset.mode);
    // 押せない「−」は disabled にしない（disabled の上では pointerdown を止められず、フォーカスが外れるおそれがあるため）
    if (btn.dataset.step && btn.getAttribute('aria-disabled') !== 'true') onStep(Number(btn.dataset.step));
    // ⏱ は作業⑤まで何もしない
  }

  // ---- 元に戻す ----
  const toast = $('toast-bottom');
  function hideUndo() {
    if (undo) clearTimeout(undo.timer);
    undo = null;
    toast.hidden = true;
  }
  function showUndo(set, index) {
    hideUndo();
    undo = { set, index, timer: setTimeout(hideUndo, UNDO_MS) };
    $('undo-text').textContent = `${index + 1}セット目を消しました`;
    toast.hidden = false;
  }
  function onUndo() {
    if (!undo) return;
    const { set, index } = undo;
    hideUndo();
    endEditing();
    insertAt(index, set);
    renderRows();
  }

  // ---- 戻る ----
  const kbOpen = () => !kbar.hidden;
  function onSaveDown(e) {
    if (kbOpen()) e.preventDefault(); // キーボード中は押せない（フォーカスも外さない）
  }
  function onSave() {
    if (kbOpen()) return;
    ctx.go('#/');
  }

  // ---- つなぐ ----
  const main = root.querySelector('.rec');
  main.addEventListener('focusin', onFocusIn);
  main.addEventListener('focusout', onFocusOut);
  main.addEventListener('input', onInput);
  main.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) deleteRow(Number(del.dataset.del));
  });
  $('rec-add').addEventListener('click', addRow);
  $('rec-back').addEventListener('click', () => ctx.go('#/'));
  const save = $('rec-save');
  save.addEventListener('pointerdown', onSaveDown);
  save.addEventListener('mousedown', onSaveDown);
  save.addEventListener('click', onSave);
  kbar.addEventListener('pointerdown', keepFocus);
  kbar.addEventListener('mousedown', keepFocus);
  kbar.addEventListener('click', onBarClick);
  $('undo-btn').addEventListener('click', onUndo);
  const vv = window.visualViewport;
  vv?.addEventListener('resize', onViewport);
  vv?.addEventListener('scroll', onViewport);
  window.addEventListener('resize', onViewport);

  renderBest();
  renderPrev();
  renderRows();

  return {
    // 画面を離れるとき：空のセットを取り除いて保存する
    unmount() {
      hideUndo();
      endEditing();
      closeBar();
      alive = false;
      kbar.removeEventListener('pointerdown', keepFocus);
      kbar.removeEventListener('mousedown', keepFocus);
      kbar.removeEventListener('click', onBarClick);
      $('undo-btn').removeEventListener('click', onUndo);
      vv?.removeEventListener('resize', onViewport);
      vv?.removeEventListener('scroll', onViewport);
      window.removeEventListener('resize', onViewport);
      const next = cleaned();
      if (next) ctx.commit(next);
    },
    // ページを閉じるとき：画面の状態は変えずに、空のセットを除いたものを保存だけする
    flush() {
      const next = cleaned();
      if (next) ctx.saveOnly(next);
    },
  };
}
