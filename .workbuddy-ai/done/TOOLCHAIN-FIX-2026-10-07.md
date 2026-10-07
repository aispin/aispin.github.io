# 工具链故障「改不了已有文件」的处置步骤（2026-10-07）

> 与 `MEMORY-CORRECTION-2026-10-07.md` 是同一批，**下次会话请一起并回 `MEMORY.md` 再删**。

## 症状

从 2026-10-07 19:37 起，**任何「修改已有文件」的操作全部失败**，但**新建文件正常**：

| 操作 | 结果 |
|---|---|
| 新建文件（任意位置） | ✅ |
| 改已有文件（Python / Edit 工具 / shell `>>` / `touch`） | ❌ |
| 改名 / 移动 / 删除已有文件 | ❌ |
| 沙箱外执行 | ❌ 同样失败 |

报错原文（三种，同一个根因）：
- Python：`Brokered file token refused: modify backup failed`
- Edit/Write 工具：`modify_backup commit: Not a directory (os error 20)`
- 删除：`[safe-delete] broker denied delete`

**重启 WorkBuddy 无效** —— 重启后续用的是**同一个 change-set id**，故障跟着走。

## 已排除的原因

- 磁盘满（还有 509 GB）
- ACL（`ls -le` 无条目）、`uchg` 文件锁（flags 为 `-`）
- 进程占用（`lsof` 为空）
- 目录权限（目录可写，新建文件能正常建也能正常删）
- 文件本身（同样的失败覆盖所有已有文件，包括几分钟前刚成功改过的）

## 根因（已定位到组件，未定位到代码）

WorkBuddy 的**变更追踪 / 修改前备份**层坏了。存储位置：

```
~/.workbuddy_cache/.workbuddy-ai/changes-index/<change-set>.json     ← 变更索引
~/.workbuddy_cache/.workbuddy-ai/changes-detail/<change-set>/         ← 每条变更的备份
```
（`~/.workbuddy-ai` 是指向 `/Volumes/Pluto/dev/workbuddy_cache/.workbuddy-ai` 的软链。）

坏掉的那个 change-set 是 `24ff3190-78c3-47b0-9869-c88150a81d4a`。
它的索引在本会话里涨到 **134 KB**（上一会话的只有 34 KB），19:39 之后就不再正常提交。
按会话轮次记录的变化量：19:16 那轮还是好的（+2906），**19:37 那轮开始失败**（+3001）。

⚠️ 时间线**否定**了"是 `mv dist .workbuddy-ai/dist-old-*` 导致的"这个猜测
（那是 19:40 执行的，而失败从 19:37 就开始了）。**别再拿它当原因。**

## 处置步骤（必须在 Terminal 里、且 WorkBuddy 完全退出时做）

我自己做不了 —— 改名/移动同样要经过那个坏掉的 broker。

```bash
# 1) 完全退出 WorkBuddy（Cmd+Q），确认没有残留进程

# 2) 把卡住的 change-set 挪走（可逆，只是搬走不是删）
mkdir -p ~/Desktop/wb-changeset-backup
mv ~/.workbuddy_cache/.workbuddy-ai/changes-index/24ff3190-78c3-47b0-9869-c88150a81d4a.json \
   ~/Desktop/wb-changeset-backup/
mv ~/.workbuddy_cache/.workbuddy-ai/changes-detail/24ff3190-78c3-47b0-9869-c88150a81d4a \
   ~/Desktop/wb-changeset-backup/

# 3) 重新打开 WorkBuddy
```

**代价**：丢掉本会话的文件变更历史（那个"撤销/查看改动"的记录）。
**不受影响**：`audit-log/`（审计日志）是另一套存储，没坏，不要动。

若做完仍不行 → 带上上面三段报错原文找 WorkBuddy 支持。

## 顺带要清理的东西

故障期间有 2 个文件删不掉，修好后**在 Finder 里手动删**：

```
/Volumes/Pluto/dev/github/aispin/aispin.github.io/.workbuddy-ai/cleanup-and-docs-2026-10-07.md
/Volumes/Pluto/dev/github/aispin/aispin.github.io/.workbuddy-ai/cleanup-inventory-2026-10-07.md
```
（它们的 `tar.gz` 已经在 `.workbuddy-ai/done/` 里了，删源文件不会丢东西。）

## 故障期间「还能做什么」

- ✅ 新建文件（报告、截图、新目录）
- ✅ 读文件、跑无头脚本、`npm run build`、跑 harness —— 只读+新建的操作都正常
- ❌ **改一行代码都做不到**

→ 所以恢复之前，任何需要动源码的计划都只能停在"计划"。
