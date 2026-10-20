import {
  applyBorderPreset,
  borderCss,
  borderSidesForPreset,
  cloneCellBorders,
  createCellBorders,
  diagonalGradient,
  normalizeCellBorders,
  normalizeColor
} from './cell-borders';

describe('cell borders', () => {
  it('normalizes hex colors', () => {
    expect(normalizeColor('#ABC')).toBe('#aabbcc');
    expect(normalizeColor(' #123456 ')).toBe('#123456');
    expect(normalizeColor('red')).toBeNull();
    expect(normalizeColor(12)).toBeNull();
  });

  it('normalizes stored border objects', () => {
    expect(normalizeCellBorders({
      top: { style: 'medium', color: '#FF0000' },
      right: { style: 'unknown', color: '#fff' },
      bottom: null,
      left: { style: 'dotted', color: 'nope' },
      diagonalDown: { style: 'thick', color: '#0000ff' }
    })).toEqual({
      top: { style: 'medium', color: '#ff0000' },
      right: null,
      bottom: null,
      left: { style: 'dotted', color: '#64748b' },
      diagonalDown: { style: 'thick', color: '#0000ff' },
      diagonalUp: null
    });
  });

  it('clones borders without sharing objects', () => {
    const original = createCellBorders();
    original.top = { style: 'thick', color: '#000000' };
    const clone = cloneCellBorders(original);

    clone.top!.color = '#ffffff';
    expect(original.top!.color).toBe('#000000');
  });

  it('builds CSS borders', () => {
    expect(borderCss({ style: 'thin', color: '#000000' })).toBe('1px solid #000000');
    expect(borderCss({ style: 'medium', color: '#000000' })).toBe('2px solid #000000');
    expect(borderCss({ style: 'dashed', color: '#ff0000' })).toBe('1px dashed #ff0000');
    expect(borderCss({ style: 'double', color: '#00ff00' })).toBe('3px double #00ff00');
    expect(borderCss(null)).toBeNull();
  });

  it('calculates preset sides inside and around a selection', () => {
    const range = { top: 1, right: 3, bottom: 2, left: 2 };

    expect(borderSidesForPreset('all', 1, 2, range)).toEqual(['right', 'bottom', 'top', 'left']);
    expect(borderSidesForPreset('all', 2, 3, range)).toEqual(['right', 'bottom']);
    expect(borderSidesForPreset('outer', 1, 2, range)).toEqual(['top', 'left']);
    expect(borderSidesForPreset('outer', 2, 3, range)).toEqual(['bottom', 'right']);
    expect(borderSidesForPreset('inner', 1, 2, range)).toEqual([]);
    expect(borderSidesForPreset('inner', 2, 3, range)).toEqual(['top', 'left']);
  });

  it('calculates directional presets', () => {
    const range = { top: 0, right: 1, bottom: 1, left: 0 };

    expect(borderSidesForPreset('horizontal', 0, 0, range)).toEqual([]);
    expect(borderSidesForPreset('horizontal', 1, 0, range)).toEqual(['top']);
    expect(borderSidesForPreset('vertical', 0, 0, range)).toEqual([]);
    expect(borderSidesForPreset('vertical', 0, 1, range)).toEqual(['left']);
    expect(borderSidesForPreset('bottom', 0, 0, range)).toEqual(['bottom']);
    expect(borderSidesForPreset('none', 0, 0, range)).toEqual([]);
  });

  it('applies a preset without duplicating shared borders', () => {
    const grid = new Map<string, ReturnType<typeof createCellBorders>>();
    const resolve = (row: number, column: number) => {
      const key = `${row}:${column}`;
      if (!grid.has(key)) {
        grid.set(key, createCellBorders());
      }
      return grid.get(key)!;
    };
    const range = { top: 0, right: 1, bottom: 1, left: 0 };
    const border = { style: 'thin' as const, color: '#000000' };

    expect(applyBorderPreset(resolve, range, 'all', border)).toBe(true);
    expect(resolve(0, 0).top).toEqual(border);
    expect(resolve(0, 0).left).toEqual(border);
    expect(resolve(0, 0).right).toEqual(border);
    expect(resolve(0, 1).left).toBeNull();
    expect(resolve(1, 0).top).toBeNull();
    expect(resolve(1, 1).top).toBeNull();
    expect(resolve(1, 1).left).toBeNull();
  });

  it('clears borders when the preset is none', () => {
    const borders = createCellBorders();
    borders.top = { style: 'thick', color: '#000000' };
    const resolve = () => borders;

    expect(applyBorderPreset(resolve, { top: 0, right: 0, bottom: 0, left: 0 }, 'none', null)).toBe(true);
    expect(borders.top).toBeNull();
  });

  it('applies diagonals without touching box borders', () => {
    const borders = createCellBorders();
    borders.top = { style: 'thin', color: '#000000' };
    const resolve = () => borders;

    applyBorderPreset(resolve, { top: 0, right: 0, bottom: 0, left: 0 }, 'diagonalDown', {
      style: 'thick',
      color: '#ff0000'
    });

    expect(borders.diagonalDown).toEqual({ style: 'thick', color: '#ff0000' });
    expect(borders.diagonalUp).toBeNull();
    expect(borders.top).toBeNull();
  });

  it('builds diagonal gradients', () => {
    expect(diagonalGradient('diagonalDown', { style: 'medium', color: '#ff0000' }))
      .toBe('linear-gradient(to bottom right, transparent calc(50% - 2px), #ff0000 50%, transparent calc(50% + 2px))');
    expect(diagonalGradient('diagonalUp', null)).toBeNull();
  });
});
