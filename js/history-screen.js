// 種目の履歴の画面
// 今日より前の記録を新しい順に、記録の画面の「前回」と同じカードで並べる（たたまない・押しても何も起きない）
import { findExercise, exerciseHistory, shortDate } from './records.js';
import { todayString } from './store.js';
import { esc, iconHtml, setListHtml } from './ui.js';

// 日付の行の右はし：「🏆」「↑2.5kg」「🏆 ↑2.5kg」
const markText = (w) => [w.best ? '🏆' : '', w.up !== null ? `↑${w.up}kg` : ''].filter(Boolean).join(' ');

function cardHtml(w) {
  const mark = markText(w);
  return `<div class="card prev">
      <div class="hd"><span>${esc(shortDate(w.date))}</span>${mark ? `<span class="mark">${esc(mark)}</span>` : ''}</div>
      ${setListHtml(w.sets)}
    </div>`;
}

// fromHome：記録の画面をホームから開いていたとき（戻ったときに「‹ ホーム」を保つ）
export function mountHistory(root, ctx, exerciseId, { fromHome = false } = {}) {
  const exercise = findExercise(ctx.getData(), exerciseId);
  if (!exercise) {
    const back = fromHome ? '<a href="#/">ホームに戻る</a>' : '<a href="#/select">種目に戻る</a>';
    root.innerHTML = `<main class="missing"><p>種目が見つかりません</p><p>${back}</p></main>`;
    return { unmount() {}, flush() {} };
  }

  const list = exerciseHistory(ctx.getData(), exerciseId, todayString());
  root.innerHTML = `
    <main class="hist">
      <div class="navb">
        <button type="button" class="back" id="hist-back">${iconHtml('chevronLeft')}<span class="bl">${esc(exercise.name)}</span></button>
      </div>
      <h1 class="ttl">${esc(exercise.name)}の履歴</h1>
      ${list.length ? list.map(cardHtml).join('') : '<div class="card prev"><p class="first">まだ記録がありません</p></div>'}
    </main>`;

  const recordHash = `#/record/${encodeURIComponent(exerciseId)}${fromHome ? '?from=home' : ''}`;
  document.getElementById('hist-back').addEventListener('click', () => ctx.replace(recordHash));

  return { unmount() {}, flush() {} };
}
