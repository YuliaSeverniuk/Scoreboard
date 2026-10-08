import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { BehaviorSubject } from 'rxjs';
import { Command, MatchState, Team } from './protocol';
import { StateStore } from './state-store';

export const PERIOD_MS = Number(process.env.PERIOD_SECONDS ?? 600) * 1000;
const TICK_MS = 100;
const HORN_MS = 2000;

const PERSIST_CLOCK_EVERY_MS = 1000;

export interface Snapshot {
  seq: number;
  state: MatchState;
}

export function initialState(): MatchState {
  return {
    home: { name: 'HOME', score: 0, fouls: 0 },
    away: { name: 'GUEST', score: 0, fouls: 0 },
    period: 1,
    clock: { remainingMs: PERIOD_MS, running: false },
    horn: false,
  };
}

@Injectable()
export class MatchService implements OnModuleDestroy {
    private readonly logger = new Logger(MatchService.name);

    private state: MatchState;
    private seq =0;

    private runningSince: number | null = null;
    private remainingAtStart = 0;
    private tickTimer?: NodeJS.Timeout;
    private hornTimer?: NodeJS.Timeout;
    private lastPersistAt = 0;

    private readonly snapshots: BehaviorSubject<Snapshot>;
    readonly snapshots$;

    constructor(private readonly store: StateStore) {
      const saved = store.load();
      if (saved) {
        this.state = { ...saved, horn: false, clock: { ...saved.clock, running: false } };
        this.logger.warn(`Recovered match state, clock paused at ${saved.clock.remainingMs} ms`);
      } else {
        this.state = initialState();
      }
      this.snapshots = new BehaviorSubject<Snapshot>(this.snapshot());
      this.snapshots$ = this.snapshots.asObservable();
    }

    snapshot(): Snapshot {
      return { seq: this.seq, state: this.state };
    }

    apply(cmd: Command): void {
    switch (cmd.type) {
      case 'score':
        return this.changeTeam(cmd.team, 'score', cmd.delta);
      case 'foul':
        return this.changeTeam(cmd.team, 'fouls', cmd.delta);
      case 'clock.start':
        return this.startClock();
      case 'clock.stop':
        return this.stopClock();
      case 'period.next':
        return this.nextPeriod();
      case 'horn':
        return this.soundHorn();
      case 'reset':
        this.stopClock();
        return this.commit(initialState());
      } 
    }

    onModuleDestroy(): void {
      clearInterval(this.tickTimer);
      clearTimeout(this.hornTimer);
      this.store.save({ ...this.state, clock: { ...this.state.clock, remainingMs: this.currentRemaining() } });
      this.snapshots.complete();
    }

    private changeTeam(team: Team, field: 'score' | 'fouls', delta: number): void {
      const current = this.state[team];
      const value = Math.min(999, Math.max(0, current[field] + delta));
      this.commit({ ...this.state, [team]: { ...current, [field]: value } });
    }

    private startClock(): void {
      const { running, remainingMs } = this.state.clock;
      if (running || remainingMs <= 0) return;
      this.runningSince = performance.now();
      this.remainingAtStart = remainingMs;
      this.tickTimer = setInterval(() => this.tick(), TICK_MS);
      this.setClock(remainingMs, true);
    }

    private stopClock(): void {
      if (!this.state.clock.running) return;
      const remaining = this.currentRemaining();
      clearInterval(this.tickTimer);
      this.tickTimer = undefined;
      this.runningSince = null;
      this.setClock(remaining, false);
    }

    private tick(): void {
      const remaining = this.currentRemaining();
      if (remaining === 0) {
        this.stopClock();
        this.soundHorn();
        return;
      }
      this.setClock(remaining, true, 'throttled');
    }

    private currentRemaining(): number {
      if (this.runningSince === null) return this.state.clock.remainingMs;
      const elapsed = performance.now() - this.runningSince;
      return Math.max(0, Math.round(this.remainingAtStart - elapsed));
    }

    private setClock(remainingMs: number, running: boolean, persist: 'now' | 'throttled' = 'now'): void {
      this.commit({ ...this.state, clock: { remainingMs, running } }, persist);
    }

    private nextPeriod(): void {
      this.stopClock();
      this.commit({
        ...this.state,
        period: this.state.period + 1,
        clock: { remainingMs: PERIOD_MS, running: false },
        home: { ...this.state.home, fouls: 0 },
        away: { ...this.state.away, fouls: 0 },
      });
    }

    private soundHorn(): void {
      clearTimeout(this.hornTimer);
      this.commit({ ...this.state, horn: true });
      this.hornTimer = setTimeout(() => this.commit({ ...this.state, horn: false }), HORN_MS);
    }

    private commit(next: MatchState, persist: 'now' | 'throttled' = 'now'): void {
      this.state = next;
      this.seq++;

      const now = performance.now();
      if (persist === 'now' || now - this.lastPersistAt >= PERSIST_CLOCK_EVERY_MS) {
        this.store.save(next);
        this.lastPersistAt = now;
      }

      this.snapshots.next(this.snapshot());
    }
}