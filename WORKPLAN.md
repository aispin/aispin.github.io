# 工作计划 · aispin.github.io

> **本文件是白板，不是台账。**
>
> 只放**待办**：待做的 **WO** + 待你拍板的 **DR**。
> 🔴 **代码一提交，就把该 WO 删掉** —— **不等验收、不等下一轮**
> （用户 2026-10-08 原话：「完成的WO、关闭的DR要在**提交代码后**及时从 Workplan 移除。
> Workplan 永远只留待办 WO 和 DR」）。
> 过程记录、实测数据、踩坑结论一律进 `.workbuddy-ai/memory/`（入口 `MEMORY.md`）；
> 沉淀下来的技术结论进 `docs/`；历史在 git。
> ⚠️ 所以本文件里**不该出现「已交付，待验收」这种段落** —— 那又是台账。
>
> ⚠️ 2026-10-12 用户反馈：**「你把快照滚动当流水帐去用了」** ——
> 顶部「📊 滚动快照」段已删。**状态写进每条 WO 自己，不再另开历史段。**

## 规范

| 记号 | 是什么 | 谁做 |
| --- | --- | --- |
| **WO** | Work Order —— 需求原文 / 现状 / 改什么 / 验收判据 | 我做，你验收 |
| **DR** | Decision Request —— **必须由你做的决定** | 你 |

流程：收到需求 → 拆 WO（**影响面大的配一个 DR 请你 review**）→ 本文件单独 commit
→ 无 DR 直接做、有 DR 等你决策 → 做完发起验收 → **代码一提交就移出本文件**。
验收有分歧就作为新一轮的新 WO 重新进表（版本历史在 git）。

## 执行注意（常驻，细节在 memory）

- **分支** `feat/v1.2.0-island-courtyard`，**不推 `main`**（推 `main` = 上线）。
- **质量门** `env -u NODE_OPTIONS npm run lint` → **0 error / 33 warning**；不跑 React Compiler。
- **构建前** `mv dist .workbuddy-ai/dist-prev-<ts>`；**推不通改 SSH**，判据 `gh api .../commits/<branch> --jq .sha`。
- **跑截图前** `pkill -f chrome-headless-shell`。
- 其余见 `.workbuddy-ai/memory/MEMORY.md` · `hard-rules.md`。

---

# 📋 待办 WO

**（空）**

> WO-18（前院小飞机 + `?flight`）已提交 `1d6173a`，按白板规矩**出表**。
> 验收判据与实测数据在提交信息里，过程记录在 `.workbuddy-ai/memory/2026-10-12.md` §19。
> 新探针（5 份）：`probe-flight-path.mjs` · `probe-airplane.mjs` ·
> `probe-flight-camera.mjs` · `probe-flight-residue.mjs` · `shot-flight-multiviewport.mjs`。

---

# 🙋 待你拍板的 DR

> DR-N（类 `me` 的小模块放哪）你已答复：**源码内聚到 `src/<业务域>/`** ——
> 已按这个做掉（`41ed934`），按白板规矩**出表**。
> 你选的这条比我原来的 (C) 更干净：我提的是"源码进 `apps/`、产物改名回 `dist/`"，
> 而你说的是**把 entry 和它的模块放一起** —— 那才是真正的内聚，
> 连"源码的家"这个概念都不需要新增一层目录。

### DR-P · 「零位图」要留一个**有限放宽**的口子吗（备查，当前**不启用**）

- **你要求的**：「DR-O 按 1 做优化，**新增加一个 DR 做有限放宽的说明**」。
- **背景**：DR-K 已查明 ez-tree demo 的逼真来自**位图贴图 + glb 资产**，
  而本项目硬规矩是 **零 jpg/png（只用 webp）、全站只允许 2 张位图**。
  DR-O 选了 (i)「不放宽，继续程序化」，WO-19 已按这条做完（`f7fc1ac`）。
- **这个 DR 记录的是"万一将来顶不上去"时的退路**（**现在不动**）：
  - **可放宽的最小集合**：**2 张 webp** —— ① 树皮 **normal** 一张
    （比 color 有效得多：树皮的"糙"主要读自法线，不是颜色）；
    ② 叶片 **形状 alpha** 一张（叶缘不规整 + 叶脉，一次解决很多片叶的观感）。
  - **不放进来的**：color 贴图（我们能程序化出色）、每物种一套 4 张、
    `grass.glb` 这类模型资产（那会连带改 `public/` 与体积预算）。
  - **放开的代价**（真要启用时要同步改的地方）：README「美术」段的零位图声明、
    `.workbuddy-ai/memory/hard-rules.md` 里的相关条目、以及
    `texturePreloadList.js` 的预载清单。
  - **触发条件**（写清楚，免得变成"随手就放宽"）：WO-19 已交付（`f7fc1ac`）；
    若你验收时仍觉得**树皮**或**叶片**明显"不像"，再回来启用；启用前先量一次
    "程序化版本 vs 贴图版本"的同机位对照。
- **当前状态**：**不启用**。此条只作决策留痕。
