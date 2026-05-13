import { invoke } from "@tauri-apps/api/core";

export const PROMPT_COMMANDS = {
  readPrompt: "read_prompt",
  writePrompt: "write_prompt"
} as const;

export interface PromptDocument {
  id: string;
  body: string;
}

export async function readPrompt(id: string): Promise<PromptDocument> {
  return invoke(PROMPT_COMMANDS.readPrompt, { id });
}

export async function writePrompt(doc: PromptDocument): Promise<PromptDocument> {
  return invoke(PROMPT_COMMANDS.writePrompt, { doc });
}
