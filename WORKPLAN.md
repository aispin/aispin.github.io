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
>
> 2026-11-04 用户再次要求：**只保留待办的 WO 与未决的 DR**。
> 「已答复的 DR」整段（DR-W/Q/R/S/T/U/V、DR-1~4、DR-E、DR-P）已归档到
> `.workbuddy-ai/memory/2026-11-04.md` 末尾，本文件不再保留。

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
- **质量门** `env -u NODE_OPTIONS npm run lint` → **0 error / 32 warning**；不跑 React Compiler。
- **构建前** `mv dist .workbuddy-ai/dist-prev-<ts>`；**https push 不通就换 SSH**
  （`git push git@github.com:aispin/aispin.github.io.git <branch>`），
  判据 `gh api .../commits/<branch> --jq .sha`。
- **端口**：dev 5199 / `dist` 4199，实际只 listen **`127.0.0.1`**（不是 `[::1]`）；
  curl 加 `--noproxy '*'`。
- **跑截图前** `pkill -f "chrome-headless-shel[l]"`（带字符类，否则杀掉自己所在的 shell）。
- 其余见 `.workbuddy-ai/memory/MEMORY.md` · `hard-rules.md`。

---

# 📋 待办 WO

> **空。**
>
> 上一轮「进大门镜头晃动 + 退出大门先拉远再跳回」已修完提交并推送
> （`a1bd3ab`），判据与逐帧数据在 `.workbuddy-ai/memory/2026-11-04.md` §70。
> 更早的 WO-32 / WO-33 / WO-C1~C5、以及 `career` 时空隧道那一整批，历史都在 git。

---

# 🙋 待你拍板的 DR

### DR-F · 其余 5 个内容房间要不要也换成「隧道」这种空间？

- **背景**：`career` 现在是一整条星空隧道（自带 Scene、接管渲染、DOM HUD）。
  另外 5 个内容房间（studio / posts / videos / music / ai）仍是 `ContentRoom`
  那套 4×N 贴卡墙。**两种空间语言现在并存。**
- **为什么问**：隧道是"往里走"的纵向空间，贴卡墙是"站在屋里看一面墙"。
  同一个人从履历走进工作室，会明显感到"换了个产品"。
- **选项**：
  - **(A) 只 career 是隧道**（现状）。履历因为"在时间里穿行"这个隐喻最贴切，
    其余房间按各自内容形态保留贴卡墙。改动量 0。
  - **(B) 全部换成隧道**。统一空间语言，但 studio/videos 的内容形态（视频墙、
    播放器）在隧道里要重新设计交互；music 还要处理音频与滚动的关系。改动量大。
  - **(C) 挑一两个**（比如 posts = 文章时间线）也用隧道，其余不动。
- **代价提示**：接管渲染的房间**不能有第二个同时挂载**（`useFrame(cb,1)` 会互相覆盖），
  多个隧道房间要共用一份接管宿主，不是复制粘贴。
- **当前状态**：等你选。**默认按 (A) 不动。**

---

### DR-G · 未提交的「Levin Wong → ZEO」批量改名要不要一并落地？

- **背景**：工作区里还躺着 4 个文件的改动，与本轮镜头修复无关：
  `src/data/profile.json`、`src/data/articles.json`、`public/demos/demos.json`、
  `public/demos/index.html`。内容是 `alias: mamboer → ZEO`、
  `nameEn: Levin Wong → ZEO AI`、`wechat: mamboer → aiblaze`、
  文章 `author.url: github.com/mamboer → aispin.github.io`。
- **为什么问**：这批改动是上一个中断会话里做的，**没有验收判据**，也不知道
  是否改全（例如 `email` 仍是 `mamboer@gmail.com`）。直接提交会把"改到一半"
  的状态固化。
- **选项**：
  - **(A) 我扫一遍全仓，把旧名残留列出来，你确认后一次改净**（推荐）。
  - **(B) 按现状提交**，只当它是笔名切换，残留以后再说。
  - **(C) 全部丢弃**（`git checkout --` 这 4 个文件），维持 `Levin Wong`。
- **当前状态**：等你选。**默认不动，改动留在工作区。**
