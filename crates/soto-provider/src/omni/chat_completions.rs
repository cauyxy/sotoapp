use std::{
    fs,
    time::{Duration, Instant},
};

use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};

use crate::errors::{ProviderError, ProviderException, ProviderResult};
use crate::omni::{OmniConfig, VoiceRequest};

pub const MIMO_PLAN_SEA_PROVIDER_ID: &str = "mimo-plan-sea";
pub const MIMO_PLAN_SEA_DEFAULT_BASE_URL: &str = "https://token-plan-sgp.xiaomimimo.com/v1";
pub const MIMO_PLAN_CN_PROVIDER_ID: &str = "mimo-plan-cn";
pub const MIMO_PLAN_CN_DEFAULT_BASE_URL: &str = "https://token-plan-cn.xiaomimimo.com/v1";
pub const MIMO_API_PROVIDER_ID: &str = "mimo-api";
pub const MIMO_API_DEFAULT_BASE_URL: &str = "https://api.xiaomimimo.com/v1";
pub const MIMO_DEFAULT_MODEL: &str = "mimo-v2.5";
pub const DOUBAO_ARK_PROVIDER_ID: &str = "doubao-ark";
pub const DOUBAO_ARK_DEFAULT_BASE_URL: &str = "https://ark.cn-beijing.volces.com/api/v3";
pub const DOUBAO_SEED_2_0_LITE_MODEL: &str = "doubao-seed-2-0-lite-260428";
pub const DOUBAO_SEED_2_0_MINI_MODEL: &str = "doubao-seed-2-0-mini-260428";
pub const DASHSCOPE_PROVIDER_ID: &str = "dashscope";
pub const DASHSCOPE_DEFAULT_BASE_URL: &str = "https://dashscope.aliyuncs.com/compatible-mode/v1";
pub const QWEN3_5_OMNI_FLASH_MODEL: &str = "qwen3.5-omni-flash";
pub const QWEN3_5_OMNI_PLUS_MODEL: &str = "qwen3.5-omni-plus";
pub const DEFAULT_HTTP_TIMEOUT: Duration = Duration::from_secs(30);
pub const DEFAULT_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ChatCompletionsRequestProfile {
    Mimo,
    DoubaoArk,
    Dashscope,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ChatCompletionsProviderDefaults {
    pub provider_id: &'static str,
    pub default_base_url: &'static str,
    pub default_model: &'static str,
    pub allowed_models: &'static [&'static str],
    pub request_profile: ChatCompletionsRequestProfile,
}

#[derive(Clone)]
pub struct ChatCompletionsOmni {
    client: Client,
}

impl ChatCompletionsOmni {
    pub fn new(client: Client) -> Self {
        Self { client }
    }

    pub async fn respond(
        &self,
        config: &OmniConfig,
        request: VoiceRequest<'_>,
    ) -> ProviderResult<String> {
        let normalized = validate(config)?;
        let audio_bytes = fs::read(&request.recording.path).map_err(|error| {
            ProviderException::new(
                ProviderError::RequestFailed,
                format!("Omni recording file could not be read: {error}"),
            )
        })?;
        let audio_format = audio_format_for(&request.recording.format)?;
        let audio_b64 = BASE64.encode(&audio_bytes);
        let endpoint = Url::parse(&format!("{}/chat/completions", normalized.base_url))
            .expect("validated base_url");

        let body = build_response_chat_request(
            &normalized,
            &request.system_prompt,
            &request.user_prompt,
            audio_b64,
            audio_format,
        );
        log_model_call_start(
            "respond",
            &normalized,
            &endpoint,
            Some(audio_bytes.len()),
            Some(request.recording.format.as_str()),
            &request.system_prompt,
            &body,
        );

        let started_at = Instant::now();
        let response = self
            .client
            .post(endpoint)
            .bearer_auth(&normalized.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|error| {
                log_model_call_transport_failure("respond", &normalized, started_at, &error);
                ProviderException::new(
                    ProviderError::RequestFailed,
                    format!("Omni request failed: {error}"),
                )
            })?;

        let status = response.status();
        let raw = response.text().await.map_err(|error| {
            log_model_call_read_failure("respond", &normalized, status, started_at, &error);
            ProviderException::new(
                ProviderError::RequestFailed,
                format!("Omni response could not be read: {error}"),
            )
        })?;
        log_model_call_http_result("respond", &normalized, status, started_at, raw.len());
        if !status.is_success() {
            log_model_call_http_failure("respond", &normalized, status, &raw);
            return Err(create_response_exception(status, &raw));
        }

        let parsed: ChatResponse = serde_json::from_str(&raw).map_err(|error| {
            log_model_call_parse_failure("respond", &normalized, started_at, &error);
            ProviderException::new(
                ProviderError::RequestFailed,
                format!("Omni response JSON could not be parsed: {error}"),
            )
        })?;

        let content = parsed
            .choices
            .into_iter()
            .next()
            .and_then(|choice| choice.message.content)
            .map(|text| text.trim().to_owned())
            .filter(|text| !text.is_empty())
            .ok_or_else(|| {
                ProviderException::new(
                    ProviderError::EmptyResponse,
                    "Omni provider returned an empty response.",
                )
            })?;

        log_model_call_success("respond", &normalized, started_at, &content);
        Ok(content)
    }

    pub async fn validate(&self, config: &OmniConfig) -> ProviderResult<()> {
        let normalized = validate(config)?;
        let endpoint = Url::parse(&format!("{}/chat/completions", normalized.base_url))
            .expect("validated base_url");

        let body = build_validation_chat_request(&normalized);
        log_model_call_start(
            "validate",
            &normalized,
            &endpoint,
            None,
            None,
            "Reply with the single word \"ok\".",
            &body,
        );

        let started_at = Instant::now();
        let response = self
            .client
            .post(endpoint)
            .bearer_auth(&normalized.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|error| {
                log_model_call_transport_failure("validate", &normalized, started_at, &error);
                ProviderException::new(
                    ProviderError::RequestFailed,
                    format!("Omni validation request failed: {error}"),
                )
            })?;
        let status = response.status();
        let body = response.text().await.map_err(|error| {
            log_model_call_read_failure("validate", &normalized, status, started_at, &error);
            ProviderException::new(
                ProviderError::RequestFailed,
                format!("Omni validation response could not be read: {error}"),
            )
        })?;
        log_model_call_http_result("validate", &normalized, status, started_at, body.len());
        if !status.is_success() {
            log_model_call_http_failure("validate", &normalized, status, &body);
            return Err(create_response_exception(status, &body));
        }
        log_model_call_success("validate", &normalized, started_at, body.trim());
        Ok(())
    }
}

/// Build the shared HTTP client.
/// `use_proxy = true`  → reqwest reads HTTPS_PROXY / ALL_PROXY env vars (default OS behavior).
/// `use_proxy = false` → .no_proxy() disables all proxy detection.
pub fn build_http_client(use_proxy: bool) -> reqwest::Result<Client> {
    let mut builder = Client::builder()
        .timeout(DEFAULT_HTTP_TIMEOUT)
        .connect_timeout(DEFAULT_CONNECT_TIMEOUT);
    if !use_proxy {
        builder = builder.no_proxy();
    }
    builder.build()
}

pub fn default_http_client() -> Client {
    build_http_client(true).expect("default reqwest client should build")
}

fn validate(config: &OmniConfig) -> ProviderResult<OmniConfig> {
    let defaults = provider_defaults_for(&config.provider_id).ok_or_else(|| {
        ProviderException::new(
            ProviderError::InvalidConfiguration,
            format!(
                "Unsupported Omni provider '{}'.",
                config.provider_id.trim().to_ascii_lowercase()
            ),
        )
    })?;
    let provider_id = defaults.provider_id.to_owned();
    let api_key = config.api_key.trim();
    if api_key.is_empty() {
        return Err(ProviderException::new(
            ProviderError::InvalidConfiguration,
            "Omni API key is required.",
        ));
    }
    let model = if config.model.trim().is_empty() {
        defaults.default_model.to_owned()
    } else {
        config.model.trim().to_owned()
    };
    let base_url = if config.base_url.trim().is_empty() {
        defaults.default_base_url.to_owned()
    } else {
        config.base_url.trim().trim_end_matches('/').to_owned()
    };
    let parsed = Url::parse(&base_url).map_err(|_| {
        ProviderException::new(
            ProviderError::InvalidConfiguration,
            "Omni base URL must be an absolute HTTP or HTTPS URL.",
        )
    })?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(ProviderException::new(
            ProviderError::InvalidConfiguration,
            "Omni base URL must be an absolute HTTP or HTTPS URL.",
        ));
    }
    Ok(OmniConfig {
        provider_id,
        api_key: api_key.to_owned(),
        model,
        base_url,
    })
}

pub fn provider_defaults_for(provider_id: &str) -> Option<ChatCompletionsProviderDefaults> {
    match provider_id.trim().to_ascii_lowercase().as_str() {
        MIMO_PLAN_SEA_PROVIDER_ID => Some(ChatCompletionsProviderDefaults {
            provider_id: MIMO_PLAN_SEA_PROVIDER_ID,
            default_base_url: MIMO_PLAN_SEA_DEFAULT_BASE_URL,
            default_model: MIMO_DEFAULT_MODEL,
            allowed_models: &[MIMO_DEFAULT_MODEL],
            request_profile: ChatCompletionsRequestProfile::Mimo,
        }),
        MIMO_PLAN_CN_PROVIDER_ID => Some(ChatCompletionsProviderDefaults {
            provider_id: MIMO_PLAN_CN_PROVIDER_ID,
            default_base_url: MIMO_PLAN_CN_DEFAULT_BASE_URL,
            default_model: MIMO_DEFAULT_MODEL,
            allowed_models: &[MIMO_DEFAULT_MODEL],
            request_profile: ChatCompletionsRequestProfile::Mimo,
        }),
        MIMO_API_PROVIDER_ID => Some(ChatCompletionsProviderDefaults {
            provider_id: MIMO_API_PROVIDER_ID,
            default_base_url: MIMO_API_DEFAULT_BASE_URL,
            default_model: MIMO_DEFAULT_MODEL,
            allowed_models: &[MIMO_DEFAULT_MODEL],
            request_profile: ChatCompletionsRequestProfile::Mimo,
        }),
        DOUBAO_ARK_PROVIDER_ID => Some(ChatCompletionsProviderDefaults {
            provider_id: DOUBAO_ARK_PROVIDER_ID,
            default_base_url: DOUBAO_ARK_DEFAULT_BASE_URL,
            default_model: DOUBAO_SEED_2_0_LITE_MODEL,
            allowed_models: &[DOUBAO_SEED_2_0_LITE_MODEL, DOUBAO_SEED_2_0_MINI_MODEL],
            request_profile: ChatCompletionsRequestProfile::DoubaoArk,
        }),
        DASHSCOPE_PROVIDER_ID => Some(ChatCompletionsProviderDefaults {
            provider_id: DASHSCOPE_PROVIDER_ID,
            default_base_url: DASHSCOPE_DEFAULT_BASE_URL,
            default_model: QWEN3_5_OMNI_FLASH_MODEL,
            allowed_models: &[QWEN3_5_OMNI_FLASH_MODEL, QWEN3_5_OMNI_PLUS_MODEL],
            request_profile: ChatCompletionsRequestProfile::Dashscope,
        }),
        _ => None,
    }
}

fn build_response_chat_request(
    normalized: &OmniConfig,
    system_prompt: &str,
    user_prompt: &str,
    audio_b64: String,
    audio_format: String,
) -> ChatRequest {
    let request_profile = request_profile_for(&normalized.provider_id);
    let audio_data = match request_profile {
        ChatCompletionsRequestProfile::Dashscope => {
            format!("data:audio/{audio_format};base64,{audio_b64}")
        }
        _ => audio_b64,
    };
    let input_audio = InputAudio::Data {
        data: audio_data,
        format: audio_format,
    };

    let messages = vec![
        ChatMessage {
            role: "system".into(),
            content: vec![ChatContent::Text {
                text: system_prompt.to_owned(),
            }],
        },
        ChatMessage {
            role: "user".into(),
            content: vec![
                ChatContent::Text {
                    text: user_prompt.to_owned(),
                },
                ChatContent::InputAudio { input_audio },
            ],
        },
    ];

    ChatRequest {
        model: normalized.model.clone(),
        modalities: modalities_for(request_profile),
        thinking: thinking_for(normalized, request_profile),
        messages,
    }
}

fn build_validation_chat_request(normalized: &OmniConfig) -> ChatRequest {
    let request_profile = request_profile_for(&normalized.provider_id);
    ChatRequest {
        model: normalized.model.clone(),
        modalities: modalities_for(request_profile),
        thinking: thinking_for(normalized, request_profile),
        messages: vec![ChatMessage {
            role: "user".into(),
            content: vec![ChatContent::Text {
                text: "Reply with the single word \"ok\".".into(),
            }],
        }],
    }
}

fn request_profile_for(provider_id: &str) -> ChatCompletionsRequestProfile {
    provider_defaults_for(provider_id)
        .map(|defaults| defaults.request_profile)
        .unwrap_or(ChatCompletionsRequestProfile::Mimo)
}

fn modalities_for(request_profile: ChatCompletionsRequestProfile) -> Option<Vec<String>> {
    match request_profile {
        ChatCompletionsRequestProfile::Mimo => Some(vec!["text".into()]),
        ChatCompletionsRequestProfile::Dashscope => Some(vec!["text".into()]),
        ChatCompletionsRequestProfile::DoubaoArk => None,
    }
}

fn thinking_for(
    normalized: &OmniConfig,
    request_profile: ChatCompletionsRequestProfile,
) -> Option<ThinkingConfig> {
    let model = normalized.model.trim().to_ascii_lowercase();
    match request_profile {
        ChatCompletionsRequestProfile::Mimo if mimo_model_supports_thinking_control(&model) => {
            Some(ThinkingConfig { kind: "disabled" })
        }
        ChatCompletionsRequestProfile::DoubaoArk => Some(ThinkingConfig { kind: "disabled" }),
        _ => None,
    }
}

fn mimo_model_supports_thinking_control(model: &str) -> bool {
    model == MIMO_DEFAULT_MODEL
}

fn audio_format_for(format: &str) -> ProviderResult<String> {
    match format.trim().to_ascii_lowercase().as_str() {
        "wav" => Ok("wav".to_owned()),
        "mp3" => Ok("mp3".to_owned()),
        other => Err(ProviderException::new(
            ProviderError::InvalidConfiguration,
            format!("Omni currently supports wav or mp3 input only (got '{other}')."),
        )),
    }
}

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    modalities: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<ThinkingConfig>,
    messages: Vec<ChatMessage>,
}

#[derive(Debug, Serialize)]
struct ThinkingConfig {
    #[serde(rename = "type")]
    kind: &'static str,
}

#[derive(Debug, Serialize)]
struct ChatMessage {
    role: String,
    content: Vec<ChatContent>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ChatContent {
    Text { text: String },
    InputAudio { input_audio: InputAudio },
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum InputAudio {
    Data { data: String, format: String },
}

fn log_model_call_start(
    operation: &str,
    config: &OmniConfig,
    endpoint: &Url,
    audio_bytes: Option<usize>,
    audio_format: Option<&str>,
    prompt: &str,
    body: &ChatRequest,
) {
    eprintln!(
        "[soto-provider] omni {operation} start: provider_id={} model={} endpoint={} prompt_chars={} audio_bytes={} audio_format={} content_parts={} thinking={}",
        config.provider_id,
        config.model,
        display_endpoint(endpoint),
        prompt.chars().count(),
        audio_bytes
            .map(|bytes| bytes.to_string())
            .unwrap_or_else(|| "none".into()),
        audio_format.unwrap_or("none"),
        body.messages
            .first()
            .map(|message| message.content.len())
            .unwrap_or_default(),
        body.thinking
            .as_ref()
            .map(|thinking| thinking.kind)
            .unwrap_or("none")
    );
}

fn log_model_call_transport_failure(
    operation: &str,
    config: &OmniConfig,
    started_at: Instant,
    error: &reqwest::Error,
) {
    eprintln!(
        "[soto-provider] omni {operation} transport FAILED: provider_id={} model={} elapsed_ms={} is_timeout={} is_connect={} error={}",
        config.provider_id,
        config.model,
        elapsed_ms(started_at),
        error.is_timeout(),
        error.is_connect(),
        format_error_chain(error),
    );
}

fn format_error_chain(error: &dyn std::error::Error) -> String {
    let mut parts = vec![error.to_string()];
    let mut current = error.source();
    while let Some(err) = current {
        parts.push(err.to_string());
        current = err.source();
    }
    parts.join(" | caused by: ")
}

fn log_model_call_read_failure(
    operation: &str,
    config: &OmniConfig,
    status: StatusCode,
    started_at: Instant,
    error: &reqwest::Error,
) {
    eprintln!(
        "[soto-provider] omni {operation} read FAILED: provider_id={} model={} status={} elapsed_ms={} error={error}",
        config.provider_id,
        config.model,
        status.as_u16(),
        elapsed_ms(started_at)
    );
}

fn log_model_call_http_result(
    operation: &str,
    config: &OmniConfig,
    status: StatusCode,
    started_at: Instant,
    response_bytes: usize,
) {
    eprintln!(
        "[soto-provider] omni {operation} http result: provider_id={} model={} status={} elapsed_ms={} response_bytes={}",
        config.provider_id,
        config.model,
        status.as_u16(),
        elapsed_ms(started_at),
        response_bytes
    );
}

fn log_model_call_http_failure(
    operation: &str,
    config: &OmniConfig,
    status: StatusCode,
    raw: &str,
) {
    let detail = extract_error_message(raw)
        .filter(|message| !message.trim().is_empty())
        .unwrap_or_else(|| format!("raw_response_bytes={}", raw.len()));
    eprintln!(
        "[soto-provider] omni {operation} http FAILED: provider_id={} model={} status={} detail={}",
        config.provider_id,
        config.model,
        status.as_u16(),
        detail
    );
}

fn log_model_call_parse_failure(
    operation: &str,
    config: &OmniConfig,
    started_at: Instant,
    error: &serde_json::Error,
) {
    eprintln!(
        "[soto-provider] omni {operation} parse FAILED: provider_id={} model={} elapsed_ms={} error={error}",
        config.provider_id,
        config.model,
        elapsed_ms(started_at)
    );
}

fn log_model_call_success(
    operation: &str,
    config: &OmniConfig,
    started_at: Instant,
    content: &str,
) {
    eprintln!(
        "{}",
        model_call_success_log_line(operation, config, elapsed_ms(started_at), content)
    );
}

fn model_call_success_log_line(
    operation: &str,
    config: &OmniConfig,
    elapsed_ms: u128,
    content: &str,
) -> String {
    format!(
        "[soto-provider] omni {operation} success: provider_id={} model={} elapsed_ms={} content_chars={} content={:?}",
        config.provider_id,
        config.model,
        elapsed_ms,
        content.chars().count(),
        content
    )
}

fn elapsed_ms(started_at: Instant) -> u128 {
    started_at.elapsed().as_millis()
}

fn display_endpoint(endpoint: &Url) -> String {
    let host = endpoint.host_str().unwrap_or("<unknown-host>");
    let port = endpoint
        .port()
        .map(|port| format!(":{port}"))
        .unwrap_or_default();
    format!(
        "{}://{}{}{}",
        endpoint.scheme(),
        host,
        port,
        endpoint.path()
    )
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<ResponseChoice>,
}

#[derive(Debug, Deserialize)]
struct ResponseChoice {
    message: ResponseMessage,
}

#[derive(Debug, Deserialize)]
struct ResponseMessage {
    content: Option<String>,
}

fn create_response_exception(status: StatusCode, body: &str) -> ProviderException {
    let error = match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => ProviderError::AuthenticationFailed,
        StatusCode::TOO_MANY_REQUESTS => ProviderError::RateLimited,
        StatusCode::INTERNAL_SERVER_ERROR
        | StatusCode::BAD_GATEWAY
        | StatusCode::SERVICE_UNAVAILABLE => ProviderError::ServiceUnavailable,
        _ => ProviderError::RequestFailed,
    };
    let detail = extract_error_message(body).unwrap_or_else(|| body.trim().to_owned());

    ProviderException::new(
        error,
        if detail.is_empty() {
            format!("Omni request failed with HTTP {}", status.as_u16())
        } else {
            format!(
                "Omni request failed with HTTP {}: {detail}",
                status.as_u16()
            )
        },
    )
}

fn extract_error_message(body: &str) -> Option<String> {
    #[derive(Deserialize)]
    struct ErrorEnvelope {
        error: Option<ErrorBody>,
    }

    #[derive(Deserialize)]
    struct ErrorBody {
        message: Option<String>,
    }

    serde_json::from_str::<ErrorEnvelope>(body)
        .ok()?
        .error?
        .message
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn mimo_response_request_disables_thinking() {
        let request = build_response_chat_request(
            &OmniConfig {
                provider_id: MIMO_PLAN_SEA_PROVIDER_ID.to_owned(),
                api_key: "test-key".to_owned(),
                model: MIMO_DEFAULT_MODEL.to_owned(),
                base_url: MIMO_PLAN_SEA_DEFAULT_BASE_URL.to_owned(),
            },
            "请识别音频中的内容",
            "User Audio:",
            "YWJj".to_owned(),
            "mp3".to_owned(),
        );

        let value = serde_json::to_value(request).expect("request serializes");
        assert_eq!(value["thinking"], json!({ "type": "disabled" }));
        let messages = value["messages"].as_array().expect("messages array");
        assert_eq!(messages.len(), 2);
        assert_eq!(value["messages"][0]["role"], "system");
        assert_eq!(
            value["messages"][0]["content"][0],
            json!({ "type": "text", "text": "请识别音频中的内容" })
        );
        assert_eq!(value["messages"][1]["role"], "user");
        assert_eq!(
            value["messages"][1]["content"][0],
            json!({ "type": "text", "text": "User Audio:" })
        );
        assert_eq!(
            value["messages"][1]["content"][1]["input_audio"],
            json!({ "data": "YWJj", "format": "mp3" })
        );
    }

    #[test]
    fn user_prompt_lands_verbatim_in_user_message_text() {
        let request = build_response_chat_request(
            &OmniConfig {
                provider_id: MIMO_PLAN_SEA_PROVIDER_ID.to_owned(),
                api_key: "test-key".to_owned(),
                model: MIMO_DEFAULT_MODEL.to_owned(),
                base_url: MIMO_PLAN_SEA_DEFAULT_BASE_URL.to_owned(),
            },
            "请识别音频中的内容",
            "<热词>\n- Soto\n- Claude\n</热词>\n\nUser Audio:",
            "YWJj".to_owned(),
            "mp3".to_owned(),
        );

        let value = serde_json::to_value(request).expect("request serializes");
        let messages = value["messages"].as_array().expect("messages array");
        assert_eq!(messages.len(), 2);
        assert_eq!(
            value["messages"][1]["content"][0],
            json!({
                "type": "text",
                "text": "<热词>\n- Soto\n- Claude\n</热词>\n\nUser Audio:"
            })
        );
        assert_eq!(
            value["messages"][1]["content"][1]["input_audio"],
            json!({ "data": "YWJj", "format": "mp3" })
        );
    }

    #[test]
    fn validate_accepts_custom_model_for_known_provider() {
        let config = validate(&OmniConfig {
            provider_id: MIMO_PLAN_SEA_PROVIDER_ID.to_owned(),
            api_key: "test-key".to_owned(),
            model: "mimo-v2.5-pro".to_owned(),
            base_url: MIMO_PLAN_SEA_DEFAULT_BASE_URL.to_owned(),
        })
        .expect("known providers should allow custom model IDs");

        assert_eq!(config.model, "mimo-v2.5-pro");
    }

    #[test]
    fn validate_accepts_recommended_and_custom_doubao_models() {
        for model in [DOUBAO_SEED_2_0_LITE_MODEL, DOUBAO_SEED_2_0_MINI_MODEL] {
            validate(&OmniConfig {
                provider_id: DOUBAO_ARK_PROVIDER_ID.to_owned(),
                api_key: "test-key".to_owned(),
                model: model.to_owned(),
                base_url: DOUBAO_ARK_DEFAULT_BASE_URL.to_owned(),
            })
            .unwrap_or_else(|error| panic!("{model} should validate: {error:?}"));
        }

        let config = validate(&OmniConfig {
            provider_id: DOUBAO_ARK_PROVIDER_ID.to_owned(),
            api_key: "test-key".to_owned(),
            model: "doubao-seed-2-0-pro-260428".to_owned(),
            base_url: DOUBAO_ARK_DEFAULT_BASE_URL.to_owned(),
        })
        .expect("custom Doubao model IDs should pass local validation");

        assert_eq!(config.model, "doubao-seed-2-0-pro-260428");
    }

    #[test]
    fn doubao_response_request_uses_base64_audio_data_field() {
        let request = build_response_chat_request(
            &OmniConfig {
                provider_id: DOUBAO_ARK_PROVIDER_ID.to_owned(),
                api_key: "test-key".to_owned(),
                model: DOUBAO_SEED_2_0_LITE_MODEL.to_owned(),
                base_url: DOUBAO_ARK_DEFAULT_BASE_URL.to_owned(),
            },
            "请识别音频中的内容",
            "User Audio:",
            "YWJj".to_owned(),
            "mp3".to_owned(),
        );

        let value = serde_json::to_value(request).expect("request serializes");
        assert_eq!(value["thinking"], json!({ "type": "disabled" }));
        assert_eq!(value.get("modalities"), None);
        let messages = value["messages"].as_array().expect("messages array");
        assert_eq!(messages.len(), 2);
        assert_eq!(value["messages"][0]["role"], "system");
        assert_eq!(
            value["messages"][0]["content"][0],
            json!({ "type": "text", "text": "请识别音频中的内容" })
        );
        assert_eq!(value["messages"][1]["role"], "user");
        assert_eq!(
            value["messages"][1]["content"][0],
            json!({ "type": "text", "text": "User Audio:" })
        );
        assert_eq!(
            value["messages"][1]["content"][1]["input_audio"],
            json!({
                "data": "YWJj",
                "format": "mp3"
            })
        );
    }

    #[test]
    fn dashscope_response_request_uses_data_uri_for_audio() {
        let request = build_response_chat_request(
            &OmniConfig {
                provider_id: DASHSCOPE_PROVIDER_ID.to_owned(),
                api_key: "test-key".to_owned(),
                model: QWEN3_5_OMNI_FLASH_MODEL.to_owned(),
                base_url: DASHSCOPE_DEFAULT_BASE_URL.to_owned(),
            },
            "请识别音频中的内容",
            "User Audio:",
            "YWJj".to_owned(),
            "wav".to_owned(),
        );

        let value = serde_json::to_value(request).expect("request serializes");
        assert_eq!(value.get("thinking"), None);
        assert_eq!(value["modalities"], json!(["text"]));
        assert_eq!(
            value["messages"][1]["content"][1]["input_audio"],
            json!({ "data": "data:audio/wav;base64,YWJj", "format": "wav" })
        );
    }

    #[test]
    fn mimo_tts_request_does_not_send_unsupported_thinking_control() {
        let request = build_response_chat_request(
            &OmniConfig {
                provider_id: MIMO_API_PROVIDER_ID.to_owned(),
                api_key: "test-key".to_owned(),
                model: "mimo-v2.5-tts".to_owned(),
                base_url: MIMO_API_DEFAULT_BASE_URL.to_owned(),
            },
            "Say hello.",
            "User Audio:",
            "YWJj".to_owned(),
            "mp3".to_owned(),
        );

        let value = serde_json::to_value(request).expect("request serializes");
        assert_eq!(value.get("thinking"), None);
    }

    #[test]
    fn format_error_chain_walks_source_chain() {
        use std::error::Error;
        use std::fmt;
        use std::io;

        #[derive(Debug)]
        struct Wrap {
            message: &'static str,
            cause: io::Error,
        }

        impl fmt::Display for Wrap {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(self.message)
            }
        }

        impl Error for Wrap {
            fn source(&self) -> Option<&(dyn Error + 'static)> {
                Some(&self.cause)
            }
        }

        let err = Wrap {
            message: "error sending request for url (https://example/v3/chat/completions)",
            cause: io::Error::new(io::ErrorKind::TimedOut, "operation timed out"),
        };

        let chain = format_error_chain(&err);
        assert!(chain.contains("error sending request for url"));
        assert!(chain.contains("caused by:"));
        assert!(chain.contains("operation timed out"));
    }

    #[test]
    fn format_error_chain_handles_leaf_error() {
        use std::io;

        let leaf = io::Error::new(io::ErrorKind::ConnectionReset, "reset by peer");
        let chain = format_error_chain(&leaf);
        assert_eq!(chain, "reset by peer");
    }

    #[test]
    fn build_http_client_with_proxy_enabled_succeeds() {
        build_http_client(true).expect("client with proxy enabled should build");
    }

    #[test]
    fn build_http_client_with_proxy_disabled_succeeds() {
        build_http_client(false).expect("client with proxy disabled should build");
    }

    #[test]
    fn model_call_success_log_line_includes_model_output() {
        let line = model_call_success_log_line(
            "respond",
            &OmniConfig {
                provider_id: DOUBAO_ARK_PROVIDER_ID.to_owned(),
                api_key: "test-key".to_owned(),
                model: DOUBAO_SEED_2_0_MINI_MODEL.to_owned(),
                base_url: DOUBAO_ARK_DEFAULT_BASE_URL.to_owned(),
            },
            123,
            "你好\nSoto",
        );

        assert!(line.contains("provider_id=doubao-ark"));
        assert!(line.contains("model=doubao-seed-2-0-mini-260428"));
        assert!(line.contains("elapsed_ms=123"));
        assert!(line.contains("content_chars=7"));
        assert!(line.contains("content=\"你好\\nSoto\""));
    }
}
