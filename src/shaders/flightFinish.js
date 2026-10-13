/**
 * 飞行视图的「单趟电影后期」—— 颗粒 + 辉光 + 饱和度（WO-29，2026-10-13）。
 * ==================================================================
 *
 * 用户第三轮需求：「**飞行试图上「单趟电影后期」（颗粒 + 辉光）**」。
 * DR-Q 定：**(A) 只限飞行视图** —— 不飞行时完全不接管渲染。
 *
 * 参考实现是 `sunset-flight-study/src/anime-renderer.js` 的
 * `createAnimeFinishMaterial`：场景先渲进一张 `WebGLRenderTarget`，
 * 再一趟全屏 quad 加 8 向辉光 + 饱和度 + 颗粒。
 *
 * ---------------------------------------------------------------------------
 * 🔴🔴 本项目特有的坑：那一趟的**色彩空间必须按 sRGB 走**（否则静默错色）
 * ---------------------------------------------------------------------------
 * 参考实现里 target 是 `LinearSRGBColorSpace`，而**它的所有材质**都插
 * `#include <colorspace_fragment>` ⇒ target 里是**一致的线性值**，最后那趟
 * 再统一编码一次。照抄到本项目会得到一张**混色**的 target：
 *
 *   · **内置材质**（Basic / Standard）会插那段 chunk。而 three 有一条规则：
 *     渲进**非 XR** 的 render target 时，着色器的输出色彩空间被**强制**成
 *     `LinearSRGBColorSpace`（`WebGLPrograms.getParameters` /
 *     `WebGLRenderer.setProgram` 里那一行三元）。⇒ 那段 chunk 变成空操作
 *     ⇒ **内置材质写进去的是线性值**。
 *   · **本项目的自定义 `ShaderMaterial` 一律不插那两个 chunk**（写的就是
 *     屏幕值 —— 见 `config/theme.js` 的 `toShaderColor()`）⇒ **写进去的是
 *     sRGB 值**。
 *
 * 两者混在一张 target 里，无论最后一趟编不编码，**必有一半是错的** ——
 * 而且错得不像 bug，像"本来就该这么暗/这么橙"。
 *
 * **做法：让 target 表现得和画布一模一样。** three 里那条三元还有一个分支：
 * `renderTarget.isXRRenderTarget === true` 时用 **target 自己的**
 * `texture.colorSpace`。所以 `FlightFinish.jsx` 里那三行缺一不可：
 *
 *   ① `rt.texture.colorSpace = THREE.SRGBColorSpace` —— 内置材质照旧过 OETF
 *   ② `rt.texture.internalFormat = 'RGBA8'`          —— 但**存储**不要 sRGB
 *   ③ `rt.isXRRenderTarget = true`                   —— 让 ① 那条生效
 *
 * 结果：target 里的值 = **画布上的值**，于是这一趟把读到的值**当屏幕值**处理，
 * 并且**绝不**再编码一次 ⇒ 所以本文件**故意不插** colorspace_fragment 那段 chunk。
 *
 * ⚠️ 反过来说：**往这个文件里加那段 chunk 就是把画面提亮一次**（双重编码）。
 *    这条注释就是防这个的。见 `docs/color-space.md`。
 *
 * ⚠️ GLSL 住在 JS 模板字面量里 —— **本文件里不许出现反引号**（连注释里也不行），
 *    引用标识符一律用「」。改完跑
 *    `python3 .workbuddy-ai/harness/check-glsl-backticks.py`
 *    和 `python3 .workbuddy-ai/harness/check-shader-uniforms.py`。
 */

/**
 * 全屏四边形。
 *
 * `PlaneGeometry(2, 2)` 的顶点本来就在 NDC 的 [-1, 1] 里，所以**不做任何矩阵
 * 变换**，直接写进裁剪空间 —— 与参考实现同一条。这也是为什么这一趟可以完全
 * 不看相机（`gl_Position` 的 z = 0、w = 1）。
 */
export const FINISH_VERT = /* glsl */ `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * 后期本体。三段：① 辉光 ② 饱和度 / 色调 ③ 颗粒。
 *
 * ⚠️ 顺序不能换：参考实现就是「先加光、再调色、最后落颗粒」——
 *    颗粒落在最后，才读得到**调过色之后**的亮度（它的振幅按亮度加权）。
 */
export const FINISH_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform float uTime;
uniform float uGrain;
uniform float uBloom;
uniform float uBloomKnee;
uniform float uSat;
uniform vec3 uTint;
uniform vec2 uResolution;

varying vec2 vUv;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
    // ⚠️ 读到的就是**屏幕值**（见文件头），不要再解码、也不要在最后编码。
    vec3 color = texture2D(tScene, vUv).rgb;

    // ---- ① 8 向辉光 ----
    // 只加不减：只有「比阈值亮」的部分才往外洒，前景原样保留
    // （参考实现的原话是 "Add only luminous spill; the unblurred
    //  foreground sample stays intact"）。
    // 8 个方向 × 2 档半径（5 px / 16 px）= 16 次取样，全在片元里，**0 新增 draw**。
    //
    // 🔴 「uBloomKnee」是**这个场景自己的**阈值，不是参考实现那个 0.62 ——
    //    参考实现的画面是黄昏（大面积暗），本项目的白天整体亮度 ≈0.72。
    //    沿用 0.62 会让**大半个画面**都超过阈值 ⇒ 辉光退化成"整体提亮"，
    //    对比度被洗掉（实测：均值 +11 灰阶，且 p50 ≈ p99）。
    //    见「FINISH_PARAMS.KNEE」的注释与「probe-flight-finish.mjs」的 F4。
    if (uBloom > 0.0) {
        vec3 knee = vec3(uBloomKnee);
        vec3 glow = vec3(0.0);
        for (int i = 0; i < 8; i++) {
            float angle = float(i) * 0.78539816;
            vec2 ray = vec2(cos(angle), sin(angle)) / uResolution;
            vec3 nearLight = texture2D(tScene, vUv + ray * 5.0).rgb;
            vec3 farLight = texture2D(tScene, vUv + ray * 16.0).rgb;
            glow += max(nearLight - knee, vec3(0.0)) * 0.075;
            glow += max(farLight - knee, vec3(0.0)) * 0.05;
        }
        color += glow * uBloom;
    }

    // ---- ② 饱和度 + 色调 ----
    // 饱和度围绕**亮度**缩放（不是简单乘），所以纯色不会爆掉。
    // uSat = 1.0 时 mix 的结果**逐位等于**原值（x*0 + y*1 = y）。
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luminance), color, uSat);
    color *= uTint;

    // ---- ③ 颗粒 ----
    // 三个来源叠起来（与参考实现同一条），因为单一噪声看起来像"脏"而不是"胶片"：
    //   paper          —— 按像素固定的底噪（纸张纤维），**不随时间动**
    //   exposureGrain  —— 每 1/12 秒换一次的曝光噪声，这才是"动"的那部分
    //   pigment        —— 极低频的颜料不匀（两个正弦拍出来）
    vec2 pixel = floor(vUv * uResolution);
    float paper = hash(pixel) - 0.5;
    float exposureGrain = hash(pixel + floor(uTime * 12.0)) - 0.5;
    float pigment = sin(pixel.y * 0.019 + sin(pixel.x * 0.013)) * 0.16;
    // 振幅按亮度加权：亮的地方颗粒明显、暗的地方几乎不动（否则暗部会全是噪点）。
    color += (paper * 0.68 + exposureGrain * 0.22 + pigment) * uGrain * (0.28 + luminance * 0.72);

    // max(..., 0)：辉光 + 颗粒在极暗处可能把某个通道压到负数，而 8 位 target
    // 会把它**回绕**成高光（一个白点）。钳一次，代价是 0。
    gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);

    // 🔴 这里**故意没有** #include <colorspace_fragment> —— 见文件头。
}
`;

/**
 * 后期参数的**唯一真源**。
 *
 * 数值直接取自参考实现（`uGrain: 0.009`、`uBloom: clamp(bloom, 0, 0.6)`
 * 传 0.24、饱和度 `1.025`、色调 `vec3(1.012, 1.002, 0.986)`）。
 *
 * ⚠️ 探针**不许自己写一份期望值** —— 它 `import` 这一份来推期望
 *    （hard-rules §28：判据自带 config 的话，常量一漂它就永远红或者假绿）。
 *    DEV 钩子 `window.__flightFinish.params` 把这份原样暴露给页面内探针。
 */
export const FINISH_PARAMS = Object.freeze({
    /** 颗粒总量。0 = 完全关掉。 */
    GRAIN: 0.009,
    /** 辉光强度。参考实现的上限是 0.6。 */
    BLOOM: 0.24,
    /**
     * 辉光的**起辉阈值**（屏幕值 0..1）。
     *
     * 🔴 参考实现写死 0.62，而那是**它那个黄昏画面**的值。本项目白天整幅
     *    亮度 ≈0.72 ⇒ 用 0.62 会让大半个画面越过阈值，辉光退化成"整体提亮"
     *    （实测：全帧均值 +11 灰阶、`p50 ≈ p99`、对比度被洗掉）。
     *    所以这一条必须按**本场景**重新定，并且可量化 —— 判据是
     *    `probe-flight-finish.mjs` 的 F4：既要"有局部光晕"（`p99` 明显），
     *    又要"没有整体提亮"（全帧均值几乎不动）。
     */
    KNEE: 0.86,
    /** 饱和度倍率。1 = 不动。 */
    SAT: 1.025,
    /** 每通道色调。全 1 = 不动。**屏幕值空间的乘数**，不是线性色。 */
    TINT: Object.freeze([1.012, 1.002, 0.986]),
});

/** 「什么都不做」的参数组 —— 这一趟必须逐位等于直出（探针 F1 用的就是它）。 */
export const FINISH_IDENTITY = Object.freeze({
    GRAIN: 0,
    BLOOM: 0,
    KNEE: 0.86,
    SAT: 1,
    TINT: Object.freeze([1, 1, 1]),
});
