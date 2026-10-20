use crate::value::ErrorCode;

#[derive(Clone, Copy, Debug)]
pub struct CellRef {
    pub row: usize,
    pub column: usize,
}

#[derive(Clone, Copy, Debug)]
pub struct RangeRef {
    pub start: CellRef,
    pub end: CellRef,
}

#[derive(Clone, Copy, Debug)]
pub enum UnaryOp {
    Plus,
    Minus,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum BinaryOp {
    Add,
    Subtract,
    Multiply,
    Divide,
    Power,
    Concat,
    Equal,
    NotEqual,
    Less,
    LessEqual,
    Greater,
    GreaterEqual,
}

#[derive(Clone, Debug)]
pub enum Expr {
    Number(f64),
    Text(String),
    Bool(bool),
    Ref(CellRef),
    Range(RangeRef),
    Unary {
        op: UnaryOp,
        value: Box<Expr>,
    },
    Percent(Box<Expr>),
    Binary {
        op: BinaryOp,
        left: Box<Expr>,
        right: Box<Expr>,
    },
    Call {
        name: String,
        args: Vec<Expr>,
    },
}

#[derive(Clone, Debug, PartialEq)]
enum Token {
    Number(f64),
    Text(String),
    Ident(String),
    Ref(usize, usize),
    LParen,
    RParen,
    Comma,
    Colon,
    Plus,
    Minus,
    Star,
    Slash,
    Caret,
    Percent,
    Amp,
    Equal,
    NotEqual,
    Less,
    LessEqual,
    Greater,
    GreaterEqual,
    Eof,
}

pub fn parse_formula(input: &str) -> Result<Expr, ErrorCode> {
    let tokens = tokenize(input)?;
    let mut parser = Parser { tokens, index: 0 };
    let expression = parser.parse_comparison()?;

    while parser.peek() == &Token::RParen {
        parser.advance();
    }

    if parser.peek() != &Token::Eof {
        return Err(ErrorCode::Parse);
    }

    Ok(expression)
}

fn tokenize(input: &str) -> Result<Vec<Token>, ErrorCode> {
    let chars: Vec<char> = input.chars().collect();
    let mut tokens = Vec::new();
    let mut index = 0;

    while index < chars.len() {
        let current = chars[index];

        if current.is_whitespace() {
            index += 1;
            continue;
        }

        if current.is_ascii_digit()
            || (current == '.' && index + 1 < chars.len() && chars[index + 1].is_ascii_digit())
        {
            let start = index;
            while index < chars.len() && (chars[index].is_ascii_digit() || chars[index] == '.') {
                index += 1;
            }
            if index < chars.len() && (chars[index] == 'e' || chars[index] == 'E') {
                let exponent_start = index;
                index += 1;
                if index < chars.len() && (chars[index] == '+' || chars[index] == '-') {
                    index += 1;
                }
                let digits_start = index;
                while index < chars.len() && chars[index].is_ascii_digit() {
                    index += 1;
                }
                if digits_start == index {
                    index = exponent_start;
                }
            }
            let text: String = chars[start..index].iter().collect();
            tokens.push(Token::Number(
                text.parse::<f64>().map_err(|_| ErrorCode::Parse)?,
            ));
            continue;
        }

        if current == '"' {
            index += 1;
            let mut text = String::new();
            loop {
                if index >= chars.len() {
                    break;
                }
                if chars[index] == '"' {
                    if index + 1 < chars.len() && chars[index + 1] == '"' {
                        text.push('"');
                        index += 2;
                        continue;
                    }
                    index += 1;
                    break;
                }
                text.push(chars[index]);
                index += 1;
            }
            tokens.push(Token::Text(text));
            continue;
        }

        if current.is_ascii_alphabetic() || current == '$' || current == '_' {
            let (token, next) = read_name_or_reference(&chars, index)?;
            tokens.push(token);
            index = next;
            continue;
        }

        let token = match current {
            '(' => Token::LParen,
            ')' => Token::RParen,
            ',' | ';' => Token::Comma,
            ':' => Token::Colon,
            '+' => Token::Plus,
            '-' => Token::Minus,
            '*' => Token::Star,
            '/' => Token::Slash,
            '^' => Token::Caret,
            '%' => Token::Percent,
            '&' => Token::Amp,
            '=' => Token::Equal,
            '<' => {
                if index + 1 < chars.len() && chars[index + 1] == '>' {
                    index += 1;
                    Token::NotEqual
                } else if index + 1 < chars.len() && chars[index + 1] == '=' {
                    index += 1;
                    Token::LessEqual
                } else {
                    Token::Less
                }
            }
            '>' => {
                if index + 1 < chars.len() && chars[index + 1] == '=' {
                    index += 1;
                    Token::GreaterEqual
                } else {
                    Token::Greater
                }
            }
            _ => return Err(ErrorCode::Parse),
        };

        tokens.push(token);
        index += 1;
    }

    tokens.push(Token::Eof);
    Ok(tokens)
}

fn read_name_or_reference(chars: &[char], start: usize) -> Result<(Token, usize), ErrorCode> {
    let mut index = start;
    let absolute_column = chars.get(index) == Some(&'$');
    if absolute_column {
        index += 1;
    }

    let letters_start = index;
    while index < chars.len() && chars[index].is_ascii_alphabetic() {
        index += 1;
    }

    if letters_start == index {
        return Err(ErrorCode::Parse);
    }

    let letters: String = chars[letters_start..index].iter().collect();
    let mut is_reference = false;
    let mut row_start = index;

    if index < chars.len() && chars[index] == '$' {
        is_reference = true;
        index += 1;
        row_start = index;
    } else if index < chars.len() && chars[index].is_ascii_digit() {
        is_reference = true;
        row_start = index;
    }

    if is_reference {
        while index < chars.len() && chars[index].is_ascii_digit() {
            index += 1;
        }

        if row_start == index {
            return Err(ErrorCode::Parse);
        }

        let row_text: String = chars[row_start..index].iter().collect();
        let row = row_text.parse::<usize>().map_err(|_| ErrorCode::Parse)?;
        let column = column_index(&letters).ok_or(ErrorCode::Ref)?;

        return Ok((Token::Ref(row.saturating_sub(1), column), index));
    }

    while index < chars.len()
        && (chars[index].is_ascii_alphanumeric() || chars[index] == '_' || chars[index] == '.')
    {
        index += 1;
    }

    let name: String = chars[start..index].iter().collect();
    Ok((Token::Ident(name.to_ascii_uppercase()), index))
}

fn column_index(letters: &str) -> Option<usize> {
    let mut value = 0usize;

    for character in letters.chars() {
        let digit = character.to_ascii_uppercase() as u8;
        if !digit.is_ascii_uppercase() {
            return None;
        }
        value = value
            .checked_mul(26)?
            .checked_add((digit - b'A' + 1) as usize)?;
        if value > 20_000 {
            return None;
        }
    }

    value.checked_sub(1)
}

struct Parser {
    tokens: Vec<Token>,
    index: usize,
}

impl Parser {
    fn peek(&self) -> &Token {
        &self.tokens[self.index]
    }

    fn advance(&mut self) -> Token {
        let token = self.tokens[self.index].clone();
        self.index += 1;
        token
    }

    fn match_token(&mut self, token: &Token) -> bool {
        if self.peek() == token {
            self.index += 1;
            true
        } else {
            false
        }
    }

    fn parse_comparison(&mut self) -> Result<Expr, ErrorCode> {
        let mut left = self.parse_concat()?;

        loop {
            let operation = match self.peek() {
                Token::Equal => Some(BinaryOp::Equal),
                Token::NotEqual => Some(BinaryOp::NotEqual),
                Token::Less => Some(BinaryOp::Less),
                Token::LessEqual => Some(BinaryOp::LessEqual),
                Token::Greater => Some(BinaryOp::Greater),
                Token::GreaterEqual => Some(BinaryOp::GreaterEqual),
                _ => None,
            };

            let Some(operation) = operation else {
                break;
            };

            self.advance();
            let right = self.parse_concat()?;
            left = Expr::Binary {
                op: operation,
                left: Box::new(left),
                right: Box::new(right),
            };
        }

        Ok(left)
    }

    fn parse_concat(&mut self) -> Result<Expr, ErrorCode> {
        let mut left = self.parse_additive()?;

        while self.match_token(&Token::Amp) {
            let right = self.parse_additive()?;
            left = Expr::Binary {
                op: BinaryOp::Concat,
                left: Box::new(left),
                right: Box::new(right),
            };
        }

        Ok(left)
    }

    fn parse_additive(&mut self) -> Result<Expr, ErrorCode> {
        let mut left = self.parse_multiplicative()?;

        loop {
            let operation = match self.peek() {
                Token::Plus => BinaryOp::Add,
                Token::Minus => BinaryOp::Subtract,
                _ => break,
            };

            self.advance();
            let right = self.parse_multiplicative()?;
            left = Expr::Binary {
                op: operation,
                left: Box::new(left),
                right: Box::new(right),
            };
        }

        Ok(left)
    }

    fn parse_multiplicative(&mut self) -> Result<Expr, ErrorCode> {
        let mut left = self.parse_power()?;

        loop {
            let operation = match self.peek() {
                Token::Star => BinaryOp::Multiply,
                Token::Slash => BinaryOp::Divide,
                _ => break,
            };

            self.advance();
            let right = self.parse_power()?;
            left = Expr::Binary {
                op: operation,
                left: Box::new(left),
                right: Box::new(right),
            };
        }

        Ok(left)
    }

    fn parse_power(&mut self) -> Result<Expr, ErrorCode> {
        let left = self.parse_unary()?;

        if self.match_token(&Token::Caret) {
            let right = self.parse_power()?;
            return Ok(Expr::Binary {
                op: BinaryOp::Power,
                left: Box::new(left),
                right: Box::new(right),
            });
        }

        Ok(left)
    }

    fn parse_unary(&mut self) -> Result<Expr, ErrorCode> {
        if self.match_token(&Token::Plus) {
            return Ok(Expr::Unary {
                op: UnaryOp::Plus,
                value: Box::new(self.parse_unary()?),
            });
        }

        if self.match_token(&Token::Minus) {
            return Ok(Expr::Unary {
                op: UnaryOp::Minus,
                value: Box::new(self.parse_unary()?),
            });
        }

        self.parse_postfix()
    }

    fn parse_postfix(&mut self) -> Result<Expr, ErrorCode> {
        let mut value = self.parse_primary()?;

        while self.match_token(&Token::Percent) {
            value = Expr::Percent(Box::new(value));
        }

        Ok(value)
    }

    fn parse_primary(&mut self) -> Result<Expr, ErrorCode> {
        match self.advance() {
            Token::Number(value) => Ok(Expr::Number(value)),
            Token::Text(value) => Ok(Expr::Text(value)),
            Token::Ref(row, column) => {
                let start = CellRef { row, column };

                if self.peek() != &Token::Colon {
                    return Ok(Expr::Ref(start));
                }

                let has_end = matches!(self.tokens.get(self.index + 1), Some(Token::Ref(_, _)));
                self.advance();

                if !has_end {
                    return Ok(Expr::Ref(start));
                }

                match self.advance() {
                    Token::Ref(end_row, end_column) => Ok(Expr::Range(RangeRef {
                        start,
                        end: CellRef {
                            row: end_row,
                            column: end_column,
                        },
                    })),
                    _ => Err(ErrorCode::Parse),
                }
            }
            Token::Ident(name) => {
                if name == "TRUE" {
                    return Ok(Expr::Bool(true));
                }
                if name == "FALSE" {
                    return Ok(Expr::Bool(false));
                }

                if !self.match_token(&Token::LParen) {
                    return Err(ErrorCode::Name);
                }

                let mut args = Vec::new();
                if !self.match_token(&Token::RParen) {
                    loop {
                        if self.peek() == &Token::Eof {
                            break;
                        }

                        args.push(self.parse_comparison()?);

                        if self.match_token(&Token::Comma) {
                            if self.match_token(&Token::RParen) {
                                break;
                            }
                            if self.peek() == &Token::Eof {
                                break;
                            }
                            continue;
                        }

                        if self.match_token(&Token::RParen) {
                            break;
                        }

                        if self.peek() == &Token::Eof {
                            break;
                        }

                        return Err(ErrorCode::Parse);
                    }
                }

                Ok(Expr::Call { name, args })
            }
            Token::LParen => {
                let expression = self.parse_comparison()?;
                if !self.match_token(&Token::RParen) && self.peek() != &Token::Eof {
                    return Err(ErrorCode::Parse);
                }
                Ok(expression)
            }
            _ => Err(ErrorCode::Parse),
        }
    }
}
