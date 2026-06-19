// Shared chat-completions response parser used by both the omni client and the
// llm client — keep error messages provider-neutral (no "Omni …" prefixes here).

import { ProviderException, type ProviderErrorCode } from "./errors.js";

/**
 * Parse an OpenAI-compatible chat-completions success body and return the first
 * choice's trimmed message content. Throws empty_response when no usable text
 * is present, request_failed when the body is not valid JSON.
 */
export function parseOmniResponse(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProviderException(
      "request_failed",
      "Chat completions response JSON could not be parsed.",
    );
  }

  const content = (parsed as { choices?: { message?: { content?: unknown } }[] })
    ?.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content.trim() : "";
  if (text.length === 0) {
    throw new ProviderException(
      "empty_response",
      "Provider returned an empty response.",
    );
  }
  return text;
}

function errorCodeForStatus(status: number): ProviderErrorCode {
  switch (status) {
    case 401:
    case 403:
      return "authentication_failed";
    case 429:
      return "rate_limited";
    case 500:
    case 502:
    case 503:
      return "service_unavailable";
    default:
      return "request_failed";
  }
}

/** Extract `error.message` from an error envelope body, if present. */
export function extractErrorMessage(body: string): string | null {
  try {
    const message = (JSON.parse(body) as { error?: { message?: unknown } })
      ?.error?.message;
    return typeof message === "string" ? message : null;
  } catch {
    return null;
  }
}

/** Build a ProviderException from a failed HTTP response. */
export function createResponseException(
  status: number,
  body: string,
): ProviderException {
  const code = errorCodeForStatus(status);
  const detail = extractErrorMessage(body) ?? body.trim();
  const message =
    detail.length === 0
      ? `Provider request failed with HTTP ${status}`
      : `Provider request failed with HTTP ${status}: ${detail}`;
  return new ProviderException(code, message);
}
