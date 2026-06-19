import type {
  HistoryObservationWriter,
  PostInsertObservation,
  PostInsertObservationHandle,
  PostInsertObserver,
  PostInsertObserverRequest,
} from "@soto/core";

export interface PostInsertObservationCoordinatorOptions {
  observer: PostInsertObserver;
  writer: HistoryObservationWriter;
  log?: (message: string) => void;
}

export class PostInsertObservationCoordinator implements PostInsertObserver {
  private active: PostInsertObservationHandle | null = null;

  constructor(private readonly options: PostInsertObservationCoordinatorOptions) {}

  start(request: PostInsertObserverRequest): PostInsertObservationHandle {
    this.cancelActive();

    let closed = false;
    let terminalClaimed = false;
    let inner: PostInsertObservationHandle | null = null;
    let handle: PostInsertObservationHandle | null = null;
    const finishAcceptedObservation = () => {
      if (closed) return;
      closed = true;
      if (inner !== null) {
        try {
          inner.cancel();
        } catch (error) {
          this.options.log?.(
            `post-insert observer cancel failed: ${messageOf(error)}`,
          );
        }
      }
      if (handle !== null && this.active === handle) this.active = null;
    };
    const wrappedRequest: PostInsertObserverRequest = {
      ...request,
      onObservation: (observation) => {
        if (closed || terminalClaimed) return;
        terminalClaimed = true;
        request.onObservation(observation);
        this.recordObservation(
          request.historyId,
          observation,
          finishAcceptedObservation,
        );
      },
    };

    try {
      inner = this.options.observer.start(wrappedRequest);
    } catch (error) {
      this.options.log?.(
        `post-insert observer failed to start: ${messageOf(error)}`,
      );
      this.recordObservation(request.historyId, observerStartFailedObservation);
      return noopHandle;
    }

    handle = {
      cancel: () => {
        if (closed) return;
        closed = true;
        if (!terminalClaimed) {
          this.recordObservation(request.historyId, observerCancelledObservation);
        }
        try {
          inner?.cancel();
        } catch (error) {
          this.options.log?.(
            `post-insert observer cancel failed: ${messageOf(error)}`,
          );
        }
        if (this.active === handle) this.active = null;
      },
    };
    this.active = handle;
    return handle;
  }

  cancelActive(): void {
    const active = this.active;
    if (active === null) return;
    this.active = null;
    active.cancel();
  }

  private recordObservation(
    historyId: string,
    observation: PostInsertObservation,
    onAccepted?: () => void,
  ): void {
    try {
      void this.options.writer
        .recordPostInsertObservation(historyId, observation)
        .then((accepted) => {
          if (accepted) onAccepted?.();
        })
        .catch((error) => {
          this.options.log?.(
            `post-insert observation write failed: ${messageOf(error)}`,
          );
        });
    } catch (error) {
      this.options.log?.(
        `post-insert observation write failed: ${messageOf(error)}`,
      );
    }
  }
}

const noopHandle: PostInsertObservationHandle = {
  cancel() {},
};

const observerStartFailedObservation: PostInsertObservation = {
  edited_text: null,
  edited_text_status: "unavailable",
  edited_text_status_reason: "native_unavailable",
  ax_context_at_end: null,
};

const observerCancelledObservation: PostInsertObservation = {
  edited_text: null,
  edited_text_status: "unavailable",
  edited_text_status_reason: "observer_cancelled",
  ax_context_at_end: null,
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
