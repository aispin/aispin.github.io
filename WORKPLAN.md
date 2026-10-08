# 工作计划 · aispin.github.io

> **本文件只放 WO 和 DR，不写过程记录。**
> 过程记录、实测数据、踩坑结论一律在 `.workbuddy-ai/memory/`（入口 `MEMORY.md`）。

## 规范

| 记号 | 是什么 | 谁做 |
|---|---|---|
| **WO** | Work Order —— 一条需求的拆解：需求原文 / 现状 / 改什么 / 验收判据 | 我做，你验收 |
| **DR** | Decision Request —— **必须由你做的决定** | 你 |

流程：

1. 收到需求 → 拆成 WO；**影响面大的，必须配一个 DR 请你 review WO**。
2. 写完本文件**单独 commit**（交给 git 管版本）。
3. 无 DR 的 WO → **直接开搞**；有 DR 的 WO → **等你决策完再开搞**。
4. 做完**发起验收**。你验收后我删掉该 WO 和 DR。
5. 新一轮迭代开始时，WO 与 DR 都应该是空的。

---

# DR · 等你决策

## DR-01 · GitHub Pages 的发布源用哪个？（阻塞 WO-05）

Pages 的发布源是**单选**，下面两条路只能留一条：

| 选项 | 做法 | 代价 |
|---|---|---|
| **A. 换成 gh-pages 分支** | 删掉现有 `.github/workflows/deploy.yml`，改用你要求的「构建 → 推 `gh-pages` 分支」；Pages 设置改成 *Deploy from a branch → gh-pages* | 放弃官方 artifact 流程（换来的好处：分支里就是 `dist` 的原样，好排查） |
| **B. 保留 `deploy.yml`** | 现有 workflow 走官方 `actions/deploy-pages` artifact 流程；`gh-pages` workflow 改成**只在手动触发** | 你要求的"推分支"就不是主路径了 |
| **C. 两个都留** | — | ❌ 不推荐：Pages 只认一个源，另一个会一直报错，两套产物还会互相覆盖 |

**我建议 A**（与你的要求一致）。**你回一个 A / B / C 就行。**

## DR-02 · 远端仓库地址（不阻塞 WO-04 的编写，阻塞真正推送）

仓库现在**没有 remote**（`git remote -v` 为空），所以脚本和 workflow 都推不出去。
需要你给一个地址（例如 `git@github.com:<你>/aispin.github.io.git`），或者让我用 `gh` 建一个。

> 顺带确认：仓库名是 `aispin.github.io` → 属于 **User Page**，站点在**根路径**，
> 所以 Vite 的 `base` 保持 `/` 是对的。若你其实想发成 **Project Page**
> （`<你>.github.io/<仓库名>/`），说一声 —— WO-04 的脚本会自动传 `--base=/<仓库名>/`。

---

# WO · 工作条目

## WO-01 · 走廊盆栽树冠左右被垂直截断

- **需求原文**：「1、树两边似乎被垂直截断」
- **状态**：✅ 无 DR，直接做
- **定位结论**：说的是**走廊那棵盆栽**（院子那棵柿子树立案了 —— 用
  `harness/probe-art-edges.mjs` 量过，它的墨迹四边边界计数全是 0，没被裁）。
- **现状**：`makePottedTreeTexture()` 的贴图 600×997，墨迹外接框是 **x 0..598 / 600**，
  **左边界有 152 列墨、右边界有 178 列墨** —— 树冠被画布硬裁成左右两条直边。
  这是我上一轮重画引入的回归：8 个叶团里有 4 个（`±W*0.24`、`±W*0.30` 那两组）
  加上 16px 轮廓描边后横向总跨度 634 px > 画布 600 px。
- **改什么**：只动 `src/utils/corridorArt.js` 里叶团布局的横向系数（`dx` 与 `rx`），
  让「叶团并集 + 8px 半描边」落在画布内并留边距；纵向顺带把树冠顶端下移一点。
  **不动**树干、盆、叶色、渐变、描边做法。
- **验收判据**：
  1. `probe-art-edges.mjs <url> 1.8 2.99` → `inkTouchingBorder` **四边全 0**，四边边距 **≥ 20px**。
  2. 走廊实拍（`shots.mjs` 机位 `[0.93,-0.25,-45.9]`）树冠左右是**弧线**，无直边。
  3. 贴图数量不变（`texture-inventory.mjs` 上传次数仍是 59）。

## WO-02 · 瓢虫缩小一半

- **需求原文**：「2、虫子太大了，缩小一半」
- **状态**：✅ 无 DR，直接做
- **现状**：瓢虫平面 `0.74 × 0.74`（上一轮为了让"躲点击"好点中，从 0.4 放大过）。
  墨迹占画布 9.8%..90.2%，屏幕上虫子本体约 0.59 世界单位。
- **改什么**：`EntranceDoors.jsx` 瓢虫平面 `0.74 → 0.37`。
  **同时补一个不可见的点击垫片**（0.58、`opacity 0` —— `alphaTest` 会把它整片丢弃）
  作为瓢虫 mesh 的子节点：缩小的是**看得见的虫**，不是**点得中的范围**，
  否则「躲点击」会退化成「点不到」。
- **验收判据**：
  1. 实拍与上一轮 0.74 的图并排比对，视觉尺寸约为一半。
  2. `test-bug-dodge.mjs` 四项断言仍全过（位移 > 0.25、有虫叫振荡器、
     无墨点平面、无 `BUG FIXED!` 文字）。

## WO-03 · 背景音乐改为「加载完资源自动播放」

- **需求原文**：「3、目前音乐是推开门播放，是否可改为加载完资源自动开始播放」
- **状态**：✅ 无 DR，直接做
- **现状**：`playBackgroundMusic()` 只在 `EntranceDoors` 的推门 `handleClick` 里调。
- **改什么**：
  1. `Preloader` 的退出序列开始时（进度到 100%、纸撕开那一刻）调一次 —— 这就是"加载完"。
  2. 推门那处**保留**（`playBackgroundMusic` 本身幂等，是天然的手势兜底）。
  3. ⚠️ **浏览器自动播放策略**：首访时用户还没做过任何手势，`audio.play()` 会被拒。
     所以在 `audioManager.js` 加一个**一次性手势补播**：注册
     `pointerdown / keydown / touchstart`，第一次真实交互时若「已请求播放但实际没在响」
     就补播，成功即摘掉监听。**不做任何 UI 打扰**（不弹按钮、不弹 toast）。
- **验收判据**：
  1. 加载完成时 BGM 元素 / 合成器进入播放态（无头下用 `music-mute-check.mjs` 那套量）。
  2. 手动：刷新页面、不碰鼠标，进度走完后音乐响；若被策略拦，第一次点任意位置后响。
  3. 静音开关、音量滑杆、双源切换（mp3 / 合成）行为不变。

## WO-04 · gh-pages 构建并推送脚本（本地）

- **需求原文**：「4、撰写构建并推送 gh-pages 分支的脚本以及 workflow 文件。」
- **状态**：✅ 无 DR，直接做（脚本内容与远端地址无关；**真跑一次要等 DR-02**）
- **改什么**：新增 `scripts/deploy-gh-pages.sh`。
  - `npm run build` → 校验 `dist/` → 在**临时目录**里 `git init` + `add` + `commit`
    → `push --force <remote> gh-pages`。**不碰工作区，也不在 `dist/` 里留 `.git`。**
  - 远端默认取 `origin`，可用 `--remote` 覆盖；取不到就**报错退出**（不静默失败）。
  - 自动判断 `base`：仓库名是 `<owner>.github.io` → `base=/`；
    否则（Project Page）→ 自动用 `--base=/<repo>/` 重新构建。
  - 支持 `--dry-run`（只构建 + 报告，不推送）与 `--message <msg>`。
  - `dist/.nojekyll` 已由 `public/.nojekyll` 带出来，脚本再确认一次。
  - ⚠️ 这是**强推**到 `gh-pages`：该分支是生成物，别在上面手写东西。
- **验收判据**：`bash -n` 语法通过；`--dry-run` 跑通；跑完 `dist/` 里没多出 `.git`。

## WO-05 · gh-pages 分支 CI workflow

- **需求原文**：同上（「以及 workflow 文件」）
- **状态**：⛔ **被 DR-01 阻塞，先不做**
- **为什么**：它和现有 `.github/workflows/deploy.yml` 是**同一件事的两套做法**，
  Pages 的发布源只能选一个；选错会一直报错或两套产物互相覆盖。见 **DR-01**。
- **你回 A** → 我写 `.github/workflows/deploy-gh-pages.yml` 并删掉 `deploy.yml`；
  **回 B** → 我把它改成 `workflow_dispatch` 手动触发。

---

# 现状快照

| | |
|---|---|
| 版本管理 | git；**还没有 remote**（见 DR-02）；`.workbuddy-ai/` 已排除 |
| dev server | `npx vite --port 5199 --strictPort --host 127.0.0.1`（⚠️ 必须带 `--host`） |
| 视觉约束 | 程序化 / canvas / three 生成；零 jpg/png；不用 AI 生图；全站只允许 2 张位图 |
| 基线 | meshes **696**（`smoke.mjs` 生产构建，**等 ≥65 s**）· 贴图 **59 次 / 64.5 MB**（`texture-inventory.mjs` 走廊态） |
| 部署 | 目标 Cloudflare Pages（`public/_headers` / `_redirects`）；**发布暂停** |
