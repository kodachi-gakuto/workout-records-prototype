// 記録の画面
// 入力欄は本物の <input>（タップした要素そのものが input なので、1回でキーボードが出る）。
// フォーカスしている input は作り直さない（作り直すとキーボードが閉じる）。値が変わったときは表示の文字だけを書きかえる。
import {
  findExercise, findTodayWorkout, ensureTodayWorkout, updateSet, addSet, insertSet, removeSet,
  removeEmptySets, previousWorkout, bestWeight, cleanSets, emptySet, isEmptySet,
  sanitizeInput, parseNumber, numText, weightParts, repsParts, editParts, canAddAssist, shortDate, mmss,
  firstMissing, todaySetCount, FIELD_INPUT, REST_CHOICES, restSecOf, setRestSec, needsTimerHint, markTimerHint,
} from './records.js';
import { todayString } from './store.js';
import { esc, GLYPHS, iconHtml, partsHtml, setListHtml, showTopToast } from './ui.js';

const WEIGHT_MODES = [['kg', 'kg'], ['bodyweight', '自重'], ['assist', '補助']];
const UNDO_MS = 3000;
const HINT_MS = 3000;
const LONG_MS = 500; // 長押し
const LONG_MOVE = 10; // 押している間にこれ以上動いたら長押しをやめる（px）

// fromHome：ホームから開いたとき。左上を「‹ ホーム」にし、押すとホームへ戻る
// 履歴の画面へ行くときは、app.js が unmount せずに suspend して隠しておき、戻ったら resume する（今日の入力を残すため）
export function mountRecord(root, ctx, exerciseId, { fromHome = false } = {}) {
  const exercise = findExercise(ctx.getData(), exerciseId);
  if (!exercise) {
    const back = fromHome ? '<a href="#/">ホームに戻る</a>' : '<a href="#/select">種目に戻る</a>';
    root.innerHTML = `<main class="missing"><p>種目が見つかりません</p><p>${back}</p></main>`;
    return { unmount() {}, flush() {} };
  }

  // 保存に1回でも失敗したら、離れたときに「保存しました」を出さない
  let saveFailed = false;
  function commit(data) {
    const r = ctx.commit(data);
    if (!r.ok) saveFailed = true;
    return r;
  }
  const today = todayString();
  const prev = previousWorkout(ctx.getData(), exerciseId, today);
  // 今日の記録がまだないときの行（値を入れるまで保存しない）。空の行を3つ出す
  let pending = [];
  {
    const w = findTodayWorkout(ctx.getData(), exerciseId, today);
    // 保存された配列が空のときだけ消す（形のおかしいセットが残っているときは消さない）
    if (w && w.sets.length === 0) {
      commit({ ...ctx.getData(), workouts: ctx.getData().workouts.filter((x) => x !== w) });
    }
    if (!findTodayWorkout(ctx.getData(), exerciseId, today)) {
      pending = Array.from({ length: 3 }, () => emptySet(prev?.sets[0]?.kind));
    }
  }
  // 右上の 🏆：開いたときの値のまま変えない（打っている間も、セットを消しても）。離れるときの「新記録」もこれと比べる
  const openBest = bestWeight(ctx.getData(), exerciseId);

  // focus：{ input, index, field: 'w' | 'r' }
  let focus = null;
  let undo = null; // { set, index, timer }
  let hintTimer = null; // 「長押しで時間を変えられます」を消すタイマー
  let press = null; // 長押しの見張り：{ x, y, pointerId, timer, from: 'tm' | 'kbar' }
  let suppressClick = false; // 長押しのあとの click で、始める／止めるを動かさない
  let prevOpen = true; // 開くたびに、いつも開いた状態から
  let alive = true;
  let leaving = false; // 「保存」「‹ 種目」「‹ ホーム」で離れるとき（離れたあとに上の案内を出す）
  let confirmHash = null; // 空の欄の確かめのシートを開いている間、離れる先

  const workout = () => findTodayWorkout(ctx.getData(), exerciseId, today);
  const sets = () => {
    const w = workout();
    return w ? cleanSets(w.sets) : pending;
  };

  // ---- 書きこみ ----
  function write(index, patch) {
    const w = workout();
    if (w) {
      commit(updateSet(ctx.getData(), w.id, index, patch));
      return;
    }
    pending = pending.map((s, i) => (i === index ? { ...s, ...patch } : s));
    if (pending.some((s) => !isEmptySet(s))) {
      commit(ensureTodayWorkout(ctx.getData(), exerciseId, { today, sets: pending }).data);
      pending = [];
    }
  }

  function insertAt(index, set) {
    const w = workout();
    if (w) commit(insertSet(ctx.getData(), w.id, index, set));
    else pending.splice(index, 0, set);
  }

  function addRow() {
    endEditing();
    const list = sets();
    const kind = list.length ? list[list.length - 1].kind : (prev?.sets[0]?.kind ?? 'kg');
    const w = workout();
    if (w) commit(addSet(ctx.getData(), w.id, emptySet(kind)));
    else pending.push(emptySet(kind));
    renderRows();
  }

  function deleteRow(index) {
    endEditing();
    const set = sets()[index];
    if (!set) return;
    const w = workout();
    if (w) commit(removeSet(ctx.getData(), w.id, index));
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
        <button type="button" class="back" id="rec-back">${iconHtml('chevronLeft')}<span class="bl">${fromHome ? 'ホーム' : '種目'}</span></button>
        <button type="button" class="save" id="rec-save">保存</button>
      </div>
      <div class="ttl-row">
        <h1 class="ttl">${esc(exercise.name)}</h1>
        <span class="bst" id="rec-best"></span>
      </div>
      <div class="lab-row">
        <h2 class="lab">前回</h2>
        ${prev ? '<button type="button" class="more" id="rec-hist"><span>履歴</span>' + iconHtml('chevronRight') + '</button>' : ''}
      </div>
      <div class="card prev" id="rec-prev"></div>
      <h2 class="lab">今回</h2>
      <div class="card" id="rec-sets"></div>
      <button type="button" class="addset" id="rec-add">${iconHtml('plusInline')}<span>セットを追加</span></button>
    </main>
    <button type="button" class="tm" id="rec-timer">⏱<span id="rec-time"></span></button>
    <div class="ov" id="rest-ov" hidden>
      <div class="rsheet" role="dialog" aria-modal="true" aria-labelledby="rest-ttl">
        <div class="eh">
          <span></span>
          <h2 id="rest-ttl">休憩の時間</h2>
          <button type="button" class="rc" id="rest-close">閉じる</button>
        </div>
        <div class="rgrid" id="rest-grid">${REST_CHOICES.map((sec) =>
          `<button type="button" data-sec="${sec}" aria-pressed="false">${mmss(sec)}</button>`).join('')}</div>
      </div>
    </div>
    <div class="ov" id="miss-ov" hidden>
      <div class="rsheet msheet" role="dialog" aria-modal="true" aria-labelledby="miss-ttl" aria-describedby="miss-sub">
        <p class="mt" id="miss-ttl"></p>
        <p class="ms" id="miss-sub">このままでも保存できます</p>
        <div class="mb">
          <button type="button" class="mfill" id="miss-fill">入力する</button>
          <button type="button" class="mkeep" id="miss-keep">このまま保存</button>
        </div>
      </div>
    </div>`;

  const $ = (id) => document.getElementById(id);
  const kbar = $('kbar');
  const kseg = $('kseg');

  function renderBest() {
    const el = $('rec-best');
    el.hidden = openBest === null;
    el.innerHTML = openBest === null ? '' : `🏆 <b>${esc(openBest)}</b>kg`;
  }

  function renderPrev() {
    const el = $('rec-prev');
    if (!prev) {
      el.innerHTML = '<p class="first">まだ記録がありません</p>';
      return;
    }
    el.innerHTML = `
      <button type="button" class="hd" id="rec-fold" aria-expanded="${prevOpen}">
        <span>${esc(shortDate(prev.date))}</span><span class="chev">${iconHtml(prevOpen ? 'chevronDown' : 'chevronRight')}</span>
      </button>
      ${prevOpen ? setListHtml(prev.sets) : ''}`;
    $('rec-fold').addEventListener('click', () => { prevOpen = !prevOpen; renderPrev(); });
  }

  // 欄に出す文字：{ parts, ph（空の欄の「重さ」「回数」）, long（小さめの文字） }
  // フォーカス中は、打っている文字を「自重+10kg」「10回（補助1）」の形でその場に出す
  function cellView(s, field, text) {
    const long = field === 'w' ? s.kind !== 'kg' : s.assistedReps !== null;
    if (text !== null) return { parts: editParts(s, field, text), ph: false, long };
    const parts = field === 'w' ? weightParts(s) : repsParts(s);
    return parts ? { parts, ph: false, long } : { parts: [{ text: field === 'w' ? '重さ' : '回数' }], ph: true, long: false };
  }

  // 欄の input に入れる数字（回数の欄は reps。手伝ってもらった回数はバーで増やす）
  const editValue = (s, field) => numText(field === 'w' ? s.weight : s.reps);

  // 重さも回数も小数を打てる（回数は小数1けたまで）
  // .cbtn：打っている欄の左はしの丸。空なら「↺」（1つ上の行の同じ欄を写す）、数字があれば「×」（この欄を空にする）
  function cellHtml(field, i) {
    const name = field === 'w' ? '重さ' : '回数';
    return `<div class="in" data-field="${field}">
      <span class="disp" aria-hidden="true"></span>
      <input type="text" inputmode="decimal"
        name="${field}${i + 1}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
        enterkeyhint="done" data-i="${i}" data-field="${field}" aria-label="${i + 1}セット目の${name}">
      <button type="button" class="cbtn" data-cbtn="${field}" data-i="${i}" hidden><i aria-hidden="true"></i></button>
    </div>`;
  }

  // 欄の左はしの丸の種類：'copy'（↺）／'clear'（×）／null（出さない）。フォーカスしている欄だけ
  function cellButton(list, i, field) {
    const s = list[i];
    if (!s) return null;
    if (field === 'w') {
      if (s.weight !== null) return 'clear';
      const up = list[i - 1];
      if (!up || weightParts(up) === null) return null;
      // 写しても変わらないとき（上も同じ種類で重さなし）は出さない
      return up.kind === s.kind && up.weight === null ? null : 'copy';
    }
    if (s.reps !== null || s.assistedReps !== null) return 'clear';
    const up = list[i - 1];
    return up && repsParts(up) !== null ? 'copy' : null;
  }

  // 行を作り直す（フォーカス中は呼ばない）
  function renderRows() {
    const list = sets();
    const el = $('rec-sets');
    el.innerHTML = list.length
      ? list.map((_, i) => `<div class="srow" data-i="${i}">
          <span class="no">${i + 1}</span>${cellHtml('w', i)}${cellHtml('r', i)}
          <button type="button" class="x" data-del="${i}" aria-label="${i + 1}セット目を消す">${iconHtml('xmark')}</button>
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
        const btn = cell.querySelector('.cbtn');
        const kind = isFocused ? cellButton(list, i, field) : null;
        btn.hidden = kind === null;
        cell.classList.toggle('has-btn', kind !== null);
        if (kind) {
          const name = field === 'w' ? '重さ' : '回数';
          btn.dataset.kind = kind;
          btn.firstElementChild.innerHTML = kind === 'copy' ? GLYPHS.copy : GLYPHS.clear;
          btn.setAttribute('aria-label', kind === 'copy' ? `上のセットの${name}を入れる` : `${name}を消す`);
        }
        // 丸のぶん狭くなって文字がはみ出すときは、小さめの文字にする
        cell.classList.remove('fit');
        if (kind && disp.scrollWidth > disp.clientWidth) cell.classList.add('fit');
        // 読み上げ用に、今の値を入れておく（フォーカス中は打っている文字のまま）
        if (!isFocused) input.value = editValue(list[i], field);
      }
    }
  }

  // 欄の左はしの丸を押したとき（フォーカスとキーボードはそのまま）
  function onCellButton(btn) {
    if (!focus || btn.closest('.in') !== focus.input.closest('.in')) return;
    const list = sets();
    const i = focus.index;
    const kind = cellButton(list, i, focus.field);
    if (kind === null) return;
    if (document.activeElement !== focus.input) focus.input.focus();
    if (focus.field === 'w') {
      const up = list[i - 1];
      write(i, kind === 'copy' ? { kind: up.kind, weight: up.weight } : { weight: null });
    } else {
      const up = list[i - 1];
      write(i, kind === 'copy' ? { reps: up.reps, assistedReps: up.assistedReps } : { reps: null, assistedReps: null });
    }
    focus.input.value = editValue(sets()[i], focus.field);
    renderSeg();
    updateCells();
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
      <button type="button" data-step="-1" aria-label="補助を1回減らす" aria-disabled="${n === 0}">${iconHtml('minusInline')}</button>
      <span class="n" aria-live="polite">補助 ${n}</span>
      <button type="button" data-step="1" aria-label="補助を1回増やす" aria-disabled="${!canAddAssist(s)}">${iconHtml('plusInline')}</button>`;
  }

  // 回数を打ちかえたら、「＋」を押せるか（補助は reps まで）だけを直す
  function updateStepPlus() {
    const plus = kseg.querySelector('button[data-step="1"]');
    if (plus) plus.setAttribute('aria-disabled', String(!canAddAssist(sets()[focus.index])));
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
    // バーの上へ動かした案内を、元の場所に戻す
    toast.style.top = '';
    toast.style.bottom = '';
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
    const text = sanitizeInput(input.value, FIELD_INPUT[focus.field]);
    if (text !== input.value) input.value = text;
    const n = parseNumber(text);
    write(focus.index, { [focus.field === 'w' ? 'weight' : 'reps']: n });
    // reps を減らして補助より小さくなっても、補助はそのまま（直さない）
    if (focus.field === 'r') updateStepPlus();
    updateCells();
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
  }

  // 手伝ってもらった回数を1つ増やす・減らす（0 は null で持つ）
  function onStep(delta) {
    if (!focus || focus.field !== 'r') return;
    const s = sets()[focus.index];
    if (!s) return;
    if (delta > 0 && !canAddAssist(s)) return;
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
    // 押せない「−」「＋」は disabled にしない（disabled の上では pointerdown を止められず、フォーカスが外れるおそれがあるため）
    if (btn.dataset.step && btn.getAttribute('aria-disabled') !== 'true') onStep(Number(btn.dataset.step));
    if (btn.id === 'kbar-timer') onTimerClick();
  }

  // ---- 元に戻す ----
  // 下の案内は「元に戻す」と「長押しで時間を変えられます」で共通（重なるときは新しいほうだけ）
  const toast = $('toast-bottom');
  function hideUndo() {
    if (undo) clearTimeout(undo.timer);
    undo = null;
    clearTimeout(hintTimer);
    hintTimer = null;
    toast.hidden = true;
    toast.style.top = '';
    toast.style.bottom = '';
    $('undo-btn').hidden = false;
  }
  function showUndo(set, index) {
    hideUndo();
    undo = { set, index, timer: setTimeout(hideUndo, UNDO_MS) };
    $('undo-text').textContent = `${index + 1}セット目を消しました`;
    toast.hidden = false;
  }
  function showHint() {
    hideUndo();
    $('undo-text').textContent = '長押しで時間を変えられます';
    $('undo-btn').hidden = true;
    toast.hidden = false;
    // キーボードが出ているときは、バーの上に出す
    if (kbOpen()) {
      toast.style.bottom = 'auto';
      toast.style.top = `${kbar.getBoundingClientRect().top - toast.offsetHeight - 8}px`;
    }
    hintTimer = setTimeout(hideUndo, HINT_MS);
  }
  function onUndo() {
    if (!undo) return;
    const { set, index } = undo;
    hideUndo();
    endEditing();
    insertAt(index, set);
    renderRows();
  }

  // ---- 休憩タイマー（見張りは timer.js。ここは表示と押したときだけ） ----
  const tmBtn = $('rec-timer');
  const kbTimer = $('kbar-timer');
  const restSec = () => restSecOf(findExercise(ctx.getData(), exerciseId) ?? exercise);

  // 動いていれば残り（どの種目のタイマーでも）、止まっていればこの種目の restSec
  function renderTimer({ timer, remaining } = ctx.timer.now()) {
    const text = mmss(timer ? remaining : restSec());
    const label = timer ? `休憩タイマー 残り${text}（押すと止まる）` : `休憩タイマー ${text}（押すと始まる）`;
    $('rec-time').textContent = text;
    $('kbar-time').textContent = text;
    tmBtn.setAttribute('aria-label', label);
    kbTimer.setAttribute('aria-label', label);
  }


  function onTimerEvent(ev) {
    if (!alive) return;
    if (ev.type === 'tick') renderTimer(ev);
  }

  function onTimerClick() {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    // 「元に戻す」が出ている間はヒントを出さない（フラグも立てず、次に押したときに出す）
    if (!undo && needsTimerHint(ctx.getData())) {
      commit(markTimerHint(ctx.getData()));
      showHint();
    }
    ctx.timer.toggle(exerciseId);
  }

  // 長押し
  function onPressDown(e) {
    suppressClick = false;
    cancelPress();
    if (e.button !== undefined && e.button !== 0) return;
    press = {
      x: e.clientX, y: e.clientY, pointerId: e.pointerId,
      from: e.currentTarget === kbTimer ? 'kbar' : 'tm',
      timer: setTimeout(onLongPress, LONG_MS),
    };
  }
  function onPressMove(e) {
    if (!press || e.pointerId !== press.pointerId) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) >= LONG_MOVE) cancelPress();
  }
  function cancelPress() {
    if (press) clearTimeout(press.timer);
    press = null;
  }
  function onLongPress() {
    const from = press?.from;
    press = null;
    suppressClick = true;
    // 長押しで知ったので、案内はもう出さない
    if (needsTimerHint(ctx.getData())) commit(markTimerHint(ctx.getData()));
    if (from === 'kbar') endEditing(); // 入力を終えてから開く（キーボードは閉じる）
    openRest();
  }
  const noMenu = (e) => e.preventDefault();

  // 長押しのあと、指を離したときの click がシートのボタンに当たらないようにする
  function onDocClick(e) {
    if (!suppressClick) return;
    if (e.target.closest?.('#rec-timer, #kbar-timer')) return; // 丸・バーのボタンでは onTimerClick が消す
    suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
  }
  // 次に押したときは、もう止めない（長押しのあとに click が来なかったとき）
  function onDocDown(e) {
    if (e.target.closest?.('#rec-timer, #kbar-timer')) return;
    suppressClick = false;
  }

  // 休憩の時間のシート
  const restOv = $('rest-ov');
  function openRest() {
    // ヒントは消す。「元に戻す」は消さない（取り消せなくならないように）
    if (!undo) hideUndo();
    const cur = restSec();
    for (const b of $('rest-grid').querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.sec) === cur));
    }
    restOv.hidden = false;
    document.body.classList.add('sheet-open');
  }
  function closeRest() {
    restOv.hidden = true;
    document.body.classList.remove('sheet-open');
  }
  function onRestPick(e) {
    const btn = e.target.closest('button[data-sec]');
    if (!btn) return;
    const sec = Number(btn.dataset.sec);
    closeRest();
    ctx.timer.startWith(setRestSec(ctx.getData(), exerciseId, sec), exerciseId, sec);
  }

  // ---- 戻る ----
  const kbOpen = () => !kbar.hidden;
  function onSaveDown(e) {
    if (kbOpen()) e.preventDefault(); // キーボード中は押せない（フォーカスも外さない）
  }
  function onSave() {
    if (kbOpen()) return;
    leave('#/select');
  }

  // 「保存」「‹ 種目」「‹ ホーム」で離れる。空でないのに欠けているセットがあれば、先にシートで確かめる
  function leave(hash) {
    endEditing();
    const miss = firstMissing(sets());
    if (miss) {
      openConfirm(hash, miss);
      return;
    }
    go(hash);
  }
  function go(hash) {
    leaving = true;
    ctx.replace(hash);
  }

  // 空の欄の確かめのシート
  const confirmOv = $('miss-ov');
  let missAt = null; // { index, field }
  function openConfirm(hash, miss) {
    if (!undo) hideUndo(); // 「元に戻す」は消さない（休憩の時間のシートと同じ）
    confirmHash = hash;
    missAt = miss;
    $('miss-ttl').textContent =
      `${miss.index + 1}セット目の${miss.field === 'w' ? '重さ' : '回数'}${miss.more ? 'ほか' : ''}が入っていません`;
    confirmOv.hidden = false;
    document.body.classList.add('sheet-open');
    $('miss-fill').focus({ preventScroll: true });
  }
  function closeConfirm() {
    confirmOv.hidden = true;
    confirmHash = null;
    if (restOv.hidden) document.body.classList.remove('sheet-open');
  }
  // 「入力する」：閉じて、その欄にフォーカスする（押した中で focus するので、キーボードが出る）
  function onFill() {
    const at = missAt;
    closeConfirm();
    const input = $('rec-sets').querySelector(`input[data-i="${at.index}"][data-field="${at.field}"]`);
    input?.focus();
  }
  function onKeepSave() {
    const hash = confirmHash;
    closeConfirm();
    if (hash) go(hash);
  }

  // 履歴の画面へ（キーボードが出ていたら閉じてから）
  function onHistory() {
    endEditing();
    ctx.go(`#/history/${encodeURIComponent(exerciseId)}${fromHome ? '?from=home' : ''}`);
  }

  // ---- つなぐ ----
  const main = root.querySelector('.rec');
  main.addEventListener('focusin', onFocusIn);
  main.addEventListener('focusout', onFocusOut);
  main.addEventListener('input', onInput);
  main.addEventListener('click', (e) => {
    const cbtn = e.target.closest('[data-cbtn]');
    if (cbtn) {
      onCellButton(cbtn);
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) deleteRow(Number(del.dataset.del));
  });
  // 欄の左はしの丸を押しても、input のフォーカスを外さない
  const keepCellFocus = (e) => { if (e.target.closest('[data-cbtn]')) e.preventDefault(); };
  main.addEventListener('pointerdown', keepCellFocus);
  main.addEventListener('mousedown', keepCellFocus);
  $('rec-add').addEventListener('click', addRow);
  $('rec-hist')?.addEventListener('click', onHistory);
  $('rec-back').addEventListener('click', () => leave(fromHome ? '#/' : '#/select'));
  const save = $('rec-save');
  save.addEventListener('pointerdown', onSaveDown);
  save.addEventListener('mousedown', onSaveDown);
  save.addEventListener('click', onSave);
  kbar.addEventListener('pointerdown', keepFocus);
  kbar.addEventListener('mousedown', keepFocus);
  kbar.addEventListener('click', onBarClick);
  $('undo-btn').addEventListener('click', onUndo);
  tmBtn.addEventListener('click', onTimerClick);
  for (const el of [tmBtn, kbTimer]) {
    el.addEventListener('pointerdown', onPressDown);
    el.addEventListener('pointermove', onPressMove);
    el.addEventListener('pointerup', cancelPress);
    el.addEventListener('pointercancel', cancelPress);
    el.addEventListener('contextmenu', noMenu);
  }
  document.addEventListener('click', onDocClick, true);
  document.addEventListener('pointerdown', onDocDown, true);
  $('rest-close').addEventListener('click', closeRest);
  $('rest-grid').addEventListener('click', onRestPick);
  // 後ろ（暗い所）を押したら閉じる
  restOv.addEventListener('click', (e) => { if (e.target === restOv) closeRest(); });
  restOv.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  $('miss-fill').addEventListener('click', onFill);
  $('miss-keep').addEventListener('click', onKeepSave);
  // 後ろ（暗い所）を押したら、ただ閉じる（離れない）
  confirmOv.addEventListener('click', (e) => { if (e.target === confirmOv) closeConfirm(); });
  confirmOv.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  const offTimer = ctx.timer.subscribe(onTimerEvent);
  const vv = window.visualViewport;
  vv?.addEventListener('resize', onViewport);
  vv?.addEventListener('scroll', onViewport);
  window.addEventListener('resize', onViewport);

  // 離れたあと、移った先の画面の上に出す。空でないセットがなければ出さない。
  // 開いたときの 🏆 より重くなったら「新記録」も（開いたときに 🏆 がなければ出さない）
  function showSaved() {
    const data = ctx.getData();
    if (saveFailed || todaySetCount(data, exerciseId, today) === 0) return;
    const text = `${exercise.name}を保存しました`;
    const best = bestWeight(data, exerciseId);
    if (openBest !== null && best !== null && best > openBest) showTopToast(text, 2500, { title: `🏆 新記録 ${best}kg` });
    else showTopToast(text);
  }

  renderBest();
  renderPrev();
  renderRows();
  renderTimer();

  return {
    // 画面を離れるとき：空のセットを取り除いて保存する
    unmount() {
      hideUndo();
      endEditing();
      closeBar();
      closeRest();
      closeConfirm();
      cancelPress();
      offTimer();
      alive = false;
      for (const el of [tmBtn, kbTimer]) {
        el.removeEventListener('pointerdown', onPressDown);
        el.removeEventListener('pointermove', onPressMove);
        el.removeEventListener('pointerup', cancelPress);
        el.removeEventListener('pointercancel', cancelPress);
        el.removeEventListener('contextmenu', noMenu);
      }
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('pointerdown', onDocDown, true);
      kbar.removeEventListener('pointerdown', keepFocus);
      kbar.removeEventListener('mousedown', keepFocus);
      kbar.removeEventListener('click', onBarClick);
      $('undo-btn').removeEventListener('click', onUndo);
      vv?.removeEventListener('resize', onViewport);
      vv?.removeEventListener('scroll', onViewport);
      window.removeEventListener('resize', onViewport);
      const next = cleaned();
      if (next) commit(next);
      if (leaving) showSaved();
    },
    // 履歴の画面へ行くとき：入力・案内・シートを閉じるだけ（行と今日の入力はそのまま残す）
    suspend() {
      hideUndo();
      endEditing();
      closeBar();
      closeRest();
      closeConfirm();
      cancelPress();
      suppressClick = false;
    },
    // 履歴の画面から戻ったとき
    resume() {
      renderTimer();
    },
    // ページを閉じるとき：画面の状態は変えずに、空のセットを除いたものを保存だけする
    flush() {
      const next = cleaned();
      if (next) ctx.saveOnly(next);
    },
  };
}
