import type { AxContext } from "../../contract/schema.js";

export function domainFromWebUrl(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    const hostname = url.hostname.replace(/\.$/, "").toLowerCase();
    return hostname.length > 0 ? hostname : null;
  } catch {
    return null;
  }
}

export function withDerivedWebDomain(axContext: AxContext): AxContext {
  if (axContext.web_domain !== null && axContext.web_domain.trim().length > 0) {
    return { ...axContext, web_domain: axContext.web_domain.trim().toLowerCase() };
  }
  return { ...axContext, web_domain: domainFromWebUrl(axContext.web_url) };
}
