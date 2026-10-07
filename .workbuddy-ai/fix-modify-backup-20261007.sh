#!/bin/bash
# =============================================================================
# WorkBuddy「已有文件写不进去」故障 修复脚本
# 2026-10-07 · aispin.github.io 会话产出
#
# 症状：改任何已存在的文件都失败
#   工具侧  → modify_backup commit: Not a directory (os error 20)
#   Python  → PermissionError: Brokered file token refused: modify backup failed
# 根因：sandbox-center 的 FileManager::do_commit_modify_backup 对 reason='m'
#       （修改）的备份提交失败。新建文件的备份（reason='a'）是正常的。
#
# ⚠️ 必须在 Terminal 里运行，且 **WorkBuddy 完全退出**（Cmd+Q）。
#    本操作只是「移走」不是「删」，随时可移回。
# =============================================================================
set -euo pipefail

CACHE="$HOME/.workbuddy-ai"                       # 指向 /Volumes/Pluto/dev/workbuddy_cache/.workbuddy-ai
SESS="$CACHE/workspace/sessions"
PARK="$HOME/Desktop/wb-backup-parked-$(date +%Y%m%d-%H%M%S)"

echo "== 1) 检查 WorkBuddy 是否已退出 =="
if pgrep -f "WorkBuddy AI.app" >/dev/null 2>&1; then
  echo "❌ 检测到 WorkBuddy 仍在运行。请先完全退出（Cmd+Q）再跑本脚本。"
  echo "   残留进程："; pgrep -fl "WorkBuddy AI.app" | head -5
  exit 1
fi
echo "✅ 没有残留进程"

echo
echo "== 2) 定位要移走的会话备份状态 =="
if [ ! -d "$SESS" ]; then
  echo "❌ 找不到 $SESS —— 路径不对？先确认 ~/.workbuddy-ai 软链是否有效："
  ls -ld "$CACHE" || true
  exit 1
fi
ls -1 "$SESS" | sed 's/^/   /'

echo
echo "== 3) 移到 $PARK =="
mkdir -p "$PARK"
moved=0
for d in "$SESS"/*/; do
  name="$(basename "$d")"
  case "$name" in
    editor-sdk-*|gc_config.json|tmbs) continue ;;   # 跳过非会话目录
  esac
  if [ -d "$d/.modify_backup_meta" ] || [ -d "$d/modify_backup" ]; then
    mv "$d" "$PARK/$name" && echo "   移走 $name" && moved=$((moved+1))
  fi
done
echo "共移走 $moved 个会话的备份状态（含 .modify_backup_meta / modify_backup / snapfile）"
echo "原位置保留在：$PARK   ← 确认修复成功后可自行删除"

echo
echo "== 4) 如果你不想用这个办法，还有两条更轻的路 =="
cat <<'EOT'
  (a) 【最推荐】打开 WorkBuddy 设置，关掉「文件备份」开关。
      CLI 的 shouldModifyBackupBeforeWrite() 在 isFileBackupEnabled() 为假时
      根本不做「修改前备份」，写入就会立刻恢复。代价：全局失去自动备份/回滚。

  (b) 不重启也能干活：所有写文件的 Python 脚本加 -S 跳过注入的 broker shim。
        /Users/lv/.workbuddy-ai/binaries/python/versions/3.13.12/bin/python3 -S script.py
      等价写法：
        env -u CODEBUDDY_SANDBOX_BROKER_IPC_ADDRESS \
            -u CODEBUDDY_SANDBOX_BROKER_SESSION_ID python3 script.py
      代价：这些改动不会进入 WorkBuddy 的「撤销/回滚」历史。
      ⚠️ Edit/Write 工具仍然不可用，改动只能走脚本。

  ⚠️ 千万不要通过沙箱往 .modify_backup_meta/ 里创建文件 —— 会触发无限自递归。
EOT

echo
echo "== 5) 重新打开 WorkBuddy 后，立刻验证 =="
echo "   给任意已有文件末尾加一个空行，例如："
echo "     printf '' >> $(cd "$(dirname "$0")/.." && pwd)/LICENSE"
echo "   能追加成功 = 已修复；仍报错 = 请把以下两处发给 WorkBuddy 支持："
echo "     · ~/.workbuddy-ai/logs/2026-10-07/*.log 里搜 'modify backup failed'"
echo "     · ~/.workbuddy-ai/logs/sandbox/20261007/sandbox_center_*.log 里搜 'cmd_modify_backup'"
echo "   并注明可疑代码位置：sandbox-center/src/backup/file_manager.rs 的 do_commit_modify_backup"
