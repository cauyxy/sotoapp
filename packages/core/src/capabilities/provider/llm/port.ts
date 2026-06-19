/** Text post-processing port (engine spec §4.2). */
export interface LlmPort {
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}
