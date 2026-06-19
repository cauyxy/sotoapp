import { describe, expect, it } from "vitest";
import type { PermissionUpdatedEvent } from "@soto/core";
import { PermissionGate, type PermissionGatePorts } from "./permissionGate.js";

interface Fakes {
  ports: PermissionGatePorts;
  state: {
    trusted: boolean;
    mic: boolean;
    installResult: boolean;
    installCalls: number;
    promptCalls: number;
    emits: PermissionUpdatedEvent[];
    logs: string[];
  };
}

function makeFakes(init: Partial<Fakes["state"]> = {}): Fakes {
  const state = {
    trusted: false,
    mic: false,
    installResult: true,
    installCalls: 0,
    promptCalls: 0,
    emits: [] as PermissionUpdatedEvent[],
    logs: [] as string[],
    ...init,
  };
  const ports: PermissionGatePorts = {
    isAccessibilityTrusted: () => state.trusted,
    promptAccessibility: () => {
      state.promptCalls += 1;
    },
    isMicrophoneGranted: () => state.mic,
    installHotkeys: () => {
      state.installCalls += 1;
      return state.installResult;
    },
    emitPermission: (e) => {
      state.emits.push(e);
    },
    log: (m) => {
      state.logs.push(m);
    },
  };
  return { ports, state };
}

describe("PermissionGate", () => {
  it("installs immediately and does NOT prompt when already trusted", () => {
    const { ports, state } = makeFakes({ trusted: true, mic: true });
    const gate = new PermissionGate(ports);

    const step = gate.start();

    expect(step).toEqual({ installed: true, polling: false });
    expect(state.promptCalls).toBe(0);
    expect(state.installCalls).toBe(1);
    expect(gate.isInstalled).toBe(true);
    expect(state.emits).toEqual([
      {
        accessibility: true,
        microphone: true,
        hotkey_installed: true,
      },
    ]);
  });

  it("prompts once and requests polling when untrusted at start", () => {
    const { ports, state } = makeFakes({ trusted: false });
    const gate = new PermissionGate(ports);

    const step = gate.start();

    expect(step).toEqual({ installed: false, polling: true });
    expect(state.promptCalls).toBe(1);
    expect(state.installCalls).toBe(0);
    // Emits a snapshot showing not-yet-installed.
    expect(state.emits.at(-1)).toEqual({
      accessibility: false,
      microphone: false,
      hotkey_installed: false,
    });
  });

  it("arms the hook the tick after trust is granted (no restart)", () => {
    const fakes = makeFakes({ trusted: false });
    const gate = new PermissionGate(fakes.ports);
    gate.start();

    // still untrusted -> keep polling, no install
    expect(gate.tick()).toEqual({ installed: false, polling: true });
    expect(fakes.state.installCalls).toBe(0);

    // user grants Accessibility -> next tick installs and stops polling
    fakes.state.trusted = true;
    fakes.state.mic = true;
    const step = gate.tick();
    expect(step).toEqual({ installed: true, polling: false });
    expect(fakes.state.installCalls).toBe(1);
    expect(fakes.state.emits.at(-1)).toEqual({
      accessibility: true,
      microphone: true,
      hotkey_installed: true,
    });
  });

  it("keeps polling if trusted but the tap install fails for another reason", () => {
    const fakes = makeFakes({ trusted: true, installResult: false });
    const gate = new PermissionGate(fakes.ports);

    const step = gate.start();

    expect(step).toEqual({ installed: false, polling: true });
    expect(fakes.state.installCalls).toBe(1); // attempted
    expect(gate.isInstalled).toBe(false);
    // prompt still fired since install did not succeed
    expect(fakes.state.promptCalls).toBe(1);
  });

  it("is idempotent once installed (no re-install, no re-emit)", () => {
    const fakes = makeFakes({ trusted: true });
    const gate = new PermissionGate(fakes.ports);
    gate.start();
    const emitsAfterStart = fakes.state.emits.length;

    expect(gate.tick()).toEqual({ installed: true, polling: false });
    expect(fakes.state.installCalls).toBe(1);
    expect(fakes.state.emits.length).toBe(emitsAfterStart);
  });
});
