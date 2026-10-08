export interface BoardLayout {
  width: number;
  height: number;
  background: string;
  elements: BoardElement[];
}

export type BoardElement = TextElement | DigitsElement | ClockElement | IndicatorElement;

export interface TextElement {
  type: 'text';
  x: number;
  y: number;
  text?: string;
  bind?: string;
  size: number;
  color: string;
}

export interface DigitsElement {
  type: 'digits';
  x: number;
  y: number;
  bind: string;
  digits: number;
  height: number;
  color: string;
}

export interface ClockElement {
  type: 'clock';
  x: number;
  y: number;
  bind: string;
  height: number;
  color: string;
}

export interface IndicatorElement {
  type: 'indicator';
  x: number;
  y: number;
  bind: string;
  radius: number;
  color: string;
}
