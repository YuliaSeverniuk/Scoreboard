import { Test } from '@nestjs/testing';
import { MatchService, PERIOD_MS, initialState } from './match.service';
import { MatchState } from './protocol';
import { StateStore } from './state-store';

class MemoryStore extends StateStore {
  saved: MatchState | null = null;
  saves = 0;
  load() {
    return this.saved;
  }
  save(state: MatchState) {
    this.saved = state;
    this.saves++;
  }
}

describe('MatchService', () => {
    let store: MemoryStore;

    async function createService(): Promise<MatchService> {
      const moduleRef = await Test.createTestingModule({
        providers: [MatchService, { provide: StateStore, useValue: store }],
      }).compile();
      return moduleRef.get(MatchService);
    }

    beforeEach(() => {
      jest.useFakeTimers();
      store = new MemoryStore();
    });

    afterEach(() => jest.useRealTimers());

    it('changes score and never goes below zero', async () => {
      const match = await createService();
      match.apply({ type: 'score', team: 'home', delta: 2 });
      match.apply({ type: 'score', team: 'away', delta: -1 });

      expect(match.snapshot().state.home.score).toBe(2);
      expect(match.snapshot().state.away.score).toBe(0);
    });

    it('increments seq on every change', async () => {
      const match = await createService();
      const seqs: number[] = [];
      match.snapshots$.subscribe((s) => seqs.push(s.seq));

      match.apply({ type: 'score', team: 'home', delta: 1 });
      match.apply({ type: 'foul', team: 'away', delta: 1 });

      expect(seqs).toEqual([0, 1, 2]);
    });

    it('counts the clock down while running', async () => {
      const match = await createService();
      match.apply({ type: 'clock.start' });
      jest.advanceTimersByTime(3000);
      match.apply({ type: 'clock.stop' });

      expect(match.snapshot().state.clock).toEqual({ remainingMs: PERIOD_MS - 3000, running: false });
    });

    it('stops at zero and sounds the horn', async () => {
      const match = await createService();
      match.apply({ type: 'clock.start' });
      jest.advanceTimersByTime(PERIOD_MS + 500);

      const { clock, horn } = match.snapshot().state;
      expect(clock).toEqual({ remainingMs: 0, running: false });
      expect(horn).toBe(true);

      jest.advanceTimersByTime(2000);
      expect(match.snapshot().state.horn).toBe(false);
    });

    it('saves the clock to disk at most once per second', async () => {
      const match = await createService();
      match.apply({ type: 'clock.start' });
      const savesAfterStart = store.saves;

      jest.advanceTimersByTime(5000); // 50 тіків

      expect(store.saves - savesAfterStart).toBeLessThanOrEqual(5);
    });

    it('recovers saved state after power loss with the clock paused', async () => {
      store.saved = {
        ...initialState(),
        home: { name: 'HOME', score: 42, fouls: 3 },
        clock: { remainingMs: 123_000, running: true },
        horn: true,
      };

      const match = await createService();
      const { state } = match.snapshot();

      expect(state.home.score).toBe(42);
      expect(state.clock).toEqual({ remainingMs: 123_000, running: false });
      expect(state.horn).toBe(false);
    });
})