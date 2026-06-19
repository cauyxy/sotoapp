import { describe, expect, it } from "vitest";
import { parseOmniResponse, createResponseException } from "./response.js";

describe("parseOmniResponse", () => {
  it("returns the first choice's trimmed message content", () => {
    const raw = JSON.stringify({ choices: [{ message: { content: "  hello world  " } }] });
    expect(parseOmniResponse(raw)).toBe("hello world");
  });

  it("throws empty_response when content is missing or blank", () => {
    const raw = JSON.stringify({ choices: [{ message: { content: "   " } }] });
    expect(() => parseOmniResponse(raw)).toThrowError(
      expect.objectContaining({ code: "empty_response" }),
    );
  });

  it("throws empty_response when there are no choices", () => {
    expect(() => parseOmniResponse(JSON.stringify({ choices: [] }))).toThrowError(
      expect.objectContaining({ code: "empty_response" }),
    );
  });

  it("throws request_failed on invalid JSON", () => {
    expect(() => parseOmniResponse("not json")).toThrowError(
      expect.objectContaining({ code: "request_failed" }),
    );
  });
});

describe("createResponseException", () => {
  it("maps 401/403 to authentication_failed", () => {
    expect(createResponseException(401, "").code).toBe("authentication_failed");
    expect(createResponseException(403, "").code).toBe("authentication_failed");
  });

  it("maps 429 to rate_limited", () => {
    expect(createResponseException(429, "").code).toBe("rate_limited");
  });

  it("maps 500/502/503 to service_unavailable", () => {
    for (const s of [500, 502, 503]) {
      expect(createResponseException(s, "").code).toBe("service_unavailable");
    }
  });

  it("maps other statuses to request_failed", () => {
    expect(createResponseException(418, "").code).toBe("request_failed");
  });

  it("extracts error.message from the body into the detail", () => {
    const body = JSON.stringify({ error: { message: "bad key" } });
    expect(createResponseException(401, body).message).toBe(
      "Provider request failed with HTTP 401: bad key",
    );
  });

  it("falls back to the trimmed body when there is no error envelope", () => {
    expect(createResponseException(400, "  oops  ").message).toBe(
      "Provider request failed with HTTP 400: oops",
    );
  });

  it("omits the detail when the body is empty", () => {
    expect(createResponseException(400, "").message).toBe(
      "Provider request failed with HTTP 400",
    );
  });
});
