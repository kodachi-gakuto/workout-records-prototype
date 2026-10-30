// 起動と画面の行き来（hash）
// #/ ＝ホーム／#/select ＝種目を選ぶ／#/record/<exerciseId> ＝記録の画面（ホームから開いたときは ?from=home を付ける）
// 開き直したときは、いつもホームから
import { loadData, saveData, requestPersist, todayString } from './store.js';
import { mountHome } from './home-screen.js';
import { mountRecord } from './record-screen.js';
import { mountSelect } from './select-screen.js';
import { esc, showTopToast } from './ui.js';
import { createTimerWatch } from './timer.js';
import { elapsedText } from './records.js';

const app = document.getElementById('app');
const state = { data: null, recoveredKey: null, screen: null, page: null, fromHome: false, homeDate: null };

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

// 休憩が終わったら、どの画面でも真ん中に知らせを出す（OK を押すまで消えない）
function showTimerDone({ sec }) {
  const ov = document.getElementById('done-ov');
  const text = elapsedText(sec);
  document.getElementById('done-text').textContent = text ? `${text}経過しました。` : '休憩の時間が経過しました。';
  // 入力中ならキーボードを閉じる（打った数字は入力のたびに保存ずみ）
  if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
  ov.hidden = false;
  document.getElementById('done-ok').focus({ preventScroll: true });
}
document.getElementById('done-ok').addEventListener('click', () => {
  document.getElementById('done-ov').hidden = true;
});
ctx.timer.subscribe((ev) => {
  if (ev.type === 'done') showTimerDone(ev);
});

function route() {
  state.screen?.unmount();
  state.screen = null;
  window.scrollTo(0, 0);
  const from = state.page;
  const wasFromHome = state.fromHome;
  const m = location.hash.match(/^#\/record\/([^?]+)(?:\?(.*))?$/);
  state.page = m ? 'record' : location.hash === '#/select' ? 'select' : 'home';
  state.fromHome = Boolean(m) && m[2] === 'from=home';
  if (state.page === 'select') {
    // 種目を選ぶ画面から開いた記録の画面から戻ったときは、記録の画面を開く前のスクロールの位置
    state.screen = mountSelect(app, ctx, { restore: from === 'record' && !wasFromHome });
  } else if (m) {
    let id = null;
    try {
      id = decodeURIComponent(m[1]);
    } catch {
      id = null; // 壊れた hash は「種目が見つかりません」にする
    }
    state.screen = mountRecord(app, ctx, id, { fromHome: state.fromHome });
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
  window.addEventListener('pagehide', () => state.screen?.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') state.screen?.flush();
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
