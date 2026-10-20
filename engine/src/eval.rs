use crate::parser::{parse_formula, BinaryOp, Expr, RangeRef, UnaryOp};
use crate::value::{ErrorCode, Value};

const STATE_NEW: u8 = 0;
const STATE_EVALUATING: u8 = 1;
const STATE_DONE: u8 = 2;

enum Arg {
    Value(Value),
    Range(Vec<Value>),
}

pub struct Sheet {
    rows: usize,
    columns: usize,
    raw: Vec<Vec<String>>,
    cache: Vec<Vec<Option<Value>>>,
    state: Vec<Vec<u8>>,
}

impl Sheet {
    pub fn new(rows: usize, columns: usize, cells: Vec<Vec<String>>) -> Self {
        let mut raw = vec![vec![String::new(); columns]; rows];

        for (row, values) in cells.into_iter().enumerate().take(rows) {
            for (column, value) in values.into_iter().enumerate().take(columns) {
                raw[row][column] = value;
            }
        }

        Self {
            rows,
            columns,
            raw,
            cache: vec![vec![None; columns]; rows],
            state: vec![vec![STATE_NEW; columns]; rows],
        }
    }

    pub fn calculate(&mut self) -> Vec<Vec<String>> {
        let mut output = vec![vec![String::new(); self.columns]; self.rows];

        for (row, output_row) in output.iter_mut().enumerate() {
            for (column, value) in output_row.iter_mut().enumerate() {
                *value = self.cell_value(row, column).display();
            }
        }

        output
    }

    fn cell_value(&mut self, row: usize, column: usize) -> Value {
        if row >= self.rows || column >= self.columns {
            return Value::Error(ErrorCode::Ref);
        }

        match self.state[row][column] {
            STATE_DONE => {
                return self.cache[row][column]
                    .clone()
                    .unwrap_or(Value::Text(String::new()))
            }
            STATE_EVALUATING => return Value::Error(ErrorCode::Cycle),
            _ => {}
        }

        self.state[row][column] = STATE_EVALUATING;
        let raw = self.raw[row][column].clone();
        let value = self.evaluate_raw(&raw);
        self.cache[row][column] = Some(value.clone());
        self.state[row][column] = STATE_DONE;
        value
    }

    fn evaluate_raw(&mut self, raw: &str) -> Value {
        let trimmed = raw.trim_start();

        if let Some(formula) = trimmed.strip_prefix('=') {
            if formula.trim().is_empty() {
                return Value::Text(String::new());
            }

            return match parse_formula(formula) {
                Ok(expression) => self.evaluate(&expression),
                Err(error) => Value::Error(error),
            };
        }

        literal_value(raw)
    }

    fn evaluate(&mut self, expression: &Expr) -> Value {
        match expression {
            Expr::Number(value) => Value::Number(*value),
            Expr::Text(value) => Value::Text(value.clone()),
            Expr::Bool(value) => Value::Bool(*value),
            Expr::Ref(reference) => self.cell_value(reference.row, reference.column),
            Expr::Range(_) => Value::Error(ErrorCode::Value),
            Expr::Unary { op, value } => {
                let value = self.evaluate(value);
                if value.is_error() {
                    return value;
                }
                match value.to_number() {
                    Ok(number) => match op {
                        UnaryOp::Plus => Value::Number(number),
                        UnaryOp::Minus => Value::Number(-number),
                    },
                    Err(error) => Value::Error(error),
                }
            }
            Expr::Percent(value) => {
                let value = self.evaluate(value);
                if value.is_error() {
                    return value;
                }
                match value.to_number() {
                    Ok(number) => Value::Number(number / 100.0),
                    Err(error) => Value::Error(error),
                }
            }
            Expr::Binary { op, left, right } => {
                if matches!(
                    op,
                    BinaryOp::Equal
                        | BinaryOp::NotEqual
                        | BinaryOp::Less
                        | BinaryOp::LessEqual
                        | BinaryOp::Greater
                        | BinaryOp::GreaterEqual
                ) {
                    return self.compare(*op, left, right);
                }

                let left = self.evaluate(left);
                if left.is_error() {
                    return left;
                }
                let right = self.evaluate(right);
                if right.is_error() {
                    return right;
                }

                self.binary(*op, left, right)
            }
            Expr::Call { name, args } => self.call(name, args),
        }
    }

    fn compare(&mut self, operation: BinaryOp, left: &Expr, right: &Expr) -> Value {
        let left = self.evaluate(left);
        if left.is_error() {
            return left;
        }
        let right = self.evaluate(right);
        if right.is_error() {
            return right;
        }

        let ordering = match (&left, &right) {
            (Value::Text(left), Value::Text(right)) => Some(compare_text(left, right)),
            _ => {
                let left_number = left.to_number();
                let right_number = right.to_number();
                match (left_number, right_number) {
                    (Ok(left), Ok(right)) => left.partial_cmp(&right),
                    _ => {
                        let left = left.to_text().unwrap_or_default();
                        let right = right.to_text().unwrap_or_default();
                        Some(compare_text(&left, &right))
                    }
                }
            }
        };

        let Some(ordering) = ordering else {
            return Value::Bool(false);
        };

        let result = match operation {
            BinaryOp::Equal => ordering.is_eq(),
            BinaryOp::NotEqual => !ordering.is_eq(),
            BinaryOp::Less => ordering.is_lt(),
            BinaryOp::LessEqual => !ordering.is_gt(),
            BinaryOp::Greater => ordering.is_gt(),
            BinaryOp::GreaterEqual => !ordering.is_lt(),
            _ => false,
        };

        Value::Bool(result)
    }

    fn binary(&mut self, operation: BinaryOp, left: Value, right: Value) -> Value {
        if operation == BinaryOp::Concat {
            let left = left.to_text();
            let right = right.to_text();
            return match (left, right) {
                (Ok(left), Ok(right)) => Value::Text(format!("{left}{right}")),
                (Err(error), _) | (_, Err(error)) => Value::Error(error),
            };
        }

        let left = match left.to_number() {
            Ok(value) => value,
            Err(error) => return Value::Error(error),
        };
        let right = match right.to_number() {
            Ok(value) => value,
            Err(error) => return Value::Error(error),
        };

        match operation {
            BinaryOp::Add => Value::number(left + right),
            BinaryOp::Subtract => Value::number(left - right),
            BinaryOp::Multiply => Value::number(left * right),
            BinaryOp::Divide => {
                if right == 0.0 {
                    Value::Error(ErrorCode::Div0)
                } else {
                    Value::number(left / right)
                }
            }
            BinaryOp::Power => Value::number(left.powf(right)),
            _ => Value::Error(ErrorCode::Value),
        }
    }

    fn call(&mut self, name: &str, args: &[Expr]) -> Value {
        match name {
            "IF" => return self.evaluate_if(args),
            "IFERROR" => return self.evaluate_iferror(args),
            _ => {}
        }

        let mut evaluated = Vec::with_capacity(args.len());
        for argument in args {
            evaluated.push(self.evaluate_argument(argument));
        }

        match name {
            "SUM" => number_reduce(&evaluated, 0.0, |total, value| total + value),
            "AVERAGE" => {
                let numbers = numbers(&evaluated);
                match numbers {
                    Ok(values) if values.is_empty() => Value::Error(ErrorCode::Div0),
                    Ok(values) => Value::Number(values.iter().sum::<f64>() / values.len() as f64),
                    Err(error) => Value::Error(error),
                }
            }
            "COUNT" => match numbers(&evaluated) {
                Ok(values) => Value::Number(values.len() as f64),
                Err(error) => Value::Error(error),
            },
            "COUNTA" => Value::Number(count_values(&evaluated) as f64),
            "MIN" => {
                let numbers = numbers(&evaluated);
                match numbers {
                    Ok(values) if values.is_empty() => Value::Number(0.0),
                    Ok(values) => {
                        Value::Number(values.iter().copied().fold(f64::INFINITY, f64::min))
                    }
                    Err(error) => Value::Error(error),
                }
            }
            "MAX" => {
                let numbers = numbers(&evaluated);
                match numbers {
                    Ok(values) if values.is_empty() => Value::Number(0.0),
                    Ok(values) => {
                        Value::Number(values.iter().copied().fold(f64::NEG_INFINITY, f64::max))
                    }
                    Err(error) => Value::Error(error),
                }
            }
            "PRODUCT" => number_reduce(&evaluated, 1.0, |total, value| total * value),
            "MEDIAN" => {
                let numbers = numbers(&evaluated);
                match numbers {
                    Ok(values) if values.is_empty() => Value::Error(ErrorCode::Num),
                    Ok(mut values) => {
                        values.sort_by(|left, right| {
                            left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal)
                        });
                        let middle = values.len() / 2;
                        if values.len() % 2 == 0 {
                            Value::Number((values[middle - 1] + values[middle]) / 2.0)
                        } else {
                            Value::Number(values[middle])
                        }
                    }
                    Err(error) => Value::Error(error),
                }
            }
            "ROUND" => round_function(&evaluated),
            "ABS" => unary_number(&evaluated, f64::abs),
            "SQRT" => unary_number(&evaluated, |value| {
                if value < 0.0 {
                    f64::NAN
                } else {
                    value.sqrt()
                }
            }),
            "INT" => unary_number(&evaluated, f64::floor),
            "POWER" => {
                if evaluated.len() != 2 {
                    return Value::Error(ErrorCode::Value);
                }
                let base = argument_number(&evaluated[0]);
                let exponent = argument_number(&evaluated[1]);
                match (base, exponent) {
                    (Ok(base), Ok(exponent)) => Value::number(base.powf(exponent)),
                    (Err(error), _) | (_, Err(error)) => Value::Error(error),
                }
            }
            "MOD" => {
                if evaluated.len() != 2 {
                    return Value::Error(ErrorCode::Value);
                }
                let dividend = argument_number(&evaluated[0]);
                let divisor = argument_number(&evaluated[1]);
                match (dividend, divisor) {
                    (_, Ok(0.0)) => Value::Error(ErrorCode::Div0),
                    (Ok(dividend), Ok(divisor)) => {
                        Value::Number(dividend - divisor * (dividend / divisor).floor())
                    }
                    (Err(error), _) | (_, Err(error)) => Value::Error(error),
                }
            }
            "CONCAT" | "CONCATENATE" => {
                let mut text = String::new();
                for value in flatten(&evaluated) {
                    match value.to_text() {
                        Ok(part) => text.push_str(&part),
                        Err(error) => return Value::Error(error),
                    }
                }
                Value::Text(text)
            }
            "LEN" => unary_text(
                &evaluated,
                |text| Value::Number(text.chars().count() as f64),
            ),
            "UPPER" => unary_text(&evaluated, |text| Value::Text(text.to_uppercase())),
            "LOWER" => unary_text(&evaluated, |text| Value::Text(text.to_lowercase())),
            "TRIM" => unary_text(&evaluated, |text| {
                Value::Text(text.split_whitespace().collect::<Vec<_>>().join(" "))
            }),
            "AND" => boolean_reduce(&evaluated, true, |left, right| left && right),
            "OR" => boolean_reduce(&evaluated, false, |left, right| left || right),
            "NOT" => {
                if evaluated.len() != 1 {
                    return Value::Error(ErrorCode::Value);
                }
                match argument_bool(&evaluated[0]) {
                    Ok(value) => Value::Bool(!value),
                    Err(error) => Value::Error(error),
                }
            }
            _ => Value::Error(ErrorCode::Name),
        }
    }

    fn evaluate_if(&mut self, args: &[Expr]) -> Value {
        if args.len() < 2 || args.len() > 3 {
            return Value::Error(ErrorCode::Value);
        }

        match self.evaluate(&args[0]).to_bool() {
            Ok(true) => self.evaluate(&args[1]),
            Ok(false) => {
                if args.len() == 3 {
                    self.evaluate(&args[2])
                } else {
                    Value::Bool(false)
                }
            }
            Err(error) => Value::Error(error),
        }
    }

    fn evaluate_iferror(&mut self, args: &[Expr]) -> Value {
        if args.len() != 2 {
            return Value::Error(ErrorCode::Value);
        }

        let value = self.evaluate(&args[0]);
        if value.is_error() {
            self.evaluate(&args[1])
        } else {
            value
        }
    }

    fn evaluate_argument(&mut self, expression: &Expr) -> Arg {
        if let Expr::Range(range) = expression {
            match self.range_values(range) {
                Ok(values) => return Arg::Range(values),
                Err(error) => return Arg::Value(Value::Error(error)),
            }
        }

        Arg::Value(self.evaluate(expression))
    }

    fn range_values(&mut self, range: &RangeRef) -> Result<Vec<Value>, ErrorCode> {
        let start_row = range.start.row.min(range.end.row);
        let end_row = range.start.row.max(range.end.row);
        let start_column = range.start.column.min(range.end.column);
        let end_column = range.start.column.max(range.end.column);

        if end_row >= self.rows || end_column >= self.columns {
            return Err(ErrorCode::Ref);
        }

        let mut values =
            Vec::with_capacity((end_row - start_row + 1) * (end_column - start_column + 1));
        for row in start_row..=end_row {
            for column in start_column..=end_column {
                values.push(self.cell_value(row, column));
            }
        }

        Ok(values)
    }
}

fn literal_value(raw: &str) -> Value {
    let trimmed = raw.trim();

    if trimmed.is_empty() {
        return Value::Text(String::new());
    }

    if trimmed.eq_ignore_ascii_case("TRUE") {
        return Value::Bool(true);
    }

    if trimmed.eq_ignore_ascii_case("FALSE") {
        return Value::Bool(false);
    }

    match trimmed.parse::<f64>() {
        Ok(value) => Value::Number(value),
        Err(_) => Value::Text(raw.to_string()),
    }
}

fn compare_text(left: &str, right: &str) -> std::cmp::Ordering {
    left.to_lowercase().cmp(&right.to_lowercase())
}

fn flatten(arguments: &[Arg]) -> Vec<&Value> {
    let mut values = Vec::new();

    for argument in arguments {
        match argument {
            Arg::Value(value) => values.push(value),
            Arg::Range(range) => values.extend(range.iter()),
        }
    }

    values
}

fn numbers(arguments: &[Arg]) -> Result<Vec<f64>, ErrorCode> {
    let mut values = Vec::new();

    for argument in arguments {
        match argument {
            Arg::Range(range) => {
                for value in range {
                    if let Value::Error(error) = value {
                        return Err(*error);
                    }
                    if let Value::Number(number) = value {
                        values.push(*number);
                    }
                }
            }
            Arg::Value(Value::Number(number)) => values.push(*number),
            Arg::Value(Value::Bool(value)) => values.push(if *value { 1.0 } else { 0.0 }),
            Arg::Value(Value::Text(text)) => {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    if let Ok(number) = trimmed.parse::<f64>() {
                        values.push(number);
                    }
                }
            }
            Arg::Value(Value::Error(error)) => return Err(*error),
        }
    }

    Ok(values)
}

fn argument_number(argument: &Arg) -> Result<f64, ErrorCode> {
    match argument {
        Arg::Value(value) => value.to_number(),
        Arg::Range(_) => Err(ErrorCode::Value),
    }
}

fn argument_bool(argument: &Arg) -> Result<bool, ErrorCode> {
    match argument {
        Arg::Value(value) => value.to_bool(),
        Arg::Range(_) => Err(ErrorCode::Value),
    }
}

fn number_reduce<F>(arguments: &[Arg], initial: f64, operation: F) -> Value
where
    F: Fn(f64, f64) -> f64,
{
    match numbers(arguments) {
        Ok(values) => Value::Number(values.into_iter().fold(initial, operation)),
        Err(error) => Value::Error(error),
    }
}

fn unary_number<F>(arguments: &[Arg], operation: F) -> Value
where
    F: Fn(f64) -> f64,
{
    if arguments.len() != 1 {
        return Value::Error(ErrorCode::Value);
    }

    match argument_number(&arguments[0]) {
        Ok(value) => Value::number(operation(value)),
        Err(error) => Value::Error(error),
    }
}

fn unary_text<F>(arguments: &[Arg], operation: F) -> Value
where
    F: Fn(String) -> Value,
{
    if arguments.len() != 1 {
        return Value::Error(ErrorCode::Value);
    }

    match &arguments[0] {
        Arg::Value(value) => match value.to_text() {
            Ok(text) => operation(text),
            Err(error) => Value::Error(error),
        },
        Arg::Range(_) => Value::Error(ErrorCode::Value),
    }
}

fn boolean_reduce<F>(arguments: &[Arg], initial: bool, operation: F) -> Value
where
    F: Fn(bool, bool) -> bool,
{
    let mut result = initial;
    let mut found = false;

    for value in flatten(arguments) {
        match value.to_bool() {
            Ok(value) => {
                result = operation(result, value);
                found = true;
            }
            Err(error) => return Value::Error(error),
        }
    }

    if found {
        Value::Bool(result)
    } else {
        Value::Error(ErrorCode::Value)
    }
}

fn count_values(arguments: &[Arg]) -> usize {
    let mut count = 0;

    for value in flatten(arguments) {
        match value {
            Value::Text(text) if text.is_empty() => {}
            _ => count += 1,
        }
    }

    count
}

fn round_function(arguments: &[Arg]) -> Value {
    if arguments.len() != 2 {
        return Value::Error(ErrorCode::Value);
    }

    let value = argument_number(&arguments[0]);
    let digits = argument_number(&arguments[1]);

    match (value, digits) {
        (Ok(value), Ok(digits)) => {
            let digits = digits.trunc().clamp(-15.0, 15.0) as i32;
            let factor = 10f64.powi(digits);
            let scaled = value * factor;
            let rounded = if scaled >= 0.0 {
                (scaled + 0.5).floor()
            } else {
                (scaled - 0.5).ceil()
            };
            Value::number(rounded / factor)
        }
        (Err(error), _) | (_, Err(error)) => Value::Error(error),
    }
}

#[cfg(test)]
mod tests {
    use super::Sheet;

    fn evaluate(cells: &[&[&str]]) -> Vec<Vec<String>> {
        let rows = cells.len();
        let columns = cells.first().map(|row| row.len()).unwrap_or(0);
        let data = cells
            .iter()
            .map(|row| row.iter().map(|value| value.to_string()).collect())
            .collect();

        Sheet::new(rows, columns, data).calculate()
    }

    #[test]
    fn evaluates_arithmetic_and_ranges() {
        let values = evaluate(&[
            &["2", "3", "=SUM(A1:B1)"],
            &["=A1*2", "=AVERAGE(A1:B1)", "=ROUND(2.345, 2)"],
        ]);

        assert_eq!(values[0][2], "5");
        assert_eq!(values[1][0], "4");
        assert_eq!(values[1][1], "2.5");
        assert_eq!(values[1][2], "2.35");
    }

    #[test]
    fn evaluates_logic_and_text() {
        let values = evaluate(&[&["hello", "=UPPER(A1)", "=IF(B1=\"HELLO\", \"yes\", \"no\")"]]);

        assert_eq!(values[0][1], "HELLO");
        assert_eq!(values[0][2], "yes");
    }

    #[test]
    fn repairs_incomplete_formulas() {
        let values = evaluate(&[
            &[
                "2",
                "3",
                "=SUM(A1:B1",
                "=SUM(A1:B1))",
                "=SUM(A1:B1,",
                "=SUM(A1;B1)",
            ],
            &[
                "hello",
                "=UPPER(A2",
                "=IF(A2=\"hello\",\"yes\"",
                "=(A1+B1",
                "=\"hello",
                "=SUM(A1:)",
            ],
            &[
                "=SUM((A1+B1)",
                "=SUM(A1:B1)))",
                "=1+2*3",
                "=A1",
                "=SUM(",
                "=SUM(A1:B1,)",
            ],
            &["=1+2))", "", "", "", "", ""],
        ]);

        assert_eq!(values[0][2], "5");
        assert_eq!(values[0][3], "5");
        assert_eq!(values[0][4], "5");
        assert_eq!(values[0][5], "5");
        assert_eq!(values[1][1], "HELLO");
        assert_eq!(values[1][2], "yes");
        assert_eq!(values[1][3], "5");
        assert_eq!(values[1][4], "hello");
        assert_eq!(values[1][5], "2");
        assert_eq!(values[2][0], "5");
        assert_eq!(values[2][1], "5");
        assert_eq!(values[2][2], "7");
        assert_eq!(values[2][3], "2");
        assert_eq!(values[2][4], "0");
        assert_eq!(values[2][5], "5");
        assert_eq!(values[3][0], "3");
    }

    #[test]
    fn reports_errors_and_cycles() {
        let values = evaluate(&[&["=1/0", "=A2", "=FOO(1)"], &["=B1", "", "=SQRT(-1)"]]);

        assert_eq!(values[0][0], "#DIV/0!");
        assert_eq!(values[1][0], "#CYCLE!");
        assert_eq!(values[0][2], "#NAME?");
        assert_eq!(values[1][2], "#NUM!");
    }

    #[test]
    fn concatenates_and_counts() {
        let values = evaluate(&[
            &["red", "blue", "=A1 & \"-\" & B1"],
            &["1", "word", "=COUNT(A2:B2)"],
            &["=COUNTA(A2:B2)", "=CONCAT(A2:B2)", "=LEN(C1)"],
        ]);

        assert_eq!(values[0][2], "red-blue");
        assert_eq!(values[1][2], "1");
        assert_eq!(values[2][0], "2");
        assert_eq!(values[2][1], "1word");
        assert_eq!(values[2][2], "8");
    }
}
