import type {
  HistoryRecord,
  InjectionOutcome,
  PostInsertObservation,
} from "../../contract/schema.js";
import type { TargetContextSnapshot } from "../context/context.js";

export interface HistoryWriter {
  append(record: HistoryRecord): Promise<void>;
}

export interface HistoryObservationWriter {
  recordPostInsertObservation(
    historyId: string,
    observation: PostInsertObservation,
  ): Promise<boolean>;
}

export interface PostInsertObserverRequest {
  historyId: string;
  sessionId: string;
  target: TargetContextSnapshot;
  injectedText: string;
  injectionOutcome: InjectionOutcome;
  startedAt: number;
  timeoutMs: number;
  onObservation(observation: PostInsertObservation): void;
}

export interface PostInsertObservationHandle {
  cancel(): void;
}

export interface PostInsertObserver {
  start(request: PostInsertObserverRequest): PostInsertObservationHandle;
}

export const NoopPostInsertObserver: PostInsertObserver = {
  start(request) {
    request.onObservation({
      edited_text: null,
      edited_text_status: "not_observed",
      edited_text_status_reason: "observer_not_attached",
      ax_context_at_end: null,
    });
    return {
      cancel() {},
    };
  },
};
