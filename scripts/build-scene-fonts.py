#!/usr/bin/env python3
"""
Rebuild the Maple Mono CN subsets from a *comprehensive* charset.

这是**唯一**的字体构建脚本。历史上还有一个 build-font-subset.py，它只把
i18n 里少数几个键（rooms / preloader / nav…）收进场景子集 —— 那个子集正是
下面这个 bug 的成因，所以已经删掉了。

Why the charset must be comprehensive:
    troika (drei <Text>) resolves per-character fonts. When none of the fonts
    passed to a <Text> covers a character it falls back to the
    unicode-font-resolver CDN (cdn.jsdelivr.net). In China / offline that fetch
    times out, the resolver promise rejects, and the <Text> never syncs - and
    because drei's Text suspends on preloadFont, a bad font can suspend the
    ENTIRE R3F scene.

    So the scene font must never miss a glyph. This script collects every
    character that appears anywhere under src/ (jsx/js/json) plus a base symbol
    set, and re-subsets the Maple fonts from the full source.

Outputs (public/fonts/):
    maple-ui.woff    — 一份两用：troika 场景文字（它不认 woff2）+ DOM 的 woff 兜底
    maple-ui.woff2   — DOM/CSS 首选，更小

    两个产物用**同一个字符集**，只有 flavor 不同，所以 woff 那一份同时服务
    3D 和 DOM，不需要再单独产 maple-cn.woff / maple-3d.woff 之类的副本。

Usage:
    python3 scripts/build-scene-fonts.py
    python3 scripts/build-scene-fonts.py --font /path/to/MapleMono-CN-Regular.ttf

Font source (v7.9):
    gh release download v7.9 --repo subframe7536/maple-font \\
        --pattern 'MapleMono-CN.zip'
    then unzip and place MapleMono-CN-Regular.ttf at ~/.cache/maple-font/
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = Path.home() / ".cache" / "maple-font"
DEFAULT_FONT = CACHE_DIR / "MapleMono-CN-Regular.ttf"

# Symbols used as 3D props / door icons / UI glyphs inside the canvas.
BASE_CHARS = (
    "".join(chr(c) for c in range(0x20, 0x7F))  # printable ASCII
    + "　°·—–…‘’“”《》〈〉、。，；：？！（）【】「」『』±×÷≈∞←→↑↓★☆✉♪▶◀◈●■□▲△"
    + "▼▤▧▷◇⌂♫✳⌂▵▸▪▫◆○◎◉⚙⏱⛵☁☾☼✓✗✕❌"
)


def iter_source_files():
    for pattern in ("*.jsx", "*.js", "*.json"):
        yield from ROOT.joinpath("src").rglob(pattern)


def collect_chars():
    chars = set(BASE_CHARS)
    for path in iter_source_files():
        text = path.read_text(encoding="utf-8", errors="ignore")
        chars.update(text)
    # Control characters never need glyphs.
    return {c for c in chars if ord(c) >= 0x20}


def subset(font_path, out_path, chars, flavor):
    out_path.parent.mkdir(parents=True, exist_ok=True)
    text = "".join(sorted(chars))
    cmd = [
        sys.executable, "-m", "fontTools.subset", str(font_path),
        f"--text={text}",
        f"--flavor={flavor}",
        f"--output-file={out_path}",
        "--layout-features=*",
        "--no-hinting",
        "--desubroutinize",
        "--drop-tables+=DSIG",
        "--name-IDs=0,1,2,3,4,5,6",
    ]
    subprocess.run(cmd, check=True)
    return out_path.stat().st_size


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--font", default=str(DEFAULT_FONT))
    args = parser.parse_args()

    font_path = Path(args.font)
    if not font_path.exists():
        sys.exit(f"Font not found: {font_path}")

    chars = collect_chars()
    print(f"source  : {font_path.name}")
    print(f"charset : {len(chars)} characters")

    public_fonts = ROOT / "public" / "fonts"
    results = [
        # 一份两用。troika (drei <Text>) 只认 ttf/otf/woff，**不认 woff2**，
        # 所以 3D 必须用 woff；而 DOM 的 @font-face 也把 woff 当兜底。
        # 同一个字符集 + 同一种 flavor ⇒ 产物逐字节相同，不必出两份。
        ("maple-ui.woff", chars, "woff"),
        # DOM / CSS 首选，体积更小。
        ("maple-ui.woff2", chars, "woff2"),
    ]
    for name, cs, flavor in results:
        size = subset(font_path, public_fonts / name, cs, flavor)
        print(f"  {name:<16} {size / 1024:8.1f} KB")

    print(json.dumps({
        "sample": "".join(sorted(c for c in chars if ord(c) > 0x2000))[:200],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
