import {
  modelClipboardContextOf,
  modelTargetContextOf,
  type ModelClipboardContext,
} from "../context/context.js";
import type {
  ModelInput,
  ModelInputAssemblyRequest,
  ModelInputContextBlock,
} from "./modelInput.js";

export interface ModelInputAssembler {
  assemble(input: ModelInputAssemblyRequest): ModelInput;
}

function baseContextBlocks(
  input: ModelInputAssemblyRequest,
  hotwords: readonly string[],
  clipboardContext: ModelClipboardContext | null,
): ModelInputContextBlock[] {
  const blocks: ModelInputContextBlock[] = [
    { kind: "base_instruction", prompt: input.modePrompt },
  ];
  if (input.appContext.profile !== null) {
    blocks.push({ kind: "app_profile", profile: input.appContext.profile });
  }
  blocks.push({ kind: "hotwords", hotwords });

  const targetContext = modelTargetContextOf(input.appContext);
  if (targetContext !== null) {
    blocks.push({ kind: "target_context", axContext: targetContext });
  }
  if (clipboardContext !== null) {
    blocks.push({ kind: "clipboard_context", clipboardContext });
  }
  return blocks;
}

export function assembleModelInput(
  input: ModelInputAssemblyRequest,
): ModelInput {
  const hotwords = [...input.hotwords];
  const clipboardContext = modelClipboardContextOf(input.appContext);
  const blocks = baseContextBlocks(input, hotwords, clipboardContext);

  if (input.recording === undefined) {
    throw new Error("dictation model input requires recording");
  }
  const audio = {
    audioB64: input.recording.audioB64,
    audioFormat: input.recording.audioFormat,
  };
  blocks.push({ kind: "user_message", message: { kind: "audio", audio } });

  return {
    intent: input.intent,
    mode: { id: input.modeId, prompt: input.modePrompt },
    audio,
    hotwords,
    appContext: input.appContext,
    clipboardContext,
    contextBlocks: blocks,
  };
}

export const DefaultModelInputAssembler: ModelInputAssembler = {
  assemble: assembleModelInput,
};
