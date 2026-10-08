import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BoardLayout } from '../../lib/board-renderer';
import { BoardCanvas } from '../board-canvas/board-canvas';
import { MatchSocket } from '../match-socket';

@Component({
  selector: 'app-board-page',
  imports: [BoardCanvas],
  template: `
    @if (layout(); as layout) {
      @if (socket.state(); as state) {
        <app-board-canvas [layout]="layout" [data]="state" />
      }
    }
    @if (socket.status() !== 'open') {
      <div class="offline">NO LINK · reconnecting…</div>
    }
  `,
  styles: `
    :host { display: block; position: relative; }
    .offline {
      position: absolute; inset: auto 0 0 0; padding: 6px;
      background: #b00020; color: #fff; font: bold 14px system-ui; text-align: center;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardPage {
  protected readonly socket = inject(MatchSocket);
  protected readonly layout = toSignal(inject(HttpClient).get<BoardLayout>('layouts/basketball.json'));
}