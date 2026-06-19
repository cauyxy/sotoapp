import { describe, expect, it } from "vitest";
import { domainFromWebUrl, withDerivedWebDomain } from "./signals.js";
import type { AxContext } from "../../contract/schema.js";

const ax: AxContext = {
  full_text: "",
  selection_start: 0,
  selection_end: 0,
  before: "",
  after: "",
  ax_role: null,
  app_bundle_id: null,
  app_name: null,
  window_title: null,
  web_url: null,
  web_domain: null,
};

describe("context signals", () => {
  it("derives a hostname domain from a full URL", () => {
    expect(domainFromWebUrl("https://mail.google.com/mail/u/0/#inbox")).toBe("mail.google.com");
  });

  it("returns null for empty, hostless, or invalid URLs", () => {
    expect(domainFromWebUrl("")).toBeNull();
    expect(domainFromWebUrl("file:///Users/x/note.txt")).toBeNull();
    expect(domainFromWebUrl("not a url")).toBeNull();
  });

  it("fills web_domain from web_url", () => {
    expect(
      withDerivedWebDomain({
        ...ax,
        web_url: "https://docs.google.com/document/d/abc",
      }).web_domain,
    ).toBe("docs.google.com");
  });
});
