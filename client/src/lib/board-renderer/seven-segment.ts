const SEGMENTS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
  ' ': '',
};

const DIGIT_WIDTH = 0.55;
const THICKNESS = 0.12;
const SPACING = 0.15;
const SEPARATOR_WIDTH = 0.3;
const OFF_ALPHA = 0.1;

function charWidth(ch: string, h: number): number {
  return ch === ':' || ch === '.' ? h * SEPARATOR_WIDTH : h * DIGIT_WIDTH;
}

export function measureSegmentText(text: string, h: number): number {
  let width = 0;
  for (const ch of text) width += charWidth(ch, h) + h * SPACING;
  return width - h * SPACING;
}

export function drawSegmentText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, h: number, color: string): void {
  let cursor = x - measureSegmentText(text, h) / 2;
  ctx.fillStyle = color;
  for (const ch of text) {
    if (ch === ':' || ch === '.') {
      drawSeparator(ctx, ch, cursor, y, h);
    } else {
      drawDigit(ctx, SEGMENTS[ch] ?? '', cursor, y, h);
    }
    cursor += charWidth(ch, h) + h * SPACING;
  }
}

function drawDigit(ctx: CanvasRenderingContext2D, lit: string, x: number, y: number, h: number): void {
  const w = h * DIGIT_WIDTH;
  const t = h * THICKNESS;
  const half = h / 2;
  const vertical = half - t * 1.5;
  const rects: Record<string, [number, number, number, number]> = {
    a: [x + t, y, w - 2 * t, t],
    b: [x + w - t, y + t, t, vertical],
    c: [x + w - t, y + half + t / 2, t, vertical],
    d: [x + t, y + h - t, w - 2 * t, t],
    e: [x, y + half + t / 2, t, vertical],
    f: [x, y + t, t, vertical],
    g: [x + t, y + half - t / 2, w - 2 * t, t],
  };
  for (const [segment, [rx, ry, rw, rh]] of Object.entries(rects)) {
    ctx.globalAlpha = lit.includes(segment) ? 1 : OFF_ALPHA;
    ctx.beginPath();
    ctx.roundRect(rx, ry, rw, rh, t / 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawSeparator(ctx: CanvasRenderingContext2D, ch: string, x: number, y: number, h: number): void {
  const r = h * THICKNESS * 0.6;
  const cx = x + (h * SEPARATOR_WIDTH) / 2;
  const dots = ch === ':' ? [y + h * 0.3, y + h * 0.7] : [y + h - r];
  for (const cy of dots) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}