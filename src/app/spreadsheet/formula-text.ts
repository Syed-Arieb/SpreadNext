export function normalizeFormula(value: string): string {
  const start = value.search(/\S/);

  if (start === -1 || value[start] !== '=') {
    return value;
  }

  let output = '';
  let depth = 0;
  let inString = false;

  for (let index = start; index < value.length; index += 1) {
    const character = value[index];

    if (inString) {
      output += character;

      if (character !== '"') {
        continue;
      }

      if (value[index + 1] === '"') {
        output += value[index + 1];
        index += 1;
        continue;
      }

      inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }

    if (character === '(') {
      depth += 1;
      output += character;
      continue;
    }

    if (character === ')') {
      if (depth === 0) {
        continue;
      }

      output = output.replace(/[,+\-*/^&<>=:]\s*$/, '').trimEnd();
      depth -= 1;
      output += ')';
      continue;
    }

    output += character;
  }

  if (inString) {
    output += '"';
  }

  output = output.replace(/[\s,+\-*/^&<>=:]+$/, '');
  output += ')'.repeat(depth);

  return output;
}
