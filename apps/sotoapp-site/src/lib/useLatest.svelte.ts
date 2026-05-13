export interface PlatformBuild {
  fileName: string;
  url: string;
}

export type LatestState =
  | { status: "loading" }
  | {
      status: "ok";
      version: string;
      pubDate: string;
      platforms: {
        "darwin-aarch64": PlatformBuild;
        "windows-x86_64": PlatformBuild;
      };
    }
  | { status: "error" };

let singleton: { value: LatestState } | null = null;

function startFetch(state: { value: LatestState }) {
  fetch("/api/latest")
    .then(async (res) => {
      if (!res.ok) {
        state.value = { status: "error" };
        return;
      }
      const body = (await res.json()) as Partial<{
        version: unknown;
        pubDate: unknown;
        platforms: {
          "darwin-aarch64"?: PlatformBuild;
          "windows-x86_64"?: PlatformBuild;
        };
      }>;
      const version = body.version;
      const pubDate = body.pubDate;
      const darwin = body.platforms?.["darwin-aarch64"];
      const windows = body.platforms?.["windows-x86_64"];
      if (
        typeof version !== "string" ||
        typeof pubDate !== "string" ||
        !darwin ||
        !windows
      ) {
        state.value = { status: "error" };
        return;
      }
      state.value = {
        status: "ok",
        version,
        pubDate,
        platforms: {
          "darwin-aarch64": darwin,
          "windows-x86_64": windows
        }
      };
    })
    .catch(() => {
      state.value = { status: "error" };
    });
}

export function useLatest(): { value: LatestState } {
  if (singleton) return singleton;
  const state = $state<{ value: LatestState }>({ value: { status: "loading" } });
  singleton = state;
  startFetch(state);
  return state;
}

/** Test-only: reset module state between tests. Not for production use. */
export function __resetLatestForTests(): void {
  singleton = null;
}

// Reset module-level singleton across Vite HMR updates so changes to this
// file don't leave a stale store in the dev browser. No-op in production.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    __resetLatestForTests();
  });
}
