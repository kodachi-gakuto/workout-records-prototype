// 起動と画面の行き来（hash）
// #/ ＝仮の一覧（作業③で「種目を選ぶ」に置きかえる）／#/record/<exerciseId> ＝記録の画面
import { loadData, saveData, requestPersist, todayString, CURRENT_VERSION } from './store.js';
import { addExercise, listExercises, ensureTodayWorkout } from './records.js';
import { mountRecord } from './record-screen.js';
import { esc, showTopToast } from './ui.js';

const app = document.getElementById('app');
const state = { data: null, recoveredKey: null, persisted: undefined, screen: null };

// data を差しかえて保存する。保存できなかったら上に短く出す
function commit(data) {
  state.data = data;
  const result = saveData(data);
  if (!result.ok) showTopToast('保存できませんでした');
  return result;
}

const ctx = {
  getData: () => state.data,
  commit,
  // 画面を閉じるときに、画面の状態は変えずに保存だけする
  saveOnly: (data) => saveData(data),
  go: (hash) => { location.hash = hash; },
};

// ---- 仮の一覧 ----
const SAMPLES = [
  ['ベンチプレス', 'chest'],
  ['懸垂', 'back'],
  ['スクワット', 'legs'],
  ['インクラインダンベルプレス', 'chest'],
  ['ショルダープレス', 'shoulders'],
];

function nextSample() {
  const names = new Set(listExercises(state.data).map((e) => e.name));
  for (let n = 1; ; n += 1) {
    for (const [name, part] of SAMPLES) {
      const label = n === 1 ? name : `${name} ${n}`;
      if (!names.has(label)) return { name: label, part };
    }
  }
}

// 昨日の日付で 60kg×10・60kg×8・57.5kg×8 の記録も一緒に作る（試し用）
function addSampleWithPrevious() {
  const { data, exercise } = addExercise(state.data, nextSample());
  const yesterday = todayString(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const kg = (weight, reps) => ({ kind: 'kg', weight, reps, assistedReps: null });
  const sets = [kg(60, 10), kg(60, 8), kg(57.5, 8)];
  commit(ensureTodayWorkout(data, exercise.id, { today: yesterday, sets }).data);
}

// ホーム画面のアイコンから開いたか
function displayMode() {
  const standalone = globalThis.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  return standalone ? 'ホーム画面（standalone）' : 'Safari';
}

function renderList() {
  const exercises = listExercises(state.data);
  const workouts = Array.isArray(state.data.workouts) ? state.data.workouts.length : 0;
  const persist = state.persisted === undefined ? '確かめ中'
    : state.persisted === null ? '使えない' : state.persisted ? '許可された' : '許可されなかった';
  app.innerHTML = `
    <main class="list">
      <h1>種目（仮）</h1>
      ${exercises.length
        ? `<ul>${exercises.map((e) => `<li><a href="#/record/${encodeURIComponent(e.id)}">${esc(e.name)}</a></li>`).join('')}</ul>`
        : '<p class="empty">種目がありません</p>'}
      <div class="add-row">
        <button type="button" class="add-ex" id="add-ex">仮の種目を足す</button>
        <button type="button" class="add-ex" id="add-ex-prev">前回の記録つきの仮の種目を足す</button>
      </div>
      <dl class="check" aria-label="確かめ用の表示">
        ${state.recoveredKey ? '<dt>お知らせ</dt><dd>前のデータを読めなかったため、別の場所に残しました</dd>' : ''}
        <dt>データの版</dt><dd>${esc(state.data.version)}（アプリ ${CURRENT_VERSION}）</dd>
        <dt>種目の数</dt><dd>${exercises.length}</dd>
        <dt>記録の数</dt><dd>${workouts}</dd>
        <dt>persist()</dt><dd>${persist}</dd>
        <dt>表示の形</dt><dd>${displayMode()}</dd>
      </dl>
    </main>`;
  document.getElementById('add-ex').addEventListener('click', () => {
    commit(addExercise(state.data, nextSample()).data);
    renderList();
  });
  document.getElementById('add-ex-prev').addEventListener('click', () => {
    addSampleWithPrevious();
    renderList();
  });
}

function route() {
  state.screen?.unmount();
  state.screen = null;
  window.scrollTo(0, 0);
  const m = location.hash.match(/^#\/record\/(.+)$/);
  if (m) {
    let id = null;
    try {
      id = decodeURIComponent(m[1]);
    } catch {
      id = null; // 壊れた hash は「種目が見つかりません」にする
    }
    state.screen = mountRecord(app, ctx, id);
  } else {
    renderList();
  }
}

// 大きい文字の設定か（標準は 17px）
function markTextSize() {
  const size = parseFloat(getComputedStyle(document.documentElement).fontSize);
  document.documentElement.classList.toggle('lg', size >= 19);
}

const errorText = (error) =>
  `読み込めませんでした。記録は消えていません。開発者に連絡してください（エラー：${error?.message ?? error}）`;

function main() {
  markTextSize();
  try {
    const loaded = loadData();
    state.data = loaded.data;
    state.recoveredKey = loaded.recoveredKey;
  } catch (error) {
    // エラーのときは保存しない（画面も出さない）
    app.innerHTML = `<main class="missing"><p>${esc(errorText(error))}</p></main>`;
    return;
  }
  window.addEventListener('hashchange', route);
  // 閉じるとき：記録の画面なら空のセットを取り除いて保存する
  window.addEventListener('pagehide', () => state.screen?.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') state.screen?.flush();
  });
  route();
  requestPersist().then((p) => {
    state.persisted = p;
    if (!state.screen) renderList();
  });
}

main();
