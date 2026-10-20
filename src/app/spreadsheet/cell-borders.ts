export type BorderSide = 'top' | 'right' | 'bottom' | 'left';

export type DiagonalSide = 'diagonalDown' | 'diagonalUp';

export type BorderDirection = BorderSide | DiagonalSide;

export type BorderLineStyle =
  | 'thin'
  | 'medium'
  | 'thick'
  | 'dashed'
  | 'dotted'
  | 'double';

export type BorderPreset =
  | 'all'
  | 'outer'
  | 'inner'
  | 'horizontal'
  | 'vertical'
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'diagonalDown'
  | 'diagonalUp'
  | 'none';

export interface CellBorder {
  style: BorderLineStyle;
  color: string;
}

export type CellBorders = Record<BorderDirection, CellBorder | null>;

export interface BorderRange {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const BORDER_SIDES: readonly BorderSide[] = ['top', 'right', 'bottom', 'left'];

export const DIAGONAL_SIDES: readonly DiagonalSide[] = ['diagonalDown', 'diagonalUp'];

export const BORDER_DIRECTIONS: readonly BorderDirection[] = [
  ...BORDER_SIDES,
  ...DIAGONAL_SIDES
];

export const BORDER_LINE_STYLES: readonly BorderLineStyle[] = [
  'thin',
  'medium',
  'thick',
  'dashed',
  'dotted',
  'double'
];

export const OPPOSITE_SIDE: Record<BorderSide, BorderSide> = {
  top: 'bottom',
  right: 'left',
  bottom: 'top',
  left: 'right'
};

const DEFAULT_BORDER_COLOR = '#64748b';
const BORDER_WIDTHS: Record<BorderLineStyle, number> = {
  thin: 1,
  medium: 2,
  thick: 3,
  dashed: 1,
  dotted: 1,
  double: 3
};

export function createCellBorders(): CellBorders {
  return {
    top: null,
    right: null,
    bottom: null,
    left: null,
    diagonalDown: null,
    diagonalUp: null
  };
}

export function cloneCellBorders(borders: CellBorders): CellBorders {
  const clone = createCellBorders();

  for (const direction of BORDER_DIRECTIONS) {
    const border = borders[direction];
    clone[direction] = border ? { ...border } : null;
  }

  return clone;
}

export function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) {
    return null;
  }

  const color = match[1].toLowerCase();
  return `#${color.length === 3 ? color.split('').map(part => part + part).join('') : color}`;
}

export function normalizeCellBorder(value: unknown): CellBorder | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const source = value as Partial<CellBorder>;
  if (!BORDER_LINE_STYLES.includes(source.style as BorderLineStyle)) {
    return null;
  }

  return {
    style: source.style as BorderLineStyle,
    color: normalizeColor(source.color) ?? DEFAULT_BORDER_COLOR
  };
}

export function normalizeCellBorders(value: unknown): CellBorders {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const borders = createCellBorders();

  for (const direction of BORDER_DIRECTIONS) {
    borders[direction] = normalizeCellBorder(source[direction]);
  }

  return borders;
}

export function borderWidth(style: BorderLineStyle): number {
  return BORDER_WIDTHS[style];
}

export function borderCss(border: CellBorder | null): string | null {
  if (!border) {
    return null;
  }

  const lineStyle = border.style === 'thin' || border.style === 'medium' || border.style === 'thick'
    ? 'solid'
    : border.style;

  return `${BORDER_WIDTHS[border.style]}px ${lineStyle} ${border.color}`;
}

export function diagonalGradient(side: DiagonalSide, border: CellBorder | null): string | null {
  if (!border) {
    return null;
  }

  const width = BORDER_WIDTHS[border.style];
  const direction = side === 'diagonalDown' ? 'to bottom right' : 'to top right';

  return `linear-gradient(${direction}, transparent calc(50% - ${width}px), ` +
    `${border.color} 50%, transparent calc(50% + ${width}px))`;
}

export function borderSidesForPreset(
  preset: BorderPreset,
  row: number,
  column: number,
  range: BorderRange
): BorderSide[] {
  switch (preset) {
    case 'all': {
      const sides: BorderSide[] = ['right', 'bottom'];
      if (row === range.top) {
        sides.push('top');
      }
      if (column === range.left) {
        sides.push('left');
      }
      return sides;
    }
    case 'outer': {
      const sides: BorderSide[] = [];
      if (row === range.top) {
        sides.push('top');
      }
      if (row === range.bottom) {
        sides.push('bottom');
      }
      if (column === range.left) {
        sides.push('left');
      }
      if (column === range.right) {
        sides.push('right');
      }
      return sides;
    }
    case 'inner': {
      const sides: BorderSide[] = [];
      if (row > range.top) {
        sides.push('top');
      }
      if (column > range.left) {
        sides.push('left');
      }
      return sides;
    }
    case 'horizontal':
      return row > range.top ? ['top'] : [];
    case 'vertical':
      return column > range.left ? ['left'] : [];
    case 'top':
      return ['top'];
    case 'right':
      return ['right'];
    case 'bottom':
      return ['bottom'];
    case 'left':
      return ['left'];
    default:
      return [];
  }
}

export type BorderResolver = (row: number, column: number) => CellBorders | null;

function neighborCoordinates(
  row: number,
  column: number,
  side: BorderSide
): { row: number; column: number } {
  if (side === 'top') {
    return { row: row - 1, column };
  }

  if (side === 'right') {
    return { row, column: column + 1 };
  }

  if (side === 'bottom') {
    return { row: row + 1, column };
  }

  return { row, column: column - 1 };
}

export function applyBorderPreset(
  resolve: BorderResolver,
  range: BorderRange,
  preset: BorderPreset,
  border: CellBorder | null
): boolean {
  let changed = false;

  for (let row = range.top; row <= range.bottom; row += 1) {
    for (let column = range.left; column <= range.right; column += 1) {
      const borders = resolve(row, column);
      if (!borders) {
        continue;
      }

      for (const direction of BORDER_DIRECTIONS) {
        if (borders[direction]) {
          borders[direction] = null;
          changed = true;
        }
      }
    }
  }

  if (!border) {
    return changed;
  }

  if (preset === 'diagonalDown' || preset === 'diagonalUp') {
    for (let row = range.top; row <= range.bottom; row += 1) {
      for (let column = range.left; column <= range.right; column += 1) {
        const borders = resolve(row, column);
        if (!borders) {
          continue;
        }

        borders[preset] = { ...border };
        changed = true;
      }
    }

    return changed;
  }

  for (let row = range.top; row <= range.bottom; row += 1) {
    for (let column = range.left; column <= range.right; column += 1) {
      const borders = resolve(row, column);
      if (!borders) {
        continue;
      }

      for (const side of borderSidesForPreset(preset, row, column, range)) {
        const current = borders[side];
        if (!current || current.style !== border.style || current.color !== border.color) {
          borders[side] = { ...border };
          changed = true;
        }

        const position = neighborCoordinates(row, column, side);
        const neighbor = resolve(position.row, position.column);
        const opposite = OPPOSITE_SIDE[side];
        if (neighbor?.[opposite]) {
          neighbor[opposite] = null;
          changed = true;
        }
      }
    }
  }

  return changed;
}
