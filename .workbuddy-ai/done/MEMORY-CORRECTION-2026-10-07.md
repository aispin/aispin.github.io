# ⚠️ 对 MEMORY.md 的数值纠正（2026-10-07 19:5x 补，下次会话请合并进去）

**写这份的原因**：WorkBuddy 的变更索引坏了，**已有文件一律无法修改**
（`Brokered file token refused: modify backup failed` / `modify_backup commit: Not a directory`），
只有新建文件能写。所以这份纠正只能另开文件，**请把它并回 `MEMORY.md`
的「全场景优化评审：基线数据与结案状态」一节，然后删掉本文件**。

---

## 纠正：我先前记的「结案实测」数字用错了尺子

我一度用**自写探针**量出 `726 mesh / 274 geo / 762 mat / 239 透明`，
并把它当成"优化后"写进了 MEMORY.md。**这是错的** —— 评审单用的是
`harness/scene-stats.mjs`，两者统计口径不同（稳定瞬间不同、材质去重方式不同），
**拿来自比会得出错的结论**。下面是刚用**评审单原班 harness** 在**生产构建**下复测的结果：

| 指标 | 评审时（优化前） | 2026-10-07 复测（同一 harness） |
|---|---|---|
| Mesh 总数 / 可见 | 759 / 723 | 760 / 724 |
| 三角面 总 / 可见 | 2,586 / 2,514 | 2,588 / 2,516 |
| Geometry 数 | 735（**复用 24，最大复用 2**） | **170（复用 76，最大复用 96）** |
| 材质 数 | 804 | 805 |
| 透明材质 | **477** | **322** |
| 其中抠图(alphaTest) | 219 | **63** |
| 双面材质 | 435 | **435（没动）** |
| 贴图 数 | 131 ≈ 139.2 MB | 131 ≈ **142.2 MB** |
| **draw call / 帧** | **389 静止 / 1,885 峰值** | **357 静止 / 1,259 峰值** |
| Audio 对象 | **42** | **42（listener 合并了，节点还在）** |

**教训**：评审类数字**只认同一把尺子**。跨工具比"优化前 vs 优化后"等于没测。

## 纠正：P1 / P5 的完成度（原记法不准确）

- **P1 抠图去 transparent**：219 → **63**（不是"还差 52"）。剩下的没动是**故意的**
  —— 摘掉会让它们退出透明通道，和别的透明物体之间的前后关系可能变，
  属视觉风险改动，**没有 A/B 截图验证不做**。
- **P5 的 42 个 PositionalAudio**：**listener 那半做了**（`engine/audioBus.js` +
  `SpatialAudioListener`，实测额外 listener = 0），**节点那半没做** ——
  42 个音频对象仍在场景里。评审原话是「一个 listener + 一个共享 Audio 池」。

## 数据之外：本轮真正的结论

- **A2「走廊改方砖墁地」被用户推翻**（要求改回橡木、要温馨）。
  → 评审的美学建议**优先级低于用户当场决定**。被推翻的条目标「被推翻」，别标「已完成」。
- 生产构建验证**全绿**：build 5.32s / chunk 无环 / 冒烟 726 mesh / 0 error /
  位图只剩 2 张（`avatar_zeo.webp`、`avatar-window.webp`，都是允许的）。

## ⚠️ 工具链故障（2026-10-07 19:37 起）

- 现象：`src/**` 与 `profile/.workbuddy-ai/memory/**` **的已有文件一律改不了**；
  `.workbuddy-ai/` 内可写；**任何位置新建文件可写**。
- 报错：Python 侧 `Brokered file token refused: modify backup failed`；
  Edit/Write 工具侧 `modify_backup commit: Not a directory (os error 20)`；
  沙箱外 `rm` 也是 `Operation not permitted`。
- 已排除：ACL（无）、`uchg`（flags 为 `-`）、进程占用（`lsof` 空）、目录权限（可写）。
- 定位：备份存储是 `~/.workbuddy_cache/.workbuddy-ai/changes-index|changes-detail/`，
  本会话的 change-set `24ff3190-78c3-47b0-9869-c88150a81d4a` 的索引 131 KB
  （另一会话只有 34 KB），**19:39 之后就不再更新** —— 与故障起点吻合。
  怀疑与本次会话里 `mv dist .workbuddy-ai/dist-old-*`（整个构建目录的增删）有关。
- **处置：重启 WorkBuddy**。重启会开新的 change-set，大概率恢复。
- 另外两个 `.workbuddy-ai/cleanup-*.md` 也因同一故障删不掉，需在 **Finder 手动删**。
