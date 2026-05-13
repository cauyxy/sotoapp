use serde::Serialize;
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderError {
    InvalidConfiguration,
    AuthenticationFailed,
    RateLimited,
    ServiceUnavailable,
    RequestFailed,
    EmptyResponse,
}

#[derive(Debug, Error)]
#[error("{message}")]
pub struct ProviderException {
    pub error: ProviderError,
    pub message: String,
}

impl ProviderException {
    pub fn new(error: ProviderError, message: impl Into<String>) -> Self {
        Self {
            error,
            message: message.into(),
        }
    }
}

pub type ProviderResult<T> = Result<T, ProviderException>;
