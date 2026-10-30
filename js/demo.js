// 確認用（一時的）：履歴の画面を iPhone で確かめるための、お試しの種目と過去の記録。確認が済んだら消す
import { addExercise, addDays, findExercise } from './records.js';
import { newId, todayString } from './store.js';

export const DEMO_ID = 'demo-bench';

const kg = (weight, reps) => ({ kind: 'kg', weight, reps, assistedReps: null });
// [何日前, セット]（🏆 ↑2.5kg が2回付く）
const DAYS = [
  [23, [kg(75, 10), kg(75, 8), kg(70, 10)]],
  [19, [kg(75, 8), kg(75, 8), kg(75, 8)]],
  [16, [kg(77.5, 8), kg(77.5, 8), kg(77.5, 7)]],
  [12, [kg(77.5, 8), kg(77.5, 8), kg(77.5, 8)]],
  [9, [kg(80, 8), kg(80, 7), kg(80, 6)]],
  [5, [kg(80, 8), kg(80, 8), kg(80, 6)]],
  [2, [kg(80, 8), kg(80, 8), kg(80, 7)]],
];

// すでにあれば何もしない
export function addDemo(data, today = todayString()) {
  if (findExercise(data, DEMO_ID)) return data;
  const added = addExercise(data, { name: '（お試し）ベンチプレス', part: 'chest', id: DEMO_ID }).data;
  const workouts = DAYS.map(([n, sets]) => {
    const date = addDays(today, -n);
    return { id: newId(), exerciseId: DEMO_ID, date, startedAt: `${date}T10:00:00.000Z`, sets };
  });
  return { ...added, workouts: [...added.workouts, ...workouts] };
}
