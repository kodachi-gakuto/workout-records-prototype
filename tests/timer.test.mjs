import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyData } from '../js/store.js';
import {
  addExercise, REST_CHOICES, restSecOf, setRestSec, validTimer, remainingSec, isTimerDone, runningTimer,
  startTimer, stopTimer, toggleTimer, needsTimerHint, markTimerHint, MAX_TIMER_MS,
} from '../js/records.js';
import { nextCheckDelay, endedWhileHidden, createTimerWatch } from '../js/timer.js';

const NOW = 1_761_600_000_000;

function data2() {
  let d = addExercise(createEmptyData(), { name: 'ベンチ', id: 'e1', restSec: 90, now: new Date(0) }).data;
  d = addExercise(d, { name: '懸垂', id: 'e2', now: new Date(0) }).data;
  return d;
}

test('休憩の時間の選択肢は 0:30〜5:00 の30秒きざみ10個', () => {
  assert.deepEqual(REST_CHOICES, [30, 60, 90, 120, 150, 180, 210, 240, 270, 300]);
});

test('restSec を書きかえる（ほかの種目・項目はそのまま、元の data は変えない）', () => {
  const before = { ...data2(), exercises: [...data2().exercises, null] };
  const d = setRestSec(before, 'e1', 180);
  assert.equal(d.exercises[0].restSec, 180);
  assert.equal(d.exercises[0].name, 'ベンチ');
  assert.equal(d.exercises[1], before.exercises[1]);
  assert.equal(d.exercises[2], null);
  assert.equal(before.exercises[0].restSec, 90);
});

test('restSec の形がおかしいときは既定の 120 秒', () => {
  assert.equal(restSecOf({ restSec: 90 }), 90);
  assert.equal(restSecOf({ restSec: 0 }), 120);
  assert.equal(restSecOf({ restSec: '60' }), 120);
  assert.equal(restSecOf(null), 120);
});

test('始める：種目の restSec で、終わる時刻を保存する', () => {
  const d = startTimer(data2(), 'e1', { now: NOW });
  assert.deepEqual(d.timer, { exerciseId: 'e1', durationSec: 90, endsAt: NOW + 90_000 });
  // 時間を渡したときはその時間
  assert.deepEqual(startTimer(data2(), 'e2', { now: NOW, sec: 30 }).timer, { exerciseId: 'e2', durationSec: 30, endsAt: NOW + 30_000 });
  assert.equal(startTimer(data2(), 'e2', { now: NOW }).timer.durationSec, 120);
});

test('止める・押すたびに始める／止める', () => {
  const start = toggleTimer(data2(), 'e1', NOW);
  assert.equal(start.timer.endsAt, NOW + 90_000);
  // 動いている間は、どの種目から押しても止まる
  assert.equal(toggleTimer(start, 'e2', NOW + 1000).timer, null);
  assert.equal(stopTimer(start).timer, null);
  // 終わったものが残っていたら、開いている種目の restSec で始める
  const again = toggleTimer(start, 'e2', NOW + 90_000);
  assert.deepEqual(again.timer, { exerciseId: 'e2', durationSec: 120, endsAt: NOW + 90_000 + 120_000 });
});

test('残りの秒（切り上げ）と、終わったかの判定', () => {
  const t = { exerciseId: 'e1', durationSec: 90, endsAt: NOW + 90_000 };
  assert.equal(remainingSec(t, NOW), 90);
  assert.equal(remainingSec(t, NOW + 1), 90);
  assert.equal(remainingSec(t, NOW + 1000), 89);
  assert.equal(remainingSec(t, NOW + 89_999), 1);
  assert.equal(remainingSec(t, NOW + 90_000), 0);
  assert.equal(remainingSec(t, NOW + 999_999), 0);
  assert.equal(isTimerDone(t, NOW + 89_999), false);
  assert.equal(isTimerDone(t, NOW + 90_000), true);
  const d = { ...data2(), timer: t };
  assert.equal(runningTimer(d, NOW), t);
  assert.equal(runningTimer(d, NOW + 90_000), null);
});

test('形のおかしいタイマー・種目が消えたタイマーは null として扱う', () => {
  const d = data2();
  for (const timer of [null, 5, 'x', [], { endsAt: NOW }, { exerciseId: 'e1' }, { exerciseId: 1, endsAt: NOW },
    { exerciseId: 'e1', endsAt: '1' }, { exerciseId: 'e1', endsAt: NaN }, { exerciseId: 'gone', endsAt: NOW + 1000 }]) {
    assert.equal(validTimer({ ...d, timer }), null, JSON.stringify(timer));
    assert.equal(runningTimer({ ...d, timer }, NOW), null);
  }
  // durationSec がなくても、exerciseId と endsAt があれば使う
  const ok = { exerciseId: 'e1', endsAt: NOW + 1000 };
  assert.equal(validTimer({ ...d, timer: ok }), ok);
  assert.equal(validTimer(null), null);
  // 形のおかしいタイマーで押したら、始める
  assert.equal(toggleTimer({ ...d, timer: { exerciseId: 'e1' } }, 'e1', NOW).timer.endsAt, NOW + 90_000);
});

test('次に見に行くまでの時間：表示の秒が変わる所まで', () => {
  const t = { exerciseId: 'e1', endsAt: NOW + 90_000 };
  assert.equal(nextCheckDelay(t, NOW), 1020);
  assert.equal(nextCheckDelay(t, NOW + 300), 720);
  assert.equal(nextCheckDelay(t, NOW + 89_500), 520);
  assert.equal(nextCheckDelay(t, NOW + 90_000), 0);
  assert.equal(nextCheckDelay(t, NOW + 95_000), 0);
});

test('ヒントのフラグ：一度だけ出す', () => {
  const d = createEmptyData();
  assert.equal(needsTimerHint(d), true);
  const m = markTimerHint(d);
  assert.equal(needsTimerHint(m), false);
  assert.deepEqual(m.flags, { timerHintShown: true });
  assert.equal(d.flags.timerHintShown, false);
  // flags がおかしくても落ちない
  assert.equal(needsTimerHint({}), true);
  assert.deepEqual(markTimerHint({ flags: 3 }).flags, { timerHintShown: true });
  assert.deepEqual(markTimerHint({ flags: { other: 1 } }).flags, { other: 1, timerHintShown: true });
});

test('終わるまで1時間を超えるタイマーは、形のおかしいものとして null（時計のずれ対策）', () => {
  const d = data2();
  const at = (ms) => ({ ...d, timer: { exerciseId: 'e1', endsAt: NOW + ms } });
  assert.equal(MAX_TIMER_MS, 3_600_000);
  assert.notEqual(validTimer(at(MAX_TIMER_MS), NOW), null);
  assert.equal(validTimer(at(MAX_TIMER_MS + 1), NOW), null);
  assert.equal(runningTimer(at(MAX_TIMER_MS + 1), NOW), null);
  // 押したら、新しく始める
  assert.equal(toggleTimer(at(MAX_TIMER_MS + 1), 'e1', NOW).timer.endsAt, NOW + 90_000);
});

test('見えていない間に終わったか', () => {
  // ずっと見えていた
  assert.equal(endedWhileHidden(NOW, null, null, NOW + 1), false);
  // 隠れたあとに終わり、まだ戻った知らせが来ていない（setTimeout が先に来た）
  assert.equal(endedWhileHidden(NOW, NOW - 1000, null, NOW + 5000), true);
  // 隠れる前に終わっていた
  assert.equal(endedWhileHidden(NOW, NOW + 1, null, NOW + 5000), false);
  // 戻ったあとで終わった
  assert.equal(endedWhileHidden(NOW + 2000, NOW - 1000, NOW + 1000, NOW + 3000), false);
  // 隠れている間に終わり、戻った
  assert.equal(endedWhileHidden(NOW, NOW - 1000, NOW + 1000, NOW + 3000), true);
});

// ---- 見張り（document・window・AudioContext は小さな偽物） ----
// timer.js の AudioContext はモジュールに1つだけ作られるので、鳴った数もここで1つにまとめて数える
const sound = { contexts: 0, oscillators: 0 };
class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  constructor() { sound.contexts += 1; }
  resume() { return Promise.resolve(); }
  createGain() {
    return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (x) => x };
  }
  createOscillator() {
    sound.oscillators += 1;
    return { frequency: {}, connect: (x) => x, start() {}, stop() {} };
  }
}

function fakeEnv() {
  const on = {};
  const add = (prefix) => (type, fn) => { (on[prefix + type] ??= []).push(fn); };
  globalThis.document = { visibilityState: 'visible', addEventListener: add('') };
  globalThis.window = { addEventListener: add('w:') };
  globalThis.AudioContext = FakeAudioContext;
  const fire = (type) => { for (const fn of on[type] ?? []) fn({}); };
  const setVisible = (v) => { globalThis.document.visibilityState = v ? 'visible' : 'hidden'; };
  return { fire, setVisible, sound };
}

function makeWatch(initial = data2()) {
  let data = initial;
  const ctx = { commits: 0, getData: () => data, commit: (d) => { data = d; ctx.commits += 1; } };
  const watch = createTimerWatch(ctx);
  const events = [];
  watch.subscribe((ev) => events.push(ev.type));
  watch.start();
  return { ctx, watch, events };
}

function withClock(fn) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW });
  try {
    fn();
  } finally {
    mock.timers.reset();
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.AudioContext;
  }
}

test('見張り：タイマーが動いていなければ、タップで AudioContext を作らない', () => {
  withClock(() => {
    const env = fakeEnv();
    makeWatch();
    env.fire('click');
    assert.equal(sound.contexts, 0);
  });
});

test('見張り：開き直して丸を押していなくても、タイマーが動いていればタップで AudioContext を作る', () => {
  withClock(() => {
    const env = fakeEnv();
    makeWatch({ ...data2(), timer: { exerciseId: 'e1', durationSec: 90, endsAt: NOW + 90_000 } });
    assert.equal(sound.contexts, 0);
    env.fire('click');
    assert.equal(sound.contexts, 1);
    env.fire('touchend'); // 作り済みなら作り直さない
    assert.equal(sound.contexts, 1);
  });
});

test('見張り：0:00 になったら音と知らせを一度だけ。data は保存しない', () => {
  withClock(() => {
    const env = fakeEnv();
    const { ctx, watch, events } = makeWatch();
    watch.toggle('e1');
    const commits = ctx.commits;
    const before = sound.oscillators;
    mock.timers.tick(90_000 + 100);
    assert.equal(sound.oscillators - before, 10); // 5回×2（約3秒）
    assert.equal(events.filter((t) => t === 'done').length, 1);
    assert.equal(ctx.commits, commits); // 0:00 では保存しない
    assert.notEqual(ctx.getData().timer, null); // data の timer は残る
    assert.equal(watch.now().timer, null); // 終わったものは返さない
    // 戻っても、もう一度は鳴らさない・知らせない
    env.setVisible(false);
    env.fire('visibilitychange');
    env.setVisible(true);
    env.fire('visibilitychange');
    assert.equal(sound.oscillators - before, 10);
    assert.equal(events.filter((t) => t === 'done').length, 1);
    assert.equal(ctx.commits, commits);
    // 次に押したら、新しく始める
    watch.toggle('e1');
    assert.equal(ctx.getData().timer.endsAt, Date.now() + 90_000);
  });
});

test('見張り：裏にいる間に終わったら、戻ったときに setTimeout が先に来ても鳴らさず知らせだけ', () => {
  withClock(() => {
    const env = fakeEnv();
    const { ctx, watch, events } = makeWatch();
    watch.toggle('e1');
    const commits = ctx.commits;
    const before = sound.oscillators;
    env.setVisible(false);
    env.fire('visibilitychange');
    mock.timers.tick(30_000);
    // 戻った（visibilitychange はまだ来ていない）。止められていた setTimeout が先に来る
    env.setVisible(true);
    mock.timers.tick(60_000 + 100);
    assert.equal(sound.oscillators, before);
    assert.equal(events.filter((t) => t === 'done').length, 1);
    env.fire('visibilitychange');
    assert.equal(sound.oscillators, before);
    assert.equal(events.filter((t) => t === 'done').length, 1);
    assert.equal(ctx.commits, commits);
  });
});

test('見張り：戻ったあとで終わったら鳴らす。裏にいる間に終わったものは、戻ったときに点滅だけ', () => {
  withClock(() => {
    const env = fakeEnv();
    const { watch, events } = makeWatch();
    watch.toggle('e1');
    env.setVisible(false);
    env.fire('visibilitychange');
    mock.timers.tick(10_000);
    env.setVisible(true);
    env.fire('visibilitychange');
    const before = sound.oscillators;
    mock.timers.tick(80_000 + 100);
    assert.equal(sound.oscillators - before, 10);
    // 2回目：隠れている間に setTimeout が来て終わる → 戻ったときに点滅
    watch.toggle('e1');
    const dones = events.filter((t) => t === 'done').length;
    env.setVisible(false);
    env.fire('visibilitychange');
    mock.timers.tick(90_000 + 100);
    assert.equal(events.filter((t) => t === 'done').length, dones); // 見えない間は知らせない
    env.setVisible(true);
    env.fire('visibilitychange');
    assert.equal(sound.oscillators - before, 10);
    assert.equal(events.filter((t) => t === 'done').length, dones + 1);
  });
});

