import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY, BROKEN_KEY_PREFIX, BACKUP_KEY_PREFIX, CURRENT_VERSION, PARTS,
  createEmptyData, migrate, normalize, loadData, saveData, requestPersist, newId, todayString,
} from '../js/store.js';

// localStorage の代わり（Map を使った小さな偽物）
function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

const keysWith = (s, prefix) => [...s.map.keys()].filter((k) => k.startsWith(prefix));
const empty = () => ({ data: createEmptyData(), recoveredKey: null });

test('キーがないときは空のデータ', () => {
  assert.deepEqual(loadData(fakeStorage()), empty());
});

test('空のデータの形', () => {
  const d = createEmptyData();
  assert.equal(d.version, CURRENT_VERSION);
  assert.deepEqual(d.exercises, []);
  assert.deepEqual(d.workouts, []);
  assert.equal(d.timer, null);
  assert.deepEqual(d.flags, { timerHintShown: false });
});

test('保存して読むと同じ', () => {
  const s = fakeStorage();
  const data = createEmptyData();
  data.exercises.push({ id: 'e1', name: 'ベンチプレス', part: 'chest', restSec: 120, createdAt: '2026-10-28T00:00:00.000Z' });
  data.workouts.push({
    id: 'w1', exerciseId: 'e1', date: '2026-10-28', startedAt: '2026-10-28T00:00:00.000Z',
    sets: [{ kind: 'kg', weight: 60, reps: 10, assistedReps: 2 }, { kind: 'bodyweight', weight: null, reps: 8, assistedReps: null }],
  });
  data.timer = { exerciseId: 'e1', endsAt: 1761600000000 };
  assert.deepEqual(saveData(data, s), { ok: true });
  assert.deepEqual(loadData(s), { data, recoveredKey: null });
});

test('今の版のデータはそのまま', () => {
  const d = createEmptyData();
  d.flags.timerHintShown = true;
  assert.deepEqual(migrate(structuredClone(d)), d);
});

test('新しすぎる version はエラーで、保存された中身は変えない', () => {
  const s = fakeStorage();
  const text = JSON.stringify({ version: CURRENT_VERSION + 1, exercises: [] });
  s.setItem(STORAGE_KEY, text);
  assert.throws(() => loadData(s));
  assert.equal(s.getItem(STORAGE_KEY), text);
  assert.equal(s.map.size, 1);
});

test('壊れた JSON は退避キーに残って、空のデータを返す', () => {
  const s = fakeStorage();
  s.setItem(STORAGE_KEY, '{壊れた');
  const r = loadData(s);
  assert.deepEqual(r.data, createEmptyData());
  const broken = keysWith(s, BROKEN_KEY_PREFIX);
  assert.deepEqual(broken, [r.recoveredKey]);
  assert.equal(s.getItem(broken[0]), '{壊れた');
});

// 読めるが形のおかしいデータ（version なし・文字列・小数など）も退避する
for (const [name, text] of [
  ['null', 'null'],
  ['配列', '[]'],
  ['数', '123'],
  ['文字列', '"x"'],
  ['version が文字列', '{"version":"1"}'],
  ['version が小数', '{"version":1.5}'],
  ['version が 0', '{"version":0}'],
  ['version なし', '{"exercises":[{"id":"old"}]}'],
]) {
  test(`形のおかしいデータ（${name}）は退避して空のデータ`, () => {
    const s = fakeStorage();
    s.setItem(STORAGE_KEY, text);
    const r = loadData(s);
    assert.deepEqual(r.data, createEmptyData());
    assert.ok(r.recoveredKey.startsWith(BROKEN_KEY_PREFIX));
    assert.equal(s.getItem(r.recoveredKey), text);
  });
}

test('足りない所は既定値で補う', () => {
  const s = fakeStorage();
  s.setItem(STORAGE_KEY, '{"version":1}');
  assert.deepEqual(loadData(s), empty());
  s.setItem(STORAGE_KEY, '{"version":1,"exercises":[{"id":"e1"}],"flags":{}}');
  const r = loadData(s);
  assert.equal(r.recoveredKey, null);
  assert.deepEqual(r.data.exercises, [{ id: 'e1' }]);
  assert.deepEqual(r.data.workouts, []);
  assert.equal(r.data.timer, null);
  assert.deepEqual(r.data.flags, { timerHintShown: false });
});

test('補えない形（配列でないなど）は退避して空のデータ', () => {
  for (const text of [
    '{"version":1,"exercises":{}}',
    '{"version":1,"workouts":"x"}',
    '{"version":1,"timer":5}',
    '{"version":1,"flags":[]}',
  ]) {
    const s = fakeStorage();
    s.setItem(STORAGE_KEY, text);
    const r = loadData(s);
    assert.deepEqual(r.data, createEmptyData(), text);
    assert.equal(s.getItem(r.recoveredKey), text);
  }
  assert.equal(normalize(null), null);
});

test('退避の setItem が失敗したら例外が出て、wrp:data は変わらない', () => {
  const s = fakeStorage();
  s.setItem(STORAGE_KEY, '{壊れた');
  s.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.throws(() => loadData(s));
  assert.equal(s.getItem(STORAGE_KEY), '{壊れた');
  assert.equal(s.map.size, 1);
});

test('版を順に上げる（1→2→3）', () => {
  const calls = [];
  const migrations = {
    2: (d) => { calls.push([2, d.version]); return { ...d, a: 1 }; },
    3: (d) => { calls.push([3, d.version]); return { ...d, b: d.a + 1 }; },
  };
  const r = migrate({ version: 1 }, migrations, 3);
  assert.deepEqual(calls, [[2, 1], [3, 2]]);
  assert.deepEqual(r, { version: 3, a: 1, b: 2 });
  assert.throws(() => migrate({ version: 1 }, { 3: (d) => d }, 3)); // 途中の変換がない
});

test('版を上げる前に、元の文字列をバックアップに残す', () => {
  const s = fakeStorage();
  const text = JSON.stringify({ version: 1, exercises: [{ id: 'e1' }] });
  s.setItem(STORAGE_KEY, text);
  const migrations = { 2: (d) => ({ ...d, note: 'v2' }) };
  const r = loadData(s, { migrations, currentVersion: 2 });
  assert.equal(r.recoveredKey, null);
  assert.equal(r.data.version, 2);
  assert.equal(r.data.note, 'v2');
  assert.equal(s.getItem(BACKUP_KEY_PREFIX + '1'), text);
  // 今の版のときはバックアップを作らない
  const s2 = fakeStorage();
  s2.setItem(STORAGE_KEY, text);
  loadData(s2);
  assert.deepEqual(keysWith(s2, BACKUP_KEY_PREFIX), []);
});

test('setItem が例外を投げたら { ok: false }', () => {
  const s = fakeStorage();
  s.setItem = () => { throw new Error('QuotaExceededError'); };
  const r = saveData(createEmptyData(), s);
  assert.equal(r.ok, false);
  assert.ok(r.error instanceof Error);
});

test('新しい版の記録があるときは、保存せずに { ok: false }', () => {
  const s = fakeStorage();
  const text = JSON.stringify({ version: CURRENT_VERSION + 1 });
  s.setItem(STORAGE_KEY, text);
  const r = saveData(createEmptyData(), s);
  assert.equal(r.ok, false);
  assert.ok(r.error instanceof Error);
  assert.equal(s.getItem(STORAGE_KEY), text);
  // 壊れた中身や同じ版のときは保存できる
  s.setItem(STORAGE_KEY, '{壊れた');
  assert.deepEqual(saveData(createEmptyData(), s), { ok: true });
});

test('localStorage の取り出しで例外が出ても saveData は { ok: false }', () => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('SecurityError'); },
  });
  try {
    assert.equal(saveData(createEmptyData()).ok, false);
    assert.throws(() => loadData());
  } finally {
    if (desc) Object.defineProperty(globalThis, 'localStorage', desc);
    else delete globalThis.localStorage;
  }
});

// navigator を差し替えて requestPersist を試す
async function withNavigator(value, fn) {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
  try {
    return await fn();
  } finally {
    if (desc) Object.defineProperty(globalThis, 'navigator', desc);
    else delete globalThis.navigator;
  }
}

test('requestPersist：使えない→null、例外→false、結果はそのまま', async () => {
  assert.equal(await withNavigator(undefined, requestPersist), null);
  assert.equal(await withNavigator({ storage: {} }, requestPersist), null);
  assert.equal(await withNavigator({ storage: { persist: async () => { throw new Error('x'); } } }, requestPersist), false);
  assert.equal(await withNavigator({ storage: { persist: () => { throw new Error('x'); } } }, requestPersist), false);
  assert.equal(await withNavigator({ storage: { persist: async () => true } }, requestPersist), true);
  assert.equal(await withNavigator({ storage: { persist: async () => false } }, requestPersist), false);
});

test('todayString は現地時間の YYYY-MM-DD', () => {
  assert.match(todayString(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(todayString(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('newId は毎回ちがう文字列', () => {
  const a = newId();
  assert.equal(typeof a, 'string');
  assert.notEqual(a, newId());
});

test('PARTS は決めた順番', () => {
  assert.deepEqual(PARTS.map((p) => p.id), ['chest', 'back', 'shoulders', 'arms', 'abs', 'legs']);
});
