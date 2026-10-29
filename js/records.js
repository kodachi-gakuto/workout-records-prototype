// 記録の読み書き（画面とは分ける）
// 書く関数は data を受けて、新しい data を返す（受けた data は変えない）。
// 保存された1件ずつの形は確かめていないので、形のおかしい種目・記録・セットは、表示と計算では飛ばす。
// 書くときは、形のおかしいものも消さずにそのまま残す（あとで直せるように）。
// セットの index は「形の正しいセットだけを数えた番号」（画面の行の番号と同じ）。

import { DEFAULT_REST_SEC, PARTS, newId, todayString } from './store.js';

export const KINDS = ['kg', 'bodyweight', 'assist'];

const isPlainObject = (v) =>
  v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v) => v === null || v === undefined || isNum(v);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidExercise(e) {
  return isPlainObject(e) && typeof e.id === 'string' && typeof e.name === 'string';
}

export function isValidSet(s) {
  return isPlainObject(s) && KINDS.includes(s.kind)
    && isNumOrNull(s.weight) && isNumOrNull(s.reps) && isNumOrNull(s.assistedReps);
}

export function isValidWorkout(w) {
  return isPlainObject(w) && typeof w.id === 'string' && typeof w.exerciseId === 'string'
    && typeof w.date === 'string' && DATE_RE.test(w.date) && Array.isArray(w.sets);
}

// 形のそろったセットにする（undefined は null にそろえる）
const tidySet = (s) => ({
  kind: s.kind,
  weight: isNum(s.weight) ? s.weight : null,
  reps: isNum(s.reps) ? s.reps : null,
  assistedReps: isNum(s.assistedReps) ? s.assistedReps : null,
});

// 表示・計算用：形の正しいセットだけを、形をそろえて返す（保存の中身は変えない）
export function cleanSets(sets) {
  return Array.isArray(sets) ? sets.filter(isValidSet).map(tidySet) : [];
}

export function emptySet(kind = 'kg') {
  return { kind: KINDS.includes(kind) ? kind : 'kg', weight: null, reps: null, assistedReps: null };
}

// 重さも回数もないセット（数えない）。形のおかしいセットも true
export function isEmptySet(s) {
  return !isValidSet(s) || (!isNum(s.weight) && !isNum(s.reps) && !isNum(s.assistedReps));
}

// 形が正しくて、重さも回数もないセット（画面を離れるときに取り除くもの）
const isBlankSet = (s) => isValidSet(s) && isEmptySet(s);

const exercisesOf = (data) => (Array.isArray(data?.exercises) ? data.exercises : []);
const workoutsOf = (data) => (Array.isArray(data?.workouts) ? data.workouts : []);

export function listExercises(data) {
  return exercisesOf(data).filter(isValidExercise);
}

export function findExercise(data, exerciseId) {
  return listExercises(data).find((e) => e.id === exerciseId) ?? null;
}

// 戻り値：{ data, exercise }
export function addExercise(data, { name, part = null, restSec = DEFAULT_REST_SEC, id = newId(), now = new Date() }) {
  const exercise = { id, name, part, restSec, createdAt: now.toISOString() };
  return { data: { ...data, exercises: [...exercisesOf(data), exercise] }, exercise };
}

// ---- 種目の登録・編集・削除 ----

export const NAME_MAX = 25;

export const isPart = (id) => PARTS.some((p) => p.id === id);

// 打っている名前を25文字で切る（前後の空白はまだ取らない）。絵文字をこわさないよう、文字ごとに数える
export const cutName = (text) => Array.from(String(text ?? '')).slice(0, NAME_MAX).join('');

// 保存する名前：前後の空白を取り、25文字で切る
export const tidyName = (text) => cutName(String(text ?? '').trim()).trim();

// 整えたあとで同じ名前の種目があるか（exceptId の種目は除く）
export function hasSameName(data, name, exceptId = null) {
  const n = tidyName(name);
  return listExercises(data).some((e) => e.id !== exceptId && e.name === n);
}

// 名前と部位を書きかえる（ほかの項目はそのまま）
export function updateExercise(data, exerciseId, { name, part }) {
  return {
    ...data,
    exercises: exercisesOf(data).map((e) => (isValidExercise(e) && e.id === exerciseId ? { ...e, name, part } : e)),
  };
}

// 種目と、その種目の記録をすべて消す。タイマーがその種目を指していたら null にする
export function deleteExercise(data, exerciseId) {
  const next = {
    ...data,
    exercises: exercisesOf(data).filter((e) => !(isValidExercise(e) && e.id === exerciseId)),
    workouts: workoutsOf(data).filter((w) => !(isPlainObject(w) && w.exerciseId === exerciseId)),
  };
  if (isPlainObject(data?.timer) && data.timer.exerciseId === exerciseId) next.timer = null;
  return next;
}

// 今日の記録の、空でないセットの数
export function todaySetCount(data, exerciseId, today = todayString()) {
  const w = findTodayWorkout(data, exerciseId, today);
  return w ? cleanSets(w.sets).filter((s) => !isEmptySet(s)).length : 0;
}

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// 部位ごとの種目：[{ id, label, exercises }]。PARTS の順で、部位が PARTS にない種目は最後に「部位なし」（id は null）
// 並び（前回やった順）：今日より前で、その部位の種目を最後に記録した日の種目を、その日の startedAt の順に上から。
// その日にやっていない種目は、その下に登録した順（createdAt の順）。今日の記録と、空のセットしかない記録は数えない
export function exercisesByPart(data, today = todayString()) {
  // 種目ごとに、日付 → その日のいちばん早い startedAt
  const done = new Map();
  for (const w of workoutsOf(data)) {
    if (!isValidWorkout(w) || !(w.date < today)) continue;
    if (cleanSets(w.sets).every(isEmptySet)) continue;
    const days = done.get(w.exerciseId) ?? new Map();
    const at = String(w.startedAt ?? '');
    if (!days.has(w.date) || at < days.get(w.date)) days.set(w.date, at);
    done.set(w.exerciseId, days);
  }
  const order = (list) => {
    const byCreated = [...list].sort((a, b) => byText(String(a.createdAt ?? ''), String(b.createdAt ?? '')));
    let last = null;
    for (const e of list) {
      for (const date of done.get(e.id)?.keys() ?? []) if (last === null || date > last) last = date;
    }
    if (last === null) return byCreated;
    const startedAt = (e) => done.get(e.id)?.get(last);
    const did = byCreated.filter((e) => startedAt(e) !== undefined).sort((a, b) => byText(startedAt(a), startedAt(b)));
    return [...did, ...byCreated.filter((e) => startedAt(e) === undefined)];
  };
  const all = listExercises(data);
  const groups = PARTS.map((p) => ({ id: p.id, label: p.label, exercises: order(all.filter((e) => e.part === p.id)) }));
  const other = all.filter((e) => !isPart(e.part));
  if (other.length) groups.push({ id: null, label: '部位なし', exercises: order(other) });
  return groups;
}

export function findTodayWorkout(data, exerciseId, today = todayString()) {
  return workoutsOf(data).find((w) => isValidWorkout(w) && w.exerciseId === exerciseId && w.date === today) ?? null;
}

// 今日の記録を探し、なければ作る。sets は作るときだけ使う。戻り値：{ data, workout }
export function ensureTodayWorkout(data, exerciseId, { today = todayString(), sets = [], id = newId(), now = new Date() } = {}) {
  const found = findTodayWorkout(data, exerciseId, today);
  if (found) return { data, workout: found };
  const workout = { id, exerciseId, date: today, startedAt: now.toISOString(), sets: cleanSets(sets) };
  return { data: { ...data, workouts: [...workoutsOf(data), workout] }, workout };
}

// workoutId の記録の、保存されたままのセットの配列を fn で書きかえる
function mapRawSets(data, workoutId, fn) {
  return {
    ...data,
    workouts: workoutsOf(data).map((w) =>
      isValidWorkout(w) && w.id === workoutId ? { ...w, sets: fn(w.sets) } : w),
  };
}

// 形の正しいセットだけを数えた index を、保存された配列の位置に直す（ないときは -1）
function rawIndex(raw, index) {
  let n = -1;
  for (let i = 0; i < raw.length; i += 1) {
    if (isValidSet(raw[i])) {
      n += 1;
      if (n === index) return i;
    }
  }
  return -1;
}

export function updateSet(data, workoutId, index, patch) {
  return mapRawSets(data, workoutId, (raw) => {
    const at = rawIndex(raw, index);
    return at === -1 ? raw : raw.map((s, i) => (i === at ? tidySet({ ...s, ...patch }) : s));
  });
}

export function addSet(data, workoutId, set = emptySet()) {
  return mapRawSets(data, workoutId, (raw) => [...raw, tidySet(set)]);
}

// 元に戻す用：index の位置（形の正しいセットで数えた位置）に入れる
export function insertSet(data, workoutId, index, set) {
  return mapRawSets(data, workoutId, (raw) => {
    const at = rawIndex(raw, index);
    const next = [...raw];
    next.splice(at === -1 ? next.length : at, 0, tidySet(set));
    return next;
  });
}

export function removeSet(data, workoutId, index) {
  return mapRawSets(data, workoutId, (raw) => {
    const at = rawIndex(raw, index);
    return at === -1 ? raw : raw.filter((_, i) => i !== at);
  });
}

// 空のセット（形が正しくて、重さも回数もないもの）を取り除く。形のおかしいセットは残す。
// 保存された配列が空になった記録は、記録ごと取り除く
export function removeEmptySets(data, workoutId) {
  const cleaned = mapRawSets(data, workoutId, (raw) => raw.filter((s) => !isBlankSet(s)));
  return {
    ...cleaned,
    workouts: cleaned.workouts.filter((w) => !(isValidWorkout(w) && w.id === workoutId && w.sets.length === 0)),
  };
}

// 前回：今日より前の日付で、空でないセットがある最新の記録。sets は空でないものだけ
export function previousWorkout(data, exerciseId, today = todayString()) {
  let best = null;
  for (const w of workoutsOf(data)) {
    if (!isValidWorkout(w) || w.exerciseId !== exerciseId || !(w.date < today)) continue;
    const sets = cleanSets(w.sets).filter((s) => !isEmptySet(s));
    if (sets.length === 0) continue;
    const later = !best || w.date > best.date
      || (w.date === best.date && String(w.startedAt ?? '') > String(best.startedAt ?? ''));
    if (later) best = { ...w, sets };
  }
  return best;
}

// 歴代の最高（仮）：すべての日の kind "kg" のセットの重さの最大。なければ null
export function bestWeight(data, exerciseId) {
  let max = null;
  for (const w of workoutsOf(data)) {
    if (!isValidWorkout(w) || w.exerciseId !== exerciseId) continue;
    for (const s of cleanSets(w.sets)) {
      if (s.kind === 'kg' && isNum(s.weight) && s.weight > 0 && (max === null || s.weight > max)) max = s.weight;
    }
  }
  return max;
}

// ---- 入力の文字と数字 ----

// 打った文字を、欄に入れてよい形にする（重さは小数1つまで、回数は整数）
export function sanitizeInput(text, { decimal }) {
  let t = String(text ?? '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (decimal) {
    t = t.replace(/[,，．]/g, '.').replace(/[^\d.]/g, '');
    const dot = t.indexOf('.');
    if (dot !== -1) t = t.slice(0, dot + 1) + t.slice(dot + 1).replace(/\./g, '').slice(0, 2);
    const [int, frac] = t.split('.');
    t = int.slice(0, 4) + (frac !== undefined ? '.' + frac : '');
  } else {
    t = t.replace(/\D/g, '').slice(0, 3);
  }
  return t;
}

export function parseNumber(text) {
  if (text === '' || text === '.') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export const numText = (n) => (isNum(n) ? String(n) : '');

// ---- 表示の文字 ----
// parts：[{ text, unit?, extra?, tight?, caret? }] の配列。画面ではこれを数字と小さい単位に分けて出す。
// 大きい文字では part ごとに折り返す。tight は前の part との間を空けない。caret は text のうしろに打つ位置の印を出す

export function weightParts(s) {
  if (!isValidSet(s)) return null;
  const w = isNum(s.weight) ? String(s.weight) : null;
  if (s.kind === 'bodyweight') return w ? [{ text: '自重' }, { text: '+' + w, unit: 'kg', tight: true }] : [{ text: '自重' }];
  if (s.kind === 'assist') return w ? [{ text: '補助' }, { text: w, unit: 'kg' }] : [{ text: '補助' }];
  return w ? [{ text: w, unit: 'kg' }] : null;
}

export function repsParts(s) {
  if (!isValidSet(s)) return null;
  const parts = [];
  if (isNum(s.reps)) parts.push({ text: String(s.reps), unit: '回' });
  if (isNum(s.assistedReps)) parts.push(assistedPart(s.assistedReps));
  return parts.length ? parts : null;
}

// 手伝ってもらった回数（reps のうちの数。10回 補助1 ＝ 10回のうち最後の1回は手伝ってもらった）
const assistedPart = (n) => ({ text: '（補助' + n + '）', extra: true, tight: true });

// 手伝ってもらった回数を1つ増やせるか。reps に数があれば reps まで。reps が空なら増やせる
export function canAddAssist(s) {
  if (!isValidSet(s)) return false;
  return !isNum(s.reps) || (s.assistedReps ?? 0) < s.reps;
}

// 打っている間の欄の文字。text は input に打っている文字（"10." のような途中の形もそのまま出す）
// field：'w'（重さ）／'r'（回数）
export function editParts(s, field, text) {
  if (!isValidSet(s)) return null;
  if (field === 'r') {
    const parts = [{ text, unit: '回', caret: true }];
    if (isNum(s.assistedReps)) parts.push(assistedPart(s.assistedReps));
    return parts;
  }
  if (s.kind === 'bodyweight') {
    return [{ text: '自重' }, text ? { text: '+' + text, unit: 'kg', tight: true, caret: true } : { text: '', tight: true, caret: true }];
  }
  if (s.kind === 'assist') return [{ text: '補助' }, { text, unit: 'kg', caret: true }];
  return [{ text, unit: 'kg', caret: true }];
}

export const partsText = (parts) =>
  (parts ?? []).map((p, i) => (i > 0 && !p.tight ? ' ' : '') + p.text + (p.unit ?? '')).join('');

// "2026-10-19" → "10/19"
export function shortDate(date) {
  const m = DATE_RE.test(date ?? '') ? date.split('-') : null;
  return m ? `${Number(m[1])}/${Number(m[2])}` : '';
}

export function mmss(sec) {
  const s = isNum(sec) && sec > 0 ? Math.round(sec) : DEFAULT_REST_SEC;
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
