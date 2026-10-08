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

# 🙋 本轮待你验收（WO-01 ~ WO-05）

| WO | 一句话 | 验证证据 | 状态 |
|---|---|---|---|
| WO-01 | 盆栽树冠不再被左右裁平 | 边界墨迹 152/178 → **0/0**；`AB-pottedtree-cut.png` | 待验收 |
| WO-02 | 瓢虫缩到一半 | 屏幕墨迹 280×235 → **135×133 px**；`AB-ladybird-size.png` | 待验收 |
| WO-03 | BGM 加载完即播 | 你报了缺陷 → 已定位并修复，**请重验**（见 WO-03） | ⚠️ **重验** |
| WO-04 | gh-pages 部署脚本 | `bash -n` / `--dry-run` 通过；无 remote 时明确报错 | 待验收 |
| WO-05 | gh-pages CI workflow | YAML 解析通过；推送序列用本地 bare 仓库**实测跑通** | 待验收 |

生产冒烟（`smoke.mjs`，生产构建，72 s）→ `meshes 697` / `hasCanvas true` /
`ERRORS (0)` / 只栅格化 2 张位图。697 = 原基线 696 + 新增的瓢虫点击垫片 1。

**你说「验收通过」我就删掉这些 WO 和 DR。**

---

# DR · 已决策（验收后连同 WO 一起删）

## DR-01 · GitHub Pages 发布源 —— ✅ 你选了 **A**，已执行

- 删除 `.github/workflows/deploy.yml`（官方 artifact 流程）
- 新增 `.github/workflows/deploy-gh-pages.yml`（构建 → 强推 `gh-pages` 分支）

> **你问「能不能用 gh 改 Pages 设置」—— 能，而且比预想的简单。**
> 实测 `gh api -X PUT` 写成功（`HTTP 204 No Content`）。查下来发现
> `aispin/aispin.github.io` 的 Pages **本来就是** `Deploy from a branch`
> （`build_type: legacy`），只是分支指着 **`master`**。
> 所以 UI 上那一步其实就是**把下拉框从 `master` 换成 `gh-pages`，模式不用改**。
>
> 脚本现在每次部署前都会**只读**检查发布源（指错就告警 —— 指错是**静默不生效**的，
> GitHub 不会报错）；加 `--configure-pages` 可以直接替你改：
> ```bash
> scripts/deploy-gh-pages.sh --configure-pages --remote git@github.com:aispin/aispin.github.io.git
> ```
> ⚠️ **顺序不能反**：`gh-pages` 分支必须先存在（UI 的下拉框也只列已存在的分支）。
> 所以是「先推分支，再改发布源」。
> ⚠️ CI 里的 `GITHUB_TOKEN` 权限不够改仓库设置 —— 这步只能在本地做一次。
>
> 🔴 **但执行它等于把线上站点换掉**：`https://aispin.github.io/` 现在跑的还是**旧站**
> （`master`，标题 `Faso.ME`，最近构建 2026-09-18）。
> 推 `gh-pages` + 改发布源 = **旧站被新站替换**。**要不要现在上线，等你一句话。**

## DR-02 · 远端仓库 —— ⚠️ **前提变了，请你重新拍板**

你选的是「用 gh 新建一个」，但我一查：**仓库已经存在，而且是你的原始上游仓库。**

| | |
|---|---|
| `aispin/aispin.github.io` | **已存在**（2013-02-23 建），**PUBLIC**，不是 fork |
| 默认分支 | `dev`；另有 `main` / `master` / `v2` |
| 最近推送 | 2026-09-18 |
| 说明 | `Home of AISPIN` |

**所以没有仓库可建。** 而且两边历史**无关**：本地是新起的 29 个提交
（基线 `259ed2f 建立版本管理基线（此前的仓库历史已丢失）`），远端是 2013 年以来的老历史。
→ `git push origin main` 会**撞上远端的 `main`**（非快进，必须强推），**不能乱推**。

| 选项 | 做法 | 后果 |
|---|---|---|
| **A. 只推 `gh-pages`**（推荐） | 只把 `dist/` 推成 `gh-pages`，远端旧分支全部原样保留 | 非破坏性；站点换成新站，源码历史仍只在本地 |
| **B. 再推一个源码分支** | 本地 `main` 推成远端**新**分支（如 `v3`），旧分支不动 | 源码也上了远端，但与旧历史是两条线 |
| **C. 覆盖远端 `main`** | 强推本地 `main` → 远端 `main` | ❌ 破坏性，不建议 |

我建议 **A** —— 你要的是「站点上线」，`gh-pages` 已经够了。

---

# WO · 工作条目

## WO-01 · 走廊盆栽树冠左右被垂直截断

- **需求原文**：「1、树两边似乎被垂直截断」
- **状态**：✅ **已实施，待验收**（无 DR）
- **实测**：`probe-art-edges.mjs <url> 1.8 2.99` → `inkTouchingBorder` 四边全 0，
  `inkBBox [22, 28, 574, 958]`（改前 `[0, 18, 598, 958]`，左 152 / 右 178 列墨）。
  截图 `.workbuddy-ai/art-2026-10-08/AB-pottedtree-cut.png`：左=被裁平，右=全弧线。
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
- **状态**：✅ **已实施，待验收**（无 DR）
- **实测**：屏幕上瓢虫墨迹 **280×235 px → 135×133 px**（约一半）。
  截图 `.workbuddy-ai/art-2026-10-08/AB-ladybird-size.png`。
  `test-bug-dodge.mjs` 四项断言全过：位移 0.515 / 虫叫振荡器 0→6 /
  墨点平面 0 / `BUG FIXED!` 0；垫片实测 `{parentIsMesh: true, opacity: 0}`。
- **现状**：瓢虫平面 `0.74 × 0.74`（上一轮为了让"躲点击"好点中，从 0.4 放大过）。
  墨迹占画布 9.8%..90.2%，屏幕上虫子本体约 0.59 世界单位。
- **改什么**：`EntranceDoors.jsx` 瓢虫平面 `0.74 → 0.37`。
  **同时补一个不可见的点击垫片**（0.46、`opacity 0` + `alphaTest 0.01` ——
  three 把 `opacity` 乘进 `diffuseColor.a` **在 alphaTest 之前**，所以每个片元都被丢弃）
  作为瓢虫 mesh 的子节点：缩小的是**看得见的虫**，不是**点得中的范围**，
  否则「躲点击」会退化成「点不到」。做成子节点是为了白拿父级的游走 + 躲闪。
- **验收判据**：
  1. 实拍与上一轮 0.74 的图并排比对，视觉尺寸约为一半。
  2. `test-bug-dodge.mjs` 四项断言仍全过（位移 > 0.25、有虫叫振荡器、
     无墨点平面、无 `BUG FIXED!` 文字）。

## WO-03 · 背景音乐改为「加载完资源自动播放」 ⚠️ 你报了缺陷 → 已修复，请重验

- **需求原文**：「3、目前音乐是推开门播放，是否可改为加载完资源自动开始播放」
- **状态**：⚠️ **重验**（第一版没通过 —— 你实测「BGM 没有自动播放」）
- **先回答你的疑问 —— 是的，这是浏览器的硬限制，绕不过去**：
  首访时用户还没做过任何手势，Chrome / Safari / Firefox 一律拒绝**带声音**的自动播放，
  没有任何 API 能突破（这是策略本身的目的）。唯一出路是等一次真实交互。
  所以正确行为只能是：**加载完成就请求播放；被拦则等第一次交互立刻补播。**
- **那第一版为什么"没响" —— 不只是策略，兜底逻辑本身有两处会静默失效**：
  1. `isSilentNow()` 只看 `el.paused`。被拦下的元素在某些浏览器里 `paused` 仍报
     `false` → 谎报"正在响" → `retry()` 直接 `disarm()`，**补播永不发生**。
  2. `playBackgroundMusic()` 里的 `if (el.paused)` 守卫：同一个原因，
     补播调进去也**什么都不做**。
  （合成源还有第三处：`startSynthBgm()` 的 `if (s.playing) return`，
  而被挂起的 AudioContext `playing` 同样是 `true`。）
- **改什么**：
  1. `isSilentNow()` 改判「真有声音出来」：mp3 用 `!paused && currentTime > 0`；
     合成用新增的 `synth.audible`（= `playing && ctx.state === 'running'`）。
  2. `playBackgroundMusic()` 去掉 `el.paused` 守卫（对已在播的元素再调 `play()` 无害；
     `pauseBackgroundMusic` 全仓库无人调用，不存在"用户暂停后不该续播"的顾虑）。
  3. `startSynthBgm()` 在 `playing && !audible` 时调 `unlock()` 唤醒上下文。
  4. `NotAllowedError` 不再当错误刷控制台（它是预期内的）。
- **实测**（`test-bgm-fallback.mjs`，生产构建，**确定性打桩** ——
  把 `play()` 打桩成返回 `NotAllowedError`，在"第一次手势"时解除打桩）：
  | 模式 | 加载完成被拦下 | 手势后补播 | 补播来自兜底 |
  |---|---|---|---|
  | `natural`（被拦时 `paused` 保持 true） | ✅ | ✅ `currentTime 0→0.24` | ✅ play 1→2 |
  | `paused-false`（对抗：强制 `paused` 谎报 false） | ✅ | ✅ `currentTime 0→0.28` | ✅ play 1→2 |
  > 🔴 **无头环境复现不出真实策略**：`chrome-headless-shell` **根本不执行**自动播放策略，
  > 换完整 Chrome 的 `headless: true` 也一样（`userActivation` 一开始就是 `true`）。
  > 所以这里测的是**我写的兜底代码**，不是浏览器策略 —— 后者只能人工验。
- **请你这样重验**：刷新页面 → **不碰鼠标**等进度走完 → 应**无声**（预期，不是 bug）；
  → **点一下页面任意位置** → 音乐应**立刻响起**。点了还不响才是真 bug。

## WO-04 · gh-pages 构建并推送脚本（本地）

- **需求原文**：「4、撰写构建并推送 gh-pages 分支的脚本以及 workflow 文件。」
- **状态**：✅ **脚本已实施，待验收**；workflow 见 WO-05（已写好）。
  **真跑一次要等 DR-02 拍板。**
- **实测**：`bash -n` 通过；无 remote 时明确报错退出（不静默失败）；
  `--base=/my-site/` 覆盖生效（产物里资源变成 `/my-site/assets/…`）；
  `site.json` 默认值生效；工作区脏、Project Page 不匹配都会告警。
  **发布源检查实测**：对真远端跑 `--dry-run` → 正确报出
  `⚠ Pages 发布源现在是 master，不是 gh-pages —— 推上去不会发布。`
- **改什么**：新增 `scripts/deploy-gh-pages.sh`。
  - `npm run build` → 校验 `dist/` → 在**临时目录**里 `git init` + `add` + `commit`
    → `push --force <remote> gh-pages`。**不碰工作区，也不在 `dist/` 里留 `.git`。**
  - 远端默认取 `origin`，可用 `--remote` 覆盖；取不到就**报错退出**（不静默失败）。
  - 自动判断 `base`：**以 `src/data/site.json` 的 `siteUrl` 路径名为准**
    （canonical / og:url / sitemap 都用它，是唯一真源），
    再与远端仓库形状交叉校验、不匹配就告警。**不靠仓库名猜** ——
    `aispin.github.io` 这种名字既可能是 User Page 也可能是 Project Page。
  - 支持 `--dry-run`（只构建 + 报告，不推送）与 `--message <msg>`。
  - `dist/.nojekyll` 已由 `public/.nojekyll` 带出来，脚本再确认一次。
  - **每次都会只读检查 Pages 发布源**（`gh api … /pages`），指错分支就告警；
    `--configure-pages` 可顺手改掉（`PUT`/`POST … /pages`，`build_type=legacy`）。
    需要 `gh` 已登录 + admin 权限 —— `GITHUB_TOKEN` 不够，所以只放本地、不进 CI。
  - ⚠️ 这是**强推**到 `gh-pages`：该分支是生成物，别在上面手写东西。
- **验收判据**：`bash -n` 语法通过；`--dry-run` 跑通；跑完 `dist/` 里没多出 `.git`；
  发布源指向 `gh-pages` 时脚本报 `✔`、指向别处时报 `⚠` 并给出改法。

## WO-05 · gh-pages 分支 CI workflow

- **需求原文**：同上（「以及 workflow 文件」）
- **状态**：✅ **已实施，待验收**（DR-01 已决策为 **A**）
- **改什么**：
  - 新增 `.github/workflows/deploy-gh-pages.yml`；**删除** `.github/workflows/deploy.yml`。
  - `push` 到 `main` 或手动触发 → `npm ci` → `npm run build`。
  - 校验 `dist/index.html` / `me/index.html` / `404.html` 都在；补 `.nojekyll`。
  - **守卫**：`dist/` 里出现 jpg/png 直接失败（仓库视觉约定：零 jpg/png）。
  - 在 `dist/` 里 `git init` + `symbolic-ref HEAD refs/heads/gh-pages` + commit
    → `push --force` 到 `gh-pages`。
  - 用 `symbolic-ref` 而非 `git init -b`（后者要 git ≥ 2.28，这样更保险）。
  - `permissions: contents: write`（推分支不需要 `pages` / `id-token`，那是 artifact 流程用的）。
- **验收判据**：
  1. YAML 能解析 —— 已用 PyYAML 验过（6 个 step、`on`/`permissions` 都对）。
  2. **推送序列实测跑通**：拿本地 bare 仓库当远端跑了一遍 → `gh-pages` 建出来，
     `index.html` / `me/index.html` / `404.html` / `.nojekyll` 全在，
     且**真实 `dist/` 没被 `.git` 污染**。
  3. 真上线还要等 DR-02 拍板；Pages 源不必手点 —— `scripts/deploy-gh-pages.sh --configure-pages` 直接改。

---

# 现状快照

| | |
|---|---|
| 版本管理 | git；本地 **29 个提交**（新起历史），**没有 remote**（见 DR-02）；`.workbuddy-ai/` 已排除 |
| 远端 | `aispin/aispin.github.io` **已存在**（2013-02-23 起，PUBLIC，默认分支 `dev`，另有 `main`/`master`/`v2`）—— 与本地历史**无关** |
| 线上 | `https://aispin.github.io/` 现在跑的是**旧站**（Pages 源 = `master`，标题 `Faso.ME`） |
| dev server | `npx vite --port 5199 --strictPort --host 127.0.0.1`（⚠️ 必须带 `--host`） |
| 视觉约束 | 程序化 / canvas / three 生成；零 jpg/png；不用 AI 生图；全站只允许 2 张位图 |
| 基线 | meshes **697**（`smoke.mjs` 生产构建，**等 ≥65 s**）· 贴图 **59 次 / 64.5 MB**（`texture-inventory.mjs` 走廊态） |
| 部署 | GitHub Pages。Pages 源**当前 = `master`**（旧站），目标 = **`gh-pages`**（DR-01 选 A）；workflow `.github/workflows/deploy-gh-pages.yml`；本地脚本 `scripts/deploy-gh-pages.sh`（`--configure-pages` 可改 Pages 源）。**真上线待 DR-02 拍板** |
| 备注 | `public/demos/demos.json` 是构建插件生成的（每次 dev/preview 启动刷新 `generatedAt`）→ 会让工作区变脏，提交前 `git checkout --` 掉 |
