export interface FormulaFunction {
  name: string;
  signature: string;
  description: string;
}

export const FORMULA_FUNCTIONS: FormulaFunction[] = [
  { name: 'SUM', signature: 'SUM(value1, [value2], ...)', description: 'Adds numbers or ranges' },
  { name: 'AVERAGE', signature: 'AVERAGE(value1, [value2], ...)', description: 'Returns the mean of numeric values' },
  { name: 'IF', signature: 'IF(test, then, [else])', description: 'Returns one value or another based on a test' },
  { name: 'COUNT', signature: 'COUNT(value1, [value2], ...)', description: 'Counts numeric values' },
  { name: 'COUNTA', signature: 'COUNTA(value1, [value2], ...)', description: 'Counts non-empty values' },
  { name: 'MIN', signature: 'MIN(value1, [value2], ...)', description: 'Returns the smallest number' },
  { name: 'MAX', signature: 'MAX(value1, [value2], ...)', description: 'Returns the largest number' },
  { name: 'ROUND', signature: 'ROUND(number, digits)', description: 'Rounds a number to a set of digits' },
  { name: 'ABS', signature: 'ABS(number)', description: 'Returns the absolute value' },
  { name: 'PRODUCT', signature: 'PRODUCT(value1, [value2], ...)', description: 'Multiplies numbers together' },
  { name: 'MEDIAN', signature: 'MEDIAN(value1, [value2], ...)', description: 'Returns the middle value' },
  { name: 'SQRT', signature: 'SQRT(number)', description: 'Returns the square root' },
  { name: 'POWER', signature: 'POWER(number, power)', description: 'Raises a number to a power' },
  { name: 'MOD', signature: 'MOD(number, divisor)', description: 'Returns the remainder after division' },
  { name: 'INT', signature: 'INT(number)', description: 'Rounds a number down to an integer' },
  { name: 'CONCAT', signature: 'CONCAT(value1, [value2], ...)', description: 'Joins text values together' },
  { name: 'LEN', signature: 'LEN(text)', description: 'Returns the length of a text value' },
  { name: 'UPPER', signature: 'UPPER(text)', description: 'Converts text to uppercase' },
  { name: 'LOWER', signature: 'LOWER(text)', description: 'Converts text to lowercase' },
  { name: 'TRIM', signature: 'TRIM(text)', description: 'Removes extra spaces from text' },
  { name: 'AND', signature: 'AND(test1, [test2], ...)', description: 'Returns TRUE when every test is true' },
  { name: 'OR', signature: 'OR(test1, [test2], ...)', description: 'Returns TRUE when any test is true' },
  { name: 'NOT', signature: 'NOT(test)', description: 'Reverses a TRUE or FALSE value' },
  { name: 'IFERROR', signature: 'IFERROR(value, fallback)', description: 'Returns a fallback when a formula errors' }
];
