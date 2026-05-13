const R2_ROOT = "https://soto-installer.sotoapp.org";

function normalize(version: string): string {
  return version.replace(/^v/, "");
}

export function dmgFileNameFor(version: string): string {
  return `Soto_${normalize(version)}_darwin_aarch64.dmg`;
}

export function dmgUrlFor(version: string): string {
  const v = normalize(version);
  return `${R2_ROOT}/artifacts/${v}/darwin-aarch64/${dmgFileNameFor(v)}`;
}
