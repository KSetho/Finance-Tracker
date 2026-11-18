/** Injectable clock (mirrors backend/app/core/clock.py) so tests can pin "now". */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

let current: Clock = systemClock;

export function getClock(): Clock {
  return current;
}

export function setClock(clock: Clock): void {
  current = clock;
}
