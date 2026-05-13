#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const version = process.env.VERSION;
if (!version) {
  console.error("VERSION env var is required");
  process.exitCode = 1;
  process.exit();
}

const baseUrl = "https://soto-installer.sotoapp.org/artifacts";

function readSig(path) {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}

const platforms = {};

const darwinSig = readSig(`artifacts-darwin/Soto_${version}_darwin_aarch64.app.tar.gz.sig`);
if (darwinSig) {
  const platform = "darwin-aarch64";
  platforms["darwin-aarch64"] = {
    url: `${baseUrl}/${version}/${platform}/Soto_${version}_darwin_aarch64.app.tar.gz`,
    signature: darwinSig
  };
}

const windowsSig = readSig(`artifacts-windows/Soto_${version}_windows_x86_64-setup.exe.sig`);
if (windowsSig) {
  const platform = "windows-x86_64";
  platforms["windows-x86_64"] = {
    url: `${baseUrl}/${version}/${platform}/Soto_${version}_windows_x86_64-setup.exe`,
    signature: windowsSig
  };
}

if (Object.keys(platforms).length === 0) {
  console.error("No platform artifact signatures found; check artifact download paths.");
  process.exitCode = 1;
  process.exit();
}

const latest = {
  version,
  notes: `Soto ${version}`,
  pub_date: new Date().toISOString(),
  platforms
};

writeFileSync("latest.json", JSON.stringify(latest, null, 2));
console.log("Generated latest.json:\n", JSON.stringify(latest, null, 2));
