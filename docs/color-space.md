# 色彩空间 · render target 那一趟（WO-29）

> 为什么会有这份文档：飞行视图的「单趟电影后期」把场景**先渲进一张
> `WebGLRenderTarget`**，再拿一趟全屏 quad 出到画布。这个改动**会静默错色** ——
> 症状是"飞机一升空画面整体变暗变橙"，看着不像 bug，像"天上光本来就不一样"。
> 这份文档是**取证结果**，不是猜测：每一条都在 `node_modules/three/build/`
> 的源码里对过，并且有逐像素判据（`probe-flight-finish.mjs` 的 F1）守着。

---

## 1. 结论先写（三行缺一不可）

`src/components/canvas/entrance/FlightFinish.jsx` 的 `buildRig()` 里：

```js
const target = new THREE.WebGLRenderTarget(1, 1, {
    // …
    colorSpace: THREE.SRGBColorSpace,   // ①
    internalFormat: 'RGBA8',            // ③
    // …
});
target.isXRRenderTarget = true;         // ② 🔴 这一行是钥匙
```

外加一条**纪律**：出画布的那一趟（`src/shaders/flightFinish.js` 的片元）
**故意不插** `#include <colorspace_fragment>` —— 它把读到的值**当屏幕值**处理，
**不再编码一次**。

---

## 2. 机制：three 怎么决定着色器的输出色彩空间

`three` 里那条三元出现在**两个**地方（`WebGLPrograms.getParameters` 与
`WebGLRenderer.setProgram`，0.182 的 `three.module.js` 里两处逐字相同）：

```js
const colorSpace = ( _currentRenderTarget === null )
    ? _this.outputColorSpace
    : ( _currentRenderTarget.isXRRenderTarget === true
        ? _currentRenderTarget.texture.colorSpace
        : LinearSRGBColorSpace );
```

读法：

| 渲到哪 | 着色器拿到的 `outputColorSpace` |
|---|---|
| **画布**（`_currentRenderTarget === null`） | `renderer.outputColorSpace`（本项目 = sRGB） |
| **普通 render target** | `LinearSRGBColorSpace`（**被强制**，与 target 自己怎么配无关） |
| **`isXRRenderTarget === true` 的 target** | target 自己的 `texture.colorSpace` ← **唯一能"跟着我配"的分支** |

而内置材质的片元里插着：

```glsl
#include <colorspace_fragment>
```

它做的事就是"按 `outputColorSpace` 把值编码一次"。于是：

* 渲进**普通** target ⇒ `outputColorSpace = LinearSRGBColorSpace` ⇒ 那段 chunk
  在 sRGB 输出下**是空操作** ⇒ 内置材质写进去的是**线性值**。

**这就是 ② 存在的唯一理由**：不设 `isXRRenderTarget`，①（`texture.colorSpace`）
根本不会被采纳。

---

## 3. 为什么本项目比参考实现难：两种材质写进去的量纲不一样

参考实现（`sunset-flight-study/src/anime-renderer.js`）用 `LinearSRGBColorSpace`
的 target 是**对的** —— 因为它**所有**材质都插那段 chunk，target 里是
**一致的线性值**，最后一趟统一编码一次。

本项目不是。**自定义 `ShaderMaterial` 一律不插那两个 chunk**：它们写的
**本来就是屏幕值**（`src/config/theme.js` 的 `toShaderColor()` /
`convertLinearToSRGB()` 就是干这个的）。于是同一张 target 里：

| 材质 | 写进 target 的量纲 |
|---|---|
| 内置（Basic / Standard，如飞机） | **线性值**（被 three 强制） |
| 自定义 `ShaderMaterial`（地面 / 森林 / 草 / 天空…） | **sRGB 值**（屏幕值） |

两种量纲混在一起，**最后一趟无论编不编码，必有一半是错的**。这就是"照着参考
实现抄会翻车"的原因：抄的是它的 target 配置，而它的前提（所有材质都插 chunk）
在本项目**不成立**。

**所以做法不是去改几百个材质，而是让 target 表现得和画布一模一样** ——
`isXRRenderTarget = true` 之后，内置材质照旧过 OETF（与画布一致），自定义
材质照旧写屏幕值（与画布一致）⇒ **target 里就是画布上的值**。

---

## 4. ③ `internalFormat` 为什么必须显式钉死

只写 ① ② 的话，`WebGLTextures.getInternalFormat` 会因为
`texture.colorSpace === SRGBColorSpace` 把**存储格式**选成 `SRGB8_ALPHA8`
（硬件 sRGB），于是**硬件再编一次码**：

```
着色器写 sRGB 值 → 硬件又 OETF 一次 → 双重编码（整体提亮、发灰）
```

显式给 `internalFormat: 'RGBA8'` 会让 `getInternalFormat` **直接短路**返回
`gl.RGBA8` ⇒ 存储是普通 8 位 ⇒ **写进去什么、读出来就是什么**。

⚠️ 这一行要管**两处**：MSAA 那条路上「多采样 renderbuffer」（`renderbufferStorageMultisample`）
与「解析用贴图」都会走 `getInternalFormat`。显式 `internalFormat` 把两处一起钉住 ——
本项目画布 `SAMPLES = 4`，走的就是 MSAA 这条路，**不是**可选的。

---

## 5. 出画布那一趟的纪律

`src/shaders/flightFinish.js` 的片元**故意没有**：

```glsl
#include <colorspace_fragment>   // 🔴 加回来 = 把画面提亮一次（双重编码）
```

因为读到的已经是屏幕值。这条纪律写在那个文件的注释里，**就是为了防"顺手补上"**。

⚠️ 另外两条同源纪律：

* **GLSL 住在 JS 模板字面量里 ⇒ 那个文件里不许出现反引号**（连注释里也不行，
  一个反引号就会把 shader 截断）。引用标识符一律用「」。判据：
  `python3 .workbuddy-ai/harness/check-glsl-backticks.py`。
  这条是 2026-10-13 真踩到的：`uBloomKnee` 两处反引号让整个模块**语法错误**，
  而 `import` 它的探针只报 `SyntaxError: Unexpected identifier`。
* 用到的 `uniform` 必须**声明**，否则 three **不报错**、材质静默什么都不画。
  判据：`python3 .workbuddy-ai/harness/check-shader-uniforms.py`。

---

## 6. 怎么验证（判据）

`probe-flight-finish.mjs` 的 **F1 恒等往返**：把这一趟的参数设成
`FINISH_IDENTITY`（`GRAIN 0 / BLOOM 0 / SAT 1 / TINT [1,1,1]`），逐像素比对
"经过 target 一趟"与"R3F 直出"**同一帧**的画面。色彩空间写错一个方向，
这条就会**大**幅不过。

实测（2026-10-13，1600×900，`?nolight&flight&t=6&season=spring`）：

```
恒等往返 meanAbs 0.0021（0..255）· max 1 · 不同像素 0.47%（只在几何边缘）
```

阈值是 `meanAbs ≤ 0.35` 且「不同像素占比 ≤ 6%」。两边多采样数已对齐（F0 断言
`target.samples === 画布 SAMPLES`），所以剩下那点差异只有 **MSAA 解析方式**
（画布由驱动隐式解析、target 走一次 blit），只落在几何边缘。

量级对比：sRGB 与线性在中灰（屏幕值 0.72）差到 0.48，是**几十个灰阶的全局
偏移**。所以这条判据离"真错"有**两个数量级**的余量，不会假绿。

---

## 7. ⚠️ 量这条判据的前置条件：先把画面钉住

两条缺一不可，否则量到的**不是**色彩空间：

1. **时钟**。场景是 `state.clock.elapsedTime` 的纯函数，把
   `Clock.prototype.getDelta` 打桩成"钉在 T、返回 0"，所有 `uTime` 就恒定。
   判据：同一组参数连抓两帧，逐像素差必须**恰好是 0**（`probe` 的 F0b）。
2. **等画面自己稳下来**。本项目有一套**按 fps 自动降档**的性能分级
   （`App.jsx` 的 `<PerformanceMonitor onDecline={downgradeTier} />`），而 LOW 档
   会改 `DreamForest` 的**树数**（`lowTier`）⇒ **同一个页面在载入后 ~60 s 会
   自己换一次画面，之后再也不变**。不等它，就会量到"3.7 灰阶的整体偏移"，
   看着完全像编码错了一次。

   判据与工具：`.workbuddy-ai/harness/lib/frame-capture.mjs` 的
   `settleFrames()`（连续若干帧指纹相同、且稳定窗口本身够长才算数）。

> 这两条合起来是一句话：**先证明"画面是确定的"，再谈"画面变了没有"。**
