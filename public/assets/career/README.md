# 项目截图

`public/assets/career/` —— 站内 `/career` 房间和 `public/demos/web3d/career/` 的 demo
**共用这一份**（各 1.7MB 复制两遍没必要）。两边的取图前缀：

| 消费者 | 前缀 | 在哪定义 |
|---|---|---|
| 站内 | `/assets/career/` | `src/utils/projectLink.js` 的 `SHOT_BASE` |
| demo | `../../../assets/career/` | demo `index.html` 里的 `SHOT_BASE` |

把截图放到这个目录，**文件名 = `id`**（`experiences.json` 里每个项目的 `id`）。
扩展名 `.png` / `.jpg` / `.jpeg` 都行，页面会依次尝试，找不到就显示「截图待补」占位块。

```
100.qingyuan-01.*     地铁轨道交通查询机系统        （轻远科技）  ✅
101.waima-01.*        歪马送酒微信小程序            （美团）      ✅
102.waima-02.*        歪马送酒中后台系统（供应链）  （美团）      ✅
103.linglong-01.*     京东羚珑营销内容设计平台      （京东）      ✅
104.linglong-02.*     京东千人千面内容营销          （京东）      ✅
106.gitalk.*          Gitalk                        （京东）      ✅
107.vue-easy-gantt.*  Vue-easy-gantt                （京东）      ✅
108.aotu.io.*         凹凸实验室                    （京东）      ✅
109.tencent-games.*   腾讯游戏营销活动              （腾讯）      ✅
105.tencent-qqvip.*   QQ会员                        （腾讯）      ✅
110.baidu-zhidao.*    百度知道                      （百度）      ✅
111.sohu-dashiye.*    搜狐大视野                    （搜狐）      ✅
112.m18.*             麦网 M18.COM                  （麦网）      ✅ 站点已下线，程序化文字卡
113.cognizant.*       海外软件项目                  （高知特中国）✅
```

14 个全齐。其中 `112.m18` 因为站点下线，是用 HTML/CSS 排的文字背景卡，
不是截图 —— 源文件就是同目录的 `112.m18.source.html`，改文案后重开它截图即可。

## 画幅怎么处理

- **头图跟着图片自身的比例定高**：`h = clamp(300, cw × natH/natW, 540)`。
  16:9 的图在 980 宽的卡里就是 540（封顶），**不要再为迁就框子把图裁成 2.88:1**
  —— 那是上一版的坑，横条里什么细节都看不清。
- **竖图**（< 1.25:1，手机 / 小程序截图）：自动切成 `contain` + 同图放大模糊垫底，
  头图拔高到 520px（`min(520px, 60vh)`），**整张完整显示**，不会被裁成一条。
- 左栏缩略图是 56×40：横图 `cover`，竖图 `contain`（保留手机形状）。
- 中英文共用同一套文件名（`locale` 不同、`id` 相同），截图只需放一份。
- 横图按 **1600×900** 拍，竖图宽 ≤ 900。

## 体积规范（一律 JPEG）

14 张总共 **1.7MB**，单张最大 212KB。新加图请按同一套参数压：

| 项 | 值 | 理由 |
|---|---|---|
| 格式 | JPEG，`progressive` + `optimize` | 渐进式先出糊再变清，体感更快 |
| 质量 | **q80**，`subsampling=4:2:0` | 截图文字在 q80 仍锐利；4:4:4 要多花 30% 体积 |
| 横图宽度 | **≤ 1600** | 头图框 978 宽 ⇒ 1.6x，1x 屏锐利、2x 屏略软但可接受 |
| 竖图宽度 | **≤ 900** | 竖图最大只显示 293×520 ⇒ 900 宽 ≈ 1.7x |

一条命令搞定（macOS 自带 `sips` 也能凑合，但 PIL 能控 subsampling）：

```bash
python3 - <<'PY'
from PIL import Image
im = Image.open('xxx.png').convert('RGB')
w, h = im.size
m = 900 if w / h < 1.25 else 1600
if w > m: im = im.resize((m, round(h * m / w)), Image.LANCZOS)
im.save('xxx.jpg', 'JPEG', quality=80, optimize=True, progressive=True, subsampling='4:2:0')
PY
```
