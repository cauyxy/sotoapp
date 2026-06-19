import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogProfile = "dev" | "smoke" | "release";
export type LogFieldValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogFieldValue>;

export interface ConsoleLike {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface MainLogConfig {
  profile: LogProfile;
  minLevel: LogLevel;
  scopes: Set<string> | null;
  fileEnabled: boolean;
  maxFileBytes: number;
}

export interface MainLoggerOptions {
  userDataPath: string;
  isPackaged: boolean;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  console?: ConsoleLike;
  maxFileBytes?: number;
}

export interface ResolveMainLogConfigOptions {
  isPackaged: boolean;
  env?: Record<string, string | undefined>;
  maxFileBytes?: number;
}

export interface ScopedLogger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  line(level: LogLevel, message: string): void;
}

export interface MainLogger {
  readonly config: MainLogConfig;
  readonly filePath: string;
  scope(scope: string): ScopedLogger;
  log(level: LogLevel, scope: string, event: string, fields?: LogFields): void;
  line(level: LogLevel, scope: string, message: string): void;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const LOG_FILE_RELATIVE_PATH = join("logs", "soto-main.log");

export function resolveMainLogConfig(
  options: ResolveMainLogConfigOptions,
): MainLogConfig {
  const env = options.env ?? process.env;
  const profile = parseProfile(env["SOTO_LOG_PROFILE"]) ?? defaultProfile(options.isPackaged);
  const profileLevel = profile === "release" ? "info" : "debug";
  const minLevel = parseLevel(env["SOTO_LOG_LEVEL"]) ?? profileLevel;
  return {
    profile,
    minLevel,
    scopes: parseScopes(env["SOTO_LOG_SCOPES"]),
    fileEnabled: env["SOTO_LOG_FILE"] !== "0",
    maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
  };
}

export function createMainLogger(options: MainLoggerOptions): MainLogger {
  const consoleSink = options.console ?? console;
  const now = options.now ?? (() => new Date());
  const config = resolveMainLogConfig({
    isPackaged: options.isPackaged,
    env: options.env,
    maxFileBytes: options.maxFileBytes,
  });
  const filePath = join(options.userDataPath, LOG_FILE_RELATIVE_PATH);

  const write = (level: LogLevel, scope: string, body: string): void => {
    if (!shouldLog(config, level, scope)) return;
    const line = `${now().toISOString()} ${level.toUpperCase()} ${sanitizeToken(
      scope,
    )} ${body}`;
    writeConsole(consoleSink, level, line);
    if (config.fileEnabled) writeFileLine(filePath, line, config.maxFileBytes, consoleSink);
  };

  const logger: MainLogger = {
    config,
    filePath,
    scope(scope) {
      return {
        debug: (event, fields) => logger.log("debug", scope, event, fields),
        info: (event, fields) => logger.log("info", scope, event, fields),
        warn: (event, fields) => logger.log("warn", scope, event, fields),
        error: (event, fields) => logger.log("error", scope, event, fields),
        line: (level, message) => logger.line(level, scope, message),
      };
    },
    log(level, scope, event, fields) {
      const body = fields === undefined ? sanitizeMessage(event) : formatEvent(event, fields);
      write(level, scope, body);
    },
    line(level, scope, message) {
      write(level, scope, sanitizeMessage(message));
    },
  };

  return logger;
}

function defaultProfile(isPackaged: boolean): LogProfile {
  return isPackaged ? "release" : "dev";
}

function parseProfile(value: string | undefined): LogProfile | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "dev" || normalized === "development") return "dev";
  if (normalized === "smoke") return "smoke";
  if (normalized === "release" || normalized === "prod" || normalized === "production") {
    return "release";
  }
  return null;
}

function parseLevel(value: string | undefined): LogLevel | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "debug" ||
    normalized === "info" ||
    normalized === "warn" ||
    normalized === "error"
  ) {
    return normalized;
  }
  return null;
}

function parseScopes(value: string | undefined): Set<string> | null {
  if (value === undefined || value.trim().length === 0) return null;
  const scopes = value
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
  return scopes.length > 0 ? new Set(scopes) : null;
}

function shouldLog(config: MainLogConfig, level: LogLevel, scope: string): boolean {
  if (LEVEL_RANK[level] < LEVEL_RANK[config.minLevel]) return false;
  return config.scopes === null || config.scopes.has(scope);
}

function formatEvent(event: string, fields: LogFields): string {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    pairs.push(`${sanitizeToken(key)}=${formatValue(value)}`);
  }
  return [sanitizeMessage(event), ...pairs].join(" ");
}

function formatValue(value: Exclude<LogFieldValue, undefined>): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return /^[A-Za-z0-9._:/@+-]+$/.test(value) ? value : JSON.stringify(value);
}

function sanitizeToken(value: string): string {
  return value.replace(/[^A-Za-z0-9_.:-]+/g, "_") || "unknown";
}

function sanitizeMessage(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function writeConsole(sink: ConsoleLike, level: LogLevel, line: string): void {
  sink[level](line);
}

function writeFileLine(
  filePath: string,
  line: string,
  maxFileBytes: number,
  consoleSink: ConsoleLike,
): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    rotateIfNeeded(filePath, maxFileBytes);
    appendFileSync(filePath, `${line}\n`, "utf8");
  } catch (error) {
    consoleSink.warn(`[main] diagnostic log write failed: ${(error as Error).message}`);
  }
}

function rotateIfNeeded(filePath: string, maxFileBytes: number): void {
  if (maxFileBytes <= 0 || !existsSync(filePath)) return;
  if (statSync(filePath).size < maxFileBytes) return;
  const previous = `${filePath}.1`;
  rmSync(previous, { force: true });
  renameSync(filePath, previous);
}
