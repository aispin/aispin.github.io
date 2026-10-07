# AISPIN 3D 个人网站 — 项目长期备忘

## 用户核心偏好（2026-10-03 确定）
- **尽量不用图片**：贴图优先 GPU shader（GLSL 程序化），道具优先 Three.js 纯几何搭建；不为视觉效果消耗 AI 生图积分（用户明确要省钱）。
- 插画类内容（树、头像等无法用几何表达且有既定资产的）可保留现有贴图。
- 端到端测试由用户自己做；agent 负责 build + 打开 preview 链接。
- 中文交流。

## 技术要点
- **品牌名 = ZEO**（2026-10-04 由 ITOM 更名；站点 aispin.github.io）。HeroText 是 3 字母拆分动画。
- **程序化表面位置**：走廊/玄关的 shader 在 `src/shaders/roomSurfaces.js`
  （WOOD_FLOOR_FRAG / WARM_WALL_FRAG / WARM_CEILING_FRAG / BASEBOARD_FRAG + `makeRoomMaterial`）；
  入口砖墙/草地 shader 在 `src/shaders/entranceTextures.js`（BRICKS_FRAG 需 `uOrigin`=平面左下角世界 XY）；
  canvas 生成器在 `src/utils/proceduralTextures.js`（`woodFloorTexture` / `trimTexture`）。
  带 paint-reveal `onBeforeCompile` 补丁的面必须用 canvas 纹理（ShaderMaterial 会打断补丁）。
- **GLSL 写在 JS 模板字符串里时，注释里绝对不能出现反引号** —— 会提前闭合模板字符串，报
  `Unexpected identifier 'xxx'`（本项目已踩 3 次）。
- 场景基本无光照依赖：大量 meshBasicMaterial；Experience.jsx 有 ambient + directional light，meshStandardMaterial 道具可正常着色。
- **禁止把 SVG 交给 three.js 当纹理**：three.js 的 WebGL 纹理是不可变存储，SVG 的第二次上传会被驱动拒绝
  （`GL_INVALID_OPERATION: ... Texture is immutable.`），上传静默失败、sampler 返回黑，且**只报 GL warn 不报 error**。
  需要图形就 canvas 现画 → `THREE.CanvasTexture`（见 `src/utils/photoPlaceholder.js`）。
- react-hooks 规则严格：useTexture 结果不可变（clone + useMemo 模式）；useMemo 内不能用 Math.random（purity 规则）。
- 砖墙 shader 的门/窗洞几何：门拱 x±1.01、顶 y=0.75；窗 (2.5, 0.02) 半径 0.70×0.73（从原版贴图 alpha 测得）。改动砖墙时勿丢。
- SW 缓存版本 aispin-v2；同文件名换内容时必须 bump。
- Bash 命令始终加 `cd /Volumes/Pluto/dev/github/aispin/aispin.github.io && pwd &&` 前缀（cwd 会漂移）。
- 沙箱内 Bash 的 `grep`/`rg` 静默返回空 → 用 Grep 工具；`vite build` 的 emptyOutDir 被 safe-delete 拦 → 先 `mv dist .dist-old`。
- headless 验证：`puppeteer-core` 在 `~/.workbuddy-ai/binaries/node/workspace/node_modules/`，ESM 需绝对路径 import；
  进房间用 `window.__aispin.enter()` + `teleport(id)`（`snap()` 拍不到旋转过的内容房间）。

## 死代码（勿再引用）
- `src/components/canvas/rooms/Studio/StudioRoom.jsx` 与 `FloatingCodeParticles.jsx` 无任何引用
  （studio 房间已改为 ContentRoom 卡片墙）。其 `/textures/studio/*`（34 张）应继续留在预加载清单之外。

## 待办/备注
- profile 项目已删除（在废纸篓 `/Volumes/Pluto/.Trashes/501/profile 14-35-57-682`），会话结束前勿删 `profile/README-会话占位.txt`。
- 已弃用但保留在磁盘的贴图（可日后清理）：entrance 下 cat_colored / wall_bricks_2_colored / stone-path_colored / mouse_hanging / pot_with_duck / window_sketch / sign.webp / belka.webp。
- 已移出 public 的素材：`/tmp/aispin-removed/NovelHanging.scss`、`/tmp/aispin-removed/gallery-svg/`（4 个 gallery-*.svg）。
- 遗留小问题：`projects.json` 的 `thumbnail` 字段是死字段（7 个 `/projects/*` 文件不存在）；studio/about 卡片打开
  的 GlobalOverlay 因此没有配图（回落 1×1 透明 GIF）。若要做，可照 `drawCardTexture` 的思路再画一张 canvas 封面。
