import test from 'node:test';
import assert from 'node:assert/strict';
import { changePhase, finish, initialTimer, pause, secondsLeft, start } from './timer.ts';

test('画面を長時間閉じても、終了時刻から残り時間を計算する', () => {
  const running = start(initialTimer(), 10_000);
  assert.equal(secondsLeft(running, 610_000), 900);
  assert.equal(secondsLeft(running, 2_000_000), 0);
});
test('一時停止中は時間が進まず、再開すると残り時間から動く', () => {
  const paused = pause(start(initialTimer(), 0), 60_000);
  assert.equal(secondsLeft(paused, 999_999), 1440);
  assert.equal(secondsLeft(start(paused, 1_000_000), 1_060_000), 1380);
});
test('集中4回ごとに長い休憩になり、休憩終了後は集中に戻る', () => {
  let timer = initialTimer();
  for (let count = 1; count <= 4; count++) {
    timer = finish(timer);
    assert.equal(timer.phase, count === 4 ? 'longBreak' : 'shortBreak');
    assert.equal(timer.endsAt, null);
    timer = finish(timer);
    assert.equal(timer.phase, 'focus');
    assert.equal(timer.completed, count);
  }
});
test('モード変更でタイマーを停止し、そのモードの時間に戻す', () => {
  const timer = changePhase(start(initialTimer(), 0), 'shortBreak');
  assert.equal(timer.endsAt, null);
  assert.equal(timer.remaining, 300);
  assert.equal(start(start(timer, 0), 100).endsAt, 300_000);
});
