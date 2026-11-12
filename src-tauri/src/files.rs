//! Reading and writing files the user explicitly chooses.
//!
//! File dialogs are opened here, in Rust, with the native picker. The webview
//! never receives filesystem access and never supplies a path: it can only
//! ask "export" or "import", and the user picks the location.

use std::fs;
use std::path::PathBuf;

use serde::Serialize;

use crate::db::Ledger;
use crate::error::{AppError, AppResult};

pub const BACKUP_EXTENSION: &str = "vaultbackup";
const MAX_IMPORT_BYTES: u64 = 20 * 1024 * 1024;
const MAX_IMPORT_ROWS: usize = 200_000;

fn save_dialog(title: &str, file_name: &str, filter: (&str, &[&str])) -> Option<PathBuf> {
    rfd::FileDialog::new().set_title(title).set_file_name(file_name).add_filter(filter.0, filter.1).save_file()
}

fn open_dialog(title: &str, filter: (&str, &[&str])) -> Option<PathBuf> {
    rfd::FileDialog::new().set_title(title).add_filter(filter.0, filter.1).pick_file()
}

fn file_name(path: &PathBuf) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Spreadsheets treat cells starting with = + - @ as formulas. Text cells are
/// prefixed with an apostrophe so an imported description cannot run one.
fn safe_cell(text: &str) -> String {
    match text.chars().next() {
        Some('=' | '+' | '-' | '@' | '\t' | '\r') => format!("'{text}"),
        _ => text.to_string(),
    }
}

fn amount_text(centimes: i64) -> String {
    format!("{}{}.{:02}", if centimes < 0 { "-" } else { "" }, centimes.abs() / 100, centimes.abs() % 100)
}

/// Transactions as CSV text, one row each, with names instead of ids.
pub fn transactions_csv(ledger: &Ledger) -> AppResult<String> {
    let name_of = |id: &str| -> String {
        ledger.accounts.iter().find(|a| a.id == id).map(|a| a.name.clone()).unwrap_or_default()
    };
    let mut writer = csv::Writer::from_writer(Vec::new());
    let io = |e: csv::Error| AppError::Internal(e.to_string());
    writer
        .write_record(["date", "type", "amount", "category", "account", "to_account", "description", "notes", "fixed"])
        .map_err(io)?;
    let mut rows: Vec<_> = ledger.transactions.iter().collect();
    rows.sort_by(|a, b| a.date.cmp(&b.date));
    for tx in rows {
        let category = tx
            .category_id
            .as_deref()
            .and_then(|id| ledger.categories.iter().find(|c| c.id == id))
            .map(|c| c.name.clone())
            .unwrap_or_default();
        writer
            .write_record([
                tx.date.clone(),
                tx.kind.clone(),
                amount_text(tx.amount),
                safe_cell(&category),
                safe_cell(&name_of(&tx.account_id)),
                safe_cell(&tx.transfer_account_id.as_deref().map(name_of).unwrap_or_default()),
                safe_cell(&tx.description),
                safe_cell(&tx.notes),
                if tx.is_fixed { "yes".into() } else { "no".into() },
            ])
            .map_err(io)?;
    }
    let bytes = writer.into_inner().map_err(|e| AppError::Internal(e.to_string()))?;
    String::from_utf8(bytes).map_err(|e| AppError::Internal(e.to_string()))
}

/// Ask where to save, then write. Returns the file name, or None if cancelled.
pub fn save_text(title: &str, suggested: &str, filter: (&str, &[&str]), contents: &str) -> AppResult<Option<String>> {
    let Some(path) = save_dialog(title, suggested, filter) else { return Ok(None) };
    // A UTF-8 byte-order mark makes Excel read accented characters correctly.
    let bom = if suggested.ends_with(".csv") { "\u{feff}" } else { "" };
    fs::write(&path, format!("{bom}{contents}"))?;
    Ok(Some(file_name(&path)))
}

pub fn save_bytes(title: &str, suggested: &str, filter: (&str, &[&str]), contents: &[u8]) -> AppResult<Option<String>> {
    let Some(path) = save_dialog(title, suggested, filter) else { return Ok(None) };
    fs::write(&path, contents)?;
    Ok(Some(file_name(&path)))
}

pub fn pick_bytes(title: &str, filter: (&str, &[&str])) -> AppResult<Option<(String, Vec<u8>)>> {
    let Some(path) = open_dialog(title, filter) else { return Ok(None) };
    if fs::metadata(&path)?.len() > MAX_IMPORT_BYTES {
        return Err(AppError::invalid("That file is too large (limit 20 MB)."));
    }
    Ok(Some((file_name(&path), fs::read(&path)?)))
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CsvFile {
    pub file_name: String,
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

/// Parse CSV bytes into text cells. Interpretation (dates, amounts, names) is
/// done by the engine in the interface, which previews it before importing.
pub fn parse_csv(file_name: String, bytes: &[u8]) -> AppResult<CsvFile> {
    let text = String::from_utf8_lossy(bytes);
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    // Accept semicolon-separated files, the default export of French-locale Excel.
    let first_line = text.lines().next().unwrap_or_default();
    let delimiter = if first_line.matches(';').count() > first_line.matches(',').count() { b';' } else { b',' };
    let mut reader = csv::ReaderBuilder::new().delimiter(delimiter).flexible(true).trim(csv::Trim::All).from_reader(text.as_bytes());
    let bad = |e: csv::Error| AppError::invalid(format!("This file could not be read as CSV: {e}"));
    let headers: Vec<String> = reader.headers().map_err(bad)?.iter().map(|h| h.to_lowercase()).collect();
    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record.map_err(bad)?;
        if record.iter().all(|cell| cell.is_empty()) {
            continue;
        }
        if rows.len() >= MAX_IMPORT_ROWS {
            return Err(AppError::invalid("That file has too many rows (limit 200,000)."));
        }
        rows.push(record.iter().map(|cell| cell.strip_prefix('\'').unwrap_or(cell).to_string()).collect());
    }
    Ok(CsvFile { file_name, headers, rows })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{self, AccountInput, TransactionInput};
    use rusqlite::Connection;

    fn ledger_with(description: &str, notes: &str) -> Ledger {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate(&mut conn).unwrap();
        let account = db::save_account(&conn, None, &AccountInput {
            name: "Current, main".into(), kind: "current".into(), opening_balance: 0, opening_date: "2026-01-01".into(),
        }).unwrap();
        db::save_transaction(&conn, None, &TransactionInput {
            account_id: account, date: "2026-11-12".into(), kind: "expense".into(), amount: 32_050,
            category_id: Some("cat-food".into()), transfer_account_id: None,
            description: description.into(), notes: notes.into(), is_fixed: false,
        }).unwrap();
        db::load_ledger(&conn).unwrap()
    }

    #[test]
    fn exports_and_reads_back_csv() {
        let csv = transactions_csv(&ledger_with("Dinner \"Chez Ali\", Rabat", "line one\nline two")).unwrap();
        let parsed = parse_csv("x.csv".into(), csv.as_bytes()).unwrap();
        assert_eq!(parsed.headers, ["date", "type", "amount", "category", "account", "to_account", "description", "notes", "fixed"]);
        assert_eq!(parsed.rows, [["2026-11-12", "expense", "320.50", "Food", "Current, main", "", "Dinner \"Chez Ali\", Rabat", "line one\nline two", "no"]]);
    }

    #[test]
    fn neutralises_spreadsheet_formulas() {
        let csv = transactions_csv(&ledger_with("=HYPERLINK(\"http://evil\")", "@SUM(A1)")).unwrap();
        assert!(csv.contains("'=HYPERLINK"));
        assert!(csv.contains("'@SUM"));
        // ...and reading it back removes the guard again.
        let parsed = parse_csv("x.csv".into(), csv.as_bytes()).unwrap();
        assert_eq!(parsed.rows[0][6], "=HYPERLINK(\"http://evil\")");
    }

    #[test]
    fn reads_semicolon_files_with_bom_and_blank_lines() {
        let text = "\u{feff}Date;Type;Amount\n2026-11-01;income;14000\n;;\n02/11/2026;expense;3 800,50\n";
        let parsed = parse_csv("bank.csv".into(), text.as_bytes()).unwrap();
        assert_eq!(parsed.headers, ["date", "type", "amount"]);
        assert_eq!(parsed.rows, [["2026-11-01", "income", "14000"], ["02/11/2026", "expense", "3 800,50"]]);
    }

    #[test]
    fn formats_amounts_exactly() {
        assert_eq!(amount_text(32_050), "320.50");
        assert_eq!(amount_text(7), "0.07");
        assert_eq!(amount_text(-150_000), "-1500.00");
    }
}
