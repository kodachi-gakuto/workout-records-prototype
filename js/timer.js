// 休憩タイマーの見張り（画面をまたいで動く）
// 終わる時刻（data.timer.endsAt）を見張り、0:00 になったら音を鳴らして知らせ（done）を出す。
// 終わったタイマーはメモリの中で「終わったもの」として扱い、ここでは保存しない
// （data の timer は、次に押したときか、起動したときの start() の掃除で消える）。
// 画面は subscribe して表示だけを受け持つ。import しただけでは document にさわらない。
import { validTimer, runningTimer, remainingSec, isTimerDone, toggleTimer, startTimer } from './records.js';

// 次に見に行くまでの時間：残りの秒の表示が次に変わる時刻（少しだけ後ろ）まで
export function nextCheckDelay(timer, now = Date.now()) {
  const left = timer.endsAt - now;
  if (left <= 0) return 0;
  return (left % 1000 || 1000) + 20;
}

// 見えていない間に終わったか。hiddenAt：見えなくなった時刻（見えていたなら null）、
// shownAt：そのあと見えるようになった時刻（まだ戻っていない・戻った知らせが来ていないなら null）
export function endedWhileHidden(endsAt, hiddenAt, shownAt, now = Date.now()) {
  if (hiddenAt == null) return false;
  return endsAt >= hiddenAt && endsAt <= (shownAt ?? now);
}

// 同じタイマーかを見分ける印
const timerKey = (t) => `${t.exerciseId}@${t.endsAt}`;

// ---- 音（Web Audio。音のファイルは使わない） ----
// iOS はタップの中で AudioContext を作る・resume しないと鳴らない
let audio = null;

export function unlockAudio() {
  try {
    if (!audio) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return;
      audio = new AC();
      // 無音を一度鳴らしておく（iOS で次から鳴るように）
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + 0.01);
    }
    if (audio.state !== 'running') audio.resume().catch(() => {});
  } catch {
    // 鳴らせない環境では何もしない
  }
}

// 「ピピッ」を5回、約3秒（880Hz、0.18秒ずつ）
function beep() {
  if (!audio) return;
  try {
    if (audio.state !== 'running') audio.resume().catch(() => {});
    const t0 = audio.currentTime + 0.02;
    for (let i = 0; i < 10; i += 1) {
      const s = t0 + Math.floor(i / 2) * 0.6 + (i % 2) * 0.22;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, s);
      gain.gain.exponentialRampToValueAtTime(0.3, s + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, s + 0.18);
      osc.connect(gain).connect(audio.destination);
      osc.start(s);
      osc.stop(s + 0.2);
    }
  } catch {
    // 鳴らなくても先へ進む
  }
}

// ctx：app.js の ctx（getData・commit）
// subscribe(fn)：fn({ type: 'tick' | 'done', timer, remaining, sec }) を呼ぶ。戻り値は外す関数
//   tick：表示を変えるとき（1秒ごと・始めた・止めた・終わった）。timer は動いているタイマーか null
//   done：終わったので知らせを出すとき。sec は終わったタイマーの時間（わからなければ null）
export function createTimerWatch(ctx) {
  const listeners = new Set();
  let handle = null;
  let pendingDone = null; // 知らせをまだ出していない、終わったタイマーの時間（{ sec }）
  let doneKey = null; // 終わったものとして扱った（音・点滅を済ませた）タイマーの印
  let hiddenAt = null; // 見えなくなった時刻
  let shownAt = null; // そのあと見えるようになった時刻
  const isVisible = () => document.visibilityState === 'visible';

  // タップのたびに AudioContext を起こしておく（裏から戻ると止まっていることがある）。
  // まだ作っていなくても、動いているタイマーがあれば作る（開き直して丸を押していないとき）
  function wakeAudio() {
    if (audio) {
      if (audio.state !== 'running') audio.resume().catch(() => {});
    } else if (runningTimer(ctx.getData())) {
      unlockAudio();
    }
  }

  function emit(type, extra = {}) {
    const now = Date.now();
    const timer = runningTimer(ctx.getData(), now);
    const ev = { type, timer, remaining: timer ? remainingSec(timer, now) : 0, ...extra };
    for (const fn of [...listeners]) {
      try {
        fn(ev);
      } catch (error) {
        console.error(error);
      }
    }
  }

  function schedule() {
    clearTimeout(handle);
    handle = null;
    const t = runningTimer(ctx.getData());
    if (t) handle = setTimeout(() => check(), nextCheckDelay(t));
  }

  // 終わっていたら、一度だけ音と知らせ。見えていない間に終わっていたら、音は鳴らさずに知らせだけ
  // （戻ったとき、setTimeout が visibilitychange より先に来ても鳴らさない）
  function check() {
    const now = Date.now();
    const t = validTimer(ctx.getData(), now);
    if (t && isTimerDone(t, now) && timerKey(t) !== doneKey) {
      doneKey = timerKey(t);
      if (isVisible() && !endedWhileHidden(t.endsAt, hiddenAt, shownAt, now)) beep();
      pendingDone = { sec: Number.isFinite(t.durationSec) ? t.durationSec : null };
    }
    emit('tick');
    if (pendingDone && isVisible()) {
      const extra = pendingDone;
      pendingDone = null;
      emit('done', extra);
    }
    schedule();
  }

  function onVisibility() {
    if (!isVisible()) {
      hiddenAt = Date.now();
      shownAt = null;
      return;
    }
    if (hiddenAt != null && shownAt == null) shownAt = Date.now();
    check();
  }

  return {
    // 起動したとき：形のおかしいタイマー・閉じている間に終わったタイマーは、何も出さずに null にする
    start() {
      const data = ctx.getData();
      const t = validTimer(data);
      if (data?.timer != null && (!t || isTimerDone(t))) ctx.commit({ ...data, timer: null });
      if (!isVisible()) hiddenAt = Date.now();
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pageshow', onVisibility);
      document.addEventListener('click', wakeAudio, true);
      document.addEventListener('touchend', wakeAudio, true);
      schedule();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    // 今の状態：{ timer, remaining }
    now() {
      const now = Date.now();
      const timer = runningTimer(ctx.getData(), now);
      return { timer, remaining: timer ? remainingSec(timer, now) : 0 };
    },
    // 押したとき：動いていれば止め、止まっていれば exerciseId の restSec で始める
    toggle(exerciseId) {
      unlockAudio();
      ctx.commit(toggleTimer(ctx.getData(), exerciseId));
      emit('tick');
      schedule();
    },
    // 時間を選んだとき：その時間ですぐ始める（data は restSec を書きかえたもの）
    startWith(data, exerciseId, sec) {
      unlockAudio();
      ctx.commit(startTimer(data, exerciseId, { sec }));
      emit('tick');
      schedule();
    },
  };
}
