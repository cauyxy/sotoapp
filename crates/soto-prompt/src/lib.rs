use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PromptDocument {
    pub id: String,
    pub body: String,
}

#[derive(Debug, Error)]
pub enum PromptError {
    #[error("prompt not found: {0}")]
    NotFound(String),
    #[error("prompt storage error: {0}")]
    Storage(String),
}

pub trait PromptStore: Send + Sync {
    fn get(&self, id: &str) -> Result<PromptDocument, PromptError>;
    fn put(&self, doc: &PromptDocument) -> Result<(), PromptError>;
    fn delete(&self, id: &str) -> Result<(), PromptError>;
}

/// Fully-assembled prompt strings for a single voice request.
///
/// `soto-prompt` owns every prompt-content decision (fallback, hotword
/// formatting, audio label). Providers consume the two strings + a
/// `RecordingFile` and only decide the wire shape — they do **not** re-parse,
/// re-format, or re-decide prompt content.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoicePrompt {
    pub system_prompt: String,
    pub user_prompt: String,
}

const FALLBACK_PROMPT: &str = "Respond to the following audio.";
const AUDIO_LABEL: &str = "User Audio:";

pub fn build_voice_prompt(doc: &PromptDocument, hotwords: &[String]) -> VoicePrompt {
    let system_prompt = if doc.body.trim().is_empty() {
        FALLBACK_PROMPT.to_owned()
    } else {
        doc.body.clone()
    };

    let user_prompt = if hotwords.is_empty() {
        AUDIO_LABEL.to_owned()
    } else {
        let body = hotwords
            .iter()
            .map(|term| format!("- {term}"))
            .collect::<Vec<_>>()
            .join("\n");
        format!("<热词>\n{body}\n</热词>\n\n{AUDIO_LABEL}")
    };

    VoicePrompt {
        system_prompt,
        user_prompt,
    }
}

/// Returns the bundled built-in prompt documents used to seed first-run storage.
///
/// Returns owned `PromptDocument`s; the first-run seeder calls this once.
pub fn bundled_prompt_documents() -> Vec<PromptDocument> {
    vec![
        PromptDocument {
            id: "default".into(),
            body: include_str!("../prompts/default.md").trim_end().to_owned(),
        },
        PromptDocument {
            id: "translate".into(),
            body: include_str!("../prompts/translate.md")
                .trim_end()
                .to_owned(),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_used_when_body_empty() {
        let prompt = build_voice_prompt(
            &PromptDocument {
                id: "default".into(),
                body: "".into(),
            },
            &[],
        );

        assert_eq!(prompt.system_prompt, FALLBACK_PROMPT);
        assert_eq!(prompt.user_prompt, "User Audio:");
    }

    #[test]
    fn body_preserved_when_present() {
        let prompt = build_voice_prompt(
            &PromptDocument {
                id: "default".into(),
                body: "Please transcribe".into(),
            },
            &[],
        );

        assert_eq!(prompt.system_prompt, "Please transcribe");
        assert_eq!(prompt.user_prompt, "User Audio:");
    }

    #[test]
    fn hotwords_render_before_audio_label_separated_by_blank_line() {
        let prompt = build_voice_prompt(
            &PromptDocument {
                id: "default".into(),
                body: "Please transcribe".into(),
            },
            &["Soto".into(), "Claude".into()],
        );

        assert_eq!(prompt.system_prompt, "Please transcribe");
        assert_eq!(
            prompt.user_prompt,
            "<热词>\n- Soto\n- Claude\n</热词>\n\nUser Audio:"
        );
    }

    #[test]
    fn bundled_documents_contain_default_and_translate() {
        let docs = bundled_prompt_documents();
        let ids: Vec<&str> = docs.iter().map(|d| d.id.as_str()).collect();
        assert_eq!(ids, vec!["default", "translate"]);
        assert!(!docs[0].body.is_empty());
        assert!(!docs[1].body.is_empty());
    }
}
