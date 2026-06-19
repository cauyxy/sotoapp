// IPC command *output* (response) DTOs — the canonical main→renderer wire
// shapes. Request schemas live in requests.ts (zod-validated at the trust
// boundary); outputs are produced by trusted main-process code, so they are
// plain types rather than runtime-validated schemas. Both sides (main
// assemblers/handlers and the renderer's typed ipc seam) import THESE types —
// never re-declare them — so the two processes cannot drift.

import type { z } from "zod";
import type { Capability } from "./schema.js";
import type { PaneSchema } from "./requests.js";

/** `health` command response. */
export interface Health {
  ok: boolean;
  version: string;
  storage_ok?: boolean;
}

/** A permission pane identity — derived from the request-side PaneSchema enum. */
export type PermissionPane = z.infer<typeof PaneSchema>;

/** Native permission authorization states (macOS TCC vocabulary + fallbacks). */
export type PermissionStatusKind =
  | "not_determined"
  | "restricted"
  | "denied"
  | "granted"
  | "not_required"
  | "unknown";

/** One row of the permission panel: pane identity + grant state + copy. */
export interface PermissionStatus {
  pane: PermissionPane;
  granted: boolean;
  status: PermissionStatusKind;
  label: string;
  detail: string;
}

/** A selectable audio input device. */
export interface MicrophoneDevice {
  id: string;
  label: string;
  is_default: boolean;
}

/** Per-capability model menu for one vendor (engine spec §7.4). */
export interface SupportedCapability {
  default_model: string;
  models: string[];
}

/** A provider catalog entry as the renderer consumes it. */
export interface SupportedProvider {
  provider_id: string;
  group: string | null;
  display_name: string;
  default_base_url: string | null;
  capabilities: Partial<Record<Capability, SupportedCapability>>;
  /** @deprecated legacy single-capability fields — omni (or first) capability; removed once the renderer migrates (B9). */
  default_model: string;
  models: string[];
}

/** `list_supported_providers` command response. */
export interface SupportedProvidersResponse {
  providers: SupportedProvider[];
}

/** `test_provider_config` command response. */
export interface ProviderTestResult {
  config_id: string;
  status: "ok" | "err" | "unspecified";
  note: string;
  latency_ms: number;
}
