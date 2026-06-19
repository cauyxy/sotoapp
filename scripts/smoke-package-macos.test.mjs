import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { installAndLaunch, main, parseCliArgs } from "./smoke-package-macos.mjs";

const VERSION = "9.9.9";
const CURRENT_EXPORTS = [
  "_soto_app_activate",
  "_soto_app_frontmost",
  "_soto_app_frontmost_window_bounds",
  "_soto_audio_is_output_muted",
  "_soto_audio_set_output_muted",
  "_soto_ax_capture_focused",
  "_soto_ax_context_free",
  "_soto_ax_is_trusted",
  "_soto_clipboard_copy_user_text",
  "_soto_clipboard_prepare_paste_text",
  "_soto_clipboard_restore_after_paste",
  "_soto_focus_probe",
  "_soto_hook_install",
  "_soto_hook_next_event",
  "_soto_hook_shutdown",
  "_soto_open_permission_settings",
  "_soto_permission_status_kind",
  "_soto_request_permission",
  "_soto_send_paste",
  "_soto_window_title",
];
const TASK5_EXPORTS = [
  "_soto_app_activate",
  "_soto_app_frontmost_bundle_id",
  "_soto_app_frontmost_name",
  "_soto_app_frontmost_pid",
  "_soto_app_frontmost_window_bounds",
  "_soto_audio_is_output_muted",
  "_soto_audio_set_output_muted",
  "_soto_ax_capture_focused",
  "_soto_ax_context_free",
  "_soto_ax_is_trusted",
  "_soto_ax_window_title",
  "_soto_clipboard_change_count",
  "_soto_clipboard_get",
  "_soto_clipboard_set",
  "_soto_clipboard_set_transient",
  "_soto_clipboard_snapshot_kind",
  "_soto_focus_probe",
  "_soto_free_string",
  "_soto_hook_install",
  "_soto_hook_next_event",
  "_soto_hook_shutdown",
  "_soto_open_permission_settings",
  "_soto_perm_request",
  "_soto_perm_status",
  "_soto_send_paste",
];

function createPackagedFixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "soto-macos-smoke-"));
  mkdirSync(join(repoRoot, "apps/desktop"), { recursive: true });
  writeFileSync(join(repoRoot, "apps/desktop/package.json"), JSON.stringify({ version: VERSION }));

  const appBundle = join(repoRoot, "apps/desktop/dist/mac-arm64/Soto.app");
  mkdirSync(join(appBundle, "Contents/Resources/native"), { recursive: true });
  writeFileSync(join(appBundle, "Contents/Resources/native/libSotoMacNative.dylib"), "dylib");
  writeFileSync(join(repoRoot, `apps/desktop/dist/Soto-${VERSION}-arm64.dmg`), "dmg");
  writeFileSync(join(repoRoot, `apps/desktop/dist/Soto-${VERSION}-arm64-mac.zip`), "zip");
  writeFileSync(join(repoRoot, "apps/desktop/dist/latest-mac.yml"), `version: ${VERSION}\n`);

  return { repoRoot, appBundle, cleanup: () => rmSync(repoRoot, { recursive: true, force: true }) };
}

// runCommand stub that records every invocation and feeds the verify step the
// arm64 / required-export outputs it expects so verification passes.
function recordingRunCommand(calls, exports = CURRENT_EXPORTS) {
  return (command, args) => {
    calls.push({ command, args });
    if (command === "lipo") return { status: 0, stdout: "arm64", stderr: "" };
    if (command === "nm") return { status: 0, stdout: exports.join("\n"), stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
}

function sink() {
  return { write() {} };
}

function recordingSink() {
  const chunks = [];
  return {
    write(chunk) {
      chunks.push(String(chunk));
    },
    output() {
      return chunks.join("");
    },
  };
}

test("parseCliArgs recognises --reload alongside the existing flags", () => {
  assert.deepEqual(parseCliArgs(["--reload", "--verify-only", "--skip-codesign"]), {
    help: false,
    skipCodesign: true,
    skipNative: false,
    verifyOnly: true,
    reload: true,
  });
  assert.equal(parseCliArgs([]).reload, false);
});

test("installAndLaunch kills, replaces the /Applications bundle, then launches it in order", () => {
  const calls = [];
  const installed = installAndLaunch({
    paths: { appBundle: "/build/Soto.app" },
    runCommand: recordingRunCommand(calls),
    stdout: sink(),
  });

  assert.equal(installed, "/Applications/Soto.app");
  assert.deepEqual(
    calls.map((c) => [c.command, ...c.args]),
    [
      ["pkill", "-x", "Soto"],
      ["rm", "-rf", "/Applications/Soto.app"],
      ["ditto", "/build/Soto.app", "/Applications/Soto.app"],
      ["open", "--env", "SOTO_LOG_PROFILE=smoke", "/Applications/Soto.app"],
    ],
  );
});

test("installAndLaunch tolerates pkill exiting non-zero when no Soto is running", () => {
  const calls = [];
  // pkill -x returns status 1 when nothing matched; that must not abort install.
  const runCommand = (command, args) => {
    calls.push({ command, args });
    return { status: command === "pkill" ? 1 : 0, stdout: "", stderr: "" };
  };

  const installed = installAndLaunch({
    paths: { appBundle: "/build/Soto.app" },
    runCommand,
    stdout: sink(),
  });

  assert.equal(installed, "/Applications/Soto.app");
  assert.deepEqual(
    calls.map((c) => c.command),
    ["pkill", "rm", "ditto", "open"],
  );
});

test("main with --reload installs and launches only after verification passes", () => {
  const fixture = createPackagedFixture();
  const calls = [];
  try {
    const code = main(["--verify-only", "--skip-codesign", "--reload"], {
      repoRoot: fixture.repoRoot,
      platform: "darwin",
      arch: "arm64",
      runCommand: recordingRunCommand(calls),
      stdout: sink(),
      stderr: sink(),
    });

    assert.equal(code, 0);
    const sequence = calls.map((c) => c.command);
    // verify (lipo, nm) must precede the install/launch commands
    assert.deepEqual(sequence, ["lipo", "nm", "pkill", "rm", "ditto", "open"]);
    const ditto = calls.find((c) => c.command === "ditto");
    assert.deepEqual(ditto.args, [fixture.appBundle, "/Applications/Soto.app"]);
  } finally {
    fixture.cleanup();
  }
});

test("main build path uses the mac smoke package script", () => {
  const fixture = createPackagedFixture();
  const calls = [];
  try {
    const code = main(["--skip-native", "--skip-codesign"], {
      repoRoot: fixture.repoRoot,
      platform: "darwin",
      arch: "arm64",
      runCommand: recordingRunCommand(calls),
      stdout: sink(),
      stderr: sink(),
    });

    assert.equal(code, 0);
    assert.deepEqual(calls[0], {
      command: "pnpm",
      args: ["--filter", "@soto/desktop", "run", "package:smoke:mac"],
    });
  } finally {
    fixture.cleanup();
  }
});

test("main without --reload never touches /Applications", () => {
  const fixture = createPackagedFixture();
  const calls = [];
  try {
    const code = main(["--verify-only", "--skip-codesign"], {
      repoRoot: fixture.repoRoot,
      platform: "darwin",
      arch: "arm64",
      runCommand: recordingRunCommand(calls),
      stdout: sink(),
      stderr: sink(),
    });

    assert.equal(code, 0);
    for (const blocked of ["pkill", "rm", "ditto", "open"]) {
      assert.equal(calls.some((c) => c.command === blocked), false, `${blocked} should not run`);
    }
  } finally {
    fixture.cleanup();
  }
});

test("main with --reload aborts install when verification fails", () => {
  const fixture = createPackagedFixture();
  const calls = [];
  try {
    // nm returns no required exports -> verifyArtifacts throws before install.
    const runCommand = (command, args) => {
      calls.push({ command, args });
      if (command === "lipo") return { status: 0, stdout: "arm64", stderr: "" };
      if (command === "nm") return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    const code = main(["--verify-only", "--skip-codesign", "--reload"], {
      repoRoot: fixture.repoRoot,
      platform: "darwin",
      arch: "arm64",
      runCommand,
      stdout: sink(),
      stderr: sink(),
    });

    assert.equal(code, 1);
    for (const blocked of ["pkill", "rm", "ditto", "open"]) {
      assert.equal(calls.some((c) => c.command === blocked), false, `${blocked} must not run after a failed verify`);
    }
  } finally {
    fixture.cleanup();
  }
});

test("main rejects the Task 5 macOS export surface after Task 6", () => {
  const fixture = createPackagedFixture();
  const calls = [];
  const stderr = recordingSink();
  try {
    const code = main(["--verify-only", "--skip-codesign"], {
      repoRoot: fixture.repoRoot,
      platform: "darwin",
      arch: "arm64",
      runCommand: recordingRunCommand(calls, TASK5_EXPORTS),
      stdout: sink(),
      stderr,
    });

    assert.equal(code, 1);
    assert.match(stderr.output(), /_soto_clipboard_prepare_paste_text/);
    assert.match(stderr.output(), /_soto_app_frontmost/);
    assert.match(stderr.output(), /_soto_window_title/);
    assert.match(stderr.output(), /_soto_permission_status_kind/);
  } finally {
    fixture.cleanup();
  }
});
