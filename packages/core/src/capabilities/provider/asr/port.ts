/** Dedicated speech-recognition port (engine spec §4.1). A future local
 * recognizer is just another implementation injected from main. */
export interface AsrHints {
  hotwords: readonly string[];
  languageHint: string | null;
}

export interface AsrPort {
  transcribe(
    audio: { audioB64: string; audioFormat: string },
    hints: AsrHints,
  ): Promise<{ text: string }>;
}
