//! `Provider` trait + concrete `MimoProvider` / `DoubaoProvider` impls.
//!
//! The trait sits on top of the existing chat-completions transport
//! (`omni::ChatCompletionsOmni`) so we get a dyn-compatible seam that mocks
//! can implement, without rewriting the wire format.
//!
//! Phase E follow-up: callers should construct providers through
//! `ProviderFactory::build`; the legacy `omni::OmniProvider` enum stays as a
//! transport-level helper.

use std::sync::Arc;

use futures::future::BoxFuture;
use soto_audio::RecordingFile;
use soto_core::{ProviderConfig, stores::ProviderSecrets};
use soto_prompt::VoicePrompt;

use crate::errors::{ProviderError, ProviderException, ProviderResult};
use crate::omni::{self, OmniConfig, VoiceRequest, chat_completions};

/// Provider response carried back to orchestration.
#[derive(Debug, Clone)]
pub struct ProviderResponse {
    pub raw_text: String,
    pub processed_text: Option<String>,
    pub final_text: String,
    pub provider_id: String,
    pub model_id: String,
}

/// Outbound provider operations. Dyn-compatible — `Arc<dyn Provider>` is the
/// orchestration-layer handle.
pub trait Provider: Send + Sync {
    /// Run one voice request: serialize the `VoicePrompt` for this vendor +
    /// upload the recording + parse the response.
    fn invoke<'a>(
        &'a self,
        prompt: VoicePrompt,
        audio: &'a RecordingFile,
    ) -> BoxFuture<'a, Result<ProviderResponse, ProviderException>>;

    /// Validate credentials with a trivial round-trip.
    fn validate<'a>(&'a self) -> BoxFuture<'a, ProviderResult<()>>;

    fn provider_id(&self) -> &str;
    fn model_id(&self) -> &str;
}

pub struct MimoProvider {
    config: OmniConfig,
    transport: omni::ChatCompletionsOmni,
}

pub struct DoubaoProvider {
    config: OmniConfig,
    transport: omni::ChatCompletionsOmni,
}

pub struct QwenProvider {
    config: OmniConfig,
    transport: omni::ChatCompletionsOmni,
}

impl MimoProvider {
    pub fn new(config: OmniConfig, client: reqwest::Client) -> Self {
        Self {
            config,
            transport: omni::ChatCompletionsOmni::new(client),
        }
    }
}

impl DoubaoProvider {
    pub fn new(config: OmniConfig, client: reqwest::Client) -> Self {
        Self {
            config,
            transport: omni::ChatCompletionsOmni::new(client),
        }
    }
}

impl QwenProvider {
    pub fn new(config: OmniConfig, client: reqwest::Client) -> Self {
        Self {
            config,
            transport: omni::ChatCompletionsOmni::new(client),
        }
    }
}

async fn invoke_chat_completions(
    transport: &omni::ChatCompletionsOmni,
    config: &OmniConfig,
    prompt: VoicePrompt,
    audio: &RecordingFile,
) -> Result<ProviderResponse, ProviderException> {
    let request = VoiceRequest {
        system_prompt: prompt.system_prompt,
        user_prompt: prompt.user_prompt,
        recording: audio,
    };
    let text = transport.respond(config, request).await?;
    Ok(ProviderResponse {
        raw_text: text.clone(),
        processed_text: None,
        final_text: text,
        provider_id: config.provider_id.clone(),
        model_id: config.model.clone(),
    })
}

impl Provider for MimoProvider {
    fn invoke<'a>(
        &'a self,
        prompt: VoicePrompt,
        audio: &'a RecordingFile,
    ) -> BoxFuture<'a, Result<ProviderResponse, ProviderException>> {
        Box::pin(invoke_chat_completions(
            &self.transport,
            &self.config,
            prompt,
            audio,
        ))
    }

    fn validate<'a>(&'a self) -> BoxFuture<'a, ProviderResult<()>> {
        let transport = &self.transport;
        let config = &self.config;
        Box::pin(async move { transport.validate(config).await })
    }

    fn provider_id(&self) -> &str {
        &self.config.provider_id
    }

    fn model_id(&self) -> &str {
        &self.config.model
    }
}

impl Provider for DoubaoProvider {
    fn invoke<'a>(
        &'a self,
        prompt: VoicePrompt,
        audio: &'a RecordingFile,
    ) -> BoxFuture<'a, Result<ProviderResponse, ProviderException>> {
        Box::pin(invoke_chat_completions(
            &self.transport,
            &self.config,
            prompt,
            audio,
        ))
    }

    fn validate<'a>(&'a self) -> BoxFuture<'a, ProviderResult<()>> {
        let transport = &self.transport;
        let config = &self.config;
        Box::pin(async move { transport.validate(config).await })
    }

    fn provider_id(&self) -> &str {
        &self.config.provider_id
    }

    fn model_id(&self) -> &str {
        &self.config.model
    }
}

impl Provider for QwenProvider {
    fn invoke<'a>(
        &'a self,
        prompt: VoicePrompt,
        audio: &'a RecordingFile,
    ) -> BoxFuture<'a, Result<ProviderResponse, ProviderException>> {
        Box::pin(invoke_chat_completions(
            &self.transport,
            &self.config,
            prompt,
            audio,
        ))
    }

    fn validate<'a>(&'a self) -> BoxFuture<'a, ProviderResult<()>> {
        let transport = &self.transport;
        let config = &self.config;
        Box::pin(async move { transport.validate(config).await })
    }

    fn provider_id(&self) -> &str {
        &self.config.provider_id
    }

    fn model_id(&self) -> &str {
        &self.config.model
    }
}

/// Construction seam: `ProviderFactory::build` turns a (config, secrets) pair
/// into an `Arc<dyn Provider>`. Production wires `DefaultProviderFactory`;
/// tests can swap in a mock that returns `Arc<MockProvider>`.
pub trait ProviderFactory: Send + Sync {
    fn build(
        &self,
        config: &ProviderConfig,
        secrets: &ProviderSecrets,
    ) -> ProviderResult<Arc<dyn Provider>>;
}

pub struct DefaultProviderFactory {
    client: reqwest::Client,
}

impl DefaultProviderFactory {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }
}

impl ProviderFactory for DefaultProviderFactory {
    fn build(
        &self,
        config: &ProviderConfig,
        secrets: &ProviderSecrets,
    ) -> ProviderResult<Arc<dyn Provider>> {
        let omni = omni_config_from_pair(config, secrets);
        let provider_id = omni.provider_id.trim().to_ascii_lowercase();
        match chat_completions::provider_defaults_for(&provider_id) {
            Some(_) if provider_id.starts_with("mimo-") => {
                Ok(Arc::new(MimoProvider::new(omni, self.client.clone())) as Arc<dyn Provider>)
            }
            Some(_) if provider_id == chat_completions::DOUBAO_ARK_PROVIDER_ID => {
                Ok(Arc::new(DoubaoProvider::new(omni, self.client.clone())) as Arc<dyn Provider>)
            }
            Some(_) if provider_id == chat_completions::DASHSCOPE_PROVIDER_ID => {
                Ok(Arc::new(QwenProvider::new(omni, self.client.clone())) as Arc<dyn Provider>)
            }
            _ => Err(ProviderException::new(
                ProviderError::InvalidConfiguration,
                format!("Unsupported provider '{provider_id}'."),
            )),
        }
    }
}

#[cfg(test)]
mod provider_tests {
    use chrono::Utc;
    use soto_core::{
        ProviderConfig, ProviderConfigValidation, ValidationStatus, stores::ProviderSecrets,
    };

    use super::*;
    use crate::omni::chat_completions;

    fn mimo_config() -> ProviderConfig {
        ProviderConfig {
            config_id: "config.test".into(),
            provider_id: "mimo-plan-sea".into(),
            display_name: None,
            model: "mimo-v2.5".into(),
            base_url: Some("https://token-plan-sgp.xiaomimimo.com/v1".into()),
            is_default: true,
            validation: ProviderConfigValidation {
                last_validated_at: None,
                last_validated_latency_ms: None,
                last_validated_status: ValidationStatus::Unspecified,
                last_validated_note: None,
                last_validated_sample: None,
                last_validated_sample_result: None,
            },
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    fn secrets() -> ProviderSecrets {
        ProviderSecrets {
            api_key: "test-key".into(),
            endpoint: None,
        }
    }

    #[test]
    fn default_provider_factory_builds_mimo_provider() {
        let client = chat_completions::default_http_client();
        let factory = DefaultProviderFactory::new(client);
        let provider = factory.build(&mimo_config(), &secrets()).unwrap();
        assert_eq!(provider.provider_id(), "mimo-plan-sea");
    }

    #[test]
    fn default_provider_factory_rejects_unknown_provider() {
        let client = chat_completions::default_http_client();
        let factory = DefaultProviderFactory::new(client);
        let mut cfg = mimo_config();
        cfg.provider_id = "unknown-provider".into();
        assert!(factory.build(&cfg, &secrets()).is_err());
    }
}

fn omni_config_from_pair(cfg: &ProviderConfig, secrets: &ProviderSecrets) -> OmniConfig {
    OmniConfig {
        provider_id: cfg.provider_id.clone(),
        api_key: secrets.api_key.clone(),
        model: cfg.model.clone(),
        base_url: secrets
            .endpoint
            .clone()
            .or_else(|| cfg.base_url.clone())
            .unwrap_or_default(),
    }
}
