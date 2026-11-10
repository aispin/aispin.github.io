# AI 卡片墙 — 24 件工具

24 件 iskill 工具的卡片墙：一面围着观众的弧形展墙，卡片随滚动在深度里移动，点开就是该项目自己的页面（全屏浮层，四边 24px）。纯 CSS 3D + WebGL 背景，没有一张位图。

- 入口：`index.html`
- 在线预览：`/demos/web3d/ai-atlas/`
- 调试参数：`?theme=light|dark`、`?lang=zh|en`（不给就**随系统**）、`?dust=0`（关掉粒子）
- 🔴 名字：2026-11-10 房间定名 **「AI」**（原来叫「AI+」）。这个 demo 之前叫「图鉴 / ATLAS」，
  已同步改成 `AI` —— 站上不能一个东西两个名字。**目录名 `ai-atlas` 是历史，不改**
  （URL 要稳，`demos.json`、缩略图、探针都按这个路径）。

## 背景：一团冷光 + 一层尘

2026-11-09 按用户要求，把原来那条 `sin(p.y*420)` 的横向扫描线换成**飘动的粒子**
（配方取自 `ai-symbiosis` 的浮尘：每点自己的相位闪烁、近大远小、按深度吃视差）。
点云铺在"屏高 = 1"的平面上（和背景 shader 同一套坐标），只留一个 depth 做假透视 ——
卡片墙是平的，粒子真立体了会跟墙打架。滚动时整层按 0.00022 px 上移（比卡片慢，
所以在卡片后面）；`prefers-reduced-motion` 下整层钉住不动。

混合模式跟主题走：深色 additive（点是光），浅色 normal（点是纸上的墨）——
additive 在奶油纸上会直接烧白。调密度/大小/速度看 `VS_PTS` 里的
`ptCount`（`resizeGL`，面积/600）、`gl_PointSize`、`vx/vy`。

## 主题与语言（搬进 3D 房间前必读）

这个页面**没有**切换图标，也不该有 —— 深/浅色和中/英都由 3D 房子统一控制
（房子那边是 `SitePreferences` 写 `html[data-theme]` / `html[lang]`）。
`public/demos/_env.js` 只是让独立页面能模拟这套环境：

```
?theme= / ?lang=   >   宿主预写的 <html data-theme> / <html data-lang>   >   系统
```

解析结果写进 `html[data-theme]` / `data-lang` / `lang` / `color-scheme`，
并通过 `stageEnv.onChange` 通知页面。宿主后来改 `data-*` 或派
`aispin-language-change`，整页跟着重画（文案、封面、色相、WebGL 底）。

🔴 `_env.js` 里写属性前必须先判等：`setAttribute` 写同值也会派发 MutationRecord，
observer 再调 `apply` 就是自激死循环 —— 切一次主题页面直接卡死。

## 浅色不是把深色反相

墙要比纸再深一档（墙 `#F7EDDE` / 卡 `#FFFDF8`），全用 `#FFF6E9` 会糊成一片；
封面的「信号图」换墨色并把 alpha 提 2.1 倍，否则 1px 细线在纸上消失；
卡片色相从 `74% 62%` 压到 `58% 33%`，WebGL 暗角收到 13%、颗粒减半。

## 英文描述从哪来

`EN` 表里的 24 条抓自每个项目自己落地页的 `assets/content.js` →
`lang.en.meta.description`（同一句话、同一个作者）。有两张卡的原站 `en` 段还是中文，
那两条是手译的。卡片只放两行，`brief()` 按第一个从句截断，全文在 `title` 里。

## 搬进 3D 房间之后：手机上比这里窄一档（2026-11-09）

房间版（`src/components/ui/AiAtlasHud.jsx`）的布局是从这个 demo 搬过去的，只差**一处
约束**：房子里右上角有一排常驻控件（`.hud-cluster--right`，`right:12px` + 46px 宽），
窄屏上正好压在最后一列卡片上（badge / 编号 / 名字被盖住，那一条还点不动）。所以：

| | demo（这里） | 房间版 |
|---|---|---|
| 左右留白 | 对称 `side = 16` | `padL 14 / padR 60`（12 + 46 + 2px 呼吸） |
| 390 宽卡片 | 172.7 × 212.7（比例 1.22） | 151.7 × 205.6（比例 1.34） |
| ≤720 排版 | 只缩标题/页脚 | 另隐藏 `.card__top`、名字 13px、描述 11px、封面 42% |

卡片窄了 21px 就得把比例提到 1.34 再把编号行收掉，否则"名字两行 + 描述两行 + 页脚"
会顶出卡片（demo 版在手机上就是这么写的，只是这边卡片够宽，实测只有 2 张溢出 1px，
所以没动）。

🔴 两边一起改，但**别互相照搬**：把 60px 右槽搬回 demo 是白留一条空；把 1.22 搬回
房间会让字压在页脚上。判据见 `.workbuddy-ai/harness/probe-ai-atlas.mjs`（浮层边距、
胶囊居中、`?from=ai`）和 `probe-room-door.mjs`（点门进场 → 房间亮起 → 退出）。

