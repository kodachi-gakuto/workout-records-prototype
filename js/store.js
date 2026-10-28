// 記録の保存（localStorage に1つの JSON で入れる）
// import しただけでは localStorage にさわらない。storage は引数で差し替えられる。

export const STORAGE_KEY = 'wrp:data'; // 今後変えない
export const BROKEN_KEY_PREFIX = 'wrp:data:broken:';
export const BACKUP_KEY_PREFIX = 'wrp:data:backup:v';
export const CURRENT_VERSION = 1;
export const DEFAULT_REST_SEC = 120;

export const PARTS = [
  { id: 'chest', label: '胸' },
  { id: 'back', label: '背中' },
  { id: 'shoulders', label: '肩' },
  { id: 'arms', label: '腕' },
  { id: 'abs', label: '腹筋' },
  { id: 'legs', label: '脚' },
];

export function createEmptyData() {
  return {
    version: CURRENT_VERSION,
    exercises: [],
    workouts: [],
    timer: null,
    flags: { timerHintShown: false },
  };
}

// MIGRATIONS[n]：版 n-1 のデータを版 n に直す関数
// v2 を足すときは MIGRATIONS[2] = (v1) => v2 を1つ足し、CURRENT_VERSION を 2 にする
export const MIGRATIONS = {};

const isPlainObject = (v) =>
  v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

// 読める形：プレーンなオブジェクトで、version が 1 以上の整数
const hasValidVersion = (raw) =>
  isPlainObject(raw) && Number.isInteger(raw.version) && raw.version >= 1;

// version が 1 以上の整数のデータを、今の版まで順に直す
export function migrate(raw, migrations = MIGRATIONS, currentVersion = CURRENT_VERSION) {
  if (!hasValidVersion(raw)) throw new Error('データの形が正しくありません');
  if (raw.version > currentVersion) {
    // 新しい版で保存されたデータ。上書きして壊さないように止める
    throw new Error(`データの版 ${raw.version} はこの版（${currentVersion}）より新しいため読めません`);
  }
  let data = raw;
  for (let v = raw.version + 1; v <= currentVersion; v += 1) {
    const step = migrations[v];
    if (!step) throw new Error(`版 ${v - 1} から ${v} への変換がありません`);
    data = { ...step(data), version: v };
  }
  return data;
}

// 今の版の中身の形をそろえる。足りない所は既定値で補い、補えない形なら null
export function normalize(data) {
  if (!isPlainObject(data)) return null;
  const exercises = data.exercises ?? [];
  const workouts = data.workouts ?? [];
  const timer = data.timer ?? null;
  const flags = data.flags ?? {};
  if (!Array.isArray(exercises) || !Array.isArray(workouts)) return null;
  if (timer !== null && !isPlainObject(timer)) return null;
  if (!isPlainObject(flags)) return null;
  return {
    ...data,
    exercises,
    workouts,
    timer,
    flags: { ...flags, timerHintShown: flags.timerHintShown ?? false },
  };
}

// 読めない中身を消さずに別のキーへ退避する。退避に失敗したら例外のまま（wrp:data は変えない）
function stash(storage, text) {
  const base = BROKEN_KEY_PREFIX + Date.now();
  let key = base;
  for (let n = 2; storage.getItem(key) !== null; n += 1) key = `${base}-${n}`; // 同じ時刻の退避を上書きしない
  storage.setItem(key, text);
  return key;
}

// 戻り値：{ data, recoveredKey }。退避したときだけ recoveredKey に退避先のキーが入る
// 2つめの引数はテスト用（変換の表と今の版を差し替える）
export function loadData(storage, { migrations = MIGRATIONS, currentVersion = CURRENT_VERSION } = {}) {
  const s = storage ?? globalThis.localStorage;
  const text = s.getItem(STORAGE_KEY);
  if (text === null) return { data: createEmptyData(), recoveredKey: null };

  // 退避できたら、その場で空のデータを書く（次に読んだときに、また退避しないように）
  const recover = () => {
    const recoveredKey = stash(s, text);
    const data = createEmptyData();
    try {
      s.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // 書けなくても、退避はできているので続ける
    }
    return { data, recoveredKey };
  };

  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return recover();
  }
  if (!hasValidVersion(raw)) return recover();
  if (raw.version < currentVersion) {
    // 版を上げる前に、元の文字列を残す
    s.setItem(BACKUP_KEY_PREFIX + raw.version, text);
  }
  // 新しすぎる版は migrate がエラーを投げる（wrp:data は変えない）
  const data = normalize(migrate(raw, migrations, currentVersion));
  if (data === null) return recover();
  return { data, recoveredKey: null };
}

export function saveData(data, storage) {
  try {
    const s = storage ?? globalThis.localStorage;
    const saved = s.getItem(STORAGE_KEY);
    if (saved !== null) {
      let raw;
      let parsed = true;
      try {
        raw = JSON.parse(saved);
      } catch {
        parsed = false;
      }
      // 新しい版で保存された記録を、古い版で上書きしない
      if (parsed && hasValidVersion(raw) && raw.version > CURRENT_VERSION) {
        return { ok: false, error: new Error(`保存済みのデータの版 ${raw.version} がこの版より新しいため保存しません`) };
      }
      // 読める版でない中身（壊れた JSON・版なし・形がおかしい）は、上書きの前に退避する
      const readable = parsed && hasValidVersion(raw)
        && (raw.version < CURRENT_VERSION || normalize(raw) !== null);
      if (!readable) stash(s, saved);
    }
    s.setItem(STORAGE_KEY, JSON.stringify(data));
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

export async function requestPersist() {
  try {
    if (typeof globalThis.navigator?.storage?.persist !== 'function') return null;
    return await globalThis.navigator.storage.persist();
  } catch {
    return false;
  }
}

export function newId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function todayString(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
