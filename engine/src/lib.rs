mod eval;
mod parser;
mod value;

use std::cell::RefCell;

use eval::Sheet;
use serde::{Deserialize, Serialize};

const MAX_ROWS: usize = 1_000;
const MAX_COLUMNS: usize = 200;

#[derive(Deserialize)]
struct SheetInput {
    rows: usize,
    columns: usize,
    #[serde(default)]
    cells: Vec<Vec<String>>,
}

#[derive(Serialize)]
struct SheetOutput {
    values: Vec<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

thread_local! {
    static RESULT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

#[no_mangle]
pub extern "C" fn alloc(length: usize) -> *mut u8 {
    if length == 0 {
        return std::ptr::null_mut();
    }

    let mut buffer = vec![0u8; length].into_boxed_slice();
    let pointer = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    pointer
}

/// Releases a buffer created by [`alloc`].
///
/// # Safety
///
/// `pointer` must have been returned by [`alloc`] with the same `length`, and
/// it must not be used after this call.
#[no_mangle]
pub unsafe extern "C" fn dealloc(pointer: *mut u8, length: usize) {
    if pointer.is_null() || length == 0 {
        return;
    }

    let slice = std::ptr::slice_from_raw_parts_mut(pointer, length);
    drop(Box::from_raw(slice));
}

/// Evaluates a JSON sheet description and stores the JSON result.
///
/// # Safety
///
/// `pointer` must reference at least `length` readable bytes that remain valid
/// for the duration of the call.
#[no_mangle]
pub unsafe extern "C" fn evaluate(pointer: *const u8, length: usize) {
    let input = if pointer.is_null() || length == 0 {
        &[]
    } else {
        std::slice::from_raw_parts(pointer, length)
    };

    let output = calculate(input);

    let bytes = serde_json::to_vec(&output).unwrap_or_else(|_| {
        br#"{"values":[],"error":"Formula engine serialization failed"}"#.to_vec()
    });

    RESULT.with(|result| {
        *result.borrow_mut() = bytes;
    });
}

/// Exports a JSON sheet description as CSV and stores the result.
///
/// The first output byte is a status code. Zero means success and one means
/// failure. The remaining bytes are the CSV data or an error message.
///
/// # Safety
///
/// `pointer` must reference at least `length` readable bytes that remain valid
/// for the duration of the call.
#[no_mangle]
pub unsafe extern "C" fn export_csv(pointer: *const u8, length: usize) {
    let input = if pointer.is_null() || length == 0 {
        &[]
    } else {
        std::slice::from_raw_parts(pointer, length)
    };

    let output = calculate_csv(input);

    RESULT.with(|result| {
        *result.borrow_mut() = output;
    });
}

#[no_mangle]
pub extern "C" fn result_ptr() -> *const u8 {
    RESULT.with(|result| result.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn result_len() -> usize {
    RESULT.with(|result| result.borrow().len())
}

fn calculate(input: &[u8]) -> SheetOutput {
    let request = match serde_json::from_slice::<SheetInput>(input) {
        Ok(request) => request,
        Err(error) => {
            return SheetOutput {
                values: Vec::new(),
                error: Some(error.to_string()),
            };
        }
    };

    let rows = request.rows.min(MAX_ROWS);
    let columns = request.columns.min(MAX_COLUMNS);
    let mut sheet = Sheet::new(rows, columns, request.cells);

    SheetOutput {
        values: sheet.calculate(),
        error: None,
    }
}

fn calculate_csv(input: &[u8]) -> Vec<u8> {
    let request = match serde_json::from_slice::<SheetInput>(input) {
        Ok(request) => request,
        Err(error) => return csv_error(&error.to_string()),
    };

    let rows = request.rows.min(MAX_ROWS);
    let columns = request.columns.min(MAX_COLUMNS);
    let mut sheet = Sheet::new(rows, columns, request.cells);
    let values = sheet.calculate();

    let mut csv = String::new();
    for (row_index, row) in values.iter().enumerate() {
        if row_index > 0 {
            csv.push_str("\r\n");
        }

        for (column_index, value) in row.iter().enumerate() {
            if column_index > 0 {
                csv.push(',');
            }
            push_csv_cell(&mut csv, value);
        }
    }

    let mut output = Vec::with_capacity(csv.len() + 1);
    output.push(0);
    output.extend_from_slice(csv.as_bytes());
    output
}

fn csv_error(message: &str) -> Vec<u8> {
    let mut output = Vec::with_capacity(message.len() + 1);
    output.push(1);
    output.extend_from_slice(message.as_bytes());
    output
}

fn push_csv_cell(output: &mut String, value: &str) {
    output.push('"');

    if matches!(value.as_bytes().first(), Some(b'=' | b'+' | b'-' | b'@')) {
        output.push('\'');
    }

    for character in value.chars() {
        if character == '"' {
            output.push('"');
        }
        output.push(character);
    }

    output.push('"');
}

#[cfg(test)]
mod tests {
    use super::calculate_csv;

    #[test]
    fn exports_evaluated_cells_as_csv() {
        let input = br#"{"rows":2,"columns":2,"cells":[["a,b","=1+2"],["say \"hi\"","=A1"]]}"#;
        let output = calculate_csv(input);

        assert_eq!(output[0], 0);
        assert_eq!(
            std::str::from_utf8(&output[1..]).unwrap(),
            "\"a,b\",\"3\"\r\n\"say \"\"hi\"\"\",\"a,b\""
        );
    }

    #[test]
    fn prefixes_spreadsheet_formula_characters() {
        let input = br#"{"rows":1,"columns":2,"cells":[["+hello","@world"]]}"#;
        let output = calculate_csv(input);

        assert_eq!(output[0], 0);
        assert_eq!(
            std::str::from_utf8(&output[1..]).unwrap(),
            "\"'+hello\",\"'@world\""
        );
    }

    #[test]
    fn reports_invalid_input() {
        let output = calculate_csv(b"not json");

        assert_eq!(output[0], 1);
        assert!(!output[1..].is_empty());
    }
}
