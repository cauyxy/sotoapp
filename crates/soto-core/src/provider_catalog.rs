use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderCategory {
    Omni,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct SupportedProvider {
    pub category: ProviderCategory,
    pub provider_id: String,
    pub display_name: String,
    pub default_endpoint: Option<String>,
    pub default_model: Option<String>,
    pub requires_app_id: bool,
    pub suggested_models: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ProviderCatalog {
    pub providers: Vec<SupportedProvider>,
}

impl ProviderCatalog {
    pub fn builtin() -> Self {
        Self {
            providers: vec![
                SupportedProvider {
                    category: ProviderCategory::Omni,
                    provider_id: "mimo-plan-sea".into(),
                    display_name: "Mimo-Plan-SEA".into(),
                    default_endpoint: Some("https://token-plan-sgp.xiaomimimo.com/v1".into()),
                    default_model: Some("mimo-v2.5".into()),
                    requires_app_id: false,
                    suggested_models: vec!["mimo-v2.5".into()],
                },
                SupportedProvider {
                    category: ProviderCategory::Omni,
                    provider_id: "mimo-plan-cn".into(),
                    display_name: "Mimo-Plan-CN".into(),
                    default_endpoint: Some("https://token-plan-cn.xiaomimimo.com/v1".into()),
                    default_model: Some("mimo-v2.5".into()),
                    requires_app_id: false,
                    suggested_models: vec!["mimo-v2.5".into()],
                },
                SupportedProvider {
                    category: ProviderCategory::Omni,
                    provider_id: "mimo-api".into(),
                    display_name: "Mimo-API".into(),
                    default_endpoint: Some("https://api.xiaomimimo.com/v1".into()),
                    default_model: Some("mimo-v2.5".into()),
                    requires_app_id: false,
                    suggested_models: vec!["mimo-v2.5".into()],
                },
                SupportedProvider {
                    category: ProviderCategory::Omni,
                    provider_id: "doubao-ark".into(),
                    display_name: "Doubao Ark".into(),
                    default_endpoint: Some("https://ark.cn-beijing.volces.com/api/v3".into()),
                    default_model: Some("doubao-seed-2-0-lite-260428".into()),
                    requires_app_id: false,
                    suggested_models: vec![
                        "doubao-seed-2-0-lite-260428".into(),
                        "doubao-seed-2-0-mini-260428".into(),
                    ],
                },
                SupportedProvider {
                    category: ProviderCategory::Omni,
                    provider_id: "dashscope".into(),
                    display_name: "Qwen (DashScope)".into(),
                    default_endpoint: Some(
                        "https://dashscope.aliyuncs.com/compatible-mode/v1".into(),
                    ),
                    default_model: Some("qwen3.5-omni-flash".into()),
                    requires_app_id: false,
                    suggested_models: vec!["qwen3.5-omni-flash".into(), "qwen3.5-omni-plus".into()],
                },
            ],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn omni_catalog_includes_mimo_chat_completions_routes() {
        let catalog = ProviderCatalog::builtin();
        assert!(!catalog.providers.iter().any(|p| p.provider_id == "openai"));

        assert_mimo_provider(
            &catalog,
            "mimo-plan-sea",
            "Mimo-Plan-SEA",
            "https://token-plan-sgp.xiaomimimo.com/v1",
        );
        assert_mimo_provider(
            &catalog,
            "mimo-plan-cn",
            "Mimo-Plan-CN",
            "https://token-plan-cn.xiaomimimo.com/v1",
        );
        assert_mimo_provider(
            &catalog,
            "mimo-api",
            "Mimo-API",
            "https://api.xiaomimimo.com/v1",
        );
    }

    #[test]
    fn omni_catalog_includes_doubao_ark_audio_models() {
        let catalog = ProviderCatalog::builtin();
        let provider = catalog
            .providers
            .iter()
            .find(|provider| provider.provider_id == "doubao-ark")
            .expect("doubao ark provider missing");

        assert_eq!(provider.display_name, "Doubao Ark");
        assert_eq!(
            provider.default_endpoint.as_deref(),
            Some("https://ark.cn-beijing.volces.com/api/v3")
        );
        assert_eq!(
            provider.default_model.as_deref(),
            Some("doubao-seed-2-0-lite-260428")
        );
        assert_eq!(
            provider.suggested_models,
            ["doubao-seed-2-0-lite-260428", "doubao-seed-2-0-mini-260428"]
        );
    }

    #[test]
    fn omni_catalog_includes_dashscope_qwen_omni_models() {
        let catalog = ProviderCatalog::builtin();
        let provider = catalog
            .providers
            .iter()
            .find(|p| p.provider_id == "dashscope")
            .expect("dashscope provider missing");

        assert_eq!(provider.display_name, "Qwen (DashScope)");
        assert_eq!(
            provider.default_endpoint.as_deref(),
            Some("https://dashscope.aliyuncs.com/compatible-mode/v1")
        );
        assert_eq!(
            provider.default_model.as_deref(),
            Some("qwen3.5-omni-flash")
        );
        assert_eq!(
            provider.suggested_models,
            ["qwen3.5-omni-flash", "qwen3.5-omni-plus"]
        );
    }

    fn assert_mimo_provider(
        catalog: &ProviderCatalog,
        provider_id: &str,
        display_name: &str,
        endpoint: &str,
    ) {
        let provider = catalog
            .providers
            .iter()
            .find(|provider| provider.provider_id == provider_id)
            .unwrap_or_else(|| panic!("{provider_id} missing"));

        assert_eq!(provider.display_name, display_name);
        assert_eq!(provider.default_endpoint.as_deref(), Some(endpoint));
        assert_eq!(provider.default_model.as_deref(), Some("mimo-v2.5"));
        assert_eq!(provider.suggested_models, ["mimo-v2.5"]);
    }
}
