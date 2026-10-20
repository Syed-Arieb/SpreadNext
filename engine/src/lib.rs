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
