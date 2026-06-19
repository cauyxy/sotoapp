export type LearningTerminalSignal =
  | "submit_key"
  | "field_cleared"
  | "focus_lost"
  | "timeout_snapshot";

export interface LearningObservationEvent {
  historyId: string;
  injectedText: string;
  observedText: string;
  confidence: "high" | "medium" | "low";
  terminalSignal: LearningTerminalSignal;
  observedAt: bigint;
}

export interface LearningPipeline {
  consume(event: LearningObservationEvent): Promise<void>;
}

export const NoopLearningPipeline: LearningPipeline = {
  async consume() {
    // Intentionally empty: Phase 1 defines the seam, later phases attach learning.
  },
};
