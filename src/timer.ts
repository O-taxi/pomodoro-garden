export type Phase = 'focus' | 'shortBreak' | 'longBreak';
export const DURATIONS: Record<Phase, number> = { focus: 25 * 60, shortBreak: 5 * 60, longBreak: 15 * 60 };
export type Timer = {
  phase: Phase;
  remaining: number;
  endsAt: number | null;
  completed: number;
};
export const initialTimer = (): Timer => ({ phase: 'focus', remaining: DURATIONS.focus, endsAt: null, completed: 0 });
export function secondsLeft(timer: Timer, now: number): number {
  return timer.endsAt === null ? timer.remaining : Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
}
export function start(timer: Timer, now: number): Timer {
  return timer.endsAt !== null ? timer : { ...timer, endsAt: now + timer.remaining * 1000 };
}
export function pause(timer: Timer, now: number): Timer {
  return { ...timer, remaining: secondsLeft(timer, now), endsAt: null };
}
export function changePhase(timer: Timer, phase: Phase): Timer {
  return { ...timer, phase, remaining: DURATIONS[phase], endsAt: null };
}
export function finish(timer: Timer): Timer {
  const completed = timer.completed + (timer.phase === 'focus' ? 1 : 0);
  const phase: Phase = timer.phase !== 'focus' ? 'focus' : completed % 4 === 0 ? 'longBreak' : 'shortBreak';
  return { phase, remaining: DURATIONS[phase], endsAt: null, completed };
}
export function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
