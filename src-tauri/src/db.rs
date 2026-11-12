//! Schema, migrations and queries. Everything here takes a plain
//! `rusqlite::Connection`, so it is testable without Tauri or encryption.
//!
//! Amounts are INTEGER centimes. Dates are TEXT `YYYY-MM-DD`.

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// Applied in order; never edit a released entry, append a new one.
const MIGRATIONS: &[&str] = &[
    // 1: accounts, categories, transactions
    r#"
    CREATE TABLE accounts (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL CHECK (length(trim(name)) > 0),
        kind            TEXT NOT NULL CHECK (kind IN ('current','savings','cash')),
        opening_balance INTEGER NOT NULL,
        opening_date    TEXT NOT NULL,
        archived        INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE categories (
        id               TEXT PRIMARY KEY,
        name             TEXT NOT NULL CHECK (length(trim(name)) > 0),
        kind             TEXT NOT NULL CHECK (kind IN ('income','expense')),
        is_fixed_default INTEGER NOT NULL DEFAULT 0,
        archived         INTEGER NOT NULL DEFAULT 0,
        sort_order       INTEGER NOT NULL DEFAULT 0,
        UNIQUE (kind, name)
    );

    CREATE TABLE recurring_rules (
        id                  TEXT PRIMARY KEY,
        account_id          TEXT NOT NULL REFERENCES accounts(id),
        kind                TEXT NOT NULL CHECK (kind IN ('income','expense','transfer')),
        amount              INTEGER NOT NULL CHECK (amount > 0),
        category_id         TEXT REFERENCES categories(id),
        transfer_account_id TEXT REFERENCES accounts(id),
        description         TEXT NOT NULL DEFAULT '',
        is_fixed            INTEGER NOT NULL DEFAULT 1,
        frequency           TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','yearly')),
        interval            INTEGER NOT NULL CHECK (interval >= 1),
        start_date          TEXT NOT NULL,
        end_date            TEXT,
        paused              INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE transactions (
        id                  TEXT PRIMARY KEY,
        account_id          TEXT NOT NULL REFERENCES accounts(id),
        date                TEXT NOT NULL,
        kind                TEXT NOT NULL CHECK (kind IN ('income','expense','transfer')),
        amount              INTEGER NOT NULL CHECK (amount > 0),
        category_id         TEXT REFERENCES categories(id),
        transfer_account_id TEXT REFERENCES accounts(id),
        description         TEXT NOT NULL DEFAULT '',
        notes               TEXT NOT NULL DEFAULT '',
        is_fixed            INTEGER NOT NULL DEFAULT 0,
        recurring_rule_id   TEXT REFERENCES recurring_rules(id) ON DELETE SET NULL,
        occurrence_date     TEXT,
        created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (recurring_rule_id, occurrence_date),
        CHECK ((kind = 'transfer') = (transfer_account_id IS NOT NULL)),
        CHECK (kind <> 'transfer' OR category_id IS NULL),
        CHECK (transfer_account_id IS NULL OR transfer_account_id <> account_id)
    );
    CREATE INDEX transactions_by_date ON transactions(date);
    CREATE INDEX transactions_by_account ON transactions(account_id, date);
    CREATE INDEX transactions_by_category ON transactions(category_id, date);

    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

    INSERT INTO categories (id, name, kind, is_fixed_default, sort_order) VALUES
        ('cat-salary',        'Salary',            'income',  0, 1),
        ('cat-extra-income',  'Additional income', 'income',  0, 2),
        ('cat-freelance',     'Freelance',         'income',  0, 3),
        ('cat-rent',          'Rent',              'expense', 1, 1),
        ('cat-food',          'Food',              'expense', 0, 2),
        ('cat-transport',     'Transportation',    'expense', 0, 3),
        ('cat-subscriptions', 'Subscriptions',     'expense', 1, 4),
        ('cat-shopping',      'Shopping',          'expense', 0, 5),
        ('cat-bills',         'Bills',             'expense', 1, 6),
        ('cat-other',         'Other',             'expense', 0, 7);
    "#,
];

pub fn configure(conn: &Connection) -> AppResult<()> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(())
}

/// Bring the schema up to date. Each migration runs in its own transaction.
pub fn migrate(conn: &mut Connection) -> AppResult<()> {
    configure(conn)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
    )?;
    let current: i64 = conn.query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| r.get(0))?;
    if current as usize > MIGRATIONS.len() {
        return Err(AppError::invalid(
            "This vault was created by a newer version of VAULT. Update the application to open it.",
        ));
    }
    for (index, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.execute("INSERT INTO schema_migrations (version) VALUES (?1)", [index as i64 + 1])?;
        tx.commit()?;
    }
    Ok(())
}

// ---------------------------------------------------------------- models

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub opening_balance: i64,
    pub opening_date: String,
    pub archived: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInput {
    pub name: String,
    pub kind: String,
    pub opening_balance: i64,
    pub opening_date: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub is_fixed_default: bool,
    pub archived: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryInput {
    pub name: String,
    pub kind: String,
    pub is_fixed_default: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    pub id: String,
    pub account_id: String,
    pub date: String,
    pub kind: String,
    pub amount: i64,
    pub category_id: Option<String>,
    pub transfer_account_id: Option<String>,
    pub description: String,
    pub notes: String,
    pub is_fixed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionInput {
    pub account_id: String,
    pub date: String,
    pub kind: String,
    pub amount: i64,
    pub category_id: Option<String>,
    pub transfer_account_id: Option<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub is_fixed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ledger {
    pub accounts: Vec<Account>,
    pub categories: Vec<Category>,
    pub transactions: Vec<Transaction>,
}

// ------------------------------------------------------------ validation

/// True for a real calendar date in strict `YYYY-MM-DD` form.
pub fn is_valid_date(date: &str) -> bool {
    let bytes = date.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    let number = |range: std::ops::Range<usize>| -> Option<u32> {
        let part = &date[range];
        if part.bytes().all(|b| b.is_ascii_digit()) { part.parse().ok() } else { None }
    };
    let (Some(year), Some(month), Some(day)) = (number(0..4), number(5..7), number(8..10)) else {
        return false;
    };
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    year >= 1 && (1..=days).contains(&day)
}

/// Largest amount accepted: keeps every sum inside JavaScript's safe integers.
pub const MAX_AMOUNT: i64 = 100_000_000_000_000; // centimes = MAD 1 trillion

fn clean_name(name: &str) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::invalid("A name is required."));
    }
    if name.chars().count() > 80 {
        return Err(AppError::invalid("Names are limited to 80 characters."));
    }
    Ok(name.to_string())
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

// -------------------------------------------------------------- accounts

fn account_from(row: &Row) -> rusqlite::Result<Account> {
    Ok(Account {
        id: row.get(0)?,
        name: row.get(1)?,
        kind: row.get(2)?,
        opening_balance: row.get(3)?,
        opening_date: row.get(4)?,
        archived: row.get(5)?,
    })
}

pub fn list_accounts(conn: &Connection) -> AppResult<Vec<Account>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, kind, opening_balance, opening_date, archived FROM accounts ORDER BY created_at, id",
    )?;
    let rows = stmt.query_map([], account_from)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn save_account(conn: &Connection, id: Option<&str>, input: &AccountInput) -> AppResult<String> {
    let name = clean_name(&input.name)?;
    if !matches!(input.kind.as_str(), "current" | "savings" | "cash") {
        return Err(AppError::invalid("Unknown account type."));
    }
    if !is_valid_date(&input.opening_date) {
        return Err(AppError::invalid("The opening date is not a valid date."));
    }
    if input.opening_balance.abs() > MAX_AMOUNT {
        return Err(AppError::invalid("The opening balance is too large."));
    }
    match id {
        Some(id) => {
            let changed = conn.execute(
                "UPDATE accounts SET name = ?2, kind = ?3, opening_balance = ?4, opening_date = ?5 WHERE id = ?1",
                params![id, name, input.kind, input.opening_balance, input.opening_date],
            )?;
            if changed == 0 { Err(AppError::NotFound) } else { Ok(id.to_string()) }
        }
        None => {
            let id = new_id();
            conn.execute(
                "INSERT INTO accounts (id, name, kind, opening_balance, opening_date) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, name, input.kind, input.opening_balance, input.opening_date],
            )?;
            Ok(id)
        }
    }
}

pub fn set_account_archived(conn: &Connection, id: &str, archived: bool) -> AppResult<()> {
    let changed = conn.execute("UPDATE accounts SET archived = ?2 WHERE id = ?1", params![id, archived])?;
    if changed == 0 { Err(AppError::NotFound) } else { Ok(()) }
}

/// Delete an account that has never been used. Accounts with history can
/// only be archived, so past balances stay explainable.
pub fn delete_account(conn: &Connection, id: &str) -> AppResult<()> {
    let used: i64 = conn.query_row(
        "SELECT COUNT(*) FROM transactions WHERE account_id = ?1 OR transfer_account_id = ?1",
        [id],
        |r| r.get(0),
    )?;
    if used > 0 {
        return Err(AppError::invalid(
            "This account has transactions. Archive it instead, or delete its transactions first.",
        ));
    }
    let changed = conn.execute("DELETE FROM accounts WHERE id = ?1", [id])?;
    if changed == 0 { Err(AppError::NotFound) } else { Ok(()) }
}

// ------------------------------------------------------------ categories

fn category_from(row: &Row) -> rusqlite::Result<Category> {
    Ok(Category {
        id: row.get(0)?,
        name: row.get(1)?,
        kind: row.get(2)?,
        is_fixed_default: row.get(3)?,
        archived: row.get(4)?,
    })
}

pub fn list_categories(conn: &Connection) -> AppResult<Vec<Category>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, kind, is_fixed_default, archived FROM categories ORDER BY kind DESC, sort_order, name",
    )?;
    let rows = stmt.query_map([], category_from)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn save_category(conn: &Connection, id: Option<&str>, input: &CategoryInput) -> AppResult<String> {
    let name = clean_name(&input.name)?;
    if !matches!(input.kind.as_str(), "income" | "expense") {
        return Err(AppError::invalid("Unknown category type."));
    }
    let duplicate: Option<String> = conn
        .query_row(
            "SELECT id FROM categories WHERE kind = ?1 AND name = ?2 COLLATE NOCASE",
            params![input.kind, name],
            |r| r.get(0),
        )
        .optional()?;
    if duplicate.is_some() && duplicate.as_deref() != id {
        return Err(AppError::invalid("A category with this name already exists."));
    }
    match id {
        Some(id) => {
            let existing_kind: Option<String> =
                conn.query_row("SELECT kind FROM categories WHERE id = ?1", [id], |r| r.get(0)).optional()?;
            match existing_kind {
                None => return Err(AppError::NotFound),
                Some(kind) if kind != input.kind => {
                    return Err(AppError::invalid("A category cannot change between income and expense."));
                }
                _ => {}
            }
            conn.execute(
                "UPDATE categories SET name = ?2, is_fixed_default = ?3 WHERE id = ?1",
                params![id, name, input.is_fixed_default],
            )?;
            Ok(id.to_string())
        }
        None => {
            let id = new_id();
            conn.execute(
                "INSERT INTO categories (id, name, kind, is_fixed_default, sort_order) VALUES (?1, ?2, ?3, ?4, 100)",
                params![id, name, input.kind, input.is_fixed_default],
            )?;
            Ok(id)
        }
    }
}

pub fn set_category_archived(conn: &Connection, id: &str, archived: bool) -> AppResult<()> {
    let changed = conn.execute("UPDATE categories SET archived = ?2 WHERE id = ?1", params![id, archived])?;
    if changed == 0 { Err(AppError::NotFound) } else { Ok(()) }
}

// ---------------------------------------------------------- transactions

fn transaction_from(row: &Row) -> rusqlite::Result<Transaction> {
    Ok(Transaction {
        id: row.get(0)?,
        account_id: row.get(1)?,
        date: row.get(2)?,
        kind: row.get(3)?,
        amount: row.get(4)?,
        category_id: row.get(5)?,
        transfer_account_id: row.get(6)?,
        description: row.get(7)?,
        notes: row.get(8)?,
        is_fixed: row.get(9)?,
    })
}

pub fn list_transactions(conn: &Connection) -> AppResult<Vec<Transaction>> {
    let mut stmt = conn.prepare(
        "SELECT id, account_id, date, kind, amount, category_id, transfer_account_id, description, notes, is_fixed
         FROM transactions ORDER BY date DESC, created_at DESC, id",
    )?;
    let rows = stmt.query_map([], transaction_from)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

fn account_exists(conn: &Connection, id: &str) -> AppResult<bool> {
    Ok(conn.query_row("SELECT 1 FROM accounts WHERE id = ?1", [id], |_| Ok(())).optional()?.is_some())
}

/// Validate and normalise an input into the shape the table constraints expect.
fn check_transaction(conn: &Connection, input: &TransactionInput) -> AppResult<TransactionInput> {
    let mut tx = input.clone();
    if !is_valid_date(&tx.date) {
        return Err(AppError::invalid("The date is not a valid date."));
    }
    if tx.amount <= 0 {
        return Err(AppError::invalid("The amount must be greater than zero."));
    }
    if tx.amount > MAX_AMOUNT {
        return Err(AppError::invalid("The amount is too large."));
    }
    if !account_exists(conn, &tx.account_id)? {
        return Err(AppError::invalid("Choose an account."));
    }
    tx.description = tx.description.trim().to_string();
    tx.notes = tx.notes.trim().to_string();
    if tx.description.chars().count() > 200 || tx.notes.chars().count() > 2000 {
        return Err(AppError::invalid("The description or notes are too long."));
    }

    match tx.kind.as_str() {
        "transfer" => {
            let Some(destination) = tx.transfer_account_id.as_deref() else {
                return Err(AppError::invalid("Choose the account the money moves to."));
            };
            if destination == tx.account_id {
                return Err(AppError::invalid("A transfer needs two different accounts."));
            }
            if !account_exists(conn, destination)? {
                return Err(AppError::invalid("Choose the account the money moves to."));
            }
            tx.category_id = None;
            tx.is_fixed = false;
        }
        "income" | "expense" => {
            tx.transfer_account_id = None;
            let Some(category_id) = tx.category_id.as_deref() else {
                return Err(AppError::invalid("Choose a category."));
            };
            let kind: Option<String> = conn
                .query_row("SELECT kind FROM categories WHERE id = ?1", [category_id], |r| r.get(0))
                .optional()?;
            if kind.as_deref() != Some(tx.kind.as_str()) {
                return Err(AppError::invalid("The category does not match the transaction type."));
            }
            if tx.kind == "income" {
                tx.is_fixed = false;
            }
        }
        _ => return Err(AppError::invalid("Unknown transaction type.")),
    }
    Ok(tx)
}

pub fn save_transaction(conn: &Connection, id: Option<&str>, input: &TransactionInput) -> AppResult<String> {
    let tx = check_transaction(conn, input)?;
    match id {
        Some(id) => {
            let changed = conn.execute(
                "UPDATE transactions SET account_id = ?2, date = ?3, kind = ?4, amount = ?5, category_id = ?6,
                    transfer_account_id = ?7, description = ?8, notes = ?9, is_fixed = ?10,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                 WHERE id = ?1",
                params![id, tx.account_id, tx.date, tx.kind, tx.amount, tx.category_id, tx.transfer_account_id,
                    tx.description, tx.notes, tx.is_fixed],
            )?;
            if changed == 0 { Err(AppError::NotFound) } else { Ok(id.to_string()) }
        }
        None => {
            let id = new_id();
            conn.execute(
                "INSERT INTO transactions (id, account_id, date, kind, amount, category_id, transfer_account_id,
                    description, notes, is_fixed)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![id, tx.account_id, tx.date, tx.kind, tx.amount, tx.category_id, tx.transfer_account_id,
                    tx.description, tx.notes, tx.is_fixed],
            )?;
            Ok(id)
        }
    }
}

pub fn delete_transaction(conn: &Connection, id: &str) -> AppResult<()> {
    let changed = conn.execute("DELETE FROM transactions WHERE id = ?1", [id])?;
    if changed == 0 { Err(AppError::NotFound) } else { Ok(()) }
}

pub fn load_ledger(conn: &Connection) -> AppResult<Ledger> {
    Ok(Ledger {
        accounts: list_accounts(conn)?,
        categories: list_categories(conn)?,
        transactions: list_transactions(conn)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        conn
    }

    fn account(conn: &Connection, name: &str, kind: &str) -> String {
        save_account(
            conn,
            None,
            &AccountInput { name: name.into(), kind: kind.into(), opening_balance: 500_000, opening_date: "2026-01-01".into() },
        )
        .unwrap()
    }

    fn expense(account_id: &str, amount: i64) -> TransactionInput {
        TransactionInput {
            account_id: account_id.into(),
            date: "2026-11-12".into(),
            kind: "expense".into(),
            amount,
            category_id: Some("cat-food".into()),
            transfer_account_id: None,
            description: "  Groceries ".into(),
            notes: String::new(),
            is_fixed: false,
        }
    }

    #[test]
    fn validates_dates() {
        for good in ["2026-11-12", "2028-02-29", "2000-02-29", "0001-01-01"] {
            assert!(is_valid_date(good), "{good}");
        }
        for bad in ["2026-02-30", "2025-02-29", "1900-02-29", "2026-13-01", "2026-00-10", "2026-1-05",
            "12/11/2026", "", "2026-11-1x", "+026-11-12", "2026-11-12 "] {
            assert!(!is_valid_date(bad), "{bad}");
        }
    }

    #[test]
    fn migrations_are_idempotent_and_seed_categories() {
        let mut conn = db();
        migrate(&mut conn).unwrap();
        let categories = list_categories(&conn).unwrap();
        assert_eq!(categories.len(), 10);
        assert!(categories.iter().any(|c| c.name == "Rent" && c.is_fixed_default));
        let version: i64 = conn.query_row("SELECT MAX(version) FROM schema_migrations", [], |r| r.get(0)).unwrap();
        assert_eq!(version as usize, MIGRATIONS.len());
    }

    #[test]
    fn refuses_a_vault_from_a_newer_version() {
        let mut conn = db();
        conn.execute("INSERT INTO schema_migrations (version) VALUES (999)", []).unwrap();
        assert!(matches!(migrate(&mut conn), Err(AppError::Invalid(_))));
    }

    #[test]
    fn account_round_trip_and_validation() {
        let conn = db();
        let id = account(&conn, "  Current  ", "current");
        let accounts = list_accounts(&conn).unwrap();
        assert_eq!(accounts[0].name, "Current");
        assert_eq!(accounts[0].opening_balance, 500_000);

        let bad = |name: &str, kind: &str, date: &str| {
            save_account(&conn, None, &AccountInput { name: name.into(), kind: kind.into(), opening_balance: 0, opening_date: date.into() })
        };
        assert!(bad("", "current", "2026-01-01").is_err());
        assert!(bad("X", "brokerage", "2026-01-01").is_err());
        assert!(bad("X", "current", "2026-02-31").is_err());

        save_account(&conn, Some(&id), &AccountInput { name: "Main".into(), kind: "current".into(), opening_balance: -100, opening_date: "2026-02-01".into() }).unwrap();
        assert_eq!(list_accounts(&conn).unwrap()[0].opening_balance, -100);
        assert!(matches!(
            save_account(&conn, Some("missing"), &AccountInput { name: "X".into(), kind: "cash".into(), opening_balance: 0, opening_date: "2026-01-01".into() }),
            Err(AppError::NotFound)
        ));
    }

    #[test]
    fn transaction_round_trip() {
        let conn = db();
        let current = account(&conn, "Current", "current");
        let id = save_transaction(&conn, None, &expense(&current, 12_345)).unwrap();
        let stored = &list_transactions(&conn).unwrap()[0];
        assert_eq!(stored.amount, 12_345);
        assert_eq!(stored.description, "Groceries");
        assert_eq!(stored.category_id.as_deref(), Some("cat-food"));

        let mut edit = expense(&current, 99_999);
        edit.date = "2026-10-01".into();
        save_transaction(&conn, Some(&id), &edit).unwrap();
        let stored = &list_transactions(&conn).unwrap()[0];
        assert_eq!((stored.amount, stored.date.as_str()), (99_999, "2026-10-01"));

        delete_transaction(&conn, &id).unwrap();
        assert!(list_transactions(&conn).unwrap().is_empty());
        assert!(matches!(delete_transaction(&conn, &id), Err(AppError::NotFound)));
    }

    #[test]
    fn rejects_invalid_transactions() {
        let conn = db();
        let current = account(&conn, "Current", "current");
        let reject = |change: &dyn Fn(&mut TransactionInput)| {
            let mut input = expense(&current, 1000);
            change(&mut input);
            assert!(matches!(save_transaction(&conn, None, &input), Err(AppError::Invalid(_))));
        };
        reject(&|t| t.amount = 0);
        reject(&|t| t.amount = -500);
        reject(&|t| t.amount = MAX_AMOUNT + 1);
        reject(&|t| t.date = "2026-02-30".into());
        reject(&|t| t.account_id = "nope".into());
        reject(&|t| t.category_id = None);
        reject(&|t| t.category_id = Some("cat-salary".into())); // income category on an expense
        reject(&|t| t.kind = "gift".into());
        assert!(list_transactions(&conn).unwrap().is_empty());
    }

    #[test]
    fn transfers_need_two_distinct_accounts_and_no_category() {
        let conn = db();
        let current = account(&conn, "Current", "current");
        let savings = account(&conn, "Savings", "savings");
        let mut transfer = expense(&current, 200_000);
        transfer.kind = "transfer".into();

        assert!(save_transaction(&conn, None, &transfer).is_err()); // no destination
        transfer.transfer_account_id = Some(current.clone());
        assert!(save_transaction(&conn, None, &transfer).is_err()); // same account
        transfer.transfer_account_id = Some(savings.clone());
        save_transaction(&conn, None, &transfer).unwrap();

        let stored = &list_transactions(&conn).unwrap()[0];
        assert_eq!(stored.category_id, None); // category dropped
        assert_eq!(stored.transfer_account_id.as_deref(), Some(savings.as_str()));
    }

    #[test]
    fn used_accounts_cannot_be_deleted_only_archived() {
        let conn = db();
        let current = account(&conn, "Current", "current");
        let spare = account(&conn, "Spare", "cash");
        save_transaction(&conn, None, &expense(&current, 1000)).unwrap();

        assert!(matches!(delete_account(&conn, &current), Err(AppError::Invalid(_))));
        set_account_archived(&conn, &current, true).unwrap();
        assert!(list_accounts(&conn).unwrap().iter().any(|a| a.id == current && a.archived));
        delete_account(&conn, &spare).unwrap();
        assert_eq!(list_accounts(&conn).unwrap().len(), 1);
    }

    #[test]
    fn custom_categories() {
        let conn = db();
        let input = |name: &str, kind: &str| CategoryInput { name: name.into(), kind: kind.into(), is_fixed_default: false };
        let id = save_category(&conn, None, &input("Health", "expense")).unwrap();
        assert!(save_category(&conn, None, &input("health", "expense")).is_err()); // duplicate, case-insensitive
        assert!(save_category(&conn, None, &input("Rent", "expense")).is_err());
        save_category(&conn, None, &input("Rent", "income")).unwrap(); // same name, other kind: fine
        save_category(&conn, Some(&id), &input("Healthcare", "expense")).unwrap();
        assert!(save_category(&conn, Some(&id), &input("Healthcare", "income")).is_err()); // kind is fixed
        set_category_archived(&conn, &id, true).unwrap();
        assert!(list_categories(&conn).unwrap().iter().any(|c| c.name == "Healthcare" && c.archived));
    }
}
