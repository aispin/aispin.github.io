/**
 * 天空里的云（WO-20，2026-10-12）。
 * ==================================================================
 *
 * 用户：「飞机飞行的效果没有案例好，能尽量对齐吗？**包括天空、云彩这些**。」
 *
 * 这一份只做**上色**。云的**形状**来自 `utils/cloudArt.js` 的程序化水墨素描
 * （白身 + 墨线描边 + 腹灰），摆位来自 `config/skyClouds.js`。
 *
 * ---------------------------------------------------------------------------
 * 为什么"上色"要写在着色器里，而不是用现成的 `utils/colorizeCloud`
 * ---------------------------------------------------------------------------
 * `colorizeCloud` 是把色调**烤进一张 canvas**（`destination-in` + `multiply`），
 * 一张素描 × 一个色调 = 一张新贴图。摄影室里用得起，因为那里的云**不换色**。
 *
 * 天空里的云不行：它的颜色要跟**昼夜过渡**一起变（0.9 秒内每帧都在动）。
 * 每帧重烤一张 512×h 的 canvas 是不可能的。
 *
 * 所以这里把素描当**灰度遮罩**用（`s.rgb` 就是"白身 1.0 / 墨线 0.06 /
 * 腹灰 0.7"），颜色在片元里现算 ⇒ **贴图只有三张、颜色每帧可动**。
 *
 * ---------------------------------------------------------------------------
 * 对齐了参考实现的三件事
 * ---------------------------------------------------------------------------
 * 参考实现（`sunset-world.js` 的 `createCloudMaterial`）让云"像画的"靠的是：
 *
 *   ① **分色**：`light = sunFacing*0.77 + n.y*0.24 + brush*0.20`，再按
 *      四个阈值切成四档（`uDeep/uShadow/uViolet/uLavender`）。
 *   ② **朝阳金边**：`silhouette = 1 - max(dot(n, eye))`，再按 `sunFacing`
 *      加权 —— 边亮、而且是**暖**的。
 *   ③ **距离霾**：`smoothstep(800, 6200, dist)` 化进 `uHaze`。
 *
 * 这里是平面面片（没有法线可用），所以：
 *   ① 改成**竖向渐变**（`uv.y` 顶亮底暗）+ 朝阳侧整体加暖 —— 云本来
 *      就是被上面的太阳照亮的，这个替换在观感上等价；
 *   ② 墨线**自带**（素描里就有），不需要描边 pass；
 *   ③ **照搬**，但霾的近远距离从 `scene.fog` 拷（本项目一贯做法，
 *      见 `shaders/airplane.js`），这样云和树/房子/飞机是同一层空气。
 *
 * ⚠️ GLSL 住在 JS 模板字面量里 —— **本文件里不许出现反引号**，
 *    引用标识符一律用「」。改完跑
 *    `python3 .workbuddy-ai/harness/check-glsl-backticks.py`。
 */

export const CLOUD_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vW;
varying float vDepth;

void main() {
    vUv = uv;
    // 面片是 billboard（每帧由 CPU 写进 instanceMatrix），所以这里只做常规变换。
    // ⚠️ 「instanceMatrix」是 three 在 InstancedMesh 上**自动声明**的属性
    //    （WebGLProgram 的前缀里有「#ifdef USE_INSTANCING attribute mat4
    //    instanceMatrix;」），自定义 ShaderMaterial 一样能拿到。
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vec4 mv = viewMatrix * wp;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
}
`;

export const CLOUD_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uGold;
uniform vec3 uSunDir;
uniform vec3 uHaze;
uniform float uHazeNear;
uniform float uHazeFar;
uniform float uOpacity;
uniform float uInk;
uniform float uGoldAmt;

varying vec2 vUv;
varying vec3 vW;
varying float vDepth;

void main() {
    // 素描：白身 + 墨线 + 腹灰。**当灰度遮罩用**，颜色下面现算。
    vec4 s = texture2D(uMap, vUv);
    float a = s.a * uOpacity;
    if (a < 0.004) discard;

    // ① 分色：底暗顶亮。云是被**上面**的太阳照亮的，所以这个替换与
    //    参考实现的"按法线分档"在观感上等价。
    vec3 c = mix(uBottom, uTop, vUv.y);

    // ② 朝阳暖边：
    //    · 顶边染金（「pow(uv.y, 2.2)」—— 只在最上面那一小条）
    //    · 整朵云再按"它在太阳那一侧吗"整体加暖（对应参考实现的
    //      「sunward」那一项，它同样是把云整体往暖色推）
    vec3 toCloud = normalize(vW - cameraPosition);
    float sunFacing = max(dot(toCloud, uSunDir), 0.0);
    c = mix(c, uGold, pow(vUv.y, 2.2) * uGoldAmt);
    c = mix(c, uGold, pow(sunFacing, 2.0) * uGoldAmt * 0.62);

    // 墨线：「s.rgb」是灰度，乘上去就把描边和腹灰带回来了。
    // uInk 略小于 1 —— 纯 0 的墨线在自定义光照下是个洞。
    c *= mix(vec3(1.0), s.rgb, uInk);

    // ③ 距离霾：和飞机 / 两棵树 / 竹林**同一条** —— 每帧从 scene.fog 拷。
    //    这保证换季、入夜时云和世界一起变，不会出现"云还亮着、地已经黑了"。
    c = mix(c, uHaze, smoothstep(uHazeNear, uHazeFar, vDepth));

    gl_FragColor = vec4(c, a);
}
`;

/**
 * 云的 uniform 骨架。
 *
 * ⚠️ **颜色不在这里定死** —— `uTop` / `uBottom` / `uGold` / `uHaze` 都由
 *    `SkyClouds.jsx` 每帧从**天空穹顶的 uniform** 与 `scene.fog` 派生。
 *    这里只给形状参数（不透明度 / 墨线强度 / 暖边强度）。
 */
export const CLOUD_SHAPE = Object.freeze({
    /** 整体不透明度。云不是实心的 —— 留一点让天光透过来。 */
    OPACITY: 0.92,
    /** 墨线强度（乘 `s.rgb` 的混合比）。 */
    INK: 0.94,
    /** 暖边强度。 */
    GOLD_AMT: 0.30,
});
