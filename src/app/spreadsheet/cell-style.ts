import {
  BORDER_DIRECTIONS,
  CellBorders,
  cloneCellBorders,
  createCellBorders
} from './cell-borders';

export type CellAlign = 'left' | 'center' | 'right';

export interface CellStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  align: CellAlign;
  background: string | null;
  borders: CellBorders;
}

export const DEFAULT_CELL_STYLE: CellStyle = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  align: 'left',
  background: null,
  borders: createCellBorders()
};

export function cloneCellStyle(style: CellStyle): CellStyle {
  return {
    ...style,
    borders: cloneCellBorders(style.borders)
  };
}

export function hasCellBorders(borders: CellBorders): boolean {
  return BORDER_DIRECTIONS.some(direction => borders[direction] !== null);
}

export function hasCellFormatting(style: CellStyle): boolean {
  return style.bold ||
    style.italic ||
    style.underline ||
    style.strike ||
    style.align !== DEFAULT_CELL_STYLE.align ||
    style.background !== null ||
    hasCellBorders(style.borders);
}

export function clearCellFormatting(): CellStyle {
  return cloneCellStyle(DEFAULT_CELL_STYLE);
}
