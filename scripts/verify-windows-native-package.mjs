#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { builtinModules } from "node:module";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

const REQUIRED_PACKAGED_PATH_PARTS = ["resources", "native", "SotoWinNative.dll"];
const MAIN_BUNDLE_PATH = "apps/desktop/out/main/index.js";
const WINDOWS_SMOKE_PACKAGE_OUTPUT_DIR = "dist/smoke-win-package";
const WINDOWS_PACKAGED_APP_PATHS = [
  `apps/desktop/${WINDOWS_SMOKE_PACKAGE_OUTPUT_DIR}/win-unpacked`,
  "apps/desktop/dist/win-unpacked",
];
const WINDOWS_INSTALL_DIR_NAME = "Soto";
const WINDOWS_EXE_NAME = "Soto.exe";
const NODE_RUNTIME_SPECIFIERS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);
const NON_PACKAGE_RUNTIME_SPECIFIERS = new Set(["electron"]);
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

function usage() {
  return `Usage:
  pnpm smoke:package:win [--verify-only] [--reload]

Builds the Windows Native AOT DLL, packages the Electron app into
apps/desktop/${WINDOWS_SMOKE_PACKAGE_OUTPUT_DIR}, then verifies
the staged DLL, required soto_win_* exports, and app.asar runtime dependencies:
  dotnet publish native/windows/SotoWinNative.csproj -c Release -r win-x64 --self-contained -p:PublishAot=true
  pnpm --filter @soto/desktop run rebuild:electron
  pnpm --filter @soto/desktop exec electron-vite build
  pnpm --filter @soto/desktop exec electron-builder --win --x64 -c.directories.output=${WINDOWS_SMOKE_PACKAGE_OUTPUT_DIR}

Use --verify-only after a manual package build to skip the build steps.
With --reload, after verification passes the script copies the smoke
win-unpacked directory over the local per-user install, stops any running
Soto.exe, then launches it with SOTO_LOG_PROFILE=smoke. Reload never runs when
verification fails.
`;
}

export function parseCliArgs(argv) {
  const parsed = {
    help: false,
    verifyOnly: false,
    reload: false,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--verify-only") {
      parsed.verifyOnly = true;
    } else if (arg === "--reload") {
      parsed.reload = true;
    } else {
      throw new Error(`Unknown script argument ${arg}`);
    }
  }

  return parsed;
}

function assertSupportedBuildHost(platform = process.platform, arch = process.arch) {
  if (platform !== "win32" || arch !== "x64") {
    throw new Error("Windows package smoke must run on Windows x64.");
  }
}

function runStep(command, args, options = {}) {
  const result = (options.runCommand ?? spawnSync)(command, args, {
    cwd: options.cwd,
    stdio: options.stdio ?? "inherit",
    encoding: options.encoding,
  });

  if (result.error) throw result.error;
  return result;
}

function requireOk(result, label) {
  if ((result.status ?? 1) === 0) return;
  const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  throw new Error(`${label} failed${detail ? `:\n${detail}` : ""}`);
}

function requireFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${label} not found: ${path}`);
  }
}

function requireDirectory(path, label) {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`${label} not found: ${path}`);
  }
}

function publishWindowsNative(repoRoot, runCommand) {
  requireOk(
    runStep("dotnet", WINDOWS_NATIVE_PUBLISH_ARGS, {
      cwd: repoRoot,
      runCommand,
    }),
    "dotnet publish",
  );
}

function pnpmInvocation(args, platform = process.platform) {
  if (platform === "win32") {
    return ["cmd.exe", ["/d", "/s", "/c", ["pnpm", ...args].join(" ")]];
  }
  return ["pnpm", args];
}

function buildDesktopPackage(repoRoot, runCommand, platform) {
  const steps = [
    {
      label: "pnpm --filter @soto/desktop run rebuild:electron",
      args: ["--filter", "@soto/desktop", "run", "rebuild:electron"],
    },
    {
      label: "pnpm --filter @soto/desktop exec electron-vite build",
      args: ["--filter", "@soto/desktop", "exec", "electron-vite", "build"],
    },
    {
      label: "pnpm --filter @soto/desktop exec electron-builder",
      args: [
        "--filter",
        "@soto/desktop",
        "exec",
        "electron-builder",
        "--win",
        "--x64",
        `-c.directories.output=${WINDOWS_SMOKE_PACKAGE_OUTPUT_DIR}`,
      ],
    },
  ];

  for (const step of steps) {
    const [command, args] = pnpmInvocation(step.args, platform);
    requireOk(
      runStep(command, args, {
        cwd: repoRoot,
        runCommand,
      }),
      step.label,
    );
  }
}

function requireRobocopyOk(result, label) {
  const status = result.status ?? 1;
  if (status >= 0 && status < 8) return;
  const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  throw new Error(`${label} failed${detail ? `:\n${detail}` : ""}`);
}

function powershellSingleQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function defaultWindowsInstallDir(env = process.env) {
  const localAppData = env.LOCALAPPDATA ?? resolve(env.USERPROFILE ?? "", "AppData/Local");
  return resolve(localAppData, "Programs", WINDOWS_INSTALL_DIR_NAME);
}

export function installAndLaunchWindows({
  repoRoot,
  installDir = defaultWindowsInstallDir(),
  runCommand = spawnSync,
  stdout = process.stdout,
} = {}) {
  const packagedAppDir = findPackagedAppDir(repoRoot);
  if (!packagedAppDir) {
    throw new Error("Packaged Windows app directory not found under apps/desktop/dist");
  }
  requireDirectory(packagedAppDir, "Packaged Windows app directory");
  requireFile(resolve(packagedAppDir, WINDOWS_EXE_NAME), "Packaged Windows app executable");

  const installedExe = resolve(installDir, WINDOWS_EXE_NAME);
  stdout?.write(`Reinstalling Soto into ${installDir} and launching...\n`);

  runStep("taskkill", ["/IM", WINDOWS_EXE_NAME, "/F", "/T"], {
    runCommand,
    stdio: "ignore",
  });

  requireRobocopyOk(
    runStep("robocopy", [packagedAppDir, installDir, "/E"], {
      runCommand,
      stdio: "pipe",
      encoding: "utf8",
    }),
    `robocopy ${packagedAppDir} ${installDir}`,
  );

  const launchScript = [
    "$env:SOTO_LOG_PROFILE = 'smoke'",
    `Start-Process -FilePath ${powershellSingleQuote(installedExe)}`,
  ].join("; ");
  requireOk(
    runStep("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", launchScript], {
      runCommand,
    }),
    `Start-Process ${installedExe}`,
  );

  return installedExe;
}

function readCString(buffer, offset) {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) end += 1;
  return buffer.toString("ascii", offset, end);
}

function readSectionHeaders(buffer, peOffset, sectionCount, optionalHeaderSize) {
  const headers = [];
  const base = peOffset + 24 + optionalHeaderSize;
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = base + index * 40;
    headers.push({
      virtualSize: buffer.readUInt32LE(offset + 8),
      virtualAddress: buffer.readUInt32LE(offset + 12),
      rawSize: buffer.readUInt32LE(offset + 16),
      rawPointer: buffer.readUInt32LE(offset + 20),
    });
  }
  return headers;
}

function rvaToOffset(rva, sections) {
  for (const section of sections) {
    const span = Math.max(section.virtualSize, section.rawSize);
    if (rva >= section.virtualAddress && rva < section.virtualAddress + span) {
      return section.rawPointer + (rva - section.virtualAddress);
    }
  }
  return rva;
}

export function exportedPeSymbols(dllPath) {
  const buffer = readFileSync(dllPath);
  if (buffer.toString("ascii", 0, 2) !== "MZ") {
    throw new Error(`${dllPath} is not a PE file`);
  }

  const peOffset = buffer.readUInt32LE(0x3c);
  if (buffer.toString("ascii", peOffset, peOffset + 4) !== "PE\u0000\u0000") {
    throw new Error(`${dllPath} is missing the PE signature`);
  }

  const sectionCount = buffer.readUInt16LE(peOffset + 6);
  const optionalHeaderSize = buffer.readUInt16LE(peOffset + 20);
  const optionalOffset = peOffset + 24;
  const magic = buffer.readUInt16LE(optionalOffset);
  const dataDirectoryOffset = magic === 0x20b ? optionalOffset + 112 : optionalOffset + 96;
  const exportTableRva = buffer.readUInt32LE(dataDirectoryOffset);
  if (exportTableRva === 0) {
    return [];
  }

  const sections = readSectionHeaders(buffer, peOffset, sectionCount, optionalHeaderSize);
  const exportOffset = rvaToOffset(exportTableRva, sections);
  const numberOfNames = buffer.readUInt32LE(exportOffset + 24);
  const addressOfNamesRva = buffer.readUInt32LE(exportOffset + 32);
  const namesOffset = rvaToOffset(addressOfNamesRva, sections);
  const symbols = [];

  for (let index = 0; index < numberOfNames; index += 1) {
    const nameRva = buffer.readUInt32LE(namesOffset + index * 4);
    symbols.push(readCString(buffer, rvaToOffset(nameRva, sections)));
  }

  return symbols.sort();
}

export function windowsAbiSymbols(koffiAbiPath) {
  const text = readFileSync(koffiAbiPath, "utf8");
  return Array.from(new Set(text.match(/\bsoto_win_[A-Za-z0-9_]+/g) ?? [])).sort();
}

function packagedAppCandidates(repoRoot, relativePath) {
  return WINDOWS_PACKAGED_APP_PATHS.map((appPath) => resolve(repoRoot, appPath, relativePath));
}

function findPackagedAppDir(repoRoot) {
  for (const candidate of WINDOWS_PACKAGED_APP_PATHS.map((path) => resolve(repoRoot, path))) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

function findPackagedDll(repoRoot) {
  const searchRoots = [
    ...packagedAppCandidates(repoRoot, "resources/native/SotoWinNative.dll"),
    resolve(repoRoot, "apps/desktop/dist/resources/native/SotoWinNative.dll"),
  ];
  for (const candidate of searchRoots) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

function findPackagedAsar(repoRoot) {
  const searchRoots = [
    ...packagedAppCandidates(repoRoot, "resources/app.asar"),
    resolve(repoRoot, "apps/desktop/dist/resources/app.asar"),
  ];
  for (const candidate of searchRoots) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

function pathHasPackagedShape(path) {
  const normalized = path.replace(/\\/g, "/").split("/");
  return REQUIRED_PACKAGED_PATH_PARTS.every((part, index) => {
    const actual = normalized[normalized.length - REQUIRED_PACKAGED_PATH_PARTS.length + index];
    return actual === part;
  });
}

function packageNameForRuntimeSpecifier(specifier) {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("\\") ||
    NODE_RUNTIME_SPECIFIERS.has(specifier) ||
    NON_PACKAGE_RUNTIME_SPECIFIERS.has(specifier)
  ) {
    return null;
  }

  const parts = specifier.split("/");
  if (specifier.startsWith("@")) {
    if (parts.length < 2) return null;
    return `${parts[0]}/${parts[1]}`;
  }

  return parts[0] ?? null;
}

export function externalRuntimeDependencies(bundleText) {
  const dependencies = new Set();
  const requirePattern = /\brequire\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of bundleText.matchAll(requirePattern)) {
    const dependency = packageNameForRuntimeSpecifier(match[1]);
    if (dependency !== null) dependencies.add(dependency);
  }

  return [...dependencies].sort();
}

function normalizeAsarPath(path) {
  const normalized = path.replace(/\\/g, "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

export function missingPackagedRuntimeDependencies(bundleText, asarPaths) {
  const normalizedPaths = asarPaths.map(normalizeAsarPath);
  return externalRuntimeDependencies(bundleText).filter((dependency) => {
    const packageRoot = `/node_modules/${dependency}/`;
    return !normalizedPaths.some(
      (path) => path === `${packageRoot}package.json` || path.startsWith(packageRoot),
    );
  });
}

function readFully(fd, buffer, label) {
  let offset = 0;
  while (offset < buffer.length) {
    const bytesRead = readSync(fd, buffer, offset, buffer.length - offset, null);
    if (bytesRead === 0) {
      throw new Error(`Unable to read ${label}`);
    }
    offset += bytesRead;
  }
}

function readAsarHeader(archivePath) {
  const fd = openSync(archivePath, "r");
  try {
    const sizePickle = Buffer.alloc(8);
    readFully(fd, sizePickle, "asar header size");
    const headerSize = sizePickle.readUInt32LE(4);
    const headerPickle = Buffer.alloc(headerSize);
    readFully(fd, headerPickle, "asar header");
    const headerStringSize = headerPickle.readUInt32LE(4);
    const headerString = headerPickle.subarray(8, 8 + headerStringSize).toString("utf8");
    return JSON.parse(headerString);
  } finally {
    closeSync(fd);
  }
}

export function listAsarPackagePaths(archivePath) {
  const paths = [];
  const header = readAsarHeader(archivePath);
  const visit = (files, parentPath) => {
    for (const [name, entry] of Object.entries(files ?? {})) {
      const path = `${parentPath}\\${name}`;
      paths.push(path);
      if (entry && typeof entry === "object" && entry.files) {
        visit(entry.files, path);
      }
    }
  };

  visit(header.files, "");
  return paths;
}

function verifyPackagedRuntimeDependencies(repoRoot) {
  const mainBundle = resolve(repoRoot, MAIN_BUNDLE_PATH);
  requireFile(mainBundle, "Built main bundle");

  const packagedAsar = findPackagedAsar(repoRoot);
  if (!packagedAsar) {
    throw new Error("Packaged app.asar was not found under apps/desktop/dist");
  }
  requireFile(packagedAsar, "Packaged app.asar");

  const bundleText = readFileSync(mainBundle, "utf8");
  const dependencies = externalRuntimeDependencies(bundleText);
  const missing = missingPackagedRuntimeDependencies(bundleText, listAsarPackagePaths(packagedAsar));
  if (missing.length > 0) {
    throw new Error(
      `Packaged app.asar is missing main-process runtime dependencies: ${missing.join(", ")}`,
    );
  }

  return { dependencies, packagedAsar };
}

export function main(argv = process.argv.slice(2), context = {}) {
  const stdout = context.stdout ?? process.stdout;
  const stderr = context.stderr ?? process.stderr;
  const repoRoot = context.repoRoot ?? resolve(import.meta.dirname, "..");
  const platform = context.platform ?? process.platform;
  const arch = context.arch ?? process.arch;
  const runCommand = context.runCommand ?? spawnSync;

  try {
    const args = parseCliArgs(argv);
    if (args.help) {
      stdout.write(usage());
      return 0;
    }

    if (!args.verifyOnly || args.reload) {
      assertSupportedBuildHost(platform, arch);
    }

    if (!args.verifyOnly) {
      publishWindowsNative(repoRoot, runCommand);
      buildDesktopPackage(repoRoot, runCommand, platform);
    }

    const publishDll = resolve(
      repoRoot,
      "native/windows/bin/Release/net8.0/win-x64/publish/SotoWinNative.dll",
    );
    requireFile(publishDll, "Native AOT publish DLL");

    const packagedDll = findPackagedDll(repoRoot);
    if (!packagedDll) {
      throw new Error("Packaged SotoWinNative.dll was not found under apps/desktop/dist");
    }
    requireFile(packagedDll, "Packaged Windows native DLL");
    if (!pathHasPackagedShape(packagedDll)) {
      throw new Error(`Packaged DLL must be under resources/native: ${packagedDll}`);
    }

    const requiredSymbols = windowsAbiSymbols(resolve(repoRoot, "packages/native-bridge/src/koffiAbi.ts"));
    const publishSymbols = exportedPeSymbols(publishDll);
    const packagedSymbols = exportedPeSymbols(packagedDll);
    const missing = requiredSymbols.filter((symbol) => !publishSymbols.includes(symbol));
    if (missing.length > 0) {
      throw new Error(`Native AOT DLL is missing required exports: ${missing.join(", ")}`);
    }
    const packagedMissing = requiredSymbols.filter((symbol) => !packagedSymbols.includes(symbol));
    if (packagedMissing.length > 0) {
      throw new Error(`Packaged DLL is missing required exports: ${packagedMissing.join(", ")}`);
    }
    const runtime = verifyPackagedRuntimeDependencies(repoRoot);
    const installedExe = args.reload
      ? installAndLaunchWindows({ repoRoot, runCommand, stdout })
      : null;

    stdout.write("Windows native package smoke passed:\n");
    stdout.write(`  publish: ${publishDll}\n`);
    stdout.write(`  packaged: ${packagedDll}\n`);
    stdout.write(`  exports: ${requiredSymbols.length} soto_win_* symbols\n`);
    stdout.write(`  app.asar: ${runtime.packagedAsar}\n`);
    stdout.write(`  runtime deps: ${runtime.dependencies.length} main-process packages\n`);
    if (installedExe) stdout.write(`  installed: ${installedExe} (launched)\n`);
    return 0;
  } catch (error) {
    stderr.write(`Windows native package smoke failed: ${error.message}\n`);
    return 1;
  }
}

if (basename(process.argv[1] ?? "") === basename(import.meta.filename)) {
  process.exitCode = main();
}
