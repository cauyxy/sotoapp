// @soto/ipc — the Soto IPC trust boundary, extracted from @soto/core (spec §3,
// Stage B). It layers on top of @soto/core: the generic IpcRouter + command
// definitions (router.ts) and the authoritative 31-command policy/registry
// (commands.ts, whose request schemas come from @soto/core's contract layer).
//
// The barrel re-exports the FULL public surface of both files. From router.ts:
// IpcRouter, WindowKind, SenderContext, CommandDefinition, AnyCommandDefinition,
// defineCommand, DispatchResult, DispatchError. From commands.ts: COMMAND_POLICY,
// ALL_COMMANDS, CAPSULE_COMMANDS, CommandName, CommandHandler, createIpcRegistry.
export * from "./router.js";
export * from "./commands.js";
