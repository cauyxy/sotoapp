#!/usr/bin/env bash
# Download and bundle the fonts referenced by styles.css into public/fonts/.
#
# Output (all woff2):
#   SourceSerif4Variable-Roman.woff2   (~420 KB, full Latin Extended)
#   InterVariable.woff2                (~150 KB, Latin subset)
#   JetBrainsMonoVariable.woff2        (~80 KB,  Latin subset)
#   NotoSerifSC-VF.woff2               (~1.8 MB, CJK subset)
#   NotoSansSC-VF.woff2                (~1.6 MB, CJK subset)
#
# Requires: curl, unzip, python3 + fonttools + brotli.
#   python3 -m pip install --user fonttools brotli
#
# Re-run any time you want to refresh bundled fonts. Pin upstream versions
# below — bump them to pull newer releases.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../public/fonts"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$OUT_DIR"

# --- locate pyftsubset -------------------------------------------------------
# pip --user installs to a per-Python-version path that often isn't on PATH.
# Probe common locations before giving up.
PYFTSUBSET=""
if command -v pyftsubset >/dev/null 2>&1; then
  PYFTSUBSET="$(command -v pyftsubset)"
else
  for candidate in \
    "$HOME/Library/Python/3.9/bin/pyftsubset" \
    "$HOME/Library/Python/3.10/bin/pyftsubset" \
    "$HOME/Library/Python/3.11/bin/pyftsubset" \
    "$HOME/Library/Python/3.12/bin/pyftsubset" \
    "$HOME/Library/Python/3.13/bin/pyftsubset" \
    "$HOME/.local/bin/pyftsubset"; do
    if [ -x "$candidate" ]; then PYFTSUBSET="$candidate"; break; fi
  done
fi
if [ -z "$PYFTSUBSET" ]; then
  echo "pyftsubset not found." >&2
  echo "Install with:  python3 -m pip install --user fonttools brotli" >&2
  exit 1
fi

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required tool: $1" >&2; exit 1; }
}
require curl
require unzip

# Latin coverage: basic + Latin-1 + Latin Extended-A/B + punctuation +
# super/subscript + currency + letterlike (©, ™, …).
LATIN_RANGE="U+0020-007F,U+00A0-00FF,U+0100-017F,U+0180-024F,U+2000-206F,U+2070-209F,U+20A0-20CF,U+2100-214F"

# CJK: Latin baseline + CJK punctuation + Halfwidth/Fullwidth + Unified Ideographs.
CJK_RANGE="$LATIN_RANGE,U+3000-303F,U+FF00-FFEF,U+4E00-9FFF"

# --- Source Serif 4 ----------------------------------------------------------
echo "==> Source Serif 4 Variable (Roman)"
curl -fsSL -o "$TMP_DIR/ssp4.zip" \
  "https://github.com/adobe-fonts/source-serif/releases/download/4.005R/source-serif-4.005_WOFF2.zip"
unzip -q -o "$TMP_DIR/ssp4.zip" -d "$TMP_DIR/ssp4"
cp "$TMP_DIR/ssp4/source-serif-4.005_WOFF2/VAR/SourceSerif4Variable-Roman.ttf.woff2" \
   "$OUT_DIR/SourceSerif4Variable-Roman.woff2"

# --- Inter -------------------------------------------------------------------
echo "==> Inter Variable (subset to Latin)"
curl -fsSL -o "$TMP_DIR/inter.zip" \
  "https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip"
unzip -q -o "$TMP_DIR/inter.zip" -d "$TMP_DIR/inter"
"$PYFTSUBSET" "$TMP_DIR/inter/InterVariable.ttf" \
  --output-file="$OUT_DIR/InterVariable.woff2" \
  --flavor=woff2 \
  --unicodes="$LATIN_RANGE" \
  --layout-features='*' \
  --no-hinting

# --- JetBrains Mono ----------------------------------------------------------
echo "==> JetBrains Mono Variable (subset to Latin)"
curl -fsSL -o "$TMP_DIR/jbm.zip" \
  "https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip"
unzip -q -o "$TMP_DIR/jbm.zip" -d "$TMP_DIR/jbm"
"$PYFTSUBSET" "$TMP_DIR/jbm/fonts/variable/JetBrainsMono[wght].ttf" \
  --output-file="$OUT_DIR/JetBrainsMonoVariable.woff2" \
  --flavor=woff2 \
  --unicodes="$LATIN_RANGE" \
  --layout-features='*' \
  --no-hinting

# --- Noto SC (CJK) -----------------------------------------------------------
echo "==> Noto Sans SC Variable (subset)"
curl -fsSL -o "$TMP_DIR/noto-sans-sc.otf" \
  "https://github.com/notofonts/noto-cjk/raw/main/Sans/Variable/OTF/Subset/NotoSansSC-VF.otf"
"$PYFTSUBSET" "$TMP_DIR/noto-sans-sc.otf" \
  --output-file="$OUT_DIR/NotoSansSC-VF.woff2" \
  --flavor=woff2 \
  --unicodes="$CJK_RANGE" \
  --layout-features='*' \
  --no-hinting

echo "==> Noto Serif SC Variable (subset)"
curl -fsSL -o "$TMP_DIR/noto-serif-sc.otf" \
  "https://github.com/notofonts/noto-cjk/raw/main/Serif/Variable/OTF/Subset/NotoSerifSC-VF.otf"
"$PYFTSUBSET" "$TMP_DIR/noto-serif-sc.otf" \
  --output-file="$OUT_DIR/NotoSerifSC-VF.woff2" \
  --flavor=woff2 \
  --unicodes="$CJK_RANGE" \
  --layout-features='*' \
  --no-hinting

echo
echo "Done. Bundled fonts in $OUT_DIR:"
ls -lh "$OUT_DIR"
