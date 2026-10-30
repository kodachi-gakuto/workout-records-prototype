// 起動と画面の行き来（hash）
// #/ ＝ホーム／#/select ＝種目を選ぶ／#/record/<exerciseId> ＝記録の画面（ホームから開いたときは ?from=home を付ける）
// #/history/<exerciseId> ＝種目の履歴の画面（記録の画面の ?from=home を引き継ぐ）
// 開き直したときは、いつもホームから
import { loadData, saveData, requestPersist, todayString } from './store.js';
import { mountHome } from './home-screen.js';
import { mountRecord } from './record-screen.js';
import { mountSelect } from './select-screen.js';
import { mountHistory } from './history-screen.js';
import { esc, showTopToast } from './ui.js';
import { createTimerWatch } from './timer.js';
import { elapsedText } from './records.js';

const app = document.getElementById('app');
// 履歴の画面はここに出す（記録の画面を app に隠したまま残せるように）
const sub = document.getElementById('sub');
// kept：履歴の画面を開いている間、隠しておく記録の画面 { screen, id, fromHome, scrollY }
const state = { data: null, recoveredKey: null, screen: null, page: null, id: null, fromHome: false, homeDate: null, kept: null };

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
  // 履歴を積まずに移る（戻るで同じ画面に戻らないように）
  replace: (hash) => { location.replace(hash); },
};
// 休憩タイマーの見張り（画面をまたいで動く。記録の画面は表示だけ）
ctx.timer = createTimerWatch(ctx);

// 休憩が終わったら、どの画面でも真ん中に知らせを出す（OK か後ろを押すまで消えない）
function showTimerDone({ sec }) {
  const ov = document.getElementById('done-ov');
  const text = elapsedText(sec);
  document.getElementById('done-text').textContent = text ? `${text}経過しました。` : '休憩の時間が経過しました。';
  // 入力中ならキーボードを閉じる（打った数字は入力のたびに保存ずみ）
  if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
  ov.hidden = false;
  document.getElementById('done-ok').focus({ preventScroll: true });
}
function closeTimerDone() {
  document.getElementById('done-ov').hidden = true;
}
document.getElementById('done-ok').addEventListener('click', closeTimerDone);
// 後ろ（暗い所）を押しても、OK と同じく閉じる
document.getElementById('done-ov').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeTimerDone();
});
ctx.timer.subscribe((ev) => {
  if (ev.type === 'done') showTimerDone(ev);
});

// hash を { page, id, fromHome } にする。壊れた hash の id は null（「種目が見つかりません」にする）
function parseHash(hash) {
  const m = hash.match(/^#\/(record|history)\/([^?]+)(?:\?(.*))?$/);
  if (!m) return { page: hash === '#/select' ? 'select' : 'home', id: null, fromHome: false };
  let id = null;
  try {
    id = decodeURIComponent(m[2]);
  } catch {
    id = null;
  }
  return { page: m[1], id, fromHome: m[3] === 'from=home' };
}

function route() {
  const next = parseHash(location.hash);
  const cur = state.screen;
  state.screen = null;
  // 記録の画面 → 同じ種目の履歴：記録の画面は閉じずに隠しておく（今日の入力・空の行・タイマーの表示をそのまま残す）
  const toOwnHistory = state.page === 'record' && next.page === 'history'
    && next.id === state.id && next.fromHome === state.fromHome;
  if (cur && toOwnHistory && cur.suspend) {
    cur.suspend();
    state.kept = { screen: cur, id: state.id, fromHome: state.fromHome, scrollY: window.scrollY };
  } else {
    cur?.unmount();
  }
  // 隠しておいた記録の画面は、その履歴の画面か、その記録の画面へ行くときだけ残す。ほかへ行くなら閉じる
  const kept = state.kept;
  if (kept && !((next.page === 'history' || next.page === 'record') && next.id === kept.id && next.fromHome === kept.fromHome)) {
    kept.screen.unmount();
    state.kept = null;
  }

  const from = state.page;
  const wasFromHome = state.fromHome;
  state.page = next.page;
  state.id = next.id;
  state.fromHome = next.fromHome;
  const onHistory = next.page === 'history';
  app.hidden = onHistory;
  sub.hidden = !onHistory;
  if (!onHistory) sub.innerHTML = '';

  // 履歴の画面から戻ったとき：隠しておいた記録の画面を出し直す（スクロールの位置も戻す）
  if (next.page === 'record' && state.kept) {
    state.screen = state.kept.screen;
    const { scrollY } = state.kept;
    state.kept = null;
    state.screen.resume();
    window.scrollTo(0, scrollY);
    return;
  }

  window.scrollTo(0, 0);
  if (next.page === 'select') {
    // 種目を選ぶ画面から開いた記録の画面から戻ったときは、記録の画面を開く前のスクロールの位置
    state.screen = mountSelect(app, ctx, { restore: from === 'record' && !wasFromHome });
  } else if (next.page === 'record') {
    state.screen = mountRecord(app, ctx, next.id, { fromHome: next.fromHome });
  } else if (onHistory) {
    state.screen = mountHistory(sub, ctx, next.id, { fromHome: next.fromHome });
  } else {
    state.homeDate = todayString();
    state.screen = mountHome(app, ctx, { recovered: Boolean(state.recoveredKey) });
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
  // 開き直したときはホームから（hash が #/ 以外なら、履歴を積まずに #/ にする）
  if (location.hash !== '#/') history.replaceState(null, '', location.pathname + location.search + '#/');
  ctx.timer.start();
  window.addEventListener('hashchange', route);
  // 閉じるとき：記録の画面なら空のセットを取り除いて保存する
  // 履歴の画面を開いている間は、隠しておいた記録の画面も
  const flushAll = () => {
    state.screen?.flush();
    state.kept?.screen.flush();
  };
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
    // 翌日に戻ってきたときは、ホームを今日の日付で描き直す
    else if (state.page === 'home' && todayString() !== state.homeDate) route();
  });
  route();
  requestPersist(); // 結果は画面に出さない
}

main();

// 電波がなくても開けるように、サービスワーカーを登録する（失敗しても画面は動き続ける）
// 新しい版が入っても自動で読み直さない（次に開いたときに新しい版になる）
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
}
