use std::time::Duration;

use soto_provider::omni::{
    OmniConfig, build_omni_provider, chat_completions::DEFAULT_HTTP_TIMEOUT,
};

#[test]
fn omni_default_http_timeout_is_bounded() {
    assert!(DEFAULT_HTTP_TIMEOUT <= Duration::from_secs(30));
}

#[test]
fn mimo_routes_use_chat_completions_omni_provider() {
    for provider_id in ["mimo-plan-sea", "mimo-plan-cn", "mimo-api"] {
        let provider = build_omni_provider(&OmniConfig {
            provider_id: provider_id.to_owned(),
            api_key: "test-key".to_owned(),
            model: "mimo-v2.5".to_owned(),
            base_url: "https://example.test/v1".to_owned(),
        });

        assert!(
            provider.is_ok(),
            "{provider_id} should be routed through the chat.completions Omni client"
        );
    }
}

#[test]
fn openai_route_is_not_supported() {
    let provider = build_omni_provider(&OmniConfig {
        provider_id: "openai".to_owned(),
        api_key: "test-key".to_owned(),
        model: "gpt-4o-audio-preview".to_owned(),
        base_url: "https://api.openai.com/v1".to_owned(),
    });

    assert!(provider.is_err(), "OpenAI route should not be available");
}

#[test]
fn doubao_ark_route_uses_chat_completions_omni_provider() {
    let provider = build_omni_provider(&OmniConfig {
        provider_id: "doubao-ark".to_owned(),
        api_key: "test-key".to_owned(),
        model: "doubao-seed-2-0-lite-260428".to_owned(),
        base_url: "https://ark.cn-beijing.volces.com/api/v3".to_owned(),
    });

    assert!(
        provider.is_ok(),
        "doubao ark should be routed through the chat.completions Omni client"
    );
}
