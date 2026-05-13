//! End-to-end smoke tests for the soto-app session pipeline.
//!
//! Wires `SqliteStorage` + a `MockProviderFactory` so the orchestration layer
//! runs without any HTTP traffic.

use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};

use futures::future::BoxFuture;
use soto_app::{PrepareVoiceSessionRequest, SessionDeps, prepare_voice_session, run_voice_session};
use soto_audio::{
    AudioFrame, BufferedRecordingFileRecorder, MicrophoneAudioFormat, RecordingFile,
    RecordingFileRecorder,
};
use soto_core::{
    EmptyReason, InjectionOutcome, ProviderConfig, ProviderConfigValidation, SelectionBehavior,
    SessionStatus, SessionTarget, ValidationStatus, stores::ProviderSecrets,
};
use soto_prompt::VoicePrompt;
use soto_provider::{
    Provider, ProviderFactory, ProviderResponse,
    errors::{ProviderException, ProviderResult},
};
use soto_session::TextInjector;
use soto_storage::SqliteStorage;

struct MockProvider {
    response_text: String,
}

impl Provider for MockProvider {
    fn invoke<'a>(
        &'a self,
        _prompt: VoicePrompt,
        _audio: &'a RecordingFile,
    ) -> BoxFuture<'a, Result<ProviderResponse, ProviderException>> {
        let text = self.response_text.clone();
        Box::pin(async move {
            Ok(ProviderResponse {
                raw_text: text.clone(),
                processed_text: None,
                final_text: text,
                provider_id: "mock".into(),
                model_id: "mock-1".into(),
            })
        })
    }

    fn validate<'a>(&'a self) -> BoxFuture<'a, ProviderResult<()>> {
        Box::pin(async { Ok(()) })
    }

    fn provider_id(&self) -> &str {
        "mock"
    }

    fn model_id(&self) -> &str {
        "mock-1"
    }
}

struct MockProviderFactory {
    text: Arc<Mutex<String>>,
    builds: AtomicUsize,
}

impl MockProviderFactory {
    fn new(text: &str) -> Self {
        Self {
            text: Arc::new(Mutex::new(text.into())),
            builds: AtomicUsize::new(0),
        }
    }

    fn build_count(&self) -> usize {
        self.builds.load(Ordering::SeqCst)
    }
}

impl ProviderFactory for MockProviderFactory {
    fn build(
        &self,
        _config: &ProviderConfig,
        _secrets: &ProviderSecrets,
    ) -> ProviderResult<Arc<dyn Provider>> {
        self.builds.fetch_add(1, Ordering::SeqCst);
        let text = self.text.lock().unwrap().clone();
        Ok(Arc::new(MockProvider {
            response_text: text,
        }) as Arc<dyn Provider>)
    }
}

struct RecordingInjector {
    inserted: Arc<Mutex<Vec<String>>>,
}

impl TextInjector for RecordingInjector {
    fn inject(&mut self, text: &str, _selection_behavior: SelectionBehavior) -> InjectionOutcome {
        self.inserted.lock().unwrap().push(text.to_string());
        InjectionOutcome::Inserted
    }
}

fn seeded_storage() -> (tempfile::TempDir, SqliteStorage) {
    let dir = tempfile::tempdir().expect("tempdir");
    let storage = SqliteStorage::open(dir.path().join("soto.db")).expect("open db");

    let now = chrono::Utc::now();
    let cfg = ProviderConfig {
        config_id: "config.mock".into(),
        provider_id: "mock-provider".into(),
        display_name: Some("Mock".into()),
        model: "mock-1".into(),
        base_url: Some("https://example.invalid".into()),
        is_default: true,
        validation: ProviderConfigValidation {
            last_validated_at: None,
            last_validated_latency_ms: None,
            last_validated_status: ValidationStatus::Unspecified,
            last_validated_note: None,
            last_validated_sample: None,
            last_validated_sample_result: None,
        },
        created_at: now,
        updated_at: now,
    };
    storage.upsert_provider_config(cfg).expect("seed config");
    storage
        .upsert_provider_secret("config.mock", "api_key", "test-key")
        .expect("seed secret");
    let mut settings = storage.read_settings().expect("read settings");
    settings.active_provider_config_id = Some("config.mock".into());
    storage.write_settings(&settings).expect("write settings");
    (dir, storage)
}

fn synthesize_recording(
    dir: &std::path::Path,
    samples: Vec<i16>,
) -> soto_audio::CapturedRecordingFile {
    let mut recorder = BufferedRecordingFileRecorder::new_in_directory(
        MicrophoneAudioFormat::mvp_pcm_16khz_mono(),
        dir,
    );
    recorder.start().unwrap();
    let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
    recorder
        .frame_queue()
        .unwrap()
        .push(AudioFrame::new(bytes))
        .unwrap();
    recorder.finish().unwrap()
}

#[test]
fn prepare_voice_session_snapshots_prompt_and_resolves_provider() {
    let (_dir, storage) = seeded_storage();
    let storage = Arc::new(storage);
    let deps = SessionDeps::from_storage(storage);
    let request = PrepareVoiceSessionRequest {
        mode_id: "default".into(),
        provider_config_id: None,
        locale_hint: "en-US".into(),
        target: SessionTarget::default(),
    };

    let active = prepare_voice_session(&deps, request).expect("prepare");

    assert_eq!(active.mode.id, "default");
    assert!(
        !active.prompt_snapshot.body.is_empty(),
        "prompt snapshot has body"
    );
    assert_eq!(active.provider_config_id, "config.mock");
}

#[tokio::test]
async fn provider_factory_is_swappable_via_with_provider_factory() {
    let (_dir, storage) = seeded_storage();
    let storage = Arc::new(storage);
    let factory = Arc::new(MockProviderFactory::new("hello world"));

    let deps = SessionDeps::from_storage(storage)
        .with_provider_factory(factory.clone() as Arc<dyn ProviderFactory>);
    // Sanity-check: building twice yields two providers.
    let _p1 = deps
        .provider_factory
        .build(
            &deps.provider_configs.list().unwrap().pop().unwrap(),
            &soto_core::stores::ProviderSecrets {
                api_key: "x".into(),
                endpoint: None,
            },
        )
        .expect("build provider 1");
    let _p2 = deps
        .provider_factory
        .build(
            &deps.provider_configs.list().unwrap().pop().unwrap(),
            &soto_core::stores::ProviderSecrets {
                api_key: "x".into(),
                endpoint: None,
            },
        )
        .expect("build provider 2");
    assert_eq!(factory.build_count(), 2);
}

#[tokio::test]
async fn run_voice_session_short_circuits_on_silent_recording() {
    let (_dir, storage) = seeded_storage();
    let storage = Arc::new(storage);
    let factory = Arc::new(MockProviderFactory::new("would-be-ignored"));
    let deps = SessionDeps::from_storage(storage)
        .with_provider_factory(factory.clone() as Arc<dyn ProviderFactory>);

    let prep_req = PrepareVoiceSessionRequest {
        mode_id: "default".into(),
        provider_config_id: None,
        locale_hint: "en-US".into(),
        target: SessionTarget::default(),
    };
    let active = prepare_voice_session(&deps, prep_req).unwrap();

    let tmp = tempfile::tempdir().unwrap();
    let recording = synthesize_recording(tmp.path(), vec![0i16; 16_000]);

    let injector = Box::new(RecordingInjector {
        inserted: Arc::new(Mutex::new(Vec::new())),
    });
    let outcome = run_voice_session(&deps, active, recording, injector)
        .await
        .unwrap();

    assert_eq!(outcome.status, SessionStatus::Empty);
    assert_eq!(outcome.empty_reason, Some(EmptyReason::Silent));
    assert_eq!(factory.build_count(), 0, "provider must not be invoked");
}

#[tokio::test]
async fn run_voice_session_short_circuits_on_too_short_recording() {
    let (_dir, storage) = seeded_storage();
    let storage = Arc::new(storage);
    let factory = Arc::new(MockProviderFactory::new("would-be-ignored"));
    let deps = SessionDeps::from_storage(storage)
        .with_provider_factory(factory.clone() as Arc<dyn ProviderFactory>);

    let prep_req = PrepareVoiceSessionRequest {
        mode_id: "default".into(),
        provider_config_id: None,
        locale_hint: "en-US".into(),
        target: SessionTarget::default(),
    };
    let active = prepare_voice_session(&deps, prep_req).unwrap();

    let tmp = tempfile::tempdir().unwrap();
    let recording = synthesize_recording(tmp.path(), vec![i16::MAX; 1_600]);

    let injector = Box::new(RecordingInjector {
        inserted: Arc::new(Mutex::new(Vec::new())),
    });
    let outcome = run_voice_session(&deps, active, recording, injector)
        .await
        .unwrap();

    assert_eq!(outcome.status, SessionStatus::Empty);
    assert_eq!(outcome.empty_reason, Some(EmptyReason::TooShort));
    assert_eq!(factory.build_count(), 0, "provider must not be invoked");
}

#[tokio::test]
async fn run_voice_session_invokes_provider_for_real_audio() {
    let (_dir, storage) = seeded_storage();
    let storage = Arc::new(storage);
    let factory = Arc::new(MockProviderFactory::new("hello world"));
    let deps = SessionDeps::from_storage(storage)
        .with_provider_factory(factory.clone() as Arc<dyn ProviderFactory>);

    let prep_req = PrepareVoiceSessionRequest {
        mode_id: "default".into(),
        provider_config_id: None,
        locale_hint: "en-US".into(),
        target: SessionTarget::default(),
    };
    let active = prepare_voice_session(&deps, prep_req).unwrap();

    let tmp = tempfile::tempdir().unwrap();
    let recording = synthesize_recording(tmp.path(), vec![16_384i16; 16_000]);

    let injector = Box::new(RecordingInjector {
        inserted: Arc::new(Mutex::new(Vec::new())),
    });
    let outcome = run_voice_session(&deps, active, recording, injector)
        .await
        .unwrap();

    assert_eq!(outcome.status, SessionStatus::Completed);
    assert_eq!(outcome.empty_reason, None);
    assert_eq!(outcome.final_text, "hello world");
    assert_eq!(factory.build_count(), 1);
}
