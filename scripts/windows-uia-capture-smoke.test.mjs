import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import * as smoke from "./smoke-windows-uia-capture.mjs";

const {
  buildLaunchNotepadScript,
  captureAxReadable,
  captureStageTimedOut,
  defaultDllCandidates,
  formatHumanReport,
  hostMetadataFor,
  memoryProbeFor,
  parseCliArgs,
  reportExitCode,
  resolveDllPath,
  shouldForceProcessExit,
  verifySmokeReport,
  writeJsonReport,
} = smoke;

test("Windows UIA smoke parses defaults and explicit options", () => {
  assert.deepEqual(parseCliArgs([]), {
    help: false,
    dll: null,
    noBuild: false,
    iterations: 5,
    deadlineMs: 1000,
    fsProbeMs: 1000,
    maxRssGrowthMb: null,
    launchNotepad: false,
    expectCaptureTimeout: false,
    report: null,
    verifyReport: null,
    verifyMode: null,
    json: false,
  });

  assert.deepEqual(
    parseCliArgs([
      "--dll",
      "C:/tmp/SotoWinNative.dll",
      "--iterations",
      "20",
      "--deadline-ms",
      "350",
      "--fs-probe-ms",
      "750",
      "--max-rss-growth-mb",
      "64",
      "--launch-notepad",
      "--report",
      "artifacts/uia.json",
      "--json",
    ]),
    {
      help: false,
      dll: "C:/tmp/SotoWinNative.dll",
      noBuild: true,
      iterations: 20,
      deadlineMs: 350,
      fsProbeMs: 750,
      maxRssGrowthMb: 64,
      launchNotepad: true,
      expectCaptureTimeout: false,
      report: "artifacts/uia.json",
      verifyReport: null,
      verifyMode: null,
      json: true,
    },
  );

  assert.deepEqual(
    parseCliArgs([
      "--verify-report",
      "artifacts/uia.json",
      "--verify-mode",
      "healthy",
      "--json",
    ]),
    {
      help: false,
      dll: null,
      noBuild: false,
      iterations: 5,
      deadlineMs: 1000,
      fsProbeMs: 1000,
      maxRssGrowthMb: null,
      launchNotepad: false,
      expectCaptureTimeout: false,
      report: null,
      verifyReport: "artifacts/uia.json",
      verifyMode: "healthy",
      json: true,
    },
  );

  assert.equal(
    parseCliArgs(["--expect-capture-timeout"]).expectCaptureTimeout,
    true,
  );
});

test("Windows UIA smoke rejects malformed numeric options", () => {
  assert.throws(() => parseCliArgs(["--iterations", "0"]), /positive integer/);
  assert.throws(() => parseCliArgs(["--deadline-ms", "1.5"]), /positive integer/);
  assert.throws(() => parseCliArgs(["--fs-probe-ms", "-1"]), /positive integer/);
  assert.throws(() => parseCliArgs(["--max-rss-growth-mb", "0"]), /positive integer/);
  assert.throws(() => parseCliArgs(["--dll"]), /requires a value/);
  assert.throws(() => parseCliArgs(["--report"]), /requires a value/);
  assert.throws(() => parseCliArgs(["--verify-report"]), /requires a value/);
  assert.throws(() => parseCliArgs(["--verify-mode", "slow"]), /must be one of/);
  assert.throws(
    () => parseCliArgs(["--verify-report", "report.json", "--verify-mode", "healthy", "--iterations", "1"]),
    /cannot be combined/,
  );
  assert.throws(
    () => parseCliArgs(["--launch-notepad", "--expect-capture-timeout"]),
    /cannot be combined/,
  );
});

test("Windows UIA smoke writes a durable JSON report", () => {
  const dir = mkdtempSync(join(tmpdir(), "soto-uia-report-test-"));
  try {
    const report = {
      dll: "C:/repo/SotoWinNative.dll",
      deadlineMs: 350,
      fsProbeMs: 750,
      requireReadableCapture: true,
      expectCaptureTimeout: false,
      iterations: [
        {
          totalMs: 10,
          timedOut: false,
          failed: false,
          stages: [],
          threadpoolProbe: {
            stage: "threadpoolFsStat",
            elapsedMs: 1,
            timedOut: false,
            skipped: false,
          },
        },
      ],
    };

    const path = writeJsonReport(join(dir, "nested", "report.json"), report);
    const parsed = JSON.parse(readFileSync(path, "utf8"));

    assert.equal(parsed.deadlineMs, 350);
    assert.equal(parsed.requireReadableCapture, true);
    assert.equal(parsed.iterations[0].threadpoolProbe.stage, "threadpoolFsStat");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Windows UIA smoke records host metadata for Windows artifacts", () => {
  assert.equal(typeof hostMetadataFor, "function");

  assert.deepEqual(
    hostMetadataFor({
      platform: "win32",
      arch: "x64",
      versions: { node: "24.16.0" },
      env: { UV_THREADPOOL_SIZE: "8" },
    }),
    {
      platform: "win32",
      arch: "x64",
      nodeVersion: "24.16.0",
      uvThreadpoolSize: "8",
    },
  );

  assert.deepEqual(
    hostMetadataFor({
      platform: "win32",
      arch: "x64",
      versions: { node: "24.16.0" },
      env: {},
    }),
    {
      platform: "win32",
      arch: "x64",
      nodeVersion: "24.16.0",
      uvThreadpoolSize: "default",
    },
  );
});

test("Windows UIA smoke resolves deterministic DLL candidate paths", () => {
  const repo = "/repo/sotoapp";
  const env = { LOCALAPPDATA: "/Users/me/AppData/Local", USERPROFILE: "/Users/me" };

  assert.deepEqual(defaultDllCandidates(repo, env), [
    resolve(repo, "native/windows/bin/Release/net8.0/win-x64/publish/SotoWinNative.dll"),
    resolve(repo, "native/windows/bin/Release/net8.0/SotoWinNative.dll"),
    resolve(repo, "apps/desktop/dist/win-unpacked/resources/native/SotoWinNative.dll"),
    resolve(env.LOCALAPPDATA, "Programs", "@sotodesktop", "resources/native/SotoWinNative.dll"),
    resolve(homedir(), ".soto/native/SotoWinNative.dll"),
  ]);

  assert.equal(
    resolveDllPath({ repoRoot: repo, explicitDll: "/build/SotoWinNative.dll", env }),
    resolve("/build/SotoWinNative.dll"),
  );
});

test("Windows UIA smoke builds a quoted Notepad launch script", () => {
  const script = buildLaunchNotepadScript("C:/tmp/Soto Smoke/target's file.txt");

  assert.match(script, /Start-Process -FilePath 'notepad\.exe'/);
  assert.match(script, /C:\/tmp\/Soto Smoke\/target''s file\.txt/);
  assert.match(script, /AppActivate\(\$p\.Id\)/);
  assert.match(script, /notepad_pid=/);
});

test("Windows UIA smoke report exit code reflects timeouts and failures", () => {
  assert.equal(
    reportExitCode({
      iterations: [{ timedOut: false, failed: false }],
    }),
    0,
  );
  assert.equal(
    reportExitCode({
      memoryProbe: { exceeded: true },
      iterations: [{ timedOut: false, failed: false }],
    }),
    2,
  );
  assert.equal(
    reportExitCode({
      iterations: [{ timedOut: true, failed: false }],
    }),
    2,
  );
  assert.equal(
    reportExitCode({
      iterations: [{ timedOut: false, failed: true }],
    }),
    2,
  );
  assert.equal(
    reportExitCode({
      iterations: [
        {
          timedOut: false,
          failed: false,
          threadpoolProbe: { timedOut: true },
        },
      ],
    }),
    2,
  );
  assert.equal(
    reportExitCode({
      requireReadableCapture: true,
      iterations: [
        {
          timedOut: false,
          failed: false,
          stages: [
            {
              stage: "captureAxContext",
              result: { rc: 0, readable: false },
            },
          ],
        },
      ],
    }),
    2,
  );
  assert.equal(
    reportExitCode({
      requireReadableCapture: true,
      iterations: [
        {
          timedOut: false,
          failed: false,
          stages: [
            {
              stage: "captureAxContext",
              result: { rc: 1, readable: true },
            },
          ],
        },
      ],
    }),
    0,
  );
  assert.equal(
    reportExitCode({
      expectCaptureTimeout: true,
      iterations: [
        {
          timedOut: true,
          failed: false,
          stages: [
            {
              stage: "captureAxContext",
              timedOut: true,
            },
          ],
          threadpoolProbe: { timedOut: false },
        },
      ],
    }),
    0,
  );
  assert.equal(
    reportExitCode({
      expectCaptureTimeout: true,
      iterations: [
        {
          timedOut: false,
          failed: false,
          stages: [
            {
              stage: "captureAxContext",
              result: { rc: 1, readable: true },
            },
          ],
          threadpoolProbe: { timedOut: false },
        },
      ],
    }),
    2,
  );
});

test("Windows UIA smoke forces process exit after expected timeout artifacts", () => {
  const healthy = validHealthyReport();
  const hung = {
    ...healthy,
    expectCaptureTimeout: true,
    requireReadableCapture: false,
    iterations: [
      {
        timedOut: true,
        failed: false,
        stages: [
          { stage: "focusProbe", timedOut: false, result: 1 },
          { stage: "captureAxContext", timedOut: true },
          { stage: "captureWindowTitle", timedOut: true, skipped: true },
        ],
        threadpoolProbe: { stage: "threadpoolFsStat", timedOut: false },
      },
    ],
  };

  assert.equal(shouldForceProcessExit(healthy, 0), false);
  assert.equal(shouldForceProcessExit(hung, 0), true);
  assert.equal(shouldForceProcessExit(healthy, 2), true);
});

test("Windows UIA smoke verifies healthy, hung, and leak report artifacts", () => {
  assert.equal(typeof verifySmokeReport, "function");

  const healthy = validHealthyReport();
  const hung = validHungReport();
  const leak = {
    ...healthy,
    memoryProbe: {
      rssBeforeBytes: 1,
      rssAfterBytes: 2,
      rssGrowthBytes: 1,
      rssGrowthMb: 0,
      maxRssGrowthMb: 64,
      exceeded: false,
    },
  };

  assert.deepEqual(verifySmokeReport(withIterations(healthy, 20), "healthy"), { ok: true, errors: [] });
  assert.deepEqual(verifySmokeReport(withIterations(hung, 8), "hung"), { ok: true, errors: [] });
  assert.deepEqual(verifySmokeReport(withIterations(leak, 1000), "leak"), { ok: true, errors: [] });

  assert.deepEqual(verifySmokeReport({ ...withIterations(healthy, 20), host: { ...healthy.host, platform: "darwin" } }, "healthy"), {
    ok: false,
    errors: ["host.platform must be win32"],
  });
  assert.deepEqual(verifySmokeReport({ ...withIterations(leak, 1000), memoryProbe: { ...leak.memoryProbe, exceeded: true } }, "leak"), {
    ok: false,
    errors: ["memoryProbe.exceeded must be false"],
  });
});

test("Windows UIA smoke verification requires every capture stage and threadpool probe", () => {
  const missingStages = withIterations(validHealthyReport(), 20);
  missingStages.iterations[0] = {
    totalMs: 30,
    timedOut: false,
    failed: false,
    stages: [
      {
        stage: "captureAxContext",
        elapsedMs: 20,
        timedOut: false,
        skipped: false,
        result: { rc: 1, readable: true },
      },
    ],
    threadpoolProbe: { elapsedMs: 1, timedOut: false, skipped: false },
  };

  assert.deepEqual(verifySmokeReport(missingStages, "healthy"), {
    ok: false,
    errors: [
      "iterations[0].stages must include focusProbe",
      "iterations[0].stages must include captureWindowTitle",
      "iterations[0].threadpoolProbe.stage must be threadpoolFsStat",
    ],
  });
});

test("Windows UIA smoke verification requires iteration and stage timing metadata", () => {
  const report = withIterations(validHealthyReport(), 20);
  delete report.iterations[0].totalMs;
  delete report.iterations[0].failed;
  delete report.iterations[0].stages[1].elapsedMs;
  delete report.iterations[0].stages[1].timedOut;
  delete report.iterations[0].threadpoolProbe.elapsedMs;
  delete report.iterations[0].threadpoolProbe.timedOut;

  assert.deepEqual(verifySmokeReport(report, "healthy"), {
    ok: false,
    errors: [
      "iterations[0].totalMs must be a non-negative integer",
      "iterations[0].failed must be a boolean",
      "iterations[0].stages[1].elapsedMs must be a non-negative integer",
      "iterations[0].stages[1].timedOut must be a boolean",
      "iterations[0].threadpoolProbe.elapsedMs must be a non-negative integer",
      "iterations[0].threadpoolProbe.timedOut must be a boolean",
    ],
  });
});

test("Windows UIA smoke verification requires explicit capture mode flags", () => {
  const healthy = withIterations(validHealthyReport(), 20);
  const missingHealthyFlag = { ...healthy };
  delete missingHealthyFlag.expectCaptureTimeout;
  const hung = withIterations(validHungReport(), 8);
  const missingHungFlag = { ...hung };
  delete missingHungFlag.requireReadableCapture;

  assert.deepEqual(verifySmokeReport(missingHealthyFlag, "healthy"), {
    ok: false,
    errors: ["expectCaptureTimeout must be false"],
  });
  assert.deepEqual(verifySmokeReport(missingHungFlag, "hung"), {
    ok: false,
    errors: ["requireReadableCapture must be false"],
  });
});

test("Windows UIA smoke verification requires documented minimum iteration counts", () => {
  const healthy = validHealthyReport();
  const hung = validHungReport();
  const leak = {
    ...healthy,
    memoryProbe: {
      rssBeforeBytes: 1,
      rssAfterBytes: 2,
      rssGrowthBytes: 1,
      rssGrowthMb: 0,
      maxRssGrowthMb: 64,
      exceeded: false,
    },
  };

  assert.deepEqual(verifySmokeReport(healthy, "healthy"), {
    ok: false,
    errors: ["iterations must include at least 20 entries for healthy mode"],
  });
  assert.deepEqual(verifySmokeReport(hung, "hung"), {
    ok: false,
    errors: ["iterations must include at least 8 entries for hung mode"],
  });
  assert.deepEqual(verifySmokeReport(leak, "leak"), {
    ok: false,
    errors: ["iterations must include at least 1000 entries for leak mode"],
  });
});

test("Windows UIA smoke verification requires the documented capture deadline", () => {
  const healthy = withIterations(validHealthyReport(), 20);
  const missingDeadline = { ...healthy };
  delete missingDeadline.deadlineMs;

  assert.deepEqual(verifySmokeReport(missingDeadline, "healthy"), {
    ok: false,
    errors: ["deadlineMs must be 350"],
  });
  assert.deepEqual(verifySmokeReport({ ...healthy, deadlineMs: 1000 }, "healthy"), {
    ok: false,
    errors: ["deadlineMs must be 350"],
  });
});

test("Windows UIA smoke verification requires documented probe and leak thresholds", () => {
  const healthy = withIterations(validHealthyReport(), 20);
  const missingFsProbe = { ...healthy };
  delete missingFsProbe.fsProbeMs;
  const leak = withIterations({
    ...validHealthyReport(),
    memoryProbe: {
      rssBeforeBytes: 1,
      rssAfterBytes: 2,
      rssGrowthBytes: 1,
      rssGrowthMb: 0,
      maxRssGrowthMb: 128,
      exceeded: false,
    },
  }, 1000);

  assert.deepEqual(verifySmokeReport(missingFsProbe, "healthy"), {
    ok: false,
    errors: ["fsProbeMs must be 1000"],
  });
  assert.deepEqual(verifySmokeReport({ ...healthy, fsProbeMs: 750 }, "healthy"), {
    ok: false,
    errors: ["fsProbeMs must be 1000"],
  });
  assert.deepEqual(verifySmokeReport(leak, "leak"), {
    ok: false,
    errors: ["memoryProbe.maxRssGrowthMb must be 64"],
  });
});

test("Windows UIA smoke verification requires the workspace Node engine range", () => {
  const healthy = withIterations(validHealthyReport(), 20);

  assert.deepEqual(verifySmokeReport({
    ...healthy,
    host: { ...healthy.host, nodeVersion: "26.0.0" },
  }, "healthy"), {
    ok: false,
    errors: ["host.nodeVersion must be >=24.16.0 <25"],
  });
  assert.deepEqual(verifySmokeReport({
    ...healthy,
    host: { ...healthy.host, nodeVersion: "24.15.0" },
  }, "healthy"), {
    ok: false,
    errors: ["host.nodeVersion must be >=24.16.0 <25"],
  });
});

test("Windows UIA smoke verification rejects raw text fields in saved artifacts", () => {
  const report = withIterations(validHealthyReport(), 20);
  report.iterations[0] = {
    ...report.iterations[0],
    stages: report.iterations[0].stages.map((stage) => {
      if (stage.stage === "captureAxContext") {
        return {
          ...stage,
          result: {
            ...stage.result,
            full_text: "sensitive document body",
            before: "sensitive prefix",
          },
        };
      }
      if (stage.stage === "captureWindowTitle") {
        return {
          ...stage,
          result: {
            ...stage.result,
            windowTitle: "sensitive window title",
          },
        };
      }
      return stage;
    }),
  };

  assert.deepEqual(verifySmokeReport(report, "healthy"), {
    ok: false,
    errors: [
      "iterations[0].stages[1].result.full_text must not include raw text content",
      "iterations[0].stages[1].result.before must not include raw text content",
      "iterations[0].stages[2].result.windowTitle must not include raw text content",
    ],
  });
});

test("Windows UIA smoke verification rejects hidden stage errors in saved artifacts", () => {
  const report = withIterations(validHealthyReport(), 20);
  report.iterations[0] = {
    ...report.iterations[0],
    stages: report.iterations[0].stages.map((stage) => {
      if (stage.stage !== "captureAxContext") return stage;
      return {
        ...stage,
        error: { name: "Error", messageChars: 24 },
      };
    }),
  };

  assert.deepEqual(verifySmokeReport(report, "healthy"), {
    ok: false,
    errors: ["iterations[0].stages[1].error must be absent"],
  });
});

test("Windows UIA smoke memory probe compares raw byte growth against the threshold", () => {
  const probe = memoryProbeFor({
    rssBeforeBytes: 0,
    rssAfterBytes: 64 * 1024 * 1024 + 1,
    maxRssGrowthMb: 64,
  });

  assert.equal(probe.rssGrowthMb, 64);
  assert.equal(probe.exceeded, true);
});

test("Windows UIA smoke detects readable AX capture and capture timeouts by stage metadata", () => {
  assert.equal(
    captureAxReadable({
      stages: [
        {
          stage: "captureAxContext",
          result: { rc: 1, readable: true },
        },
      ],
    }),
    true,
  );
  assert.equal(
    captureAxReadable({
      stages: [
        {
          stage: "captureAxContext",
          result: { rc: 0, readable: false },
        },
      ],
    }),
    false,
  );
  assert.equal(
    captureStageTimedOut({
      stages: [
        {
          stage: "captureAxContext",
          timedOut: true,
        },
      ],
    }),
    true,
  );
  assert.equal(
    captureStageTimedOut({
      stages: [
        {
          stage: "captureAxContext",
          timedOut: false,
        },
      ],
    }),
    false,
  );
});

test("Windows UIA smoke human report contains only metadata summaries", () => {
  const report = {
    dll: "C:/repo/SotoWinNative.dll",
    deadlineMs: 350,
    fsProbeMs: 750,
    host: {
      platform: "win32",
      arch: "x64",
      nodeVersion: "24.16.0",
      uvThreadpoolSize: "default",
    },
    requireReadableCapture: true,
    expectCaptureTimeout: false,
    memoryProbe: {
      rssBeforeBytes: 100 * 1024 * 1024,
      rssAfterBytes: 140 * 1024 * 1024,
      rssGrowthBytes: 40 * 1024 * 1024,
      rssGrowthMb: 40,
      maxRssGrowthMb: 64,
      exceeded: false,
    },
    iterations: [
      {
        totalMs: 30,
        timedOut: false,
        failed: false,
        stages: [
          {
            stage: "captureAxContext",
            elapsedMs: 20,
            timedOut: false,
            skipped: false,
            result: {
              rc: 1,
              readable: true,
              textChars: 11,
              beforeChars: 3,
              afterChars: 4,
              selectionStart: 0,
              selectionEnd: 5,
              role: "TextPattern",
              focusedElementIdChars: 8,
            },
          },
        ],
        threadpoolProbe: {
          stage: "threadpoolFsStat",
          elapsedMs: 1,
          timedOut: false,
          skipped: false,
          result: { file: "SotoWinNative.dll", sizeBytes: 12345 },
        },
      },
    ],
  };

  const output = formatHumanReport(report);

  assert.match(output, /stage=captureAxContext/);
  assert.match(output, /stage=threadpoolFsStat/);
  assert.match(output, /require_readable_capture=true/);
  assert.match(output, /expect_capture_timeout=false/);
  assert.match(output, /host_platform=win32/);
  assert.match(output, /host_arch=x64/);
  assert.match(output, /node_version=24\.16\.0/);
  assert.match(output, /uv_threadpool_size=default/);
  assert.match(output, /rss_growth_mb=40/);
  assert.match(output, /max_rss_growth_mb=64/);
  assert.match(output, /rss_growth_exceeded=false/);
  assert.match(output, /capture_readable=true/);
  assert.match(output, /"textChars":11/);
  assert.match(output, /"sizeBytes":12345/);
  assert.doesNotMatch(output, /hello world/);
});

test("Windows UIA smoke human report sanitizes error messages", () => {
  const report = {
    dll: "C:/repo/SotoWinNative.dll",
    deadlineMs: 350,
    fsProbeMs: 1000,
    requireReadableCapture: true,
    expectCaptureTimeout: false,
    iterations: [
      {
        totalMs: 30,
        timedOut: false,
        failed: true,
        stages: [
          {
            stage: "captureAxContext",
            elapsedMs: 20,
            timedOut: false,
            skipped: false,
            error: "sensitive selected text",
          },
        ],
        threadpoolProbe: {
          stage: "threadpoolFsStat",
          elapsedMs: 1,
          timedOut: false,
          skipped: false,
          error: "sensitive window title",
        },
      },
    ],
  };

  const output = formatHumanReport(report);

  assert.match(output, /"messageChars":23/);
  assert.match(output, /"messageChars":22/);
  assert.doesNotMatch(output, /sensitive selected text/);
  assert.doesNotMatch(output, /sensitive window title/);
});

function validHealthyReport() {
  return {
    deadlineMs: 350,
    fsProbeMs: 1000,
    host: {
      platform: "win32",
      arch: "x64",
      nodeVersion: "24.16.0",
      uvThreadpoolSize: "default",
    },
    requireReadableCapture: true,
    expectCaptureTimeout: false,
    iterations: [
      {
        totalMs: 30,
        timedOut: false,
        failed: false,
        stages: [
          { stage: "focusProbe", elapsedMs: 1, timedOut: false, skipped: false, result: 1 },
          {
            stage: "captureAxContext",
            elapsedMs: 20,
            timedOut: false,
            skipped: false,
            result: { rc: 1, readable: true },
          },
          {
            stage: "captureWindowTitle",
            elapsedMs: 2,
            timedOut: false,
            skipped: false,
            result: { available: true, titleChars: 3 },
          },
        ],
        threadpoolProbe: { stage: "threadpoolFsStat", elapsedMs: 1, timedOut: false, skipped: false },
      },
    ],
  };
}

function validHungReport() {
  return {
    ...validHealthyReport(),
    requireReadableCapture: false,
    expectCaptureTimeout: true,
    iterations: [
      {
        totalMs: 350,
        timedOut: true,
        failed: false,
        stages: [
          { stage: "focusProbe", elapsedMs: 1, timedOut: false, skipped: false, result: 1 },
          { stage: "captureAxContext", elapsedMs: 349, timedOut: true, skipped: false },
          { stage: "captureWindowTitle", elapsedMs: 0, timedOut: true, skipped: true },
        ],
        threadpoolProbe: { stage: "threadpoolFsStat", elapsedMs: 1, timedOut: false, skipped: false },
      },
    ],
  };
}

function withIterations(report, count) {
  return {
    ...report,
    iterations: Array.from({ length: count }, () => structuredClone(report.iterations[0])),
  };
}
