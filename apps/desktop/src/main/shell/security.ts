function cspDirective(name: string, sources: readonly string[]): string {
  return `${name} ${sources.join(" ")}`;
}

function devHmrConnectSources(rendererUrl: string): string[] {
  const sources = ["'self'"];
  try {
    const url = new URL(rendererUrl);
    const wsProtocol = url.protocol === "https:" ? "wss:" : "ws:";
    sources.push(`${wsProtocol}//${url.host}`);
  } catch {
    sources.push("ws:");
  }
  return sources;
}

export function buildContentSecurityPolicy(rendererUrl = process.env["ELECTRON_RENDERER_URL"]): string {
  const isDevRenderer = rendererUrl !== undefined && rendererUrl.length > 0;
  const scriptSources = isDevRenderer ? ["'self'", "'unsafe-inline'"] : ["'self'"];
  const connectSources = isDevRenderer ? devHmrConnectSources(rendererUrl) : ["'self'"];

  return [
    cspDirective("default-src", ["'self'"]),
    cspDirective("script-src", scriptSources),
    cspDirective("style-src", ["'self'", "'unsafe-inline'"]),
    cspDirective("img-src", ["'self'", "data:"]),
    cspDirective("connect-src", connectSources),
  ].join("; ");
}
