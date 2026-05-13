use crate::errors::{ProviderError, ProviderException, ProviderResult};
use soto_audio::RecordingFile;

pub mod chat_completions;

pub use chat_completions::{
    ChatCompletionsOmni, DOUBAO_ARK_DEFAULT_BASE_URL, DOUBAO_ARK_PROVIDER_ID,
    DOUBAO_SEED_2_0_LITE_MODEL, DOUBAO_SEED_2_0_MINI_MODEL, MIMO_API_DEFAULT_BASE_URL,
    MIMO_API_PROVIDER_ID, MIMO_DEFAULT_MODEL, MIMO_PLAN_CN_DEFAULT_BASE_URL,
    MIMO_PLAN_CN_PROVIDER_ID, MIMO_PLAN_SEA_DEFAULT_BASE_URL, MIMO_PLAN_SEA_PROVIDER_ID,
};

/// Omni provider configuration. An "Omni" vendor takes audio + text prompt in
/// one call and returns the final text response. Used to replace the
/// ASR -> LLM pipeline with a single round-trip.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OmniConfig {
    pub provider_id: String,
    pub api_key: String,
    pub model: String,
    pub base_url: String,
}

pub struct VoiceRequest<'a> {
    pub system_prompt: String,
    pub user_prompt: String,
    pub recording: &'a RecordingFile,
}

pub enum OmniProvider {
    ChatCompletions(ChatCompletionsOmni),
}

impl OmniProvider {
    pub async fn respond(
        &self,
        config: &OmniConfig,
        request: VoiceRequest<'_>,
    ) -> ProviderResult<String> {
        match self {
            OmniProvider::ChatCompletions(p) => p.respond(config, request).await,
        }
    }

    pub async fn validate(&self, config: &OmniConfig) -> ProviderResult<()> {
        match self {
            OmniProvider::ChatCompletions(p) => p.validate(config).await,
        }
    }
}

pub fn build_omni_provider(config: &OmniConfig) -> ProviderResult<OmniProvider> {
    let provider = config.provider_id.trim().to_ascii_lowercase();
    match chat_completions::provider_defaults_for(&provider) {
        Some(_) => Ok(OmniProvider::ChatCompletions(ChatCompletionsOmni::new(
            chat_completions::default_http_client(),
        ))),
        None => Err(ProviderException::new(
            ProviderError::InvalidConfiguration,
            format!("Unsupported Omni provider '{provider}'."),
        )),
    }
}
