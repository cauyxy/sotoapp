use thiserror::Error;

use crate::{AppSettings, DictionaryEntry, HistoryRecord, Mode, ProviderConfig};

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("storage error: {0}")]
    Storage(String),
}

pub trait ModeStore: Send + Sync {
    fn list(&self) -> Result<Vec<Mode>, StoreError>;
    fn get(&self, id: &str) -> Result<Mode, StoreError>;
    fn put(&self, mode: &Mode) -> Result<(), StoreError>;
    fn delete(&self, id: &str) -> Result<(), StoreError>;
}

pub trait DictionaryStore: Send + Sync {
    fn list(&self) -> Result<Vec<DictionaryEntry>, StoreError>;
    fn put(&self, entry: &DictionaryEntry) -> Result<(), StoreError>;
    fn delete(&self, id: &str) -> Result<(), StoreError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderSecrets {
    pub api_key: String,
    pub endpoint: Option<String>,
}

pub trait ProviderConfigStore: Send + Sync {
    fn list(&self) -> Result<Vec<ProviderConfig>, StoreError>;
    fn get(&self, config_id: &str) -> Result<ProviderConfig, StoreError>;
    fn put(&self, config: &ProviderConfig) -> Result<(), StoreError>;
    fn delete(&self, config_id: &str) -> Result<(), StoreError>;
    fn set_default(&self, config_id: &str) -> Result<(), StoreError>;
}

pub trait ProviderSecretsStore: Send + Sync {
    fn get(&self, config_id: &str) -> Result<ProviderSecrets, StoreError>;
    fn put(&self, config_id: &str, secrets: &ProviderSecrets) -> Result<(), StoreError>;
    fn delete(&self, config_id: &str) -> Result<(), StoreError>;
}

pub trait HistoryStore: Send + Sync {
    fn append(&self, record: &HistoryRecord) -> Result<(), StoreError>;
    fn list_recent(&self, limit: usize) -> Result<Vec<HistoryRecord>, StoreError>;
    fn delete(&self, id: &str) -> Result<(), StoreError>;
    fn clear(&self) -> Result<(), StoreError>;
}

pub trait SettingsStore: Send + Sync {
    fn read(&self) -> Result<AppSettings, StoreError>;
    fn write(&self, settings: &AppSettings) -> Result<(), StoreError>;
}

/// Pure function: filter dictionary entries down to enabled + active hotword terms,
/// preserving storage order. Aliases are NOT included.
pub fn active_hotword_terms(entries: &[DictionaryEntry]) -> Vec<String> {
    entries
        .iter()
        .filter(|e| e.enabled && matches!(e.status, crate::DictionaryStatus::Active))
        .map(|e| e.term.clone())
        .collect()
}
