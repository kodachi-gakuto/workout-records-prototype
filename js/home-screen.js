// ホーム：日付・部位のバランス（直近30日）・今日の種目と、下に固定の「＋ 記録する」
import { partBalance, todayExercises, dateLabel, BALANCE_DAYS } from './records.js';
import { todayString } from './store.js';
import { esc } from './ui.js';
import { addDemo, DEMO_ID } from './demo.js'; // 確認用（一時的）

export function mountHome(root, ctx, { recovered = false } = {}) {
  const today = todayString();
  const data = ctx.getData();
  const balance = partBalance(data, today);
  const max = Math.max(...balance.map((p) => p.days));
  const rows = todayExercises(data, today);

  const balHtml = balance.map((p) => `
    <div class="bal${p.low ? ' low' : ''}">
      <span class="pn">${esc(p.label)}${p.low ? '<span class="dot" role="img" aria-label="いちばん少ない"></span>' : ''}</span>
      <span class="bar" aria-hidden="true"><i style="width:${max ? (p.days / max) * 100 : 0}%"></i></span>
      <span class="dn">${p.days}日</span>
    </div>`).join('');

  const todayHtml = rows.length
    ? rows.map((r) => `
      <button type="button" class="trow" data-id="${esc(r.exerciseId)}">
        <span class="nm">${esc(r.name)}</span>
        <span class="cnt">${r.sets}セット</span>
        <span class="chev" aria-hidden="true">›</span>
      </button>`).join('')
    : '<p class="none">まだ記録がありません。</p>';

  root.innerHTML = `
    <main class="home">
      <h1>${esc(dateLabel(today))}</h1>
      ${recovered ? '<p class="note">前のデータを読めなかったため、別の場所に残しました</p>' : ''}
      <h2 class="hlab">部位のバランス<small>直近${BALANCE_DAYS}日</small></h2>
      <div class="hcard">${balHtml}</div>
      <h2 class="hlab">今日の種目</h2>
      <div class="hcard" id="home-today">${todayHtml}</div>
      <button type="button" class="demo" id="home-demo">（確認用）お試しの記録を入れる</button>
    </main>
    <div class="hfoot">
      <a class="cta" href="#/select">＋ 記録する</a>
    </div>`;

  // ホームから開いたことを hash で渡す（記録の画面の左上を「‹ ホーム」にする）
  document.getElementById('home-today').addEventListener('click', (e) => {
    const row = e.target.closest('.trow');
    if (row) ctx.go(`#/record/${encodeURIComponent(row.dataset.id)}?from=home`);
  });

  // 確認用（一時的）：お試しの種目を入れて、その記録の画面を開く
  document.getElementById('home-demo').addEventListener('click', () => {
    const r = ctx.commit(addDemo(ctx.getData(), today));
    if (r.ok) ctx.go(`#/record/${DEMO_ID}?from=home`);
  });

  return { unmount() {}, flush() {} };
}
