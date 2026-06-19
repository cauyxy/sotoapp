import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const srcSvg = resolve(repoRoot, "images/soto-mark-mono.svg");
const outDir = resolve(here, "../src/renderer/public/tray");

const BLACK = "#000000";
const TEAL = "#5CBFBE";
const baseSvg = readFileSync(srcSvg, "utf8");

function renderPng(size, color) {
  const svg = baseSvg
    .replace(/currentColor/g, color)
    .replace(/width="\d+"/, `width="${size}"`)
    .replace(/height="\d+"/, `height="${size}"`);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// Minimal ICO writer: header + directory + PNG-encoded images (PNG-in-ICO,
// supported since Windows Vista). Keeps Windows multi-DPI crisp with no dep.
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  entries.forEach((entry, i) => {
    const o = i * 16;
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, o);
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(entry.buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += entry.buf.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.buf)]);
}

async function main() {
  mkdirSync(outDir, { recursive: true });

  for (const [name, size] of [
    ["iconTemplate.png", 16],
    ["iconTemplate@2x.png", 32],
    ["iconTemplate@3x.png", 48],
  ]) {
    writeFileSync(resolve(outDir, name), await renderPng(size, BLACK));
    console.log("wrote", name);
  }

  const winEntries = [];
  for (const size of [16, 20, 24, 32, 48]) {
    winEntries.push({ size, buf: await renderPng(size, TEAL) });
  }
  writeFileSync(resolve(outDir, "icon.ico"), buildIco(winEntries));
  console.log("wrote icon.ico");

  writeFileSync(resolve(outDir, "icon.png"), await renderPng(32, TEAL));
  console.log("wrote icon.png");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
