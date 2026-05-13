import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useLatest, __resetLatestForTests } from "./useLatest.svelte";

const OK_PAYLOAD = {
  version: "0.3.1",
  pubDate: "2026-05-12T10:00:00.000Z",
  platforms: {
    "darwin-aarch64": {
      fileName: "Soto_0.3.1_darwin_aarch64.dmg",
      url: "https://soto-installer.sotoapp.org/artifacts/0.3.1/darwin-aarch64/Soto_0.3.1_darwin_aarch64.dmg"
    },
    "windows-x86_64": {
      fileName: "Soto_0.3.1_windows_x86_64-setup.exe",
      url: "https://soto-installer.sotoapp.org/artifacts/0.3.1/windows-x86_64/Soto_0.3.1_windows_x86_64-setup.exe"
    }
  }
};

function makeFetchOk() {
  return vi.fn(async () => new Response(JSON.stringify(OK_PAYLOAD), { status: 200 }));
}

beforeEach(() => {
  __resetLatestForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useLatest", () => {
  it("starts in loading state and transitions to ok on success", async () => {
    const fetchMock = makeFetchOk();
    vi.stubGlobal("fetch", fetchMock);

    const store = useLatest();
    expect(store.value.status).toBe("loading");

    // Let microtasks flush.
    await vi.waitFor(() => {
      expect(store.value.status).toBe("ok");
    });

    if (store.value.status !== "ok") throw new Error("expected ok");
    expect(store.value.version).toBe("0.3.1");
    expect(store.value.pubDate).toBe("2026-05-12T10:00:00.000Z");
    expect(store.value.platforms).toEqual(OK_PAYLOAD.platforms);
    expect(fetchMock).toHaveBeenCalledWith("/api/latest");
  });

  it("transitions to error on 503", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("oops", { status: 503 })));

    const store = useLatest();
    await vi.waitFor(() => {
      expect(store.value.status).toBe("error");
    });
  });

  it("transitions to error on network rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      })
    );
    const store = useLatest();
    await vi.waitFor(() => {
      expect(store.value.status).toBe("error");
    });
  });

  it("deduplicates: calling useLatest twice triggers only one fetch", async () => {
    const fetchMock = makeFetchOk();
    vi.stubGlobal("fetch", fetchMock);

    useLatest();
    useLatest();

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
