// @soto/core — pure-TS Soto logic shared by the Electron main process and
// renderer. Zero Electron/native/IO deps; everything here is unit-testable in
// Node. Native, HTTP transport, DB, and IPC plumbing live in apps/desktop.
//
// The barrel is organised by internal layer (foundation → contract →
// capabilities → domain), matching the physical src/ nesting and the
// dependency-cruiser-enforced "no upward import" rules.

// --- Foundation: pure, zero cross-layer deps -----------------------------
export * from "./foundation/chord/chord.js";
export * from "./foundation/chord/matcher.js";
export * from "./foundation/audio/pcmStats.js";
export * from "./foundation/audio/voicedActivity.js";
export * from "./foundation/audio/wav.js";
export * from "./foundation/audio/dsp.js";

// --- Contract: IPC data model (zod schemas + derived types + event channels)
export * from "./contract/schema.js";
export * from "./contract/events.js";
export * from "./contract/eventChannels.js";
export * from "./contract/requests.js";
export * from "./contract/outputs.js";

// --- Capabilities: services built on top of the contract -----------------
// Provider catalog (per-capability maps: omni/asr/llm) — single source of truth
export * from "./capabilities/provider/catalog.js";
// Omni provider (pure request shaping + response parsing)
export * from "./capabilities/provider/omni/errors.js";
export * from "./capabilities/provider/omni/request.js";
export * from "./capabilities/provider/omni/response.js";
export * from "./capabilities/provider/omni/client.js";
// LLM capability (text-only chat-completions over the shared omni skeleton)
export * from "./capabilities/provider/llm/port.js";
export * from "./capabilities/provider/llm/client.js";
// ASR capability (openai-compat transcriptions + doubao flash adapters)
export * from "./capabilities/provider/asr/port.js";
export * from "./capabilities/provider/asr/openaiCompatAsr.js";
export * from "./capabilities/provider/asr/doubaoAsr.js";
export * from "./capabilities/provider/asr/dashscopeRealtimeAsr.js";
export * from "./capabilities/provider/asr/validationSample.js";
// Realtime transport seam (structural WebSocket factory; runtime impl lives in main)
export * from "./capabilities/provider/realtime/socket.js";
// Voice prompt assembly + hotword scoring
export * from "./capabilities/prompts/voicePrompt.js";
// Engine composition: EngineSpec/ResolvedProviderConfig + ModelRuntime factory
// (omni / asr_llm). The legacy dictation
// TranscriptionPort types live in model-runtime/port.ts for adapter internals.
export * from "./capabilities/model-input/modelInput.js";
export * from "./capabilities/model-input/assembler.js";
export * from "./capabilities/model-runtime/spec.js";
export * from "./capabilities/model-runtime/engine.js";
export * from "./capabilities/model-runtime/runtime.js";
// Target context + app-context assembly seams
export * from "./capabilities/context/context.js";
// Learning pipeline (pure filters + no-op seam)
export * from "./capabilities/learning/hotwordFilter.js";
export * from "./capabilities/learning/editDeltaAnalyzer.js";
export * from "./capabilities/learning/pipeline.js";
// Post-insert observation seam
export * from "./capabilities/observation/postInsertObserver.js";
// Storage DTO <-> row codec (pure)
export * from "./capabilities/storage/codec.js";
// History derivation (pure filter / chip / day-bucket / design-group shaping)
export * from "./capabilities/history/derive.js";
// Dictionary derivation (pure source classification / filter chips / term match)
export * from "./capabilities/dictionary/derive.js";
export * from "./capabilities/dictionary/defaultDictionaryTerms.js";
// Home usage statistics (pure derivation over history)
export * from "./capabilities/stats/overview.js";
// Canonical built-in mode catalog (single source of truth for the built-in modes)
export * from "./capabilities/modes/catalog.js";
export * from "./capabilities/modes/defaultDictationPrompt.js";
export * from "./capabilities/modes/defaultTranslatePrompt.js";
export * from "./capabilities/context/appProfile.js";
// App readiness (pure "can the user dictate, and if not what's missing" judgement)
export * from "./capabilities/app/readiness.js";
// Aggregated AppModel (the canonical get_app_model response shape)
export * from "./capabilities/app/appModel.js";

// --- Domain: stateful orchestration --------------------------------------
// Hotkey session FSM + recording machine
export * from "./domain/hotkey/hotkeyCoordinator.js";
export * from "./domain/voice/recordingMachine.js";
export * from "./domain/voice/recordingValidator.js";
export * from "./domain/injection/outcome.js";
export * from "./domain/injection/nativeUnavailableInjector.js";
export * from "./domain/voice/runVoiceSession.js";
export * from "./domain/injection/injectionPlan.js";
export * from "./domain/capsule/capsuleState.js";
// Capsule/Panel responsibility split + recording cues + media-mute coordinator
export * from "./domain/capsule/panelState.js";
export * from "./domain/voice/recordingCue.js";
export * from "./domain/voice/mediaMute.js";
// Hotkey runtime: native key events -> chord -> toggle session actions
// (owns hotkeyRuntimeActionFor: the session-action -> wire-shape bridge)
export * from "./domain/hotkey/capture.js";
export * from "./domain/hotkey/keycodes.js";
export * from "./domain/hotkey/runtime.js";
