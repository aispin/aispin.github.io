#!/usr/bin/env bash
#
# deploy-gh-pages.sh — 构建本站并把 dist/ 原样推到 gh-pages 分支。
#
# 为什么用「临时目录里 git init」而不是 `gh-pages -d dist` 或 `git subtree`：
#   * 不碰工作区 —— 不会在你的仓库里留下一个多余的分支指针或 stash；
#   * 不在 dist/ 里留 .git —— dist 是构建产物，混进 git 目录之后
#     下次 `vite build` 的行为会变得难以预料（也会让 --dry-run 的校验失真）；
#   * gh-pages 是**生成物**，每次都整体覆盖，所以用 --force 推。
#
# ⚠️ 这是强推到 gh-pages。那个分支不要手写任何东西，会被下一次部署抹掉。
#
# 用法：
#   scripts/deploy-gh-pages.sh [--dry-run] [--remote <name|url>] [--base <path>]
#                              [--message <msg>] [--keep-temp]
#
#   --dry-run      只构建 + 校验 + 报告，不推送
#   --remote       git remote 名或完整 URL（默认 origin）
#   --base         覆盖 Vite base（默认取 site.json 的 siteUrl 路径，见下）
#   --message      覆盖提交信息
#   --keep-temp    保留临时目录（排障用）
#
# base 取自**站点的规范地址** —— `src/data/site.json` 的 `siteUrl` 的路径部分
# （不靠猜远端仓库名，那不可靠）。判断错了页面会整站 404（资源路径全错），
# 所以脚本还会拿远端形态做一次交叉检查。要覆盖就用 --base。

set -euo pipefail

REMOTE="origin"
BASE_OVERRIDE=""
MESSAGE=""
DRY_RUN=0
KEEP_TEMP=0

die() { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
info() { printf '\033[36m• %s\033[0m\n' "$*"; }
ok() { printf '\033[32m✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m⚠ %s\033[0m\n' "$*"; }

# 支持 `--opt=value` 写法：先拆成 `--opt value` 两段，主循环只认后者。
_ARGS=()
for _a in "$@"; do
  case "$_a" in
    --*=*) _ARGS+=("${_a%%=*}" "${_a#*=}") ;;
    *) _ARGS+=("$_a") ;;
  esac
done
set -- ${_ARGS[@]+"${_ARGS[@]}"}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --keep-temp) KEEP_TEMP=1 ;;
    --remote) shift; [ $# -gt 0 ] || die "--remote 需要一个值"; REMOTE="$1" ;;
    --base) shift; [ $# -gt 0 ] || die "--base 需要一个值"; BASE_OVERRIDE="$1" ;;
    --message) shift; [ $# -gt 0 ] || die "--message 需要一个值"; MESSAGE="$1" ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) die "未知参数：$1（-h 看用法）" ;;
  esac
  shift
done

# ---------------------------------------------------------------- 0. 定位仓库
command -v git >/dev/null || die "找不到 git"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "当前目录不在 git 仓库里"
cd "$ROOT"
[ -f package.json ] || die "$ROOT 下没有 package.json —— 是不是跑错目录了？"

# ------------------------------------------------------------- 1. 解析远端地址
if git remote get-url "$REMOTE" >/dev/null 2>&1; then
  REMOTE_URL="$(git remote get-url "$REMOTE")"
elif [ "$REMOTE" != "origin" ] && printf '%s' "$REMOTE" | grep -qE '^(https?://|git@|ssh://)'; then
  # 直接给了 URL
  REMOTE_URL="$REMOTE"
else
  die "取不到远端 '$REMOTE'（git remote get-url 失败）。
   本仓库现在没有配任何 remote —— 先加一个，例如：
     git remote add origin git@github.com:<你>/aispin.github.io.git
   或者用 --remote <url> 直接指定。"
fi
info "远端 = $REMOTE_URL"

# ------------------------------------------------------------------- 2. 定 base
# base 取哪儿（顺序即优先级）：
#
#   1. `--base` 显式指定；
#   2. 否则用站点的**规范地址** —— `src/data/site.json` 的 `siteUrl` 的路径部分。
#      它才是"站点部署在哪"的权威说法（canonical / og:url / sitemap 全用它），
#      改地址时本来就必须改它，于是 base 自动跟着走。
#      ⚠️ 不要靠"仓库名是不是 <x>.github.io"去猜：那个名字只有在 **owner 也是 <x>**
#      时才是 User Page（站点在根路径）；owner 不同它就是个普通 Project Page，
#      站点在 /<repo>/ 下。`zeo/aispin.github.io` 正是后者。
#   3. site.json 读不出来 → 退回 `/`。
#
# base 猜错的表现是**整站资源 404（白屏）**，所以下面还有一段交叉检查。
#
# ⚠️ owner/repo 的提取必须先归一化 scp 形式。`git@github.com:owner/repo` 里
# owner 和 repo 是**用冒号**分开的，直接按 `/` 切会把 `git@github.com:owner`
# 整段当成 owner（`https://…` 那种写法才碰巧是对的）。
NORM="$REMOTE_URL"
if printf '%s' "$NORM" | grep -qE '^[^/]+@[^/]+:'; then
  NORM="https://$(printf '%s' "$NORM" | sed -E 's/^[^@]+@//; s|:|/|')"
fi
SLUG="${NORM%.git}"
SLUG="${SLUG%/}"
OWNER="$(printf '%s' "$SLUG" | awk -F/ '{print $(NF-1)}')"
REPO="$(printf '%s' "$SLUG" | awk -F/ '{print $NF}')"

CANON_PATH="$(node -e 'try{const s=require("./src/data/site.json");process.stdout.write(new URL(s.siteUrl).pathname)}catch(e){process.stdout.write("")}' 2>/dev/null || true)"

if [ -n "$BASE_OVERRIDE" ]; then
  BASE="$BASE_OVERRIDE"
  info "base = ${BASE}（--base 指定）"
elif [ -n "$CANON_PATH" ]; then
  BASE="$CANON_PATH"
  info "base = ${BASE} （取自 src/data/site.json 的 siteUrl 路径）"
else
  BASE="/"
  warn "读不到 src/data/site.json 的 siteUrl → 按 base=/ 处理。不对就 --base 指定。"
fi

# 交叉检查：base 和远端仓库形态对不上时提醒一句。
if printf '%s' "$REMOTE_URL" | grep -q 'github\.com'; then
  if [ "$REPO" = "${OWNER}.github.io" ] && [ "$BASE" != "/" ]; then
    warn "远端看着是 User Page（${OWNER}/${REPO}，站点在根路径），但 base=${BASE} —— 对不上会整站 404。"
  elif [ "$REPO" != "${OWNER}.github.io" ] && [ "$BASE" = "/" ]; then
    warn "远端 ${OWNER}/${REPO} 不是 User Page —— 发成 Project Page 时站点在 /${REPO}/ 下，"
    warn "但 base=/。真要发成 Project Page 就得改 src/data/site.json 的 siteUrl（SEO 也依赖它）。"
  fi
fi

# ------------------------------------------------------------- 3. 脏工作区提醒
if [ -n "$(git status --porcelain)" ]; then
  warn "工作区有未提交的改动 —— 这次部署的产物不对应任何一个 commit，"
  warn "以后要回到这个版本会找不到。建议先 commit。"
fi
SRC_SHA="$(git rev-parse --short HEAD)"
SRC_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ -n "$MESSAGE" ] || MESSAGE="deploy: build from ${SRC_BRANCH}@${SRC_SHA}"

# ------------------------------------------------------------------- 4. 构建
info "构建中（base=${BASE}）…"
# 不用手动清 dist —— Vite 的 emptyOutDir 默认就为真（outDir 在 root 之内），
# 它自己会把上一次的产物清掉。
if [ "$BASE" = "/" ]; then
  npm run build
else
  npm run build -- --base="$BASE"
fi
[ -f dist/index.html ] || die "构建结束但没有 dist/index.html"

# ------------------------------------------------------------------- 5. 校验
[ -f dist/me/index.html ] || warn "dist/me/index.html 不见了 —— 名片页入口可能没构建出来"
[ -f dist/404.html ] || warn "dist/404.html 不见了 —— GitHub Pages 的 SPA 深链会 404"

# .nojekyll：GitHub Pages 默认跑 Jekyll，会把下划线开头的文件/目录丢掉
# （我们就有 _headers / _redirects）。public/.nojekyll 会带出来，这里再兜一次。
if [ ! -f dist/.nojekyll ]; then
  : > dist/.nojekyll
  warn "dist/.nojekyll 原本没有，已补上（防止 Jekyll 丢掉 _headers / _redirects）"
fi

# 站点的硬约束：零 jpg/png（只允许 2 张 webp 位图）。这里只报告，不拦。
RASTERS="$(find dist -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) | head -20 || true)"
if [ -n "$RASTERS" ]; then
  warn "dist 里出现了 jpg/png（本站规定零 jpg/png）："
  printf '    %s\n' $RASTERS
fi

SIZE="$(du -sh dist | cut -f1)"
ok "构建完成：dist ${SIZE}，$(find dist -type f | wc -l | tr -d ' ') 个文件"

if [ "$DRY_RUN" = "1" ]; then
  echo
  ok "--dry-run：到此为止。真要推送就去掉 --dry-run。"
  info "将要执行：把 dist/ 的内容强推到 $REMOTE_URL 的 gh-pages 分支"
  info "提交信息：$MESSAGE"
  exit 0
fi

# --------------------------------------------------------------- 6. 推 gh-pages
# 在一个临时目录里另起一个仓库 —— 干净、不留痕、不碰工作区。
TMP="$(mktemp -d "${TMPDIR:-/tmp}/deploy-gh-pages.XXXXXX")"
cleanup() {
  if [ "$KEEP_TEMP" = "1" ]; then
    warn "临时目录保留在 $TMP"
  else
    rm -rf "$TMP"
  fi
}
trap cleanup EXIT

cp -R dist/. "$TMP/"
cd "$TMP"
# git init -b 要 git >= 2.28；symbolic-ref 到处都能用，也不需要在空仓库上 checkout。
git init -q
git symbolic-ref HEAD refs/heads/gh-pages
git add -A
git commit -q -m "$MESSAGE"
ok "已在临时仓库里提交（$(git rev-parse --short HEAD)）"

info "推送到 gh-pages …"
git push --force "$REMOTE_URL" "HEAD:refs/heads/gh-pages"

echo
ok "部署完成：$REMOTE_URL 的 gh-pages 分支"
echo "  如果 GitHub Pages 还没打开：Settings → Pages → Source = Deploy from a branch → gh-pages / (root)"
