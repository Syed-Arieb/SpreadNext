export interface FormulaReference {
  top: number;
  bottom: number;
  left: number;
  right: number;
  colorIndex: number;
}

interface ReferenceToken {
  start: number;
  end: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const REFERENCE_PATTERN = /\$?[A-Za-z]+\$?\d+/g;

export function parseFormulaReferences(formula: string): FormulaReference[] {
  if (!formula.trimStart().startsWith('=')) {
    return [];
  }

  const masked = maskStrings(formula);
  const tokens: ReferenceToken[] = [];

  for (const match of masked.matchAll(REFERENCE_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;

    if (!isReferenceToken(masked, start, end)) {
      continue;
    }

    const token = createToken(match[0]);
    if (token) {
      tokens.push({ start, end, ...token });
    }
  }

  const ranges: Omit<FormulaReference, 'colorIndex'>[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];

    if (next && /^\s*:\s*$/.test(masked.slice(token.end, next.start))) {
      ranges.push({
        top: Math.min(token.top, next.top),
        bottom: Math.max(token.bottom, next.bottom),
        left: Math.min(token.left, next.left),
        right: Math.max(token.right, next.right)
      });
      index += 1;
      continue;
    }

    ranges.push({
      top: token.top,
      bottom: token.bottom,
      left: token.left,
      right: token.right
    });
  }

  const seen = new Set<string>();
  const references: FormulaReference[] = [];

  for (const range of ranges) {
    const key = `${range.top}:${range.left}:${range.bottom}:${range.right}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    references.push({ ...range, colorIndex: references.length });
  }

  return references;
}

function maskStrings(formula: string): string {
  let masked = '';
  let inString = false;

  for (const character of formula) {
    if (character === '"') {
      inString = !inString;
      masked += character;
    } else {
      masked += inString ? ' ' : character;
    }
  }

  return masked;
}

function isReferenceToken(formula: string, start: number, end: number): boolean {
  const previous = formula[start - 1];
  const next = formula[end];

  if (previous && /[A-Za-z0-9_$.]/.test(previous)) {
    return false;
  }

  if (next && /[A-Za-z0-9_$.]/.test(next)) {
    return false;
  }

  return next !== '(';
}

function createToken(value: string): Omit<ReferenceToken, 'start' | 'end'> | null {
  const match = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(value);
  if (!match) {
    return null;
  }

  const row = Number(match[2]) - 1;
  if (row < 0) {
    return null;
  }

  const left = columnIndex(match[1]);

  return {
    top: row,
    bottom: row,
    left,
    right: left
  };
}

function columnIndex(label: string): number {
  let value = 0;

  for (const character of label.toUpperCase()) {
    value = value * 26 + character.charCodeAt(0) - 64;
  }

  return value - 1;
}
