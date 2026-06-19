// Hand-written zod schemas + derived TS types for the Soto IPC contract
// (replacing ts-rs). One source of truth: the schema both validates at the
// main-process trust boundary and yields the renderer-facing types. Shapes
// mirror the former ts-rs bindings: unix-ms timestamps as bigint (coerced so
// JSON numbers at the IPC boundary validate), snake_case enums.

export * from "./primitives.js";
export * from "./app.js";
export * from "./geometry.js";
export * from "./ax.js";
export * from "./modes.js";
export * from "./provider.js";
export * from "./dictionary.js";
export * from "./channels.js";
export * from "./observation.js";
export * from "./session.js";
export * from "./transform.js";
export * from "./settings.js";
export * from "./history.js";
