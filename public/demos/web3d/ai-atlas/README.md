# 图鉴 · ATLAS — 24 件工具卡片墙

24 件 iskill 工具的卡片墙：一面围着观众的弧形展墙，卡片随滚动在深度里移动，点开就是该项目自己的页面（全屏浮层，四边 24px）。纯 CSS 3D + WebGL 背景，没有一张位图。

- 入口：`index.html`
- 在线预览：`/demos/web3d/ai-atlas/`
- 调试参数：`?theme=light|dark`、`?lang=zh|en`（不给就**随系统**）

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
