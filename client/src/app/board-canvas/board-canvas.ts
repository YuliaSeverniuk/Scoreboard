import { ChangeDetectionStrategy, Component, ElementRef, effect, input, viewChild } from '@angular/core';
import { BoardLayout, renderBoard } from '../../lib/board-renderer';

const FRAME_BUDGET_MS = 16;

@Component({
  selector: 'app-board-canvas',
  template: `<canvas #canvas></canvas>`,
  styles: `
    :host { display: block; }
    canvas { display: block; width: 100%; height: auto; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardCanvas {
    readonly layout = input.required<BoardLayout>();
    readonly data = input.required<unknown>();

    private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

    constructor() {
        effect((onCleanup) => {
          const canvas = this.canvas().nativeElement;
          const layout = this.layout();
          const data = this.data();

          const frame = requestAnimationFrame(() => this.draw(canvas, layout, data));
          onCleanup(() => cancelAnimationFrame(frame));
        });
    }

    private draw(canvas: HTMLCanvasElement, layout: BoardLayout, data: unknown): void {
      const started = performance.now();

      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== layout.width * dpr) {
        canvas.width = layout.width * dpr;
        canvas.height = layout.height * dpr;
      }

      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderBoard(ctx, layout, data);

      const took = performance.now() - started;
      if (took > FRAME_BUDGET_MS) console.warn(`Board render took ${took.toFixed(1)} ms`);
    }
}