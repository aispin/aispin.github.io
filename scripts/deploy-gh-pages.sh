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
#                              [--message <msg>] [--keep-temp] [--configure-pages]
#
#   --dry-run           只构建 + 校验 + 报告，不推送
#   --remote            git remote 名或完整 URL（默认 origin）
#   --base              覆盖 Vite base（默认取 site.json 的 siteUrl 路径，见下）
#   --message           覆盖提交信息
#   --keep-temp         保留临时目录（排障用）
#   --configure-pages   推送后顺便把 Pages 发布源改成 gh-pages / (root)。
#                       这一步不是 git 操作，是改**仓库设置**，所以需要 gh 已登录。
#
# 环境变量：
#   GIT_RETRIES         网络重试次数（默认 5）。本机出海走代理，github.com 的
#                       CONNECT 偶发 502，push 失败未必是仓库的问题。
#
# ⚠️ 光把 dist 推上 gh-pages 是不够的：Pages 的发布源（Source）必须也指向它。
#    发布源是**单选**的，指错了分支，推上去的内容永远不会被发布 ——
#    而且没有任何报错，站点只是静静地停在旧版本上。所以本脚本每次都会
#    只读地查一下发布源，不对就提醒（用 --configure-pages 可以直接改）。
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
CONFIGURE_PAGES=0
PAGES_BRANCH="gh-pages"

die() { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
info() { printf '\033[36m• %s\033[0m\n' "$*"; }
ok() { printf '\033[32m✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m⚠ %s\033[0m\n' "$*"; }

# ------------------------------------------------------ GitHub Pages 源：小工具
# Pages 的发布源是**仓库设置**，不是 git 里的东西，所以只能走 REST API。
# gh 没有 `gh pages` 这种子命令，但 `gh api` 可以直接打：
#   读：GET  /repos/{owner}/{repo}/pages
#   改：PUT  /repos/{owner}/{repo}/pages   （204 No Content = 成功）
#   建：POST /repos/{owner}/{repo}/pages   （仓库从没开过 Pages 时用这个）
# 请求体里 `build_type=legacy` 就是 UI 上的 "Deploy from a branch"。
#
# ⚠️ `-f 'source[branch]=…'` 的方括号**必须加引号**：在 zsh 下
# `source[branch]=gh-pages` 会被当 glob 展开（zsh: no matches found），
# 在 bash 下也可能被字符类匹配到别的文件名。
# ⚠️ 这一整套需要 admin 权限，`GITHUB_TOKEN`（CI 里那个）做不到 ——
# 所以它只放在本地脚本里，不放进 workflow。
gh_ready() {
  command -v gh >/dev/null 2>&1 || return 1
  gh auth status >/dev/null 2>&1 || return 1
  return 0
}

# 读当前发布源分支；读不到（404 = 没开 Pages / 没权限）就输出空串。
pages_source_branch() {
  gh api "repos/${OWNER}/${REPO}/pages" --jq '.source.branch' 2>/dev/null || true
}

# 把发布源设成 <branch> / (root)。已开 Pages 用 PUT，没开用 POST。
pages_set_source() {
  local body=(-f build_type=legacy -f "source[branch]=$1" -f 'source[path]=/')
  if [ -n "$(pages_source_branch)" ]; then
    gh api -X PUT "repos/${OWNER}/${REPO}/pages" "${body[@]}" >/dev/null
  else
    gh api -X POST "repos/${OWNER}/${REPO}/pages" "${body[@]}" >/dev/null
  fi
}

# ------------------------------------------------------------------ 网络重试
# 这个环境的出海流量走一层代理，`github.com` 的 CONNECT **偶发 502**
# （`CONNECT tunnel failed, response 502`）——实测每 5~6 次里有 1 次成功。
# 也就是说 push 失败**未必是仓库的问题**，直接报错退出会让人白查半天。
#
# push 是幂等的（`--force` 到同一个 ref，重复执行结果一样），所以重试安全。
# 次数用 `GIT_RETRIES` 覆盖（默认 5）。
retry_git() {
  local tries="${GIT_RETRIES:-5}" n=1
  while true; do
    if "$@"; then return 0; fi
    if [ "$n" -ge "$tries" ]; then
      warn "连续 ${tries} 次失败：$*"
      return 1
    fi
    warn "网络失败（第 ${n}/${tries} 次），重试中…"
    sleep 2
    n=$((n + 1))
  done
}

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
    --configure-pages) CONFIGURE_PAGES=1 ;;
    --remote) shift; [ $# -gt 0 ] || die "--remote 需要一个值"; REMOTE="$1" ;;
    --base) shift; [ $# -gt 0 ] || die "--base 需要一个值"; BASE_OVERRIDE="$1" ;;
    --message) shift; [ $# -gt 0 ] || die "--message 需要一个值"; MESSAGE="$1" ;;
    -h|--help) sed -n '2,36p' "$0"; exit 0 ;;
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

# 远端是不是 github.com —— 决定后面要不要查/改 Pages 源。
IS_GITHUB=0
printf '%s' "$REMOTE_URL" | grep -qE '(^|@|//)github\.com[:/]' && IS_GITHUB=1

# --configure-pages 的前置条件在这里就查掉 —— 别等构建 + 推送跑完才失败。
if [ "$CONFIGURE_PAGES" = "1" ]; then
  [ "$IS_GITHUB" = "1" ] || die "--configure-pages 只对 github.com 的远端有效（当前：${REMOTE_URL}）"
  gh_ready || die "--configure-pages 需要可用的 gh，且已登录（gh auth status 失败）"
fi

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

# ------------------------------------------------- 5.5 Pages 发布源（只读检查）
# 推上去 ≠ 发布出去。发布源指错分支时 GitHub 不报错，站点只是停在旧版本 ——
# 这种"静默不生效"最容易让人以为是构建坏了，所以这里主动查一次。
if [ "$IS_GITHUB" = "1" ]; then
  if gh_ready; then
    CUR_PAGES="$(pages_source_branch)"
    if [ -z "$CUR_PAGES" ]; then
      warn "读不到 ${OWNER}/${REPO} 的 Pages 配置（可能还没启用 Pages，或当前账号无权限）。"
      warn "  启用：gh api -X POST repos/${OWNER}/${REPO}/pages -f build_type=legacy -f 'source[branch]=${PAGES_BRANCH}' -f 'source[path]=/'"
    elif [ "$CUR_PAGES" != "$PAGES_BRANCH" ]; then
      warn "Pages 发布源现在是 **${CUR_PAGES}**，不是 ${PAGES_BRANCH} —— 推上去不会发布。"
      warn "  改它：scripts/deploy-gh-pages.sh --configure-pages"
      warn "  等价于：gh api -X PUT repos/${OWNER}/${REPO}/pages -f build_type=legacy -f 'source[branch]=${PAGES_BRANCH}' -f 'source[path]=/'"
    else
      ok "Pages 发布源 = ${CUR_PAGES} / (root)"
    fi
  else
    info "（跳过 Pages 源检查：gh 不可用或未登录）"
  fi
fi

if [ "$DRY_RUN" = "1" ]; then
  echo
  ok "--dry-run：到此为止。真要推送就去掉 --dry-run。"
  info "将要执行：把 dist/ 的内容强推到 $REMOTE_URL 的 gh-pages 分支"
  info "提交信息：$MESSAGE"
  [ "$CONFIGURE_PAGES" = "1" ] && info "并会把 Pages 发布源设为 ${PAGES_BRANCH} / (root)"
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
retry_git git push --force "$REMOTE_URL" "HEAD:refs/heads/gh-pages"
cd "$ROOT"

echo
ok "部署完成：$REMOTE_URL 的 gh-pages 分支"

# ------------------------------------------------- 7. 顺带把发布源指过来
if [ "$CONFIGURE_PAGES" = "1" ]; then
  # 前置条件已在开头查过（github 远端 + gh 可用）。
  # 顺序不能反：gh-pages 分支必须先存在，否则 GitHub 会拒绝这次设置。
  # 所以这里是"推完再改源"，而不是"改完源再推"。
  info "设置 Pages 发布源为 ${PAGES_BRANCH} / (root) …"
  pages_set_source "$PAGES_BRANCH"
  ok "Pages 发布源 = $(pages_source_branch) / (root)"
elif [ "$IS_GITHUB" = "1" ] && gh_ready; then
  CUR="$(pages_source_branch)"
  if [ -n "$CUR" ] && [ "$CUR" != "$PAGES_BRANCH" ]; then
    echo
    warn "发布源还指着 ${CUR} —— 站点不会更新（GitHub 不会报错）。"
    warn "  改：scripts/deploy-gh-pages.sh --configure-pages"
  fi
fi

echo
echo "  发布源没对就：Settings → Pages → Source = Deploy from a branch → ${PAGES_BRANCH} / (root)"
