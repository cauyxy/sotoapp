export type DetectedPlatform = "darwin" | "windows" | "unknown";

export function detectPlatform(userAgent: string): DetectedPlatform {
  if (!userAgent) return "unknown";
  if (/Mac OS X|Macintosh/i.test(userAgent)) return "darwin";
  if (/Windows NT/i.test(userAgent)) return "windows";
  return "unknown";
}
