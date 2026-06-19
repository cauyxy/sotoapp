// Handler-level test for the confirm_dialog IPC command. Deliberately does NOT
// import the SqliteStore (or anything that constructs a better-sqlite3
// `Database` at runtime) so it loads on Node where the native binding can't
// build — see Task 5 testability notes. createHandlers only *type*-imports the
// store, so importing it here pulls no native code; we hand it minimal stubs and
// exercise only the confirm_dialog handler's delegation to the injected
// showConfirmDialog capability (the real electron `dialog` is injected from
// index.ts and is not under test here).

import { describe, expect, it, vi } from "vitest";
import type { ConfirmDialogInput } from "@soto/core";
import { createStubNativeBridge } from "@soto/native-bridge";
import { createHandlers } from "../ipc/handlers.js";
import type { SqliteStore } from "../db/store.js";

const MAIN_CTX = { window: "main" } as const;

// Minimal store stub: confirm_dialog touches no store method, so an empty object
// cast to SqliteStore is sufficient (createHandlers never calls it for this
// command). Other handlers would touch the store, but we only invoke confirm_dialog.
const storeStub = {} as unknown as SqliteStore;

describe("confirm_dialog handler", () => {
  it("delegates to the injected showConfirmDialog and forwards its result", async () => {
    const showConfirmDialog = vi.fn(
      (_opts: ConfirmDialogInput): Promise<boolean> => Promise.resolve(true),
    );
    const handlers = createHandlers(storeStub, createStubNativeBridge(), undefined, {
      showConfirmDialog,
    });

    const input: ConfirmDialogInput = {
      message: "Clear all history?",
      detail: "This can't be undone.",
      confirmLabel: "Clear",
      cancelLabel: "Cancel",
    };
    const result = await handlers.confirm_dialog(input, MAIN_CTX);

    expect(result).toBe(true);
    expect(showConfirmDialog).toHaveBeenCalledTimes(1);
    expect(showConfirmDialog).toHaveBeenCalledWith(input);
  });

  it("propagates a false (cancelled) result", async () => {
    const showConfirmDialog = vi.fn(
      (): Promise<boolean> => Promise.resolve(false),
    );
    const handlers = createHandlers(storeStub, createStubNativeBridge(), undefined, {
      showConfirmDialog,
    });

    const result = await handlers.confirm_dialog({ message: "Delete?" }, MAIN_CTX);
    expect(result).toBe(false);
  });

  it("defaults to false (cancelled) when no dialog capability is wired", async () => {
    // No showConfirmDialog in runtime options: a destructive action gated on the
    // result must NOT proceed, so the handler resolves false rather than throwing.
    const handlers = createHandlers(storeStub, createStubNativeBridge());
    const result = await handlers.confirm_dialog({ message: "Delete?" }, MAIN_CTX);
    expect(result).toBe(false);
  });
});
