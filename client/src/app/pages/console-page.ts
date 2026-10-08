import { ChangeDetectionStrategy, Component } from '@angular/core';
import { BoardPage } from './board-page';
import { ControlPage } from './control-page';

@Component({
  selector: 'app-console-page',
  imports: [BoardPage, ControlPage],
  template: `
    <div class="device">
      <app-board-page />
      <app-control-page />
    </div>
  `,
  styles: `
    .device {
      max-width: 640px; margin: 24px auto; border: 12px solid #2a2a2a; border-radius: 16px;
      overflow: hidden; box-shadow: 0 10px 40px #0008;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConsolePage {}