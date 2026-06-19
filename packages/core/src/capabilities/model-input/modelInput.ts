import type { AxContext } from "../../contract/schema.js";
import {
  type AppContext,
  type ModelClipboardContext,
} from "../context/context.js";
import type { AppProfile } from "../context/appProfile.js";

export type ModelIntent = "dictation";

export type ModelInputUserMessage =
  {
    kind: "audio";
    audio: {
      audioB64: string;
      audioFormat: string;
    };
  };

export type ModelInputContextBlock =
  | {
      kind: "base_instruction";
      prompt: string;
    }
  | {
      kind: "app_profile";
      profile: AppProfile;
    }
  | {
      kind: "hotwords";
      hotwords: readonly string[];
    }
  | {
      kind: "target_context";
      axContext: AxContext;
    }
  | {
      kind: "clipboard_context";
      clipboardContext: ModelClipboardContext;
    }
  | {
      kind: "user_message";
      message: ModelInputUserMessage;
    };

export interface ModelInputAssemblyRequest {
  intent: ModelIntent;
  modeId: string;
  modePrompt: string;
  recording?: {
    audioB64: string;
    audioFormat: string;
    durationMs: number;
    peak: number;
  };
  appContext: AppContext;
  hotwords: readonly string[];
  now: number;
}

export interface ModelInput {
  intent: ModelIntent;
  mode: {
    id: string;
    prompt: string;
  };
  audio: {
    audioB64: string;
    audioFormat: string;
  } | null;
  hotwords: readonly string[];
  appContext: AppContext;
  clipboardContext: ModelClipboardContext | null;
  contextBlocks: readonly ModelInputContextBlock[];
}

export interface ModelOutput {
  rawText: string;
  finalText: string;
  providerTrace: {
    recognitionProviderId: string | null;
    recognitionModelId: string | null;
    llmProviderId: string | null;
    llmModelId: string | null;
  };
}
