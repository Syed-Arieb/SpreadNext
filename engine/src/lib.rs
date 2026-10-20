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

/// Exports a JSON sheet description as an XLSX workbook and stores the result.
///
/// The first output byte is a status code. Zero means success and one means
/// failure. The remaining bytes are the workbook data or an error message.
///
/// # Safety
///
/// `pointer` must reference at least `length` readable bytes that remain valid
/// for the duration of the call.
#[no_mangle]
pub unsafe extern "C" fn export_xlsx(pointer: *const u8, length: usize) {
    let input = if pointer.is_null() || length == 0 {
        &[]
    } else {
        std::slice::from_raw_parts(pointer, length)
    };

    let output = calculate_xlsx(input);

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
        Err(error) => return export_error(&error.to_string()),
    };

    let rows = request.rows.min(MAX_ROWS);
    let columns = request.columns.min(MAX_COLUMNS);
    let mut sheet = Sheet::new(rows, columns, request.cells);
    let values = sheet.calculate();
    let (used_rows, used_columns) = used_range(&values);

    let mut csv = String::new();
    for (row_index, row) in values.iter().take(used_rows).enumerate() {
        if row_index > 0 {
            csv.push_str("\r\n");
        }

        for (column_index, value) in row.iter().take(used_columns).enumerate() {
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

fn used_range(values: &[Vec<String>]) -> (usize, usize) {
    let mut rows = 0;
    let mut columns = 0;

    for (row_index, row) in values.iter().enumerate() {
        for (column_index, value) in row.iter().enumerate() {
            if !value.is_empty() {
                rows = rows.max(row_index + 1);
                columns = columns.max(column_index + 1);
            }
        }
    }

    (rows, columns)
}

fn export_error(message: &str) -> Vec<u8> {
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

fn calculate_xlsx(input: &[u8]) -> Vec<u8> {
    let request = match serde_json::from_slice::<SheetInput>(input) {
        Ok(request) => request,
        Err(error) => return export_error(&error.to_string()),
    };

    let rows = request.rows.min(MAX_ROWS);
    let columns = request.columns.min(MAX_COLUMNS);
    let mut sheet = Sheet::new(rows, columns, request.cells);
    let values = sheet.calculate();
    let sheet_xml = worksheet_xml(&values);

    let entries: [(&str, &[u8]); 5] = [
        ("[Content_Types].xml", CONTENT_TYPES_XML.as_bytes()),
        ("_rels/.rels", PACKAGE_RELS_XML.as_bytes()),
        ("xl/workbook.xml", WORKBOOK_XML.as_bytes()),
        ("xl/_rels/workbook.xml.rels", WORKBOOK_RELS_XML.as_bytes()),
        ("xl/worksheets/sheet1.xml", sheet_xml.as_bytes()),
    ];

    let mut output = Vec::new();
    output.push(0);
    output.extend_from_slice(&zip_store(&entries));
    output
}

const CONTENT_TYPES_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"#;

const PACKAGE_RELS_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#;

const WORKBOOK_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>"#;

const WORKBOOK_RELS_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>"#;

fn worksheet_xml(values: &[Vec<String>]) -> String {
    let (row_count, column_count) = used_range(values);
    let dimension = if row_count == 0 || column_count == 0 {
        "A1".to_string()
    } else {
        format!("A1:{}{}", column_name(column_count - 1), row_count)
    };

    let mut xml = String::new();
    xml.push_str(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#);
    xml.push_str(
        r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">"#,
    );
    xml.push_str(r#"<dimension ref=""#);
    xml.push_str(&dimension);
    xml.push_str(r#""/><sheetData>"#);

    for (row_index, row) in values.iter().take(row_count).enumerate() {
        let row_number = row_index + 1;
        xml.push_str(r#"<row r=""#);
        xml.push_str(&row_number.to_string());
        xml.push_str(r#"">"#);

        for (column_index, value) in row.iter().take(column_count).enumerate() {
            if value.is_empty() {
                continue;
            }

            let reference = format!("{}{}", column_name(column_index), row_number);
            xml.push_str(r#"<c r=""#);
            xml.push_str(&reference);
            xml.push('"');

            if numeric_cell(value) {
                xml.push_str("><v>");
                xml.push_str(value);
                xml.push_str("</v></c>");
            } else {
                xml.push_str(r#" t="inlineStr"><is><t xml:space="preserve">"#);
                push_xml_text(&mut xml, value);
                xml.push_str("</t></is></c>");
            }
        }

        xml.push_str("</row>");
    }

    xml.push_str("</sheetData></worksheet>");
    xml
}

fn numeric_cell(value: &str) -> bool {
    value
        .parse::<f64>()
        .map(|number| number.is_finite() && number.to_string() == value)
        .unwrap_or(false)
}

fn column_name(mut index: usize) -> String {
    let mut name = Vec::new();
    index += 1;

    while index > 0 {
        let remainder = (index - 1) % 26;
        name.push((b'A' + remainder as u8) as char);
        index = (index - 1) / 26;
    }

    name.iter().rev().collect()
}

fn push_xml_text(output: &mut String, value: &str) {
    for character in value.chars() {
        match character {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            '\n' => output.push_str("&#10;"),
            '\r' => output.push_str("&#13;"),
            '\t' => output.push_str("&#9;"),
            '\u{0}'..='\u{8}' | '\u{b}' | '\u{c}' | '\u{e}'..='\u{1f}' => {}
            _ => output.push(character),
        }
    }
}

fn zip_store(entries: &[(&str, &[u8])]) -> Vec<u8> {
    const DOS_TIME: u16 = 0;
    const DOS_DATE: u16 = 0x5c21;

    let mut output = Vec::new();
    let mut central = Vec::new();

    for (name, data) in entries {
        let name = name.as_bytes();
        let checksum = crc32(data);
        let length = data.len() as u32;
        let offset = output.len() as u32;

        write_u32(&mut output, 0x0403_4b50);
        write_u16(&mut output, 20);
        write_u16(&mut output, 0);
        write_u16(&mut output, 0);
        write_u16(&mut output, DOS_TIME);
        write_u16(&mut output, DOS_DATE);
        write_u32(&mut output, checksum);
        write_u32(&mut output, length);
        write_u32(&mut output, length);
        write_u16(&mut output, name.len() as u16);
        write_u16(&mut output, 0);
        output.extend_from_slice(name);
        output.extend_from_slice(data);

        write_u32(&mut central, 0x0201_4b50);
        write_u16(&mut central, 20);
        write_u16(&mut central, 20);
        write_u16(&mut central, 0);
        write_u16(&mut central, 0);
        write_u16(&mut central, DOS_TIME);
        write_u16(&mut central, DOS_DATE);
        write_u32(&mut central, checksum);
        write_u32(&mut central, length);
        write_u32(&mut central, length);
        write_u16(&mut central, name.len() as u16);
        write_u16(&mut central, 0);
        write_u16(&mut central, 0);
        write_u16(&mut central, 0);
        write_u16(&mut central, 0);
        write_u32(&mut central, 0);
        write_u32(&mut central, offset);
        central.extend_from_slice(name);
    }

    let central_offset = output.len() as u32;
    let central_size = central.len() as u32;
    output.extend_from_slice(&central);

    write_u32(&mut output, 0x0605_4b50);
    write_u16(&mut output, 0);
    write_u16(&mut output, 0);
    write_u16(&mut output, entries.len() as u16);
    write_u16(&mut output, entries.len() as u16);
    write_u32(&mut output, central_size);
    write_u32(&mut output, central_offset);
    write_u16(&mut output, 0);
    output
}

fn crc32(data: &[u8]) -> u32 {
    let mut table = [0u32; 256];

    for (index, entry) in table.iter_mut().enumerate() {
        let mut value = index as u32;
        for _ in 0..8 {
            value = if value & 1 == 0 {
                value >> 1
            } else {
                0xedb8_8320 ^ (value >> 1)
            };
        }
        *entry = value;
    }

    let mut checksum = 0xffff_ffff;
    for byte in data {
        checksum = table[((checksum ^ *byte as u32) & 0xff) as usize] ^ (checksum >> 8);
    }
    !checksum
}

fn write_u16(output: &mut Vec<u8>, value: u16) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn write_u32(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_le_bytes());
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{calculate_csv, calculate_xlsx};

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
    fn trims_empty_trailing_rows_and_columns() {
        let input = br#"{"rows":5,"columns":6,"cells":[["a","","c"],["","",""],["","",""],["","",""],["","",""]]}"#;
        let output = calculate_csv(input);

        assert_eq!(output[0], 0);
        assert_eq!(
            std::str::from_utf8(&output[1..]).unwrap(),
            "\"a\",\"\",\"c\""
        );
    }

    #[test]
    fn exports_an_empty_csv_for_an_empty_sheet() {
        let input = br#"{"rows":3,"columns":3,"cells":[["","",""],["","",""],["","",""]]}"#;
        let output = calculate_csv(input);

        assert_eq!(output[0], 0);
        assert!(output[1..].is_empty());
    }

    #[test]
    fn exports_xlsx_archive() {
        let input = br#"{"rows":2,"columns":2,"cells":[["hello & <world>","=1+2"],["42","=A1"]]}"#;
        let output = calculate_xlsx(input);

        assert_eq!(output[0], 0);
        let bytes = &output[1..];
        assert_eq!(&bytes[..4], b"PK\x03\x04");
        assert_eq!(&bytes[bytes.len() - 22..bytes.len() - 18], b"PK\x05\x06");

        let entries = read_stored_zip(bytes);
        assert_eq!(entries.len(), 5);
        assert!(entries.contains_key("[Content_Types].xml"));

        let sheet = std::str::from_utf8(entries.get("xl/worksheets/sheet1.xml").unwrap()).unwrap();
        assert!(sheet.contains(r#"<dimension ref="A1:B2"/>"#));
        assert!(sheet.contains(
            r#"<c r="A1" t="inlineStr"><is><t xml:space="preserve">hello &amp; &lt;world&gt;</t></is></c>"#
        ));
        assert!(sheet.contains(r#"<c r="B1"><v>3</v></c>"#));
        assert!(sheet.contains(r#"<c r="A2"><v>42</v></c>"#));
        assert!(sheet.contains(
            r#"<c r="B2" t="inlineStr"><is><t xml:space="preserve">hello &amp; &lt;world&gt;</t></is></c>"#
        ));
    }

    #[test]
    fn reports_invalid_input() {
        let output = calculate_csv(b"not json");

        assert_eq!(output[0], 1);
        assert!(!output[1..].is_empty());
    }

    #[test]
    fn trims_the_xlsx_dimension_to_the_used_range() {
        let input = br#"{"rows":4,"columns":5,"cells":[["a","","c"],["","",""],["","",""],["","",""]]}"#;
        let output = calculate_xlsx(input);

        assert_eq!(output[0], 0);
        let bytes = &output[1..];
        let entries = read_stored_zip(bytes);
        let sheet = std::str::from_utf8(entries.get("xl/worksheets/sheet1.xml").unwrap()).unwrap();

        assert!(sheet.contains(r#"<dimension ref="A1:C1"/>"#));
        assert!(!sheet.contains(r#"<row r="2">"#));
    }

    fn read_stored_zip(bytes: &[u8]) -> HashMap<String, Vec<u8>> {
        let mut entries = HashMap::new();
        let mut offset = 0;

        while offset + 30 <= bytes.len() && read_u32(bytes, offset) == 0x0403_4b50 {
            assert_eq!(read_u16(bytes, offset + 8), 0);
            let length = read_u32(bytes, offset + 18) as usize;
            let name_length = read_u16(bytes, offset + 26) as usize;
            let extra_length = read_u16(bytes, offset + 28) as usize;
            let name_start = offset + 30;
            let data_start = name_start + name_length + extra_length;
            let name =
                String::from_utf8(bytes[name_start..name_start + name_length].to_vec()).unwrap();
            entries.insert(name, bytes[data_start..data_start + length].to_vec());
            offset = data_start + length;
        }

        entries
    }

    fn read_u16(bytes: &[u8], offset: usize) -> u16 {
        u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
    }

    fn read_u32(bytes: &[u8], offset: usize) -> u32 {
        u32::from_le_bytes([
            bytes[offset],
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3],
        ])
    }
}
