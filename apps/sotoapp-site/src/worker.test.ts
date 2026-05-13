import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleLatest, type Deps } from "./worker";
import worker from "./worker";

const UPSTREAM_OK = {
  version: "0.3.1",
  notes: "Soto 0.3.1",
  pub_date: "2026-05-12T10:00:00.000Z",
  platforms: {
    "darwin-aarch64": {
      url: "https://soto-installer.sotoapp.org/artifacts/0.3.1/darwin-aarch64/Soto_0.3.1_darwin_aarch64.app.tar.gz",
      signature: "sig-darwin"
    },
    "windows-x86_64": {
      url: "https://soto-installer.sotoapp.org/artifacts/0.3.1/windows-x86_64/Soto_0.3.1_windows_x86_64-setup.exe",
      signature: "sig-windows"
    }
  }
};

function makeDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    fetcher: vi.fn(async () => new Response(JSON.stringify(UPSTREAM_OK), { status: 200 })),
    ...overrides
  };
}

describe("handleLatest", () => {
  it("reshapes upstream latest.json into site payload", async () => {
    const deps = makeDeps();
    const res = await handleLatest(new Request("https://sotoapp.org/api/latest"), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/application\/json/);

    const body = await res.json();
    expect(body).toEqual({
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
    });
  });

  it("fetches the canonical upstream URL", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(UPSTREAM_OK)));
    await handleLatest(new Request("https://sotoapp.org/api/latest"), { fetcher });
    expect(fetcher).toHaveBeenCalledWith("https://soto-installer.sotoapp.org/latest.json", expect.any(Object));
  });

  it("sets cacheable response headers", async () => {
    const deps = makeDeps();
    const res = await handleLatest(new Request("https://sotoapp.org/api/latest"), deps);
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=300, max-age=60");
  });

  it("returns 503 on upstream 5xx", async () => {
    const deps = makeDeps({
      fetcher: vi.fn(async () => new Response("oops", { status: 502 }))
    });
    const res = await handleLatest(new Request("https://sotoapp.org/api/latest"), deps);
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "upstream-unavailable" });
  });

  it("returns 503 on fetch rejection", async () => {
    const deps = makeDeps({
      fetcher: vi.fn(async () => {
        throw new Error("network down");
      })
    });
    const res = await handleLatest(new Request("https://sotoapp.org/api/latest"), deps);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "upstream-unavailable" });
  });

  it("returns 503 on malformed upstream JSON", async () => {
    const deps = makeDeps({
      fetcher: vi.fn(async () => new Response("not json", { status: 200 }))
    });
    const res = await handleLatest(new Request("https://sotoapp.org/api/latest"), deps);
    expect(res.status).toBe(503);
  });

  it("returns 503 when upstream is missing version", async () => {
    const deps = makeDeps({
      fetcher: vi.fn(async () =>
        new Response(JSON.stringify({ platforms: {} }), { status: 200 })
      )
    });
    const res = await handleLatest(new Request("https://sotoapp.org/api/latest"), deps);
    expect(res.status).toBe(503);
  });
});

describe("worker default export", () => {
  let mockCache: { match: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockCache = {
      match: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined)
    };
    vi.stubGlobal("caches", { default: mockCache });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeEnv() {
    return {
      ASSETS: {
        fetch: vi.fn(async () => new Response("html", { status: 200 }))
      }
    } as unknown as Parameters<typeof worker.fetch>[1];
  }

  it("returns cached response when caches.default matches", async () => {
    const cached = new Response(JSON.stringify({ cached: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
    mockCache.match.mockResolvedValueOnce(cached);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await worker.fetch(new Request("https://sotoapp.org/api/latest"), makeEnv());
    expect(await res.json()).toEqual({ cached: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches upstream and caches the response on cache miss", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(UPSTREAM_OK), { status: 200 }))
    );

    const res = await worker.fetch(new Request("https://sotoapp.org/api/latest"), makeEnv());
    expect(res.status).toBe(200);
    expect(mockCache.put).toHaveBeenCalledTimes(1);
  });

  it("does not cache a 503 response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("oops", { status: 502 })));

    const res = await worker.fetch(new Request("https://sotoapp.org/api/latest"), makeEnv());
    expect(res.status).toBe(503);
    expect(mockCache.put).not.toHaveBeenCalled();
  });

  it("delegates non-/api/latest paths to env.ASSETS.fetch", async () => {
    const env = makeEnv();
    await worker.fetch(new Request("https://sotoapp.org/"), env);
    expect((env.ASSETS as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch).toHaveBeenCalledTimes(1);
  });

  it("301-redirects www.sotoapp.org to apex, preserving path and query", async () => {
    const env = makeEnv();
    const res = await worker.fetch(
      new Request("https://www.sotoapp.org/api/latest?x=1"),
      env
    );
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("https://sotoapp.org/api/latest?x=1");
    // @ts-ignore: env.ASSETS.fetch is a vitest fn under our fake env
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });
});
