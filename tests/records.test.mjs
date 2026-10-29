import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyData } from '../js/store.js';
import {
  addExercise, findExercise, listExercises, findTodayWorkout, ensureTodayWorkout,
  updateSet, addSet, insertSet, removeSet, removeEmptySets, previousWorkout, bestWeight,
  emptySet, isEmptySet, cleanSets, sanitizeInput, parseNumber, weightParts, repsParts, editParts, partsText, canAddAssist,
  shortDate, mmss,
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
  assert.equal(canAddAssist(set(60, null, 'kg', 5)), true);
  assert.equal(canAddAssist(undefined), false);
});
