# 工作计划 · aispin.github.io

> 写于 2026-10-07 20:4x。**给用户看的**（agent 用的交接在 `HANDOFF.md`）。
> 分三块：① 需要你决定的 ② 我可以直接推的 ③ 上一个会话交接的处理审计。
> 依据：`.workbuddy-ai/audit-2026-10-07.md`、`HANDOFF.md`、`MEMORY.md`、以及今晚的实测。

---

## 现状快照（2026-10-07 20:4x 实测）

| | |
|---|---|
| 写入工具链 | ✅ **已恢复**（你关掉「文件备份」开关后，Edit/Write 与沙箱内写入实测正常） |
| dev server | ❌ **停着**（5199 无响应）—— 你要端到端自测的话我需要 `npm run dev` 起一下 |
| `dist/` | ✅ **已是最新**（19:39 构建，晚于 `src`（19:11）与 `public`（18:09））→ 可以直接发布 |
| 部署目标 | **Cloudflare Pages**（`_headers` / `_redirects` 就是为它写的，`_redirects` 管着 `/me`） |
| `profile/` | ✅ **已按要求删除**（13 文件 / 13.2 MB → 废纸篓 `profile-deleted-20261007-2033`，可反悔） |
| 项目体积 | `node_modules` 428M · `.workbuddy-ai` **211M** · `dist` 6.7M · `public` 3.8M · `src` 1.9M |

---

## ① 需要你决定的（我做不了 / 不该替你决定）

| # | 事项 | 为什么卡在你 | 选项与代价 |
|---|---|---|---|
| 1 | **「文件备份」开关的长期取舍** | 现在**关着**才写得进文件。关了 = 失去"修改前自动备份 / 回滚" | (a) 长期关着；(b) 关着 + **向 WorkBuddy 报这个 bug**（我手里有完整证据链：日志、复现步骤、可疑代码位置 `sandbox-center/src/backup/file_manager.rs` 的 `do_commit_modify_backup`）——**建议做 (b)**；(c) 退出后移走会话备份状态再试开关（`fix-modify-backup-20261007.sh`） |
| 2 | **夜间模式色调/强度** | 现在偏冷蓝紫、约 0.46 倍亮度，**是我拍的，未经你确认** | 旋钮在 `src/config/theme.js` 的 `NIGHT`。你看一眼夜景，告诉我"更暖/更亮/更暗" |
| 3 | **外墙藤蔓的绿浓淡** | 双参数耦合，得你定 | `src/utils/entranceArt.js` 的 `LEAF_*` + `uInkStrength`（现 0.86）。**两者是一对，改一个必须改另一个** |
| 4 | **要不要补 git** | 结构性决定 | 现在**唯一退路是 `.tar.gz`**，任何删除都不可逆。补 git 只新建 `.git`、不碰历史 |
| 5 | **要不要现在发布** | 对外动作，要你点头 | `dist` 已最新且全绿；部署到 Cloudflare Pages。上线后我要不要顺手核对 `/me`、`/demos/` 两条路径 |
| 6 | **`/demos/` 陈列区要不要瘦身** | 会改变对外页面内容 | 里面有 **430 KB 与本项目无关**的别的主题 demo（`skill-ui/` 194K、`web3d/` 225K、`avatar/*.svg` 8.5K）。⚠️ `door.html` 是美术参考稿不能删 |
| 7 | **对联文案是否要你审** | 39 副已按节气/节日落地，但当时是"草稿"批次 | 需要的话我把 39 副排成一张对照表给你过一遍 |

## ② 需要你点头、我就动手的（清理类，低风险）

| # | 事项 | 量 | 说明 |
|---|---|---|---|
| 8 | 删 8 个**源码死文件** | 26 KB | `shaders/PaintRevealMaterial.jsx`、`shaders/RevealBasicMaterial.jsx`（真身 `RevealMaterial` 在用）、`corridor/LoopDoors.jsx`、`rooms/Contact/TornPaperGeometry.js`、`ui/AudioControls.jsx`、`hooks/{useParallax,useMouseParallax,useScrollCamera}.js`。我会**各自 `npm run build` + 冒烟复验**后再删 |
| 9 | **`.workbuddy-ai` 瘦身** | **211 MB** | 只保留"未结案"的归档：`shots/` 56M、`raster-backup` 50M、`dead-textures` 15M、`entrance-textures` 13M、`corridor-textures` 13M、`dist-old-*` 14M、`backup-articles` 5.4M |
| 10 | 删我自己诊断时建的两个目录 | **13.8 MB** | `wb-changeset-backup-20261007/`（6.7M）、`wb-runaway-quarantine-20261007/`（7.1M）—— 都是排查故障的中间产物，结论已写进笔记 |
| 11 | 清内存目录的 5 个快照/备份 | 70 KB | `*snapshot-1004.md`×3、`MEMORY.pre-consolidate-20261007.md`、`2026-10-07.md.bak-before-merge` |
| 12 | 清 `.DS_Store` | 9 个 / 60 KB | 根、`public/`、`public/demos/web3d/`、`dist/`×3、`.workbuddy-ai/dist-old-*`×4 |
| 13 | 删 `TODO.md`？ | 12.4 KB | **上游波兰语遗留**，路径指向原作者 C 盘、提到的文件大多已不存在。我倾向删（或改名 `TODO.upstream.md` 留个念） |

## ③ 我可以直接推进的（不需要你插手，只报结果）

按"性价比 × 风险"排序：

| # | 事项 | 现状 | 验收标准 |
|---|---|---|---|
| 14 | **起 dev server** | 现在停着 | `http://localhost:5199` 返回 200，0 error |
| 15 | **P5 音频池化**（评审单最后一项没做的） | 42 个 `PositionalAudio` 的 **listener 已合并**（额外 listener = 0），但 **42 个节点本身还在** | 评审原话「一个 listener + 一个共享 Audio 池」。⚠️ 必须先证明**门扇悬停音**（按 `ref.current.isPlaying` 判断"我这一扇响不响"）不被别的门影响 |
| 16 | **63 个抠图去 `transparent: true`** | 219 → 63，剩下的没动是**故意的** | **必须有 A/B 截图**：摘掉会让它们退出透明通道，前后关系可能变 |
| 17 | **双面材质 435 收敛** | 一直没动 | 逐个确认哪面永远看不到，改回单面。需 A/B 截图 |
| 18 | **贴图 142 MB 压缩** | 一直没动（6 张 512×1310 门扇占 20 MB） | 压缩后视觉无差 + `scene-stats.mjs` 贴图体积下降 |
| 19 | **`WALL_PANEL_Z = -0.5` 实测** | 保守值，**没验证过**门洞里还能不能看见走廊侧壁 | 从门洞往里拍一张，侧壁可见即可 |
| 20 | **低端机进房间卡顿** | `RoomWarmup` 在 LOW 档直接 `return null`，着色器编译开销全落到进房间那一刻 | 需先在 LOW 档下量一次进房间的掉帧 |
| 21 | **移动端 FOV / 相机 Z** | `TODO.md` 里提过（但那是上游的，需重新独立核实） | 小屏截图不自裁 |

> ⚠️ 15–18 都会**动到渲染结果**，我会一律先归档 `.tar.gz` + 留 A/B 截图，再改。

---

## ④ 上一个会话的交接：是否处理妥当（逐项审计）

原交接文档已归档：`.workbuddy-ai/done/HANDOFF-2026-10-07-1955.md`。
**结论：它的"事实描述"大体可靠，但"根因判断"是错的；6 项待办里 2 项已办、4 项未动。**

### ✅ 已办妥
| 它列的 | 处理结果 |
|---|---|
| §0 故障处置 | ✅ **已解决** —— 但**不是它猜的路径**（见下"被证伪"）。真正生效的是关掉「文件备份」开关 |
| §0 顺带清理：两个 `cleanup-*.md` | ✅ 已入废纸篓（`tar.gz` 本来就在 `done/`） |
| §6.1 合并两份说明（`MEMORY-CORRECTION` / `TOOLCHAIN-FIX`）并回 `MEMORY.md` | ✅ 已并回（`MEMORY.md` §16/§18），两份原件归档到 `done/` |
| §7 `TODO.md` 不是本项目待办 | ✅ 已确认，写进 `MEMORY.md` + 本轮 audit 再次核对 |

### ❌ 被证伪（**别再照它做**）
- 它 §0 断言根因是 `changes-index/<change-set>.json` 卡住（索引涨到 134 KB），并让你**挪走 `24ff3190-…`**。
  **实测无效**：我把那套 index/detail 改名挪走后，写入**依旧一个字都改不了**（已恢复原名，未留脏状态）。
  真根因是 sandbox-center 的 `FileManager::do_commit_modify_backup` 对 **reason=`m`（修改）** 的提交失败。
- 它给的存储路径 `~/.workbuddy_cache/...` **根本不存在**（真实位置是 `~/.workbuddy-ai`，软链到
  `/Volumes/Pluto/dev/workbuddy_cache/.workbuddy-ai`）—— 在错的路径上排查，所以没找到。
- 它的处置脚本（`fix-modify-backup-20261007.sh`）因此只是"备选"，不是首选。

### ⏳ 完全没动的（= 上面 ①②③ 里的条目）
| 它列的 | 现状 |
|---|---|
| §6.2 需要你的眼睛：**夜间模式色调**、藤蔓绿 | ⏳ 未办 → 本计划 **#2 #3** |
| §6.3 技术债：P5 池化 / 63 抠图 / 435 双面 + 142 MB 贴图 / `WALL_PANEL_Z` | ⏳ **4 项一项没动** → 本计划 **#15–#19** |
| §6.4 结构性风险：**补 git** | ⏳ 未办 → 本计划 **#4** |
| §6.5 可选方向：发布上线 / 低端机 / 移动端 | ⏳ 未办 → 本计划 **#5 #20 #21** |
| §6 未列、但本轮新发现的 | 8 个死文件、`/demos/` 430 KB 无关 demo、`.workbuddy-ai` 211 MB、`.DS_Store`×9 → **#8–#13** |

### ⚠️ 它的文档里已过期的地方
- §1 环境表写「dev server 5199 还活着」→ 实际早已停。
- §8 文档地图指向 `profile/.workbuddy-ai/memory/`（该目录**今晚已删**）与旧版 `` → 已由新版 `HANDOFF.md` 取代。
- §2 记录的工作只到 **16:50**；当天 **16:50–19:35 的 5 个章节**当时**没进本项目日志**（只存在 profile 那份里）
  → **已补全**：本项目 `2026-10-07.md` 37,854 → **63,019 B**。
- §3 的"已验证状态"仍是有效基线（但注意：评审类数字**只认 `harness/scene-stats.mjs` 这一把尺子**）。

### 它做对的地方（值得保留）
- ✅ 排除了「是 `mv dist` 引起的」（19:40 执行，失败从 19:37 开始）—— 判断正确。
- ✅ 三段报错原文摘录准确，为这次定位省了大量时间。
- ✅ §4「关键坑」全部有效，已并入 `MEMORY.md`。
- ✅ §7 主动提醒 `TODO.md` 是上游遗留 —— 这个提醒避免了一次误判。
