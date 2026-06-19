export interface AppIdentity {
  bundleId?: string | null;
  executableName?: string | null;
  appName?: string | null;
  windowTitle?: string | null;
  webDomain?: string | null;
  axRole?: string | null;
}

export interface AppProfile {
  registerHint?: "code" | "formal" | "casual" | "neutral";
  punctuationStyle?: "light" | "standard";
  structuredBias?: boolean;
  inputSurface?:
    | "code_editor"
    | "document"
    | "chat"
    | "browser"
    | "terminal"
    | "unknown";
  contextPolicy?: {
    includeBeforeAfter?: boolean;
    preferSelection?: boolean;
    preserveLineBreaks?: boolean;
  };
}

export interface AppProfileRule {
  match: {
    bundleIds?: readonly string[];
    domains?: readonly string[];
    executableNames?: readonly string[];
    titlePatterns?: readonly string[];
  };
  profile: AppProfile;
}

export const DEFAULT_APP_PROFILE_RULES: readonly AppProfileRule[] = [
  {
    match: {
      bundleIds: [
        "com.apple.Terminal",
        "com.googlecode.iterm2",
        "dev.warp.Warp-Stable",
        "com.microsoft.VSCode",
        "com.todesktop.230313mzl4w4u92",
        "com.jetbrains.intellij",
      ],
      titlePatterns: ["Terminal", "Visual Studio Code", "Cursor", "IntelliJ"],
    },
    profile: { registerHint: "code", punctuationStyle: "light" },
  },
  {
    match: {
      bundleIds: ["com.apple.mail", "notion.id", "com.apple.iWork.Pages"],
      domains: ["docs.google.com", "mail.google.com", "notion.so"],
    },
    profile: {
      registerHint: "formal",
      punctuationStyle: "standard",
      structuredBias: true,
    },
  },
  {
    match: {
      bundleIds: [
        "com.tinyspeck.slackmacgap",
        "com.microsoft.teams2",
        "com.tencent.xinWeChat",
        "ru.keepcoder.Telegram",
        "com.apple.MobileSMS",
      ],
      domains: ["slack.com", "web.telegram.org", "teams.microsoft.com"],
    },
    profile: { registerHint: "casual", punctuationStyle: "light" },
  },
];

function matchesDomain(value: string | null | undefined, candidate: string): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  const rule = candidate.toLowerCase();
  return normalized === rule || normalized.endsWith(`.${rule}`);
}

function matchesExecutableName(
  value: string | null | undefined,
  candidate: string,
): boolean {
  if (!value) return false;
  return value.toLowerCase() === candidate.toLowerCase();
}

function matchesTitlePattern(
  value: string | null | undefined,
  pattern: string,
): boolean {
  if (value === null || value === undefined) return false;
  try {
    return new RegExp(pattern, "i").test(value);
  } catch {
    return value.toLowerCase().includes(pattern.toLowerCase());
  }
}

function firstProfileMatching(
  rules: readonly AppProfileRule[],
  predicate: (rule: AppProfileRule) => boolean,
): AppProfile | undefined {
  const rule = rules.find(predicate);
  return rule === undefined ? undefined : { ...rule.profile };
}

function profileByBundleId(
  identity: AppIdentity,
  rules: readonly AppProfileRule[],
): AppProfile | undefined {
  const bundleId = identity.bundleId ?? null;
  if (bundleId === null) return undefined;
  return firstProfileMatching(
    rules,
    (rule) => rule.match.bundleIds?.includes(bundleId) ?? false,
  );
}

function profileByDomain(
  identity: AppIdentity,
  rules: readonly AppProfileRule[],
): AppProfile | undefined {
  const domain = identity.webDomain ?? null;
  if (domain === null) return undefined;
  return firstProfileMatching(
    rules,
    (rule) =>
      rule.match.domains?.some((candidate) =>
        matchesDomain(domain, candidate),
      ) ?? false,
  );
}

function profileByExecutableName(
  identity: AppIdentity,
  rules: readonly AppProfileRule[],
): AppProfile | undefined {
  const executableName = identity.executableName ?? null;
  if (executableName === null) return undefined;
  return firstProfileMatching(
    rules,
    (rule) =>
      rule.match.executableNames?.some((candidate) =>
        matchesExecutableName(executableName, candidate),
      ) ?? false,
  );
}

function profileByTitle(
  identity: AppIdentity,
  rules: readonly AppProfileRule[],
): AppProfile | undefined {
  const title = identity.windowTitle ?? identity.appName ?? null;
  if (title === null) return undefined;
  return firstProfileMatching(
    rules,
    (rule) =>
      rule.match.titlePatterns?.some((pattern) =>
        matchesTitlePattern(title, pattern),
      ) ?? false,
  );
}

export function resolveAppProfile(
  identity: AppIdentity,
  rules: readonly AppProfileRule[] = DEFAULT_APP_PROFILE_RULES,
): AppProfile | undefined {
  return (
    profileByBundleId(identity, rules) ??
    profileByDomain(identity, rules) ??
    profileByExecutableName(identity, rules) ??
    profileByTitle(identity, rules)
  );
}
