import { loadData, saveData, requestPersist, CURRENT_VERSION } from './store.js';

const out = document.getElementById('check');

function row(label, value) {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  out.append(dt, dd);
}

const errorText = (error) =>
  `読み込めませんでした。記録は消えていません。開発者に連絡してください（エラー：${error?.message ?? error}）`;

async function main() {
  let loaded;
  try {
    loaded = loadData();
  } catch (error) {
    row('読み込み', errorText(error));
    return; // エラーのときは保存しない
  }
  const { data, recoveredKey } = loaded;
  if (recoveredKey) {
    row('お知らせ', '前のデータを読めなかったため、別の場所に残しました');
  }
  row('データの版', `${data.version}（アプリ ${CURRENT_VERSION}）`);
  row('種目の数', String(data.exercises.length));
  row('記録の数', String(data.workouts.length));

  const persisted = await requestPersist();
  row('persist()', persisted === null ? '使えない' : persisted ? '許可された' : '許可されなかった');

  const result = saveData(data);
  row('保存のテスト', result.ok ? 'ok' : '失敗：' + (result.error?.message ?? result.error));
}

main().catch((error) => row('エラー', errorText(error)));
