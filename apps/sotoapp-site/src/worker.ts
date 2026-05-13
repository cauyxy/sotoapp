import { dmgFileNameFor, dmgUrlFor } from "./lib/dmgUrl";

const UPSTREAM = "https://soto-installer.sotoapp.org/latest.json";

export interface Deps {
  fetcher: typeof fetch;
}

interface UpstreamLatest {
  version?: string;
  pub_date?: string;
  platforms?: {
    "darwin-aarch64"?: { url?: string };
    "windows-x86_64"?: { url?: string };
  };
}

interface SitePayload {
  version: string;
  pubDate: string;
  platforms: {
    "darwin-aarch64": { fileName: string; url: string };
    "windows-x86_64": { fileName: string; url: string };
  };
}

function reshape(upstream: UpstreamLatest): SitePayload | null {
  const version = upstream.version;
  const pubDate = upstream.pub_date;
  const winUrl = upstream.platforms?.["windows-x86_64"]?.url;
  if (!version || !pubDate || !winUrl) return null;

  const winFileName = winUrl.split("/").pop() ?? `Soto_${version}_windows_x86_64-setup.exe`;

  return {
    version,
    pubDate,
    platforms: {
      "darwin-aarch64": {
        fileName: dmgFileNameFor(version),
        url: dmgUrlFor(version)
      },
      "windows-x86_64": {
        fileName: winFileName,
        url: winUrl
      }
    }
  };
}

function jsonResponse(body: unknown, status: number, cacheControl: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl
    }
  });
}

function errorResponse(): Response {
  return jsonResponse({ error: "upstream-unavailable" }, 503, "no-store");
}

export async function handleLatest(_request: Request, deps: Deps): Promise<Response> {
  try {
    const upstream = await deps.fetcher(UPSTREAM, {
      headers: { Accept: "application/json" }
    });
    if (!upstream.ok) return errorResponse();

    const text = await upstream.text();
    let parsed: UpstreamLatest;
    try {
      parsed = JSON.parse(text);
    } catch {
      return errorResponse();
    }

    const reshaped = reshape(parsed);
    if (!reshaped) return errorResponse();

    return jsonResponse(reshaped, 200, "public, s-maxage=300, max-age=60");
  } catch {
    return errorResponse();
  }
}

export interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.hostname === "www.sotoapp.org") {
      const apex = new URL(url.toString());
      apex.hostname = "sotoapp.org";
      return Response.redirect(apex.toString(), 301);
    }

    if (url.pathname === "/api/latest") {
      const cache = (caches as unknown as { default: Cache }).default;
      const cached = await cache.match(request);
      if (cached) return cached;

      const response = await handleLatest(request, { fetcher: fetch });
      if (response.ok) {
        // Clone before caching — body can only be consumed once.
        await cache.put(request, response.clone());
      }
      return response;
    }
    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
