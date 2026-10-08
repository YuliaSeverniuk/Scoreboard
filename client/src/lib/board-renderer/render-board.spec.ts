import { formatClock, resolve } from './render-board';

describe('formatClock', () => {
  it('shows MM:SS from one minute up, rounding seconds up', () => {
    expect(formatClock(600_000)).toBe('10:00');
    expect(formatClock(599_900)).toBe('10:00');
    expect(formatClock(599_000)).toBe(' 9:59');
    expect(formatClock(60_000)).toBe(' 1:00');
  });

  it('shows SS.t during the last minute', () => {
    expect(formatClock(59_999)).toBe('59.9');
    expect(formatClock(5_340)).toBe(' 5.3');
    expect(formatClock(0)).toBe(' 0.0');
  });
});

describe('resolve', () => {
  it('reads nested values by dotted path', () => {
    const data = { home: { score: 42 }, horn: true };
    expect(resolve(data, 'home.score')).toBe(42);
    expect(resolve(data, 'horn')).toBe(true);
    expect(resolve(data, 'away.score')).toBeUndefined();
  });
});