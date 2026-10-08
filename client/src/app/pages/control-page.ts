import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatchSocket } from '../match-socket';
import { Command, Team } from '../protocol';

type Mode = 'game' | 'more';

interface SoftKey {
  label: string;
  command?: Command;
  mode?: Mode;
}

const LED_FLASH_MS = 150;
const score = (team: Team, delta: number): Command => ({ type: 'score', team, delta });
const foul = (team: Team, delta: number): Command => ({ type: 'foul', team, delta });

@Component({
  selector: 'app-control-page',
  template: `
    <div class="mode">MODE: {{ mode() === 'game' ? 'GAME' : 'FOULS / CORRECTIONS' }}</div>
    <div class="keys">
      @for (key of keys(); track $index) {
        <button class="key" [class.lit]="lit() === $index" [class.disabled]="socket.status() !== 'open' && !key.mode" (click)="press($index)">
          <span class="num">{{ $index + 1 }}</span>
          <span class="label">{{ key.label }}</span>
        </button>
      }
    </div>
    <div class="hint">H horn · P next period · Shift+R reset</div>
  `,
  styles: `
    :host { display: block; background: #111; color: #eee; padding: 10px; font-family: system-ui, sans-serif; }
    .mode { font-size: 13px; letter-spacing: .1em; color: #8ab4f8; margin-bottom: 8px; }
    .keys { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .key {
      position: relative; height: 64px; border: 1px solid #333; border-radius: 6px;
      background: #1c1c1e; color: inherit; font: bold 15px system-ui; white-space: pre-line; cursor: pointer;
    }
    .key.lit { background: #ffcc00; color: #000; }
    .key.disabled { opacity: .35; }
    .num { position: absolute; top: 4px; left: 6px; font-size: 10px; opacity: .6; }
    .hint { margin-top: 8px; font-size: 11px; opacity: .5; }
  `,
  host: { '(document:keydown)': 'onKey($event)' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ControlPage {
  protected readonly socket = inject(MatchSocket);
  protected readonly mode = signal<Mode>('game');
  protected readonly lit = signal<number | null>(null);

  protected readonly keys = computed<SoftKey[]>(() => {
    const running = this.socket.state()?.clock.running ?? false;
    const clockKey: SoftKey = running
      ? { label: 'STOP\nCLOCK', command: { type: 'clock.stop' } }
      : { label: 'START\nCLOCK', command: { type: 'clock.start' } };

    if (this.mode() === 'game') {
      return [
        { label: 'HOME\n+1', command: score('home', 1) },
        { label: 'HOME\n+2', command: score('home', 2) },
        { label: 'HOME\n+3', command: score('home', 3) },
        clockKey,
        { label: 'GUEST\n+1', command: score('away', 1) },
        { label: 'GUEST\n+2', command: score('away', 2) },
        { label: 'GUEST\n+3', command: score('away', 3) },
        { label: 'MORE ▸', mode: 'more' },
      ];
    }
    return [
      { label: 'HOME\nFOUL +1', command: foul('home', 1) },
      { label: 'HOME\nFOUL −1', command: foul('home', -1) },
      { label: 'HOME\nSCORE −1', command: score('home', -1) },
      clockKey,
      { label: 'GUEST\nFOUL +1', command: foul('away', 1) },
      { label: 'GUEST\nFOUL −1', command: foul('away', -1) },
      { label: 'GUEST\nSCORE −1', command: score('away', -1) },
      { label: '◂ BACK', mode: 'game' },
    ];
  });

  private flashTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.flashTimer));
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.repeat) return;

    if (event.key >= '1' && event.key <= '8') this.press(Number(event.key) - 1);
    else if (event.key === 'h' || event.key === 'H') this.socket.send({ type: 'horn' });
    else if (event.key === 'p' || event.key === 'P') this.socket.send({ type: 'period.next' });
    else if (event.key === 'R' && event.shiftKey) this.socket.send({ type: 'reset' });
  }

  protected press(index: number): void {
    const key = this.keys()[index];
    if (!key) return;
    if (key.mode) {
      this.mode.set(key.mode);
    } else if (key.command && !this.socket.send(key.command)) {
      return;
    }
    this.flash(index);
  }

  private flash(index: number): void {
    clearTimeout(this.flashTimer);
    this.lit.set(index);
    this.flashTimer = setTimeout(() => this.lit.set(null), LED_FLASH_MS);
  }
}