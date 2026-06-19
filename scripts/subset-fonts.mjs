import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(root, "scripts/fonts-src/SourceSerif4Variable-Roman.woff2");
const OUT = resolve(root, "apps/desktop/src/renderer/public/fonts/SourceSerif4Variable-Roman.woff2");

function rangeText() {
  const ranges = [
    [0x20, 0x7f],
    [0xa0, 0xff],
    [0x100, 0x17f],
    [0x180, 0x24f],
    [0x2000, 0x206f],
    [0x2070, 0x209f],
    [0x20a0, 0x20cf],
    [0x2100, 0x214f],
  ];
  let text = "";
  for (const [lo, hi] of ranges) {
    for (let codePoint = lo; codePoint <= hi; codePoint += 1) {
      text += String.fromCodePoint(codePoint);
    }
  }
  return text;
}

const input = readFileSync(SRC);
const output = await subsetFont(input, rangeText(), { targetFormat: "woff2" });
writeFileSync(OUT, output);
console.log(`subset ${input.length}B -> ${output.length}B (${OUT})`);
