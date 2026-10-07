# AISPIN 3D Home — 项目说明（给 AI agent 看）

> **先读这一份。** 这是 ZEO（黄泽昊）的个人主页，不是上游那个项目 ——
> 仓库虽然源自 Tomasz Szmajda 的 `portfolio-itom`，但**主题、美术、架构都已重做**。
> 见到 "Portfolio ITOM"、"黑白手绘"、"React 18"、"Gallery 挂衣绳 / Studio 显示器塔"
> 之类的描述一律是过期信息。

## 这是什么

一个可以走进去的 3D 个人主页：**宋式院子 → 推开大门 → 无限走廊 → 8 个房间**。
纯前端，无后端，内容全在 `src/data/*.json`。

房间（`src/config/theme.js` 的 `ROOMS`）：
`about 档案` · `gallery 摄影` · `studio 工作室` · `posts 文稿` ·
`videos 视频` · `music 音乐` · `ai AI+` · `contact 联系`

## 技术栈

React 19 · Vite 7 · three 0.182 · @react-three/fiber 9 · drei 10 · GSAP 3.14 · SCSS

## 硬约束（改动前必须知道）

1. **美术全部程序化生成**，不用图片素材。生成器在 `src/utils/*Art.js`，
   GLSL 在 `src/shaders/`。全站位图只剩一张头像 webp。
2. **不用 AI 生图** —— **唯一例外是人物/角色**（招手 IP、窗口人物）。
3. **确定性**：不许 `Math.random()`，只用 `engine/art.js` 的 `seededRand(key)`。
   否则每次刷新贴图都不一样。
4. **3D 场景字体必须用 woff 且必须覆盖所有可能出现的字** —— 缺字会让 troika
   回退到 `cdn.jsdelivr.net`，国内不可达，promise 被拒后 drei 的 `<Text>`
   永远不同步，**整个 R3F 场景一起挂住**。详见 README 的「字体」一节。
5. **`manualChunks` 不许用 `id.includes('包名')`**，必须走 `vite.config.js` 的
   `packageOf()` —— 嵌套依赖会让子串判断误分类，造出循环 chunk，**生产白屏**。

## 可复用引擎层 `src/engine/`

新站可以直接抄这三块，不要再各写一份：

| 模块 | 提供 |
|---|---|
| `art.js` | `seededRand` `hashString` `makeCanvas` `rgba` `withAlpha` `roundRectPath` `alphaBBox` `fitToCanvas` `makeTexture` `createTextureCache` |
| `resources.js` | `sharedGeometry(type, ...)` + `PRIMITIVES`、材质/几何缓存、`cutoutMaterial`、`worldUvPlane` |
| `audioBus.js` | `sharedListener()` —— 全站唯一的 `AudioListener` |

## 空间模型

走廊是**真环**：`SEGMENT_LENGTH = 80`，`zOffset = 10 - segmentIndex * 80`，
房间按 `segmentIndex % 2` 在 `LOOP_SPACES` 的两个空间之间轮转，周期 160。
环境（墙/地板/涂鸦/双开门）本身就按 80 重复。**新增房间 = 纯加数据**。

## 验证方式

改动后**不要靠肉眼看**，用 `.workbuddy-ai/harness/` 里的脚本：

| 脚本 | 用途 |
|---|---|
| `scene-stats.mjs` | 场景结构性统计（mesh / geometry / 材质 / draw call） |
| `geo-audit.mjs` | 几何体复用审计（按类型+参数签名分组） |
| `engine-demo.mjs` | 三个 engine 模块的自检 + 现场 listener 断言 |
| `shots.mjs` | 无头截图（含 `hideUI`） |
| `smoke.mjs` | 冒烟：页面错误 / console 错误 / 失败请求 |
| `chunk-graph.mjs` | 生产 chunk 依赖图 + 环检测 |

**两个已知陷阱**：
- 走廊场景**本质不确定**（挂载段数随滚动位置变），截图**不能**当回归测试；
  要验证几何改动请用 `geo-audit.mjs` 的结构对比。
- app 首次绘制后会**整页 reload**，`window.__scene` / `window.__cam` 会被替换；
  任何轮询谓词都要写 `if (!window.__scene) return false;` 守卫。

## 仓库状态

- **不受 git 管理**（`.git` 已被移除）。任何删除都不可逆 ——
  大改动前先归档到 `.workbuddy-ai/*.tar.gz`。
- 沙箱里 `rm -rf` 和 `vite build` 的 `prepareOutDir` 会被拦，
  删目录改用 Python `shutil.rmtree`。
- Bash 里的 `grep` / `rg` 在本沙箱**静默返回空**，要用 Grep 工具或 Python 扫描。
