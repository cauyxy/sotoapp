// Provider catalog — one entry per vendor key/endpoint domain, with an explicit
// per-capability map (engine spec §3.2). The omni capability keeps its client
// under provider/omni/; asr clients live in provider/asr/; the llm
// capability shares the chat-completions skeleton.

import type { Capability } from "../../contract/schema.js";

export const MIMO_API_PROVIDER_ID = "mimo-api";
export const MIMO_API_DEFAULT_BASE_URL = "https://api.xiaomimimo.com/v1";
export const MIMO_DEFAULT_MODEL = "mimo-v2.5";
export const DOUBAO_ARK_PROVIDER_ID = "doubao-ark";
export const DOUBAO_ARK_DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
export const DOUBAO_SEED_2_0_LITE_MODEL = "doubao-seed-2-0-lite-260428";
export const DOUBAO_SEED_2_0_MINI_MODEL = "doubao-seed-2-0-mini-260428";
export const DASHSCOPE_PROVIDER_ID = "dashscope";
export const DASHSCOPE_DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
export const QWEN3_5_OMNI_FLASH_MODEL = "qwen3.5-omni-flash";
export const QWEN3_5_OMNI_PLUS_MODEL = "qwen3.5-omni-plus";
export const DASHSCOPE_REALTIME_PROVIDER_ID = "dashscope-realtime";
export const DASHSCOPE_REALTIME_DEFAULT_BASE_URL =
  "wss://dashscope.aliyuncs.com/api-ws/v1/realtime";
export const QWEN3_ASR_FLASH_REALTIME_MODEL = "qwen3-asr-flash-realtime";
export const QWEN3_5_OMNI_FLASH_REALTIME_MODEL = "qwen3.5-omni-flash-realtime";
export const QWEN3_5_OMNI_PLUS_REALTIME_MODEL = "qwen3.5-omni-plus-realtime";
export const OPENAI_COMPAT_PROVIDER_ID = "openai-compat";
export const OPENAI_COMPAT_DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DOUBAO_ASR_PROVIDER_ID = "doubao-asr";
export const DOUBAO_ASR_DEFAULT_BASE_URL = "https://openspeech.bytedance.com";
export const DOUBAO_ASR_FLASH_MODEL = "bigmodel";

/**
 * Per-capability request shapes:
 *  - mimo / doubao_ark / dashscope — chat-completions chat profiles (omni + llm).
 *  - openai_chat — pure OpenAI-compatible chat completions (no modalities/thinking).
 *  - openai_transcriptions — multipart POST {base}/audio/transcriptions.
 *  - doubao_flash_asr — Volcano flash file recognition (JSON + dual-key headers).
 *  - dashscope_realtime — DashScope Qwen Realtime WebSocket ASR.
 */
export type RequestProfile =
  | "mimo"
  | "doubao_ark"
  | "dashscope"
  | "openai_chat"
  | "openai_transcriptions"
  | "doubao_flash_asr"
  | "dashscope_realtime";

export interface CapabilityDefaults {
  defaultModel: string;
  allowedModels: readonly string[];
  requestProfile: RequestProfile;
}

export interface ProviderDefaults {
  providerId: string;
  group: string | null;
  defaultBaseUrl: string;
  capabilities: Partial<Record<Capability, CapabilityDefaults>>;
}

const MIMO_CHAT: CapabilityDefaults = {
  defaultModel: MIMO_DEFAULT_MODEL,
  allowedModels: [MIMO_DEFAULT_MODEL],
  requestProfile: "mimo",
};

const CATALOG: Record<string, ProviderDefaults> = {
  [MIMO_API_PROVIDER_ID]: {
    providerId: MIMO_API_PROVIDER_ID,
    group: null,
    defaultBaseUrl: MIMO_API_DEFAULT_BASE_URL,
    capabilities: { omni: MIMO_CHAT, llm: MIMO_CHAT },
  },
  // omni and llm share one model set today; they diverge once the llm slot gets dedicated models —
  // kept inline (unlike MIMO_CHAT) on purpose.
  [DOUBAO_ARK_PROVIDER_ID]: {
    providerId: DOUBAO_ARK_PROVIDER_ID,
    group: null,
    defaultBaseUrl: DOUBAO_ARK_DEFAULT_BASE_URL,
    capabilities: {
      omni: {
        defaultModel: DOUBAO_SEED_2_0_LITE_MODEL,
        allowedModels: [DOUBAO_SEED_2_0_LITE_MODEL, DOUBAO_SEED_2_0_MINI_MODEL],
        requestProfile: "doubao_ark",
      },
      llm: {
        defaultModel: DOUBAO_SEED_2_0_LITE_MODEL,
        allowedModels: [DOUBAO_SEED_2_0_LITE_MODEL, DOUBAO_SEED_2_0_MINI_MODEL],
        requestProfile: "doubao_ark",
      },
    },
  },
  // omni and llm share one model set today; they diverge once the llm slot gets dedicated models —
  // kept inline (unlike MIMO_CHAT) on purpose.
  [DASHSCOPE_PROVIDER_ID]: {
    providerId: DASHSCOPE_PROVIDER_ID,
    group: null,
    defaultBaseUrl: DASHSCOPE_DEFAULT_BASE_URL,
    capabilities: {
      omni: {
        defaultModel: QWEN3_5_OMNI_FLASH_MODEL,
        allowedModels: [QWEN3_5_OMNI_FLASH_MODEL, QWEN3_5_OMNI_PLUS_MODEL],
        requestProfile: "dashscope",
      },
      llm: {
        defaultModel: QWEN3_5_OMNI_FLASH_MODEL,
        allowedModels: [QWEN3_5_OMNI_FLASH_MODEL, QWEN3_5_OMNI_PLUS_MODEL],
        requestProfile: "dashscope",
      },
    },
  },
  [DASHSCOPE_REALTIME_PROVIDER_ID]: {
    providerId: DASHSCOPE_REALTIME_PROVIDER_ID,
    group: null,
    defaultBaseUrl: DASHSCOPE_REALTIME_DEFAULT_BASE_URL,
    capabilities: {
      asr: {
        defaultModel: QWEN3_ASR_FLASH_REALTIME_MODEL,
        allowedModels: [
          QWEN3_ASR_FLASH_REALTIME_MODEL,
          QWEN3_5_OMNI_FLASH_REALTIME_MODEL,
          QWEN3_5_OMNI_PLUS_REALTIME_MODEL,
        ],
        requestProfile: "dashscope_realtime",
      },
    },
  },
  [OPENAI_COMPAT_PROVIDER_ID]: {
    providerId: OPENAI_COMPAT_PROVIDER_ID,
    group: null,
    defaultBaseUrl: OPENAI_COMPAT_DEFAULT_BASE_URL,
    capabilities: {
      asr: {
        defaultModel: "whisper-1",
        allowedModels: [
          "whisper-1",
          "gpt-4o-transcribe",
          "gpt-4o-mini-transcribe",
          "whisper-large-v3",
        ],
        requestProfile: "openai_transcriptions",
      },
      llm: {
        defaultModel: "gpt-4o-mini",
        allowedModels: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
        requestProfile: "openai_chat",
      },
    },
  },
  [DOUBAO_ASR_PROVIDER_ID]: {
    providerId: DOUBAO_ASR_PROVIDER_ID,
    group: null,
    defaultBaseUrl: DOUBAO_ASR_DEFAULT_BASE_URL,
    capabilities: {
      asr: {
        defaultModel: DOUBAO_ASR_FLASH_MODEL,
        allowedModels: [DOUBAO_ASR_FLASH_MODEL],
        requestProfile: "doubao_flash_asr",
      },
    },
  },
};

export function providerDefaultsFor(providerId: string): ProviderDefaults | null {
  return CATALOG[providerId.trim().toLowerCase()] ?? null;
}

export function capabilityDefaultsFor(
  providerId: string,
  capability: Capability,
): CapabilityDefaults | null {
  return providerDefaultsFor(providerId)?.capabilities[capability] ?? null;
}

export function listProviderDefaults(): ProviderDefaults[] {
  return Object.values(CATALOG);
}
