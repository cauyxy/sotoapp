#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ITERATIONS = 5;
const DEFAULT_DEADLINE_MS = 1000;
const DEFAULT_FS_PROBE_DEADLINE_MS = 1000;
const VERIFY_DEADLINE_MS = 350;
const VERIFY_FS_PROBE_MS = 1000;
const VERIFY_MAX_RSS_GROWTH_MB = 64;
const VERIFY_NODE_VERSION_RANGE = ">=24.16.0 <25";
const VERIFY_MODES = ["healthy", "hung", "leak"];
const VERIFY_MIN_ITERATIONS = {
  healthy: 20,
  hung: 8,
  leak: 1000,
};
const CAPTURE_STAGE_NAMES = ["focusProbe", "captureAxContext", "captureWindowTitle"];
const RAW_TEXT_FIELD_KEYS = new Set([
  "after",
  "before",
  "fulltext",
  "rawtext",
  "selectedtext",
  "selectiontext",
  "text",
  "title",
  "value",
  "windowtitle",
]);
const WINDOWS_NATIVE_PUBLISH_ARGS = [
  "publish",
  "native/windows/SotoWinNative.csproj",
  "-c",
  "Release",
  "-r",
  "win-x64",
  "--self-contained",
  "-p:PublishAot=true",
];

const WIN_SIGNATURES = {
  focus_probe: "int soto_win_focus_probe()",
  ax_capture_focused: "int soto_win_ax_capture_focused(_Out_ AxContextRaw *outCtx)",
  ax_context_free: "void soto_win_ax_context_free(AxContextRaw *ctx)",
  ax_window_title: "void *soto_win_ax_window_title()",
  frontmost_window_title: "void *soto_win_frontmost_window_title()",
  free_string: "void soto_win_free_string(void *ptr)",
};

function usage() {
  return `Usage:
  pnpm smoke:uia:win [--dll <path>] [--no-build] [--iterations <n>] [--deadline-ms <ms>] [--fs-probe-ms <ms>] [--max-rss-growth-mb <mb>] [--launch-notepad] [--expect-capture-timeout] [--report <path>] [--json]
  pnpm smoke:uia:win --verify-report <path> --verify-mode <healthy|hung|leak> [--json]

Windows-only native UIA smoke for issue #1. It builds the NativeAOT DLL by
default, loads SotoWinNative.dll through koffi, then sequentially exercises the
async focus probe, focused AX/UIA capture, and window-title calls with one shared
deadline per iteration.

Before running, focus Notepad or another normal editable control. Output records
stage names, elapsed times, return codes, and text/window-title lengths only; it
does not print captured text. After each capture iteration, it also stats the
loaded DLL through Node fs with its own deadline to catch libuv worker-pool
starvation from orphaned native capture calls. Use --launch-notepad to create
and focus a temporary Notepad target automatically. Use --expect-capture-timeout
only when validating a deliberately hung UIA provider; in that mode capture-stage
timeouts are required but the fs/threadpool probe must still return.
Use --max-rss-growth-mb on long repeated runs to fail the smoke when process RSS
grows past the supplied limit. Use --report to also write the full JSON report
to a file. Use --verify-report to validate a saved JSON artifact without loading
the native DLL.
`;
}

export function parseCliArgs(argv) {
  const parsed = {
    help: false,
    dll: null,
    noBuild: false,
    iterations: DEFAULT_ITERATIONS,
    deadlineMs: DEFAULT_DEADLINE_MS,
    fsProbeMs: DEFAULT_FS_PROBE_DEADLINE_MS,
    maxRssGrowthMb: null,
    launchNotepad: false,
    expectCaptureTimeout: false,
    report: null,
    verifyReport: null,
    verifyMode: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--dll") {
      parsed.dll = requireValue(argv, ++index, arg);
      parsed.noBuild = true;
    } else if (arg === "--no-build") {
      parsed.noBuild = true;
    } else if (arg === "--iterations") {
      parsed.iterations = parsePositiveInteger(requireValue(argv, ++index, arg), arg);
    } else if (arg === "--deadline-ms") {
      parsed.deadlineMs = parsePositiveInteger(requireValue(argv, ++index, arg), arg);
    } else if (arg === "--fs-probe-ms") {
      parsed.fsProbeMs = parsePositiveInteger(requireValue(argv, ++index, arg), arg);
    } else if (arg === "--max-rss-growth-mb") {
      parsed.maxRssGrowthMb = parsePositiveInteger(requireValue(argv, ++index, arg), arg);
    } else if (arg === "--launch-notepad") {
      parsed.launchNotepad = true;
    } else if (arg === "--expect-capture-timeout") {
      parsed.expectCaptureTimeout = true;
    } else if (arg === "--report") {
      parsed.report = requireValue(argv, ++index, arg);
    } else if (arg === "--verify-report") {
      parsed.verifyReport = requireValue(argv, ++index, arg);
    } else if (arg === "--verify-mode") {
      parsed.verifyMode = parseVerifyMode(requireValue(argv, ++index, arg), arg);
    } else if (arg === "--json") {
      parsed.json = true;
    } else {
      throw new Error(`Unknown script argument ${arg}`);
    }
  }

  if (parsed.launchNotepad && parsed.expectCaptureTimeout) {
    throw new Error("--launch-notepad cannot be combined with --expect-capture-timeout");
  }
  if (parsed.verifyReport !== null && parsed.verifyMode === null) {
    throw new Error("--verify-report requires --verify-mode");
  }
  if (parsed.verifyMode !== null && parsed.verifyReport === null) {
    throw new Error("--verify-mode requires --verify-report");
  }
  if (parsed.verifyReport !== null) {
    const hasLiveRunOption =
      parsed.dll !== null ||
      parsed.noBuild ||
      parsed.iterations !== DEFAULT_ITERATIONS ||
      parsed.deadlineMs !== DEFAULT_DEADLINE_MS ||
      parsed.fsProbeMs !== DEFAULT_FS_PROBE_DEADLINE_MS ||
      parsed.maxRssGrowthMb !== null ||
      parsed.launchNotepad ||
      parsed.expectCaptureTimeout ||
      parsed.report !== null;
    if (hasLiveRunOption) {
      throw new Error("--verify-report cannot be combined with live smoke options");
    }
  }

  return parsed;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== value) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseVerifyMode(value, flag) {
  if (!VERIFY_MODES.includes(value)) {
    throw new Error(`${flag} must be one of ${VERIFY_MODES.join(", ")}`);
  }
  return value;
}

export function hostMetadataFor({
  platform = process.platform,
  arch = process.arch,
  versions = process.versions,
  env = process.env,
} = {}) {
  return {
    platform,
    arch,
    nodeVersion: versions.node,
    uvThreadpoolSize: env.UV_THREADPOOL_SIZE ?? "default",
  };
}

export function defaultDllCandidates(repoRoot, env = process.env) {
  const localAppData = env.LOCALAPPDATA ?? resolve(env.USERPROFILE ?? homedir(), "AppData/Local");
  return [
    resolve(repoRoot, "native/windows/bin/Release/net8.0/win-x64/publish/SotoWinNative.dll"),
    resolve(repoRoot, "native/windows/bin/Release/net8.0/SotoWinNative.dll"),
    resolve(repoRoot, "apps/desktop/dist/win-unpacked/resources/native/SotoWinNative.dll"),
    resolve(localAppData, "Programs", "@sotodesktop", "resources/native/SotoWinNative.dll"),
    resolve(homedir(), ".soto/native/SotoWinNative.dll"),
  ];
}

export function resolveDllPath({ repoRoot, explicitDll, env = process.env } = {}) {
  if (explicitDll) return resolve(explicitDll);
  const found = defaultDllCandidates(repoRoot, env).find((candidate) => existsSync(candidate));
  if (found) return found;
  return defaultDllCandidates(repoRoot, env)[0];
}

function repoRootFromScript() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function assertWindowsHost(platform = process.platform, arch = process.arch) {
  if (platform !== "win32" || arch !== "x64") {
    throw new Error("Windows UIA smoke must run on Windows x64.");
  }
}

function runStep(command, args, options = {}) {
  const result = (options.runCommand ?? spawnSync)(command, args, {
    cwd: options.cwd,
    stdio: options.stdio ?? "inherit",
    encoding: options.encoding,
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `:\n${detail}` : ""}`);
  }
}

function publishWindowsNative(repoRoot) {
  runStep("dotnet", WINDOWS_NATIVE_PUBLISH_ARGS, { cwd: repoRoot });
}

function powershellSingleQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function buildLaunchNotepadScript(targetFile) {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$p = Start-Process -FilePath 'notepad.exe' -ArgumentList ${powershellSingleQuote(targetFile)} -PassThru`,
    "Start-Sleep -Milliseconds 900",
    "$shell = New-Object -ComObject WScript.Shell",
    "$activated = $shell.AppActivate($p.Id)",
    "Start-Sleep -Milliseconds 300",
    "[Console]::Out.WriteLine(\"notepad_pid=$($p.Id) activated=$activated\")",
  ].join("; ");
}

function launchNotepadTarget({ runCommand = spawnSync, stdout = process.stdout } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "soto-uia-smoke-"));
  const targetFile = join(dir, "target.txt");
  writeFileSync(
    targetFile,
    [
      "Soto Windows UIA smoke target.",
      "This file is generated by pnpm smoke:uia:win --launch-notepad.",
      "",
    ].join("\r\n"),
    "utf8",
  );
  const result = runCommand(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      buildLaunchNotepadScript(targetFile),
    ],
    { stdio: "pipe", encoding: "utf8" },
  );
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    throw new Error(`launching Notepad target failed${detail ? `:\n${detail}` : ""}`);
  }
  stdout?.write(result.stdout ?? "");
  return targetFile;
}

function requireKoffi(repoRoot) {
  const req = createRequire(resolve(repoRoot, "packages/native-bridge/package.json"));
  return req("koffi");
}

function bindWindowsUia(k, dllPath) {
  const lib = k.load(dllPath);
  k.struct("AxContextRaw", {
    full_text: "void *",
    selection_start: "uint32",
    selection_end: "uint32",
    before: "void *",
    after: "void *",
    ax_role: "void *",
    focused_element_id: "void *",
  });

  const optionalFunc = (signature) => {
    try {
      return lib.func(signature);
    } catch {
      return null;
    }
  };

  const fns = {
    focusProbe: lib.func(WIN_SIGNATURES.focus_probe),
    axCaptureFocused: lib.func(WIN_SIGNATURES.ax_capture_focused),
    axContextFree: lib.func(WIN_SIGNATURES.ax_context_free),
    axWindowTitle: optionalFunc(WIN_SIGNATURES.ax_window_title),
    frontmostWindowTitle: optionalFunc(WIN_SIGNATURES.frontmost_window_title),
    freeString: lib.func(WIN_SIGNATURES.free_string),
  };

  const decodeCString = (ptr) => (ptr ? k.decode.string(ptr) : "");
  const takeOwnedString = (ptr) => {
    if (!ptr) return "";
    try {
      return decodeCString(ptr);
    } finally {
      fns.freeString(ptr);
    }
  };

  const koffiAsync = (fn, ...args) =>
    new Promise((resolvePromise, rejectPromise) => {
      fn.async(...args, (error, result) => {
        if (error) {
          rejectPromise(error);
          return;
        }
        resolvePromise(result);
      });
    });

  return {
    focusProbe: () => koffiAsync(fns.focusProbe),
    captureFocused: async () => {
      const out = {};
      const rc = await koffiAsync(fns.axCaptureFocused, out);
      if (rc !== 1) return { rc, readable: false };
      try {
        return {
          rc,
          readable: true,
          textChars: decodeCString(out.full_text).length,
          beforeChars: decodeCString(out.before).length,
          afterChars: decodeCString(out.after).length,
          selectionStart: out.selection_start,
          selectionEnd: out.selection_end,
          role: decodeCString(out.ax_role) || null,
          focusedElementIdChars: decodeCString(out.focused_element_id).length,
        };
      } finally {
        fns.axContextFree(out);
      }
    },
    windowTitle: async () => {
      const fn = fns.axWindowTitle ?? fns.frontmostWindowTitle;
      if (!fn) return { available: false, titleChars: 0 };
      const title = takeOwnedString(await koffiAsync(fn));
      return { available: true, titleChars: title.length };
    },
  };
}

async function withDeadline(stage, operation, remainingMs) {
  const started = performance.now();
  if (remainingMs <= 0) {
    return { stage, timedOut: true, skipped: true, elapsedMs: 0 };
  }
  const timedOut = Symbol("timed_out");
  let timer = null;
  try {
    const result = await Promise.race([
      operation(),
      new Promise((resolvePromise) => {
        timer = setTimeout(() => resolvePromise(timedOut), remainingMs);
      }),
    ]);
    const elapsedMs = Math.round(performance.now() - started);
    if (result === timedOut) return { stage, timedOut: true, skipped: false, elapsedMs };
    return { stage, timedOut: false, skipped: false, elapsedMs, result };
  } catch (error) {
    return {
      stage,
      timedOut: false,
      skipped: false,
      elapsedMs: Math.round(performance.now() - started),
      error: errorSummaryForReport(error),
    };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function runIteration(native, deadlineMs, fsProbePath, fsProbeMs) {
  const started = performance.now();
  const remaining = () => Math.max(0, deadlineMs - Math.round(performance.now() - started));
  const stages = [];

  stages.push(await withDeadline("focusProbe", () => native.focusProbe(), remaining()));
  stages.push(await withDeadline("captureAxContext", () => native.captureFocused(), remaining()));
  stages.push(await withDeadline("captureWindowTitle", () => native.windowTitle(), remaining()));

  const threadpoolProbe = await withDeadline(
    "threadpoolFsStat",
    async () => {
      const result = await stat(fsProbePath);
      return { file: "SotoWinNative.dll", sizeBytes: result.size };
    },
    fsProbeMs,
  );

  return {
    totalMs: Math.round(performance.now() - started),
    timedOut: stages.some((stage) => stage.timedOut) || threadpoolProbe.timedOut,
    failed: stages.some((stage) => stage.error) || Boolean(threadpoolProbe.error),
    stages,
    threadpoolProbe,
  };
}

export function captureAxReadable(iteration) {
  return Array.isArray(iteration.stages) && iteration.stages.some(
    (stage) => stage.stage === "captureAxContext" && stage.result?.readable === true,
  );
}

export function captureStageTimedOut(iteration) {
  return Array.isArray(iteration.stages) && iteration.stages.some((stage) => stage.timedOut);
}

function captureStageFailed(iteration) {
  return Array.isArray(iteration.stages) && iteration.stages.some((stage) => stage.error);
}

export function memoryProbeFor({ rssBeforeBytes, rssAfterBytes, maxRssGrowthMb }) {
  const rssGrowthBytes = Math.max(0, rssAfterBytes - rssBeforeBytes);
  const maxRssGrowthBytes = maxRssGrowthMb * 1024 * 1024;
  const rssGrowthMb = Math.round(rssGrowthBytes / (1024 * 1024));
  return {
    rssBeforeBytes,
    rssAfterBytes,
    rssGrowthBytes,
    rssGrowthMb,
    maxRssGrowthMb,
    exceeded: rssGrowthBytes > maxRssGrowthBytes,
  };
}

export function reportExitCode(report) {
  if (report.memoryProbe?.exceeded === true) {
    return 2;
  }
  if (
    report.iterations.some(
      (iteration) => {
        if (iteration.threadpoolProbe?.timedOut || iteration.threadpoolProbe?.error) {
          return true;
        }
        if (report.expectCaptureTimeout === true) {
          return captureStageFailed(iteration) || !captureStageTimedOut(iteration);
        }
        return (
          iteration.timedOut ||
          iteration.failed ||
          (report.requireReadableCapture === true && !captureAxReadable(iteration))
        );
      },
    )
  ) {
    return 2;
  }
  return 0;
}

export function shouldForceProcessExit(report, exitCode) {
  if (exitCode !== 0) return true;
  return (
    report.expectCaptureTimeout === true &&
    Array.isArray(report.iterations) &&
    report.iterations.some(captureStageTimedOut)
  );
}

function threadpoolProbeHealthy(iteration) {
  return iteration.threadpoolProbe?.timedOut !== true && iteration.threadpoolProbe?.error === undefined;
}

function nodeVersionInVerifiedRange(nodeVersion) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(nodeVersion);
  if (!match) return false;
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  return major === 24 && minor >= 16;
}

function reportHasWindowsHost(report, errors) {
  if (report.host?.platform !== "win32") {
    errors.push("host.platform must be win32");
  }
  if (report.host?.arch !== "x64") {
    errors.push("host.arch must be x64");
  }
  if (typeof report.host?.nodeVersion !== "string" || report.host.nodeVersion.length === 0) {
    errors.push("host.nodeVersion must be present");
  } else if (!nodeVersionInVerifiedRange(report.host.nodeVersion)) {
    errors.push(`host.nodeVersion must be ${VERIFY_NODE_VERSION_RANGE}`);
  }
  if (typeof report.host?.uvThreadpoolSize !== "string" || report.host.uvThreadpoolSize.length === 0) {
    errors.push("host.uvThreadpoolSize must be present");
  }
}

function reportHasVerificationMetadata(report, errors) {
  if (report.deadlineMs !== VERIFY_DEADLINE_MS) {
    errors.push(`deadlineMs must be ${VERIFY_DEADLINE_MS}`);
  }
  if (report.fsProbeMs !== VERIFY_FS_PROBE_MS) {
    errors.push(`fsProbeMs must be ${VERIFY_FS_PROBE_MS}`);
  }
}

function reportHasIterations(report, errors) {
  if (!Array.isArray(report.iterations) || report.iterations.length === 0) {
    errors.push("iterations must be a non-empty array");
    return false;
  }
  return true;
}

function reportHasMinimumIterations(report, mode, errors) {
  const minimum = VERIFY_MIN_ITERATIONS[mode];
  if (minimum === undefined) return;
  if (report.iterations.length < minimum) {
    errors.push(`iterations must include at least ${minimum} entries for ${mode} mode`);
  }
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function reportHasCaptureMetadata(report, errors) {
  report.iterations.forEach((iteration, index) => {
    const label = `iterations[${index}]`;
    if (!isNonNegativeInteger(iteration.totalMs)) {
      errors.push(`${label}.totalMs must be a non-negative integer`);
    }
    if (typeof iteration.timedOut !== "boolean") {
      errors.push(`${label}.timedOut must be a boolean`);
    }
    if (typeof iteration.failed !== "boolean") {
      errors.push(`${label}.failed must be a boolean`);
    }
    if (!Array.isArray(iteration.stages) || iteration.stages.length === 0) {
      errors.push(`${label}.stages must be a non-empty array`);
    } else {
      iteration.stages.forEach((stage, stageIndex) => {
        const stageLabel = `${label}.stages[${stageIndex}]`;
        if (!isNonNegativeInteger(stage.elapsedMs)) {
          errors.push(`${stageLabel}.elapsedMs must be a non-negative integer`);
        }
        if (typeof stage.timedOut !== "boolean") {
          errors.push(`${stageLabel}.timedOut must be a boolean`);
        }
      });
      for (const stageName of CAPTURE_STAGE_NAMES) {
        if (!iteration.stages.some((stage) => stage.stage === stageName)) {
          errors.push(`${label}.stages must include ${stageName}`);
        }
      }
    }
    if (iteration.threadpoolProbe?.stage !== "threadpoolFsStat") {
      errors.push(`${label}.threadpoolProbe.stage must be threadpoolFsStat`);
    }
    if (!isNonNegativeInteger(iteration.threadpoolProbe?.elapsedMs)) {
      errors.push(`${label}.threadpoolProbe.elapsedMs must be a non-negative integer`);
    }
    if (typeof iteration.threadpoolProbe?.timedOut !== "boolean") {
      errors.push(`${label}.threadpoolProbe.timedOut must be a boolean`);
    }
  });
}

function normalizedPayloadKey(key) {
  return key.replace(/[_-]/g, "").toLowerCase();
}

function reportHasMetadataOnlyPayload(value, label, errors) {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => reportHasMetadataOnlyPayload(item, `${label}[${index}]`, errors));
    return;
  }

  Object.entries(value).forEach(([key, child]) => {
    const childLabel = `${label}.${key}`;
    if (RAW_TEXT_FIELD_KEYS.has(normalizedPayloadKey(key))) {
      errors.push(`${childLabel} must not include raw text content`);
    }
    reportHasMetadataOnlyPayload(child, childLabel, errors);
  });
}

function reportHasMetadataOnlyPayloads(report, errors) {
  report.iterations.forEach((iteration, iterationIndex) => {
    if (Array.isArray(iteration.stages)) {
      iteration.stages.forEach((stage, stageIndex) => {
        reportHasMetadataOnlyPayload(
          stage.result,
          `iterations[${iterationIndex}].stages[${stageIndex}].result`,
          errors,
        );
      });
    }
    reportHasMetadataOnlyPayload(
      iteration.threadpoolProbe?.result,
      `iterations[${iterationIndex}].threadpoolProbe.result`,
      errors,
    );
  });
}

function reportHasNoCaptureStageErrors(iteration, label, errors) {
  if (!Array.isArray(iteration.stages)) return;
  iteration.stages.forEach((stage, stageIndex) => {
    if (stage.error !== undefined) {
      errors.push(`${label}.stages[${stageIndex}].error must be absent`);
    }
  });
}

function reportHasHealthyIterations(report, errors) {
  report.iterations.forEach((iteration, index) => {
    const label = `iterations[${index}]`;
    if (iteration.timedOut === true) errors.push(`${label}.timedOut must be false`);
    if (iteration.failed === true) errors.push(`${label}.failed must be false`);
    reportHasNoCaptureStageErrors(iteration, label, errors);
    if (!threadpoolProbeHealthy(iteration)) {
      errors.push(`${label}.threadpoolProbe must not time out or fail`);
    }
    if (!captureAxReadable(iteration)) {
      errors.push(`${label}.captureAxContext must be readable`);
    }
  });
}

function reportHasHungIterations(report, errors) {
  report.iterations.forEach((iteration, index) => {
    const label = `iterations[${index}]`;
    if (!threadpoolProbeHealthy(iteration)) {
      errors.push(`${label}.threadpoolProbe must not time out or fail`);
    }
    reportHasNoCaptureStageErrors(iteration, label, errors);
    if (!captureStageTimedOut(iteration)) {
      errors.push(`${label}.capture stages must include a timeout`);
    }
  });
}

export function verifySmokeReport(report, mode) {
  const errors = [];
  if (!VERIFY_MODES.includes(mode)) {
    errors.push(`mode must be one of ${VERIFY_MODES.join(", ")}`);
  }
  if (report === null || typeof report !== "object" || Array.isArray(report)) {
    return { ok: false, errors: ["report must be an object"] };
  }

  reportHasWindowsHost(report, errors);
  reportHasVerificationMetadata(report, errors);
  const hasIterations = reportHasIterations(report, errors);
  if (hasIterations) {
    reportHasMinimumIterations(report, mode, errors);
    reportHasCaptureMetadata(report, errors);
    reportHasMetadataOnlyPayloads(report, errors);
    if (mode === "hung") {
      if (report.expectCaptureTimeout !== true) {
        errors.push("expectCaptureTimeout must be true");
      }
      if (report.requireReadableCapture !== false) {
        errors.push("requireReadableCapture must be false");
      }
      reportHasHungIterations(report, errors);
    } else {
      if (report.requireReadableCapture !== true) {
        errors.push("requireReadableCapture must be true");
      }
      if (report.expectCaptureTimeout !== false) {
        errors.push("expectCaptureTimeout must be false");
      }
      reportHasHealthyIterations(report, errors);
    }
  }

  if (mode === "leak") {
    if (report.memoryProbe === undefined) {
      errors.push("memoryProbe must be present");
    } else if (report.memoryProbe.exceeded !== false) {
      errors.push("memoryProbe.exceeded must be false");
    } else if (report.memoryProbe.maxRssGrowthMb !== VERIFY_MAX_RSS_GROWTH_MB) {
      errors.push(`memoryProbe.maxRssGrowthMb must be ${VERIFY_MAX_RSS_GROWTH_MB}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function errorSummaryForReport(error) {
  if (error !== null && typeof error === "object") {
    const name = typeof error.name === "string" && error.name.length > 0 ? error.name : null;
    if (Number.isSafeInteger(error.messageChars) && error.messageChars >= 0) {
      return name === null
        ? { messageChars: error.messageChars }
        : { name, messageChars: error.messageChars };
    }
    const message = typeof error.message === "string" ? error.message : String(error);
    return name === null
      ? { messageChars: message.length }
      : { name, messageChars: message.length };
  }
  return { messageChars: String(error).length };
}

export function formatHumanReport(report) {
  const lines = [
    "Windows UIA capture smoke",
    `dll=${report.dll}`,
    `iterations=${report.iterations.length} deadline_ms=${report.deadlineMs}`,
    `fs_probe_ms=${report.fsProbeMs}`,
    `require_readable_capture=${report.requireReadableCapture ? "true" : "false"}`,
    `expect_capture_timeout=${report.expectCaptureTimeout ? "true" : "false"}`,
  ];
  if (report.host) {
    lines.push(
      `host_platform=${report.host.platform}`,
      `host_arch=${report.host.arch}`,
      `node_version=${report.host.nodeVersion}`,
      `uv_threadpool_size=${report.host.uvThreadpoolSize}`,
    );
  }
  if (report.memoryProbe) {
    lines.push(
      `rss_before_bytes=${report.memoryProbe.rssBeforeBytes}`,
      `rss_after_bytes=${report.memoryProbe.rssAfterBytes}`,
      `rss_growth_mb=${report.memoryProbe.rssGrowthMb}`,
      `max_rss_growth_mb=${report.memoryProbe.maxRssGrowthMb}`,
      `rss_growth_exceeded=${report.memoryProbe.exceeded ? "true" : "false"}`,
    );
  }
  report.iterations.forEach((iteration, index) => {
    lines.push(
      `iteration=${index + 1} total_ms=${iteration.totalMs} timed_out=${iteration.timedOut ? "true" : "false"} failed=${iteration.failed ? "true" : "false"} capture_readable=${captureAxReadable(iteration) ? "true" : "false"}`,
    );
    iteration.stages.forEach((stage) => {
      const result = stage.result ? ` result=${JSON.stringify(stage.result)}` : "";
      const error = stage.error ? ` error=${JSON.stringify(errorSummaryForReport(stage.error))}` : "";
      lines.push(
        `  stage=${stage.stage} elapsed_ms=${stage.elapsedMs} timed_out=${stage.timedOut ? "true" : "false"} skipped=${stage.skipped ? "true" : "false"}${result}${error}`,
      );
    });
    const probeResult = iteration.threadpoolProbe?.result
      ? ` result=${JSON.stringify(iteration.threadpoolProbe.result)}`
      : "";
    const probeError = iteration.threadpoolProbe?.error
      ? ` error=${JSON.stringify(errorSummaryForReport(iteration.threadpoolProbe.error))}`
      : "";
    if (iteration.threadpoolProbe) {
      lines.push(
        `  stage=${iteration.threadpoolProbe.stage} elapsed_ms=${iteration.threadpoolProbe.elapsedMs} timed_out=${iteration.threadpoolProbe.timedOut ? "true" : "false"} skipped=${iteration.threadpoolProbe.skipped ? "true" : "false"}${probeResult}${probeError}`,
      );
    }
  });
  return `${lines.join("\n")}\n`;
}

export function writeJsonReport(reportPath, report) {
  const resolved = resolve(reportPath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return resolved;
}

function readJsonReport(reportPath) {
  return JSON.parse(readFileSync(resolve(reportPath), "utf8"));
}

function formatVerifyResult(reportPath, mode, result) {
  const lines = [
    "Windows UIA capture smoke report verification",
    `report=${resolve(reportPath)}`,
    `mode=${mode}`,
    `ok=${result.ok ? "true" : "false"}`,
  ];
  result.errors.forEach((error) => lines.push(`error=${error}`));
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return 0;
  }

  if (args.verifyReport !== null) {
    const result = verifySmokeReport(readJsonReport(args.verifyReport), args.verifyMode);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(formatVerifyResult(args.verifyReport, args.verifyMode, result));
    }
    return result.ok ? 0 : 2;
  }

  assertWindowsHost();
  const repoRoot = repoRootFromScript();
  if (!args.noBuild) publishWindowsNative(repoRoot);

  const dll = resolveDllPath({ repoRoot, explicitDll: args.dll });
  if (!existsSync(dll)) {
    throw new Error(`SotoWinNative.dll not found: ${dll}`);
  }

  const native = bindWindowsUia(requireKoffi(repoRoot), dll);
  if (args.launchNotepad) {
    launchNotepadTarget({ stdout: args.json ? process.stderr : process.stdout });
  }
  const rssBeforeBytes = args.maxRssGrowthMb === null ? null : process.memoryUsage().rss;
  const iterations = [];
  for (let index = 0; index < args.iterations; index += 1) {
    iterations.push(await runIteration(native, args.deadlineMs, dll, args.fsProbeMs));
  }

  const report = {
    dll,
    deadlineMs: args.deadlineMs,
    fsProbeMs: args.fsProbeMs,
    host: hostMetadataFor(),
    requireReadableCapture: args.launchNotepad,
    expectCaptureTimeout: args.expectCaptureTimeout,
    iterations,
  };
  if (rssBeforeBytes !== null) {
    report.memoryProbe = memoryProbeFor({
      rssBeforeBytes,
      rssAfterBytes: process.memoryUsage().rss,
      maxRssGrowthMb: args.maxRssGrowthMb,
    });
  }
  if (args.report) {
    const reportPath = writeJsonReport(args.report, report);
    const reportLine = `report=${reportPath}\n`;
    if (args.json) process.stderr.write(reportLine);
    else process.stdout.write(reportLine);
  }
  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : formatHumanReport(report));
  const exitCode = reportExitCode(report);
  if (shouldForceProcessExit(report, exitCode)) {
    setTimeout(() => process.exit(exitCode), 25);
  }
  return exitCode;
}

function isMainModule() {
  return process.argv[1] ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href : false;
}

if (isMainModule()) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
