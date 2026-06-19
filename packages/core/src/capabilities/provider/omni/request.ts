// Pure-TS port of soto_provider omni chat_completions request assembly:
// config normalisation/validation + per-provider request-body shaping.

import {
  capabilityDefaultsFor,
  MIMO_DEFAULT_MODEL,
  providerDefaultsFor,
  type RequestProfile,
} from "../catalog.js";
import { ProviderException } from "./errors.js";

export interface OmniConfig {
  providerId: string;
  apiKey: string;
  model: string;
  baseUrl: string;
}

export type ChatContent =
  | { type: "text"; text: string }
  | { type: "input_audio"; input_audio: { data: string; format: string } };

export interface ChatMessage {
  role: "system" | "user";
  content: ChatContent[];
}

/**
 * Request body shaped to match the Rust ChatRequest serialization: `modalities`
 * and `thinking` are absent (not null) when the provider profile omits them.
 */
export interface ChatRequest {
  model: string;
  modalities?: string[];
  thinking?: { type: "disabled" };
  messages: ChatMessage[];
}

/**
 * Normalise + validate an OmniConfig: resolve the provider, fill blank
 * model/base URL from defaults, require an API key, and require an absolute
 * http(s) base URL (trailing slash trimmed). Port of request::validate.
 */
export function validateConfig(config: OmniConfig): OmniConfig {
  const provider = providerDefaultsFor(config.providerId);
  if (provider === null) {
    throw new ProviderException(
      "invalid_configuration",
      `Unsupported Omni provider '${config.providerId.trim().toLowerCase()}'.`,
    );
  }
  const defaults = capabilityDefaultsFor(config.providerId, "omni");
  if (defaults === null) {
    throw new ProviderException(
      "invalid_configuration",
      `Provider '${provider.providerId}' has no omni capability.`,
    );
  }

  const apiKey = config.apiKey.trim();
  if (apiKey.length === 0) {
    throw new ProviderException(
      "invalid_configuration",
      "Omni API key is required.",
    );
  }

  const model =
    config.model.trim().length === 0
      ? defaults.defaultModel
      : config.model.trim();

  const baseUrl =
    config.baseUrl.trim().length === 0
      ? provider.defaultBaseUrl
      : config.baseUrl.trim().replace(/\/+$/, "");

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new ProviderException(
      "invalid_configuration",
      "Omni base URL must be an absolute HTTP or HTTPS URL.",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ProviderException(
      "invalid_configuration",
      "Omni base URL must be an absolute HTTP or HTTPS URL.",
    );
  }

  return { providerId: provider.providerId, apiKey, model, baseUrl };
}

function requestProfileFor(providerId: string): RequestProfile {
  return capabilityDefaultsFor(providerId, "omni")?.requestProfile ?? "mimo";
}

function modalitiesFor(profile: RequestProfile): string[] | undefined {
  if (profile === "doubao_ark" || profile === "openai_chat") return undefined;
  return ["text"];
}

function thinkingFor(
  config: OmniConfig,
  profile: RequestProfile,
): { type: "disabled" } | undefined {
  const model = config.model.trim().toLowerCase();
  if (profile === "openai_chat") return undefined;
  if (profile === "doubao_ark") return { type: "disabled" };
  if (profile === "mimo" && model === MIMO_DEFAULT_MODEL) {
    return { type: "disabled" };
  }
  return undefined;
}

/** Assemble a top-level ChatRequest, omitting absent optional fields. */
function chatRequest(
  config: OmniConfig,
  profile: RequestProfile,
  messages: ChatMessage[],
): ChatRequest {
  const modalities = modalitiesFor(profile);
  const thinking = thinkingFor(config, profile);
  return {
    model: config.model,
    ...(modalities !== undefined ? { modalities } : {}),
    ...(thinking !== undefined ? { thinking } : {}),
    messages,
  };
}

function audioDataFor(profile: RequestProfile, audioB64: string, audioFormat: string): string {
  return profile === "dashscope"
    ? `data:audio/${audioFormat};base64,${audioB64}`
    : audioB64;
}

/**
 * Omni dictation sends one user message with two ordered content parts:
 * 1. text — task, hotwords, and target context assembled by voicePrompt.ts.
 * 2. input_audio — the encoded recording payload for the model to transcribe.
 *
 * The audio is a structured chat content part, never concatenated into the text
 * prompt. DashScope is the only profile that wants the base64 wrapped as a data
 * URL; other providers receive raw base64.
 */
function audioUserContent(
  profile: RequestProfile,
  userPrompt: string,
  audioB64: string,
  audioFormat: string,
): ChatContent[] {
  return [
    { type: "text", text: userPrompt },
    {
      type: "input_audio",
      input_audio: {
        data: audioDataFor(profile, audioB64, audioFormat),
        format: audioFormat,
      },
    },
  ];
}

/** Build the speech-recognition request body. Port of build_response_chat_request. */
export function buildResponseRequest(
  normalized: OmniConfig,
  systemPrompt: string,
  userPrompt: string,
  audioB64: string,
  audioFormat: string,
): ChatRequest {
  const profile = requestProfileFor(normalized.providerId);

  return chatRequest(normalized, profile, [
    { role: "system", content: [{ type: "text", text: systemPrompt }] },
    {
      role: "user",
      content: audioUserContent(profile, userPrompt, audioB64, audioFormat),
    },
  ]);
}

/** Build the lightweight "reply with ok" config-validation request body. */
export function buildValidationRequest(normalized: OmniConfig): ChatRequest {
  const profile = requestProfileFor(normalized.providerId);
  return chatRequest(normalized, profile, [
    { role: "user", content: [{ type: "text", text: 'Reply with the single word "ok".' }] },
  ]);
}

/** Build a text-only chat request for a given capability profile (LLM hop). */
export function buildTextRequest(
  normalized: OmniConfig,
  profile: RequestProfile,
  systemPrompt: string,
  userPrompt: string,
): ChatRequest {
  const messages: ChatMessage[] =
    systemPrompt.trim().length === 0
      ? [{ role: "user", content: [{ type: "text", text: userPrompt }] }]
      : [
          { role: "system", content: [{ type: "text", text: systemPrompt }] },
          { role: "user", content: [{ type: "text", text: userPrompt }] },
        ];
  return chatRequest(normalized, profile, messages);
}

/** Normalise an audio container format; Omni accepts only wav or mp3. */
export function audioFormatFor(format: string): string {
  const normalized = format.trim().toLowerCase();
  if (normalized === "wav" || normalized === "mp3") return normalized;
  throw new ProviderException(
    "invalid_configuration",
    `Omni currently supports wav or mp3 input only (got '${normalized}').`,
  );
}
