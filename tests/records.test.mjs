import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyData } from '../js/store.js';
import {
  addExercise, findExercise, listExercises, findTodayWorkout, ensureTodayWorkout,
  updateSet, addSet, insertSet, removeSet, removeEmptySets, previousWorkout, bestWeight,
  emptySet, isEmptySet, cleanSets, sanitizeInput, parseNumber, weightParts, repsParts, editParts, partsText, canAddAssist,
  shortDate, mmss, elapsedText, NAME_MAX, cutName, tidyName, hasSameName, updateExercise, deleteExercise,
  todaySetCount, exercisesByPart, addDays, partBalance, todayExercises, dateLabel, exerciseHistory,
  firstMissing, FIELD_INPUT,
} from '../js/records.js';
import { partsHtml } from '../js/ui.js';

const TODAY = '2026-10-28';
const set = (weight, reps, kind = 'kg', assistedReps = null) => ({ kind, weight, reps, assistedReps });

function withExercise() {
  const { data, exercise } = addExercise(createEmptyData(), { name: 'ベンチプレス', part: 'chest', id: 'e1', now: new Date(0) });
  return { data, ex: exercise };
}

function workout(id, date, sets, exerciseId = 'e1', startedAt = date + 'T10:00:00.000Z') {
  return { id, exerciseId, date, startedAt, sets };
}

test('種目を足す（元の data は変えない）', () => {
  const before = createEmptyData();
  const { data, exercise } = addExercise(before, { name: 'スクワット', part: 'legs', id: 'x' });
  assert.equal(before.exercises.length, 0);
  assert.deepEqual(data.exercises, [exercise]);
  assert.equal(exercise.restSec, 120);
  assert.equal(findExercise(data, 'x').name, 'スクワット');
  assert.equal(findExercise(data, 'nope'), null);
});

test('形のおかしい種目は飛ばす', () => {
  const data = { ...createEmptyData(), exercises: [null, 5, { id: 1, name: 'a' }, { id: 'ok', name: 'b' }] };
  assert.deepEqual(listExercises(data).map((e) => e.id), ['ok']);
});

test('今日の記録を探す・作る', () => {
  const { data } = withExercise();
  assert.equal(findTodayWorkout(data, 'e1', TODAY), null);
  const r = ensureTodayWorkout(data, 'e1', { today: TODAY, sets: [set(60, 10)], id: 'w1' });
  assert.equal(data.workouts.length, 0);
  assert.equal(r.workout.date, TODAY);
  assert.deepEqual(r.workout.sets, [set(60, 10)]);
  assert.equal(findTodayWorkout(r.data, 'e1', TODAY).id, 'w1');
  // もうあるときは作らない
  const again = ensureTodayWorkout(r.data, 'e1', { today: TODAY, id: 'w2' });
  assert.equal(again.data, r.data);
  assert.equal(again.workout.id, 'w1');
  // ほかの日・ほかの種目は今日の記録ではない
  assert.equal(findTodayWorkout(r.data, 'e1', '2026-10-27'), null);
  assert.equal(findTodayWorkout(r.data, 'e2', TODAY), null);
});

test('セットの更新・追加・削除・元に戻す', () => {
  const { data } = withExercise();
  let d = ensureTodayWorkout(data, 'e1', { today: TODAY, sets: [set(60, 10)], id: 'w1' }).data;
  const before = d;
  d = updateSet(d, 'w1', 0, { reps: 8 });
  assert.deepEqual(before.workouts[0].sets, [set(60, 10)]); // 元は変えない
  d = addSet(d, 'w1', emptySet());
  d = updateSet(d, 'w1', 1, { kind: 'bodyweight', weight: null, reps: 12 });
  d = addSet(d, 'w1', set(20, 6, 'assist', 2));
  const sets = () => findTodayWorkout(d, 'e1', TODAY).sets;
  assert.deepEqual(sets(), [set(60, 8), set(null, 12, 'bodyweight'), set(20, 6, 'assist', 2)]);
  const removed = sets()[1];
  d = removeSet(d, 'w1', 1);
  assert.equal(sets().length, 2);
  d = insertSet(d, 'w1', 1, removed);
  assert.deepEqual(sets()[1], removed);
  // ほかの記録は変えない
  const other = workout('w9', '2026-10-01', [set(1, 1)]);
  d = { ...d, workouts: [...d.workouts, other] };
  d = updateSet(d, 'w1', 0, { weight: 70 });
  assert.equal(d.workouts.find((w) => w.id === 'w9'), other);
});

test('空のセットを取り除き、空になった記録は記録ごと取り除く', () => {
  let d = { ...createEmptyData(), workouts: [workout('w1', TODAY, [set(60, 10), emptySet(), emptySet('bodyweight')])] };
  d = removeEmptySets(d, 'w1');
  assert.deepEqual(d.workouts[0].sets, [set(60, 10)]);
  d = { ...createEmptyData(), workouts: [workout('w1', TODAY, [emptySet()]), workout('w2', TODAY, [], 'e2')] };
  d = removeEmptySets(d, 'w1');
  assert.deepEqual(d.workouts.map((w) => w.id), ['w2']);
  assert.equal(isEmptySet(set(null, null, 'kg', 2)), false);
  assert.equal(isEmptySet(null), true);
});

test('前回：今日より前で、空でないセットがある最新の記録', () => {
  const d = {
    ...createEmptyData(),
    workouts: [
      workout('a', '2026-10-15', [set(55, 10)]),
      workout('b', '2026-10-19', [set(60, 10), emptySet(), set(57.5, 8)]),
      workout('c', '2026-10-21', [emptySet()]), // 空のセットだけ
      workout('d', '2026-10-22', [set(100, 1)], 'e2'), // ほかの種目
      workout('t', TODAY, [set(70, 5)]), // 今日
    ],
  };
  const p = previousWorkout(d, 'e1', TODAY);
  assert.equal(p.id, 'b');
  assert.deepEqual(p.sets, [set(60, 10), set(57.5, 8)]);
  assert.equal(previousWorkout(d, 'e1', '2026-10-15'), null);
  assert.equal(previousWorkout(createEmptyData(), 'e1', TODAY), null);
});

test('歴代の最高：kind "kg" の重さの最大。自重・補助は数えない', () => {
  const d = {
    ...createEmptyData(),
    workouts: [
      workout('a', '2026-10-15', [set(62.5, 5), set(200, 5, 'bodyweight')]),
      workout('b', TODAY, [set(60, 10), set(300, 5, 'assist')]),
      workout('c', TODAY, [set(500, 1)], 'e2'),
    ],
  };
  assert.equal(bestWeight(d, 'e1'), 62.5);
  assert.equal(bestWeight(createEmptyData(), 'e1'), null);
  assert.equal(bestWeight({ ...createEmptyData(), workouts: [workout('a', TODAY, [set(10, 5, 'bodyweight')])] }, 'e1'), null);
});

test('歴代の最高：重さ > 0 かつ回数 > 0 のセットだけ数える', () => {
  const d = {
    ...createEmptyData(),
    workouts: [
      workout('a', '2026-10-15', [set(100, null), set(90, 0), set(0, 5), set(70, 0.5)]),
      workout('b', TODAY, [set(120, null)]),
    ],
  };
  assert.equal(bestWeight(d, 'e1'), 70);
  assert.equal(bestWeight({ ...createEmptyData(), workouts: [workout('a', TODAY, [set(100, null)])] }, 'e1'), null);
});

test('種目の履歴：回数のないセットは 🏆・↑ に数えない', () => {
  const d = {
    ...createEmptyData(),
    workouts: [
      workout('1', '2026-10-10', [set(60, 8)]),
      workout('2', '2026-10-12', [set(100, null), set(62.5, 5)]), // 100kg は回数なし：62.5 で比べる
      workout('3', '2026-10-14', [set(90, 0)]), // 回数 0：kg の回にならない
      workout('4', '2026-10-16', [set(65, 3)]), // 直前の kg の回は 2（62.5）
    ],
  };
  const h = Object.fromEntries(exerciseHistory(d, 'e1', TODAY).map((w) => [w.id, [w.best, w.up]]));
  assert.deepEqual(h, { 1: [false, null], 2: [true, 2.5], 3: [false, null], 4: [true, 2.5] });
});

test('空でないのに欠けているセット：回数が空、kg・補助で重さが空。自重は重さなしでよい', () => {
  assert.equal(firstMissing([]), null);
  assert.equal(firstMissing([emptySet(), set(60, 10), set(null, 10, 'bodyweight')]), null);
  assert.deepEqual(firstMissing([set(60, 10), set(60, null)]), { index: 1, field: 'r', more: false });
  assert.deepEqual(firstMissing([set(null, 10, 'assist')]), { index: 0, field: 'w', more: false });
  assert.deepEqual(firstMissing([set(null, 10), set(60, null)]), { index: 0, field: 'w', more: true });
  // 補助の回数だけのセット：重さ → 回数の順
  assert.deepEqual(firstMissing([set(null, null, 'kg', 1)]), { index: 0, field: 'w', more: true });
  assert.deepEqual(firstMissing([set(5, null, 'bodyweight')]), { index: 0, field: 'r', more: false });
  // 形のおかしいセットは飛ばす（index は形の正しいセットで数える）
  assert.deepEqual(firstMissing([null, set(60, null)]), { index: 0, field: 'r', more: false });
});

test('種目の履歴：今日より前を新しい順に。空のセット・空の記録・ほかの種目は出さない', () => {
  const d = {
    ...createEmptyData(),
    workouts: [
      workout('b', '2026-10-19', [set(60, 10), emptySet(), set(57.5, 8)]),
      workout('a', '2026-10-15', [set(55, 10)]),
      workout('c', '2026-10-21', [emptySet()]), // 空のセットだけ
      workout('d', '2026-10-22', [set(100, 1)], 'e2'), // ほかの種目
      workout('t', TODAY, [set(70, 5)]), // 今日
      workout('f', '2026-10-29', [set(90, 5)]), // 今日より後
      null,
    ],
  };
  const h = exerciseHistory(d, 'e1', TODAY);
  assert.deepEqual(h.map((w) => w.id), ['b', 'a']);
  assert.deepEqual(h[0].sets, [set(60, 10), set(57.5, 8)]);
  assert.equal(h[0].date, '2026-10-19');
  assert.deepEqual(exerciseHistory(createEmptyData(), 'e1', TODAY), []);
  assert.doesNotThrow(() => exerciseHistory({ workouts: null }, 'e1', TODAY));
});

test('種目の履歴：同じ日に2つあれば startedAt の新しいほうが上', () => {
  const d = {
    ...createEmptyData(),
    workouts: [
      workout('late', '2026-10-20', [set(60, 5)], 'e1', '2026-10-20T18:00:00.000Z'),
      workout('early', '2026-10-20', [set(50, 5)], 'e1', '2026-10-20T08:00:00.000Z'),
      workout('old', '2026-10-18', [set(40, 5)]),
    ],
  };
  assert.deepEqual(exerciseHistory(d, 'e1', TODAY).map((w) => w.id), ['late', 'early', 'old']);
});

test('種目の履歴：🏆 は前の全部の回の kg の最大を超えた回。↑ は直前の kg の回より重い分', () => {
  const d = {
    ...createEmptyData(),
    workouts: [
      workout('1', '2026-10-10', [set(77.5, 8)]), // 最初の回：どちらも付けない
      workout('2', '2026-10-12', [set(80, 8), set(70, 10)]), // 🏆 ↑2.5
      workout('3', '2026-10-14', [set(75, 8)]), // 下がった：なし
      workout('4', '2026-10-16', [set(10, 8, 'bodyweight')]), // kg のセットがない：なし（比べる相手にもならない）
      workout('5', '2026-10-18', [set(78, 8)]), // 直前の kg の回（75）より重いが最高（80）は超えない：↑3 だけ
      workout('6', '2026-10-20', [set(78, 8)]), // 同じ：なし
      workout('7', '2026-10-22', [set(80.1, 3), set(500, 1, 'assist')]), // 🏆 ↑2.1（補助は数えない）
      workout('8', '2026-10-24', [set(60.1, 3)]), // 下がった
      workout('9', '2026-10-26', [set(60.2, 3)]), // ↑0.1（浮動小数の誤差が出ない）
    ],
  };
  const h = Object.fromEntries(exerciseHistory(d, 'e1', TODAY).map((w) => [w.id, [w.best, w.up]]));
  assert.deepEqual(h, {
    1: [false, null],
    2: [true, 2.5],
    3: [false, null],
    4: [false, null],
    5: [false, 3],
    6: [false, null],
    7: [true, 2.1],
    8: [false, null],
    9: [false, 0.1],
  });
});

test('種目の履歴：前に kg の記録がない最初の kg の回には 🏆・↑ を付けない', () => {
  const d = {
    ...createEmptyData(),
    workouts: [
      workout('bw', '2026-10-10', [set(null, 10, 'bodyweight')]),
      workout('k1', '2026-10-12', [set(0, 10), set(40, 10)]), // 0kg は数えない。kg の最初の回
      workout('k2', '2026-10-14', [set(42.5, 10)]),
    ],
  };
  const h = exerciseHistory(d, 'e1', TODAY);
  assert.deepEqual(h.map((w) => [w.id, w.best, w.up]), [['k2', true, 2.5], ['k1', false, null], ['bw', false, null]]);
});

test('形のおかしい記録・セットは飛ばして落ちない', () => {
  const d = {
    ...createEmptyData(),
    workouts: [
      null, 'x', { id: 'n' }, { id: 'bad', exerciseId: 'e1', date: 'きのう', sets: [] },
      workout('a', '2026-10-15', [null, { kind: 'lbs', weight: 1 }, { kind: 'kg', weight: '60' }, set(50, 5), set(80, 1)]),
      workout('t', TODAY, [null, set(40, 10)]),
    ],
  };
  assert.equal(bestWeight(d, 'e1'), 80);
  assert.deepEqual(previousWorkout(d, 'e1', TODAY).sets, [set(50, 5), set(80, 1)]);
  assert.equal(findTodayWorkout(d, 'e1', TODAY).id, 't');
  // 書くときも、形のおかしいセットは消さずに残す（index は形の正しいセットで数える）
  let d2 = updateSet(d, 't', 0, { reps: 12 });
  assert.deepEqual(findTodayWorkout(d2, 'e1', TODAY).sets, [null, set(40, 12)]);
  d2 = insertSet(d2, 't', 0, set(30, 5));
  assert.deepEqual(findTodayWorkout(d2, 'e1', TODAY).sets, [null, set(30, 5), set(40, 12)]);
  d2 = removeSet(d2, 't', 1);
  assert.deepEqual(findTodayWorkout(d2, 'e1', TODAY).sets, [null, set(30, 5)]);
  d2 = addSet(d2, 't', emptySet());
  d2 = removeEmptySets(d2, 't');
  assert.deepEqual(findTodayWorkout(d2, 'e1', TODAY).sets, [null, set(30, 5)]);
  // 形のおかしいセットだけが残った記録は、記録ごと消さない
  d2 = removeEmptySets(removeSet(d2, 't', 0), 't');
  assert.deepEqual(findTodayWorkout(d2, 'e1', TODAY).sets, [null]);
  assert.equal(updateSet(d2, 't', 5, { reps: 1 }).workouts.find((w) => w?.id === 't').sets.length, 1);
  assert.deepEqual(cleanSets('x'), []);
  assert.deepEqual(cleanSets([{ kind: 'kg' }]), [set(null, null)]);
  assert.doesNotThrow(() => previousWorkout({ workouts: null }, 'e1', TODAY));
  assert.doesNotThrow(() => removeEmptySets(d, 'zzz'));
});

test('入力の文字を整える', () => {
  assert.equal(sanitizeInput('60.55', { decimal: true }), '60.55');
  assert.equal(sanitizeInput('60.5.5', { decimal: true }), '60.55');
  assert.equal(sanitizeInput('60,5', { decimal: true }), '60.5');
  assert.equal(sanitizeInput('６０kg', { decimal: true }), '60');
  assert.equal(sanitizeInput('123456', { decimal: true }), '1234');
  assert.equal(sanitizeInput('1.234', { decimal: true }), '1.23');
  assert.equal(sanitizeInput('1.5', { decimal: false }), '15');
  assert.equal(sanitizeInput('12345', { decimal: false }), '123');
  // 回数：3けた・小数1けたまで
  assert.equal(sanitizeInput('8.5', FIELD_INPUT.r), '8.5');
  assert.equal(sanitizeInput('8.55', FIELD_INPUT.r), '8.5');
  assert.equal(sanitizeInput('1234', FIELD_INPUT.r), '123');
  assert.equal(sanitizeInput('１０，５', FIELD_INPUT.r), '10.5');
  assert.equal(sanitizeInput('60.55', FIELD_INPUT.w), '60.55');
  assert.equal(sanitizeInput('123456', FIELD_INPUT.w), '1234');
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('.'), null);
  assert.equal(parseNumber('60.'), 60);
  assert.equal(parseNumber('62.5'), 62.5);
});

test('表示の文字', () => {
  assert.equal(partsText(weightParts(set(60, 10))), '60kg');
  assert.equal(weightParts(set(null, 10)), null);
  assert.equal(partsText(weightParts(set(null, 10, 'bodyweight'))), '自重');
  assert.equal(partsText(weightParts(set(10, 10, 'bodyweight'))), '自重+10kg');
  assert.equal(partsText(weightParts(set(20, 10, 'assist'))), '補助 20kg');
  assert.equal(partsText(repsParts(set(60, 10))), '10回');
  assert.equal(partsText(repsParts(set(60, 10, 'kg', 1))), '10回（補助1）');
  assert.equal(partsText(repsParts(set(60, null, 'kg', 2))), '（補助2）');
  assert.equal(repsParts(set(60, null)), null);
  assert.equal(partsText(repsParts(set(60, 8.5, 'kg', 2))), '8.5回（補助2）');
  assert.equal(shortDate('2026-10-19'), '10/19');
  assert.equal(shortDate('x'), '');
  assert.equal(mmss(120), '2:00');
  assert.equal(mmss(90), '1:30');
  assert.equal(mmss(undefined), '2:00');
});

test('打っている間の欄の文字：打った文字に「自重」「kg」「回」「（補助N）」を添える', () => {
  assert.equal(partsText(editParts(set(null, null, 'bodyweight'), 'w', '')), '自重');
  assert.equal(partsText(editParts(set(10, null, 'bodyweight'), 'w', '10')), '自重+10kg');
  assert.equal(partsText(editParts(set(null, null, 'bodyweight'), 'w', '2.')), '自重+2.kg');
  assert.equal(partsText(editParts(set(60, null), 'w', '60')), '60kg');
  assert.equal(partsText(editParts(set(null, null), 'w', '')), 'kg');
  assert.equal(partsText(editParts(set(20, null, 'assist'), 'w', '20')), '補助 20kg');
  assert.equal(partsText(editParts(set(60, 10, 'kg', 1), 'r', '10')), '10回（補助1）');
  assert.equal(partsText(editParts(set(60, null), 'r', '')), '回');
  assert.equal(editParts({ kind: 'x' }, 'w', '1'), null);
});

test('打つ位置の印は、打っている数字のうしろ（単位の前）に出す', () => {
  assert.equal(partsHtml(editParts(set(10, null, 'bodyweight'), 'w', '10')),
    '<span>自重</span><span>+10<i class="caret"></i><small class="u">kg</small></span>');
  assert.equal(partsHtml(repsParts(set(60, 10, 'kg', 1))),
    '<span>10<small class="u">回</small></span><span class="ex">（補助1）</span>');
});

test('手伝ってもらった回数を増やせるのは reps まで。reps が空なら増やせる', () => {
  assert.equal(canAddAssist(set(60, 10)), true);
  assert.equal(canAddAssist(set(60, 10, 'kg', 9)), true);
  assert.equal(canAddAssist(set(60, 10, 'kg', 10)), false);
  assert.equal(canAddAssist(set(60, 1, 'kg', 3)), false); // reps を減らして補助より小さくなった
  assert.equal(canAddAssist(set(60, 0)), false);
  assert.equal(canAddAssist(set(60, null)), true);
  assert.equal(canAddAssist(set(60, 8.5, 'kg', 7)), true); // 小数の回数：補助は整数で 8 まで
  assert.equal(canAddAssist(set(60, 8.5, 'kg', 8)), false);
  assert.equal(canAddAssist(set(60, 0.5)), false);
  assert.equal(canAddAssist(set(60, null, 'kg', 5)), true);
  assert.equal(canAddAssist(undefined), false);
});

// ---- 種目の登録・編集・削除 ----

const ex = (id, name, part, createdAt) => ({ id, name, part, restSec: 120, createdAt });

test('名前を整える：前後の空白を取り、25文字で切る', () => {
  assert.equal(NAME_MAX, 25);
  assert.equal(tidyName('  ベンチプレス　'), 'ベンチプレス');
  assert.equal(tidyName('   '), '');
  assert.equal(tidyName('あ'.repeat(30)), 'あ'.repeat(25));
  assert.equal(tidyName('  ' + 'a'.repeat(24) + ' b'), 'a'.repeat(24)); // 切ったあとの空白も取る
  assert.equal(cutName('a'.repeat(30)), 'a'.repeat(25));
  assert.equal(cutName(' a '), ' a ');
  assert.equal(tidyName(undefined), '');
});

test('名前を切る：絵文字は1文字と数え、途中でこわさない', () => {
  assert.equal(cutName('💪'.repeat(30)), '💪'.repeat(25));
  assert.equal(cutName('a'.repeat(24) + '💪💪'), 'a'.repeat(24) + '💪');
  assert.equal(tidyName('💪'.repeat(26)), '💪'.repeat(25));
});

test('同じ名前の判定：空白を取ったあとで完全に同じ。編集のときは自分を除く', () => {
  const data = { ...createEmptyData(), exercises: [ex('a', 'ベンチプレス', 'chest'), ex('b', '懸垂', 'back')] };
  assert.equal(hasSameName(data, ' ベンチプレス '), true);
  assert.equal(hasSameName(data, 'ベンチプレス2'), false);
  assert.equal(hasSameName(data, 'べんちぷれす'), false);
  assert.equal(hasSameName(data, 'ベンチプレス', 'a'), false);
  assert.equal(hasSameName(data, '懸垂', 'a'), true);
});

test('種目の名前と部位を書きかえる（ほかの項目と元の data は変えない）', () => {
  const before = { ...createEmptyData(), exercises: [ex('a', 'ベンチ', 'chest', 't1'), null, ex('b', '懸垂', 'back', 't2')] };
  const d = updateExercise(before, 'a', { name: 'ベンチプレス', part: 'arms' });
  assert.deepEqual(d.exercises[0], { ...ex('a', 'ベンチプレス', 'arms', 't1') });
  assert.equal(d.exercises[1], null);
  assert.equal(d.exercises[2], before.exercises[2]);
  assert.equal(before.exercises[0].name, 'ベンチ');
});

test('種目を消すと、その種目の記録も消え、タイマーが指していれば null にする', () => {
  const before = {
    ...createEmptyData(),
    exercises: [ex('e1', 'ベンチ', 'chest'), ex('e2', '懸垂', 'back')],
    workouts: [workout('a', '2026-10-01', [set(60, 10)]), workout('b', TODAY, [], 'e2'), workout('c', TODAY, [set(1, 1)]),
      { id: 'bad', exerciseId: 'e1' }],
    timer: { exerciseId: 'e1', endsAt: 1 },
  };
  const d = deleteExercise(before, 'e1');
  assert.deepEqual(d.exercises.map((e) => e.id), ['e2']);
  assert.deepEqual(d.workouts.map((w) => w.id), ['b']);
  assert.equal(d.timer, null);
  assert.equal(before.exercises.length, 2);
  // ほかの種目を指すタイマーはそのまま
  const timer = { exerciseId: 'e2', endsAt: 1 };
  assert.equal(deleteExercise({ ...before, timer }, 'e1').timer, timer);
  assert.equal(deleteExercise({ ...before, timer: null }, 'e1').timer, null);
});

test('今日のセットの数：今日の記録の空でないセットだけ', () => {
  const d = {
    ...createEmptyData(),
    workouts: [workout('t', TODAY, [set(60, 10), emptySet(), null, set(null, 8)]), workout('y', '2026-10-27', [set(1, 1)], 'e2')],
  };
  assert.equal(todaySetCount(d, 'e1', TODAY), 2);
  assert.equal(todaySetCount(d, 'e2', TODAY), 0);
  assert.equal(todaySetCount(createEmptyData(), 'e1', TODAY), 0);
});

const ids = (groups, part) => groups.find((g) => g.id === part).exercises.map((e) => e.id);

test('部位ごとの並び：前回の日の種目をその日の startedAt の順、やっていない種目は下に登録順', () => {
  const d = {
    ...createEmptyData(),
    exercises: [
      ex('a', 'A', 'chest', '2026-10-01T00:00:00.000Z'),
      ex('b', 'B', 'chest', '2026-10-02T00:00:00.000Z'),
      ex('c', 'C', 'chest', '2026-10-03T00:00:00.000Z'),
      ex('d', 'D', 'chest', '2026-10-04T00:00:00.000Z'),
      ex('z', 'Z', 'legs', '2026-10-05T00:00:00.000Z'),
    ],
    workouts: [
      workout('1', '2026-10-20', [set(1, 1)], 'a', '2026-10-20T09:00:00.000Z'), // 前の日（数えない）
      workout('2', '2026-10-25', [set(1, 1)], 'c', '2026-10-25T09:00:00.000Z'),
      workout('3', '2026-10-25', [set(1, 1)], 'b', '2026-10-25T10:00:00.000Z'),
      workout('4', '2026-10-24', [set(1, 1)], 'z'), // ほかの部位
    ],
  };
  const g = exercisesByPart(d, TODAY);
  assert.deepEqual(g.map((x) => x.id), ['chest', 'back', 'shoulders', 'arms', 'abs', 'legs']);
  assert.equal(g[0].label, '胸');
  assert.deepEqual(ids(g, 'chest'), ['c', 'b', 'a', 'd']);
  assert.deepEqual(ids(g, 'legs'), ['z']);
  assert.deepEqual(ids(g, 'back'), []);
});

test('部位ごとの並び：記録がなければ登録順。今日の記録と空のセットだけの記録は数えない', () => {
  const exercises = [
    ex('b', 'B', 'back', '2026-10-02T00:00:00.000Z'),
    ex('a', 'A', 'back', '2026-10-01T00:00:00.000Z'),
    ex('c', 'C', 'back', '2026-10-03T00:00:00.000Z'),
  ];
  assert.deepEqual(ids(exercisesByPart({ ...createEmptyData(), exercises }, TODAY), 'back'), ['a', 'b', 'c']);
  const d = {
    ...createEmptyData(),
    exercises,
    workouts: [
      workout('1', '2026-10-25', [set(1, 1)], 'c'),
      workout('2', TODAY, [set(1, 1)], 'b'), // 今日
      workout('3', '2026-10-26', [emptySet(), null], 'a'), // 空のセットだけ
      workout('4', '2026-10-27', [], 'a'), // セットなし
    ],
  };
  assert.deepEqual(ids(exercisesByPart(d, TODAY), 'back'), ['c', 'a', 'b']);
});

test('部位が PARTS にない種目は、最後に「部位なし」で出す（ないときは出さない）', () => {
  const d = {
    ...createEmptyData(),
    exercises: [ex('a', 'A', null, 't1'), ex('b', 'B', 'chest', 't2'), ex('c', 'C', 'neck', 't3'), { id: 1 }],
  };
  const g = exercisesByPart(d, TODAY);
  assert.equal(g.length, 7);
  assert.deepEqual(g[6], { id: null, label: '部位なし', exercises: [d.exercises[0], d.exercises[2]] });
  assert.deepEqual(ids(g, 'chest'), ['b']);
  assert.equal(exercisesByPart(createEmptyData(), TODAY).length, 6);
  assert.doesNotThrow(() => exercisesByPart({ exercises: null, workouts: [null, 'x'] }, TODAY));
});

// ---- ホーム ----

// 部位ごとに1種目ずつ（c=胸, b=背中, s=肩, a=腕, ab=腹筋, l=脚）と、部位なしの種目 x
function partsData(workouts) {
  let data = createEmptyData();
  for (const [id, part] of [['c', 'chest'], ['b', 'back'], ['s', 'shoulders'], ['a', 'arms'], ['ab', 'abs'], ['l', 'legs'], ['c2', 'chest'], ['x', null]]) {
    data = addExercise(data, { name: id, part, id, now: new Date(0) }).data;
  }
  return { ...data, workouts };
}
const days = (data, today = TODAY) => Object.fromEntries(partBalance(data, today).map((p) => [p.id, p.days]));
const lows = (data, today = TODAY) => partBalance(data, today).filter((p) => p.low).map((p) => p.id);

test('日付をずらす：月またぎ・年またぎ・うるう年', () => {
  assert.equal(addDays('2026-10-28', -29), '2026-09-29');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(addDays('2027-01-05', -10), '2026-12-26');
});

test('部位のバランス：今日を含む直近30日（today−29 は入る、today−30 と明日は入らない）', () => {
  const data = partsData([
    workout('w1', '2026-09-29', [set(60, 10)], 'c'), // today−29
    workout('w2', '2026-09-28', [set(60, 10)], 'b'), // today−30
    workout('w3', TODAY, [set(60, 10)], 's'),
    workout('w4', '2026-10-29', [set(60, 10)], 'a'), // 明日
  ]);
  assert.deepEqual(days(data), { chest: 1, back: 0, shoulders: 1, arms: 0, abs: 0, legs: 0 });
  // 月をまたぐ：3/1 の30日前の境目は 1/31（うるう年でない年）
  const leap = partsData([workout('w1', '2027-01-31', [set(1, 1)], 'c'), workout('w2', '2027-01-30', [set(1, 1)], 'b')]);
  assert.deepEqual(days(leap, '2027-03-01'), { chest: 1, back: 0, shoulders: 0, arms: 0, abs: 0, legs: 0 });
  // うるう年：2028-03-01 の30日前の境目は 2028-02-01
  const leap2 = partsData([workout('w1', '2028-02-01', [set(1, 1)], 'c'), workout('w2', '2028-01-31', [set(1, 1)], 'b')]);
  assert.deepEqual(days(leap2, '2028-03-01'), { chest: 1, back: 0, shoulders: 0, arms: 0, abs: 0, legs: 0 });
});

test('部位のバランス：同じ日の同じ部位は1日。違う日は別に数える', () => {
  const data = partsData([
    workout('w1', TODAY, [set(60, 10)], 'c'),
    workout('w2', TODAY, [set(20, 10)], 'c2'),
    workout('w3', '2026-10-20', [set(60, 10)], 'c'),
  ]);
  assert.equal(days(data).chest, 2);
});

test('部位のバランス：空のセットだけの記録・部位なし・消えた種目・形のおかしい記録は数えない', () => {
  const data = partsData([
    workout('w1', TODAY, [set(null, null), { kind: 'zzz', weight: 60, reps: 10 }], 'c'),
    workout('w2', TODAY, [set(60, 10)], 'x'),
    workout('w3', TODAY, [set(60, 10)], 'gone'),
    { id: 'w4', exerciseId: 'b', date: '2026/10/28', sets: [set(60, 10)] },
    null,
    workout('w5', TODAY, [set(null, null), set(null, 5)], 'l'),
  ]);
  assert.deepEqual(days(data), { chest: 0, back: 0, shoulders: 0, arms: 0, abs: 0, legs: 1 });
});

test('部位のバランス：PARTS の順で6行。いちばん少ない部位に印（同点はすべて、全部同じなら無し）', () => {
  const all = (ids) => ids.map((id, i) => workout('w' + i, TODAY, [set(60, 10)], id));
  // 1つだけ少ない
  const one = partsData(all(['c', 'b', 's', 'a', 'l']));
  assert.deepEqual(partBalance(one, TODAY).map((p) => p.label), ['胸', '背中', '肩', '腕', '腹筋', '脚']);
  assert.deepEqual(lows(one), ['abs']);
  // 同点で複数
  assert.deepEqual(lows(partsData(all(['c', 'b', 's', 'l']))), ['arms', 'abs']);
  // 全部同じ日数
  assert.deepEqual(lows(partsData(all(['c', 'b', 's', 'a', 'ab', 'l']))), []);
  // 全部0
  const zero = partBalance(partsData([]), TODAY);
  assert.deepEqual(zero.map((p) => p.days), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(zero.filter((p) => p.low), []);
});

test('今日の種目：startedAt の順。空のセットだけ・消えた種目・ほかの日は出さない。sets は空でないセットの数', () => {
  const data = partsData([
    workout('w1', TODAY, [set(60, 10), set(null, null)], 'c', TODAY + 'T09:00:00.000Z'),
    workout('w2', TODAY, [set(null, 8), set(50, 8), set(40, 8)], 'b', TODAY + 'T08:00:00.000Z'),
    workout('w3', TODAY, [set(null, null)], 's', TODAY + 'T07:00:00.000Z'),
    workout('w4', TODAY, [set(60, 10)], 'gone', TODAY + 'T06:00:00.000Z'),
    workout('w5', '2026-10-27', [set(60, 10)], 'l'),
    workout('w6', TODAY, [set(60, 10)], 'x', TODAY + 'T10:00:00.000Z'),
  ]);
  assert.deepEqual(todayExercises(data, TODAY), [
    { exerciseId: 'b', name: 'b', sets: 3 },
    { exerciseId: 'c', name: 'c', sets: 1 },
    { exerciseId: 'x', name: 'x', sets: 1 },
  ]);
  assert.deepEqual(todayExercises(partsData([]), TODAY), []);
});

test('今日の種目：同じ種目の今日の記録が2つあるときは、最初のものだけ', () => {
  const data = partsData([
    workout('w1', TODAY, [set(60, 10)], 'c', TODAY + 'T09:00:00.000Z'),
    workout('w2', TODAY, [set(60, 10), set(60, 10)], 'c', TODAY + 'T08:00:00.000Z'),
  ]);
  assert.deepEqual(todayExercises(data, TODAY), [{ exerciseId: 'c', name: 'c', sets: 1 }]);
});

test('今日の種目：startedAt が無い記録は上に、その中は記録の順', () => {
  const data = partsData([
    workout('w1', TODAY, [set(60, 10)], 'c', TODAY + 'T09:00:00.000Z'),
    { id: 'w2', exerciseId: 'b', date: TODAY, sets: [set(60, 10)] },
    { id: 'w3', exerciseId: 's', date: TODAY, sets: [set(60, 10)] },
  ]);
  assert.deepEqual(todayExercises(data, TODAY).map((r) => r.exerciseId), ['b', 's', 'c']);
});

test('ホームの日付の見出し', () => {
  assert.equal(dateLabel('2026-10-27'), '10月27日（火）');
  assert.equal(dateLabel('2026-11-01'), '11月1日（日）');
  assert.equal(dateLabel('2026-10-31'), '10月31日（土）');
  assert.equal(dateLabel('bad'), '');
});

test('休憩が終わったときの経過の言葉', () => {
  assert.equal(elapsedText(120), '2分');
  assert.equal(elapsedText(90), '1分30秒');
  assert.equal(elapsedText(30), '30秒');
  assert.equal(elapsedText(300), '5分');
  assert.equal(elapsedText(null), null);
  assert.equal(elapsedText(0), null);
});
