#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrorCode {
    Div0,
    Value,
    Name,
    Ref,
    Num,
    Cycle,
    Parse,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::Div0 => "#DIV/0!",
            ErrorCode::Value => "#VALUE!",
            ErrorCode::Name => "#NAME?",
            ErrorCode::Ref => "#REF!",
            ErrorCode::Num => "#NUM!",
            ErrorCode::Cycle => "#CYCLE!",
            ErrorCode::Parse => "#PARSE!",
        }
    }
}

#[derive(Clone, Debug)]
pub enum Value {
    Number(f64),
    Text(String),
    Bool(bool),
    Error(ErrorCode),
}

impl Value {
    pub fn number(value: f64) -> Self {
        if value.is_finite() {
            Value::Number(value)
        } else {
            Value::Error(ErrorCode::Num)
        }
    }

    pub fn is_error(&self) -> bool {
        matches!(self, Value::Error(_))
    }

    pub fn to_number(&self) -> Result<f64, ErrorCode> {
        match self {
            Value::Number(value) => Ok(*value),
            Value::Bool(value) => Ok(if *value { 1.0 } else { 0.0 }),
            Value::Text(text) => {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    return Ok(0.0);
                }
                trimmed.parse::<f64>().map_err(|_| ErrorCode::Value)
            }
            Value::Error(error) => Err(*error),
        }
    }

    pub fn to_bool(&self) -> Result<bool, ErrorCode> {
        match self {
            Value::Bool(value) => Ok(*value),
            Value::Number(value) => Ok(*value != 0.0),
            Value::Text(text) => match text.trim().to_ascii_uppercase().as_str() {
                "TRUE" => Ok(true),
                "FALSE" => Ok(false),
                "" => Ok(false),
                _ => Err(ErrorCode::Value),
            },
            Value::Error(error) => Err(*error),
        }
    }

    pub fn to_text(&self) -> Result<String, ErrorCode> {
        match self {
            Value::Text(text) => Ok(text.clone()),
            Value::Number(value) => Ok(format_number(*value)),
            Value::Bool(value) => Ok(if *value { "TRUE" } else { "FALSE" }.to_string()),
            Value::Error(error) => Err(*error),
        }
    }

    pub fn display(&self) -> String {
        match self {
            Value::Number(value) => format_number(*value),
            Value::Text(text) => text.clone(),
            Value::Bool(value) => if *value { "TRUE" } else { "FALSE" }.to_string(),
            Value::Error(error) => error.as_str().to_string(),
        }
    }
}

pub fn format_number(value: f64) -> String {
    if !value.is_finite() {
        return "#NUM!".to_string();
    }

    if value == 0.0 {
        return "0".to_string();
    }

    if value.fract() == 0.0 && value.abs() < 1e15 {
        return format!("{value:.0}");
    }

    let mut formatted = format!("{value:.10}");
    if formatted.contains('.') {
        while formatted.ends_with('0') {
            formatted.pop();
        }
        if formatted.ends_with('.') {
            formatted.pop();
        }
    }

    if formatted == "-0" {
        "0".to_string()
    } else {
        formatted
    }
}
