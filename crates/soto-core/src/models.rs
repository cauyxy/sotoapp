use chrono::{DateTime, Utc};

use serde::{Deserialize, Serialize};

use crate::hotkey::Chord;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HotkeyStyle {
    Hold,
    Toggle,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HotkeyBinding {
    pub chord: Chord,
    pub style: HotkeyStyle,
}

pub fn deserialize_optional_hotkey<'de, D>(
    deserializer: D,
) -> Result<Option<HotkeyBinding>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value: Option<serde_json::Value> = Option::deserialize(deserializer)?;
    let Some(value) = value else {
        return Ok(None);
    };
    match serde_json::from_value::<HotkeyBinding>(value) {
        Ok(binding) => Ok(Some(binding)),
        Err(error) => {
            eprintln!("soto-core: dropping legacy/unparseable hotkey binding: {error}");
            Ok(None)
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Mode {
    pub id: String,
    pub name: String,
    #[serde(default, deserialize_with = "deserialize_optional_hotkey")]
    pub hotkey: Option<HotkeyBinding>,
    pub display_order: u32,
    pub built_in: bool,
    /// References a `PromptDocument.id` in the PromptStore. Prompt body is
    /// loaded separately via the store.
    pub prompt_id: String,
}

/// Injection layer mode. The session layer always picks
/// `ReplaceSelectionWhenPresent` for canonical modes; the variants exist
/// because `soto-injection` / `soto-platform` branch on them when planning
/// keystroke vs. paste fallbacks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectionBehavior {
    ReplaceSelectionWhenPresent,
    AlwaysAppend,
    PromptInjectsSelection,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ValidationStatus {
    Unspecified,
    Ok,
    Warn,
    Err,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderConfigValidation {
    pub last_validated_at: Option<DateTime<Utc>>,
    pub last_validated_latency_ms: Option<u32>,
    pub last_validated_status: ValidationStatus,
    pub last_validated_note: Option<String>,
    pub last_validated_sample: Option<String>,
    pub last_validated_sample_result: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub config_id: String,
    pub provider_id: String,
    pub display_name: Option<String>,
    pub model: String,
    pub base_url: Option<String>,
    pub is_default: bool,
    pub validation: ProviderConfigValidation,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppSettings {
    pub locale: String,
    pub active_provider_config_id: Option<String>,
    pub transcription_language_hint: String,
    pub microphone_device_id: Option<String>,
    pub input_level: u8,
    pub history_enabled: bool,
    pub store_target_metadata: bool,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_use_proxy")]
    pub use_proxy: bool,
}

fn default_theme() -> String {
    "system".to_string()
}

fn default_use_proxy() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Completed,
    Empty,
    Failed,
    Cancelled,
}

/// Why a session ended with `SessionStatus::Empty`. Sidecar field on
/// `SessionRunOutcome` / `CompleteFinalTranscriptResult`; not persisted to
/// the history record today (history rows continue to record plain
/// `SessionStatus::Empty`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EmptyReason {
    /// Recording shorter than the minimum threshold (likely tap-press).
    TooShort,
    /// Recording is the right length but had no above-noise-floor signal.
    Silent,
    /// Provider returned no recognized text for a non-trivial recording.
    NoRecognition,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "detail", rename_all = "snake_case")]
pub enum InjectionOutcome {
    Inserted,
    PasteSent,
    CopiedFallback,
    NoOp,
    Failed(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HistoryRecord {
    pub id: String,
    pub created_at: DateTime<Utc>,
    /// Model output for Omni sessions. For external commit sessions this is
    /// the text supplied by the companion device.
    pub raw_text: String,
    pub processing_mode: String,
    pub processed_text: Option<String>,
    /// Text finally submitted by the user/session. For normal desktop voice
    /// sessions this currently matches `raw_text`; companion flows may let the
    /// user edit before committing.
    pub final_text: String,
    pub status: SessionStatus,
    pub injection_outcome: InjectionOutcome,
    pub speaking_duration_ms: u64,
    pub char_count: u32,
    pub target_app: String,
    pub target_window_title: String,
    pub target_control_type: String,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SessionTarget {
    pub app: String,
    pub window_title: String,
    pub control_type: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DictionarySource {
    UserAdded,
    AutoLearned,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DictionaryStatus {
    Active,
    Suggested,
    Archived,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DictionaryEntry {
    pub id: String,
    pub term: String,
    pub aliases: Vec<String>,
    pub note: String,
    pub source: DictionarySource,
    pub status: DictionaryStatus,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub hit_count: u32,
}

#[cfg(test)]
mod hotkey_migration_tests {
    use super::*;

    #[test]
    fn legacy_hotkey_shape_drops_to_none() {
        let json = r#"{
            "id": "m1",
            "name": "Mode",
            "hotkey": { "key_code": 65, "modifiers": 1, "style": "hold" },
            "display_order": 0,
            "built_in": false,
            "prompt_id": "default"
        }"#;
        let mode: Mode = serde_json::from_str(json).expect("mode parses");
        assert!(mode.hotkey.is_none());
    }

    #[test]
    fn new_hotkey_shape_parses() {
        let json = r#"{
            "id": "m1",
            "name": "Mode",
            "hotkey": { "chord": "RightAlt", "style": "hold" },
            "display_order": 0,
            "built_in": false,
            "prompt_id": "default"
        }"#;
        let mode: Mode = serde_json::from_str(json).expect("mode parses");
        let hotkey = mode.hotkey.expect("hotkey present");
        assert_eq!(hotkey.chord.canonical(), "RightAlt");
    }
}

#[cfg(test)]
mod hotwords_tests {
    use chrono::Utc;

    use super::*;
    use crate::{DictionaryReader, collect_hotwords};

    #[derive(Debug, Clone)]
    struct FakeDictionaryReader {
        entries: Vec<DictionaryEntry>,
    }

    impl DictionaryReader for FakeDictionaryReader {
        fn read_dictionary(&self) -> Result<Vec<DictionaryEntry>, String> {
            Ok(self.entries.clone())
        }
    }

    fn dictionary_entry(
        id: &str,
        term: &str,
        enabled: bool,
        status: DictionaryStatus,
    ) -> DictionaryEntry {
        let now = Utc::now();
        DictionaryEntry {
            id: id.to_string(),
            term: term.to_string(),
            aliases: vec![format!("{term} alias")],
            note: format!("{term} note"),
            source: DictionarySource::UserAdded,
            status,
            enabled,
            created_at: now,
            updated_at: now,
            last_used_at: None,
            hit_count: 0,
        }
    }

    #[test]
    fn collect_hotwords_filters_to_enabled_active_terms() {
        let reader = FakeDictionaryReader {
            entries: vec![
                dictionary_entry("1", "Soto", true, DictionaryStatus::Active),
                dictionary_entry("2", "Disabled", false, DictionaryStatus::Active),
                dictionary_entry("3", "Suggested", true, DictionaryStatus::Suggested),
                dictionary_entry("4", "Archived", true, DictionaryStatus::Archived),
            ],
        };

        let hotwords = collect_hotwords(&reader).expect("hotwords collect");

        assert_eq!(hotwords, vec!["Soto"]);
    }

    #[test]
    fn collect_hotwords_preserves_storage_order() {
        let reader = FakeDictionaryReader {
            entries: vec![
                dictionary_entry("1", "Soto", true, DictionaryStatus::Active),
                dictionary_entry("2", "Claude", true, DictionaryStatus::Active),
                dictionary_entry("3", "Tauri", true, DictionaryStatus::Active),
            ],
        };

        let hotwords = collect_hotwords(&reader).expect("hotwords collect");

        assert_eq!(hotwords, vec!["Soto", "Claude", "Tauri"]);
    }
}

#[cfg(test)]
mod app_settings_proxy_tests {
    use super::*;

    fn base_json(extra: &str) -> String {
        format!(
            r#"{{
                "locale": "en-US",
                "active_provider_config_id": null,
                "transcription_language_hint": "",
                "microphone_device_id": null,
                "input_level": 80,
                "history_enabled": true,
                "store_target_metadata": false,
                "theme": "system"
                {extra}
            }}"#
        )
    }

    #[test]
    fn use_proxy_defaults_to_true_when_field_absent() {
        let settings: AppSettings = serde_json::from_str(&base_json("")).unwrap();
        assert!(settings.use_proxy, "use_proxy must default to true");
    }

    #[test]
    fn use_proxy_false_round_trips() {
        let settings: AppSettings =
            serde_json::from_str(&base_json(r#", "use_proxy": false"#)).unwrap();
        assert!(!settings.use_proxy);
    }

    #[test]
    fn use_proxy_true_round_trips() {
        let settings: AppSettings =
            serde_json::from_str(&base_json(r#", "use_proxy": true"#)).unwrap();
        assert!(settings.use_proxy);
    }
}
