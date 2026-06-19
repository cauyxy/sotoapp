// Pure-TS IPC trust-boundary router (plan §5). The Electron main process owns
// the only privileged side; every renderer call is dispatched through here,
// which enforces a command whitelist, per-window authorisation (the capsule
// window is least-privilege), and zod input validation BEFORE any handler
// runs. Generic over a command registry with injected handlers — no Electron
// dependency, so the security logic is fully unit-testable.

import type { z } from "zod";

export type WindowKind = "main" | "capsule";

export interface SenderContext {
  window: WindowKind;
}

export interface CommandDefinition<I = unknown, O = unknown> {
  input: z.ZodType<I>;
  allowedWindows: readonly WindowKind[];
  handler: (input: I, ctx: SenderContext) => O | Promise<O>;
}

/** Identity helper that preserves a command definition's input/output types. */
export function defineCommand<I, O>(
  def: CommandDefinition<I, O>,
): CommandDefinition<I, O> {
  return def;
}

// A registry mixes commands with different input/output types, so the values
// are erased to `any` here (the per-command types are preserved at the
// defineCommand call site). The router only relies on input/allowedWindows.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCommandDefinition = CommandDefinition<any, any>;

export type DispatchResult<O = unknown> =
  | { ok: true; value: O }
  | { ok: false; error: DispatchError; detail?: unknown };

export type DispatchError =
  | "unknown_command"
  | "forbidden"
  | "invalid_input"
  | "handler_error";

export class IpcRouter<R extends Record<string, AnyCommandDefinition>> {
  constructor(private readonly registry: R) {}

  async dispatch(
    command: string,
    rawArgs: unknown,
    ctx: SenderContext,
  ): Promise<DispatchResult> {
    const definition = this.registry[command];
    if (definition === undefined) {
      return { ok: false, error: "unknown_command" };
    }

    // Authorize the calling window before looking at the payload at all, so a
    // forbidden caller learns nothing from validation behaviour.
    if (!definition.allowedWindows.includes(ctx.window)) {
      return { ok: false, error: "forbidden" };
    }

    const parsed = definition.input.safeParse(rawArgs);
    if (!parsed.success) {
      return { ok: false, error: "invalid_input", detail: parsed.error.issues };
    }

    try {
      return { ok: true, value: await definition.handler(parsed.data, ctx) };
    } catch (error) {
      return { ok: false, error: "handler_error", detail: error };
    }
  }
}
