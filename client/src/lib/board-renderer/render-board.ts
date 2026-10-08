import { BoardElement, BoardLayout } from './layout';
import { drawSegmentText } from './seven-segment';

export function resolve(data: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((obj, key) => (obj as Record<string, unknown> | undefined)?.[key], data);
}

export function formatClock(ms: number): string {
  if (ms >= 60_000) {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, ' ')}:${String(seconds).padStart(2, '0')}`;
  }
  const tenths = Math.floor(ms / 100);
  return `${String(Math.floor(tenths / 10)).padStart(2, ' ')}.${tenths % 10}`;
}

export function renderBoard(ctx: CanvasRenderingContext2D, layout: BoardLayout, data: unknown): void {
  ctx.fillStyle = layout.background;
  ctx.fillRect(0, 0, layout.width, layout.height);
  for (const element of layout.elements) {
    renderElement(ctx, element, data);
  }
}

function renderElement(ctx: CanvasRenderingContext2D, el: BoardElement, data: unknown): void {
  switch (el.type) {
    case 'text': {
      const text = el.bind ? String(resolve(data, el.bind) ?? '') : (el.text ?? '');
      ctx.fillStyle = el.color;
      ctx.font = `bold ${el.size}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, el.x, el.y);
      return;
    }
    case 'digits': {
      const value = Number(resolve(data, el.bind) ?? 0);
      const text = String(value).padStart(el.digits, ' ').slice(-el.digits);
      drawSegmentText(ctx, text, el.x, el.y, el.height, el.color);
      return;
    }
    case 'clock': {
      const ms = Number(resolve(data, el.bind) ?? 0);
      drawSegmentText(ctx, formatClock(ms), el.x, el.y, el.height, el.color);
      return;
    }
    case 'indicator': {
      const on = resolve(data, el.bind) === true;
      ctx.fillStyle = el.color;
      ctx.globalAlpha = on ? 1 : 0.15;
      ctx.shadowColor = el.color;
      ctx.shadowBlur = on ? el.radius : 0;
      ctx.beginPath();
      ctx.arc(el.x, el.y, el.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      return;
    }
  }
}