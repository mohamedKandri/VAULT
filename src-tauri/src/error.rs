use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

/// Every failure the webview can receive. Serialised as `{ code, message }`
/// so the UI can branch on `code` and show `message`.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("The vault is locked.")]
    Locked,
    #[error("No vault exists yet.")]
    NoVault,
    #[error("A vault already exists.")]
    VaultExists,
    #[error("Incorrect passphrase.")]
    WrongPassphrase,
    #[error("The vault file is damaged or is not a VAULT database.")]
    Corrupt,
    #[error("{0}")]
    Invalid(String),
    #[error("Not found.")]
    NotFound,
    #[error("Storage error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("Internal error: {0}")]
    Internal(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Locked => "locked",
            AppError::NoVault => "no_vault",
            AppError::VaultExists => "vault_exists",
            AppError::WrongPassphrase => "wrong_passphrase",
            AppError::Corrupt => "corrupt",
            AppError::Invalid(_) => "invalid",
            AppError::NotFound => "not_found",
            AppError::Io(_) => "io",
            AppError::Db(_) => "db",
            AppError::Internal(_) => "internal",
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        AppError::Invalid(message.into())
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
