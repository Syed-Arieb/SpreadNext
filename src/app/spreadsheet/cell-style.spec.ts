import {
  DEFAULT_CELL_STYLE,
  clearCellFormatting,
  cloneCellStyle,
  hasCellBorders,
  hasCellFormatting
} from './cell-style';

describe('cell style', () => {
  it('clones styles without sharing border objects', () => {
    const style = cloneCellStyle(DEFAULT_CELL_STYLE);
    style.borders.top = { style: 'thin', color: '#000000' };
    style.bold = true;

    expect(DEFAULT_CELL_STYLE.borders.top).toBeNull();
    expect(DEFAULT_CELL_STYLE.bold).toBe(false);
  });

  it('detects formatting on a cell', () => {
    expect(hasCellFormatting(DEFAULT_CELL_STYLE)).toBe(false);
    expect(hasCellFormatting({ ...DEFAULT_CELL_STYLE, bold: true })).toBe(true);
    expect(hasCellFormatting({ ...DEFAULT_CELL_STYLE, align: 'center' })).toBe(true);
    expect(hasCellFormatting({ ...DEFAULT_CELL_STYLE, background: '#ff0000' })).toBe(true);
  });

  it('detects borders on a cell', () => {
    expect(hasCellBorders(DEFAULT_CELL_STYLE.borders)).toBe(false);
    expect(hasCellBorders({
      ...DEFAULT_CELL_STYLE.borders,
      diagonalUp: { style: 'thin', color: '#000000' }
    })).toBe(true);
  });

  it('clears every kind of formatting', () => {
    const style = {
      bold: true,
      italic: true,
      underline: true,
      strike: true,
      align: 'center' as const,
      background: '#ff0000',
      borders: {
        top: { style: 'thin' as const, color: '#000000' },
        right: null,
        bottom: null,
        left: null,
        diagonalDown: null,
        diagonalUp: null
      }
    };

    const cleared = clearCellFormatting();

    expect(cleared).toEqual(DEFAULT_CELL_STYLE);
    expect(cleared.borders).not.toBe(DEFAULT_CELL_STYLE.borders);
    expect(hasCellFormatting(cleared)).toBe(false);
    expect(style.bold).toBe(true);
  });
});
