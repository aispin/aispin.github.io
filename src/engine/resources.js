/**
 * engine/resources — 材质、几何体的共享与「世界坐标 UV」基底
 *
 * ============================================================================
 * 这个文件要治的是一个实测出来的病：
 *
 *   759 个 mesh  →  705 个 MeshBasicMaterial、735 个 geometry
 *   其中只有 24 个 geometry 被复用（最大复用次数 2）
 *
 * 也就是说**几乎每个对象都自带一份材质和一份几何体**。三角面总数只有 2,586
 * （平均每个对象 3.4 个面），所以几何本身是白菜价 —— 贵的是 draw call：
 * 材质不共享 → 渲染器无法合批，389 次 draw call 里绝大部分是「同样的一小块
 * 木头/金属/纸」被当成不同的东西各画一遍。
 * ============================================================================
 *
 * ---------------------------------------------------------------------------
 * 三条契约
 * ---------------------------------------------------------------------------
 *
 * 1. **硬边抠图（alphaTest）不要 `transparent`。**
 *    抠图是 `discard`，写深度、不需要排序、能吃 early-Z。
 *    给它挂上 `transparent: true` 等于把它丢进透明队列：
 *      - 每帧按视距重排（O(n log n)）
 *      - 失去 early-Z 剔除
 *      - 后画的透明物必须等它，深度关系变脆
 *    而视觉上几乎没区别 —— canvas 画出来的图 alpha 只有 0 和 1，
 *    唯一的中间值是抗锯齿那 1px 边。
 *    只有**真的半透明**（opacity < 1、或者靠 alpha 做羽化渐变）才需要
 *    `transparent`。判据是「这张图的 alpha 是硬的还是软的」，不是「有没有 alpha」。
 *
 * 2. **同一种材质只建一次。**
 *    用 `createMaterialCache()`。缓存命中是一次 Map 查找，可以在 render body
 *    里直接调。
 *
 * 3. **平铺/连续图案要走世界坐标 UV，不要走 0..1 UV。**
 *    一个平面上的 `uv` 是 0..1，所以图案会在每个 mesh 边界重启 —— 地板缝会在
 *    每一块砖的边界对齐成一条直线。用 `worldUvPlane()` 把世界米数烘进 uv，
 *    图案就能连续穿过整个 mesh。注意旋转 -PI/2 的平面，它的 v 轴是**逆着**
 *    世界 +Z 的，取真世界坐标要写 `(x, z) => [x, -z]` 之类的映射。
 */

import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* 世界坐标 UV                                                          */
/* ------------------------------------------------------------------ */

/**
 * 顶点阶段：uv 里装的**不是** 0..1，而是世界米数；同时把视深传给片元。
 *
 * 为什么要传 `vViewZ`：地板和走廊墙都是掠射角看过去的，一条发丝宽的缝
 * 或者一根纸纤维在那个角度下没有 mip 可以滤，会糊成爬行的噪点。有了视深
 * 就能让细线随距离淡出（读起来像景深，其实是抗锯齿）。
 */
export const WORLD_UV_VERT = /* glsl */ `
varying vec2 vUv;
varying float vViewZ;
void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewZ = -mvPosition.z;     // 相机前方的米数
    gl_Position = projectionMatrix * mvPosition;
}
`;

/**
 * 把 PlaneGeometry 的 uv 改写成世界米数。
 *
 * `mapLocalToWorld(lx, ly)` 收到的是**平面本地**米数（以平面中心为原点），
 * 返回 `[u, v]` —— 片元 shader 会把它当 `vUv` 读。返回什么坐标系由调用方定，
 * 但必须是**全局一致的**，否则相邻 mesh 的图案接不上。
 *
 * ⚠️ 旋转 -PI/2 的平面，本地 +y 指向世界 -Z，所以「真世界坐标」要写
 * `(lx, ly) => [originX + lx, originZ - ly]`。写反了图案会在接缝处镜像，
 * 而镜像的接缝看起来和「两套调色板相接」一模一样地生硬。
 */
export function bakeWorldUVs(geometry, width, height, mapLocalToWorld) {
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
        const lx = (uv.getX(i) - 0.5) * width;
        const ly = (uv.getY(i) - 0.5) * height;
        const [u, v] = mapLocalToWorld(lx, ly);
        uv.setXY(i, u, v);
    }
    uv.needsUpdate = true;
    return geometry;
}

/** `bakeWorldUVs` 的常用形态：直接产出一块烘好 UV 的平面。 */
export function worldUvPlane(width, height, mapLocalToWorld, segments = 1) {
    return bakeWorldUVs(
        new THREE.PlaneGeometry(width, height, segments, segments),
        width,
        height,
        mapLocalToWorld
    );
}

/* ------------------------------------------------------------------ */
/* 共享缓存                                                            */
/* ------------------------------------------------------------------ */

/** 所有缓存都登记在这里，方便热更新 / 场景销毁时一次性释放。 */
const caches = new Set();

function makeCache(namespace, disposeOne) {
    const map = new Map();
    const cache = (key, factory) => {
        const full = `${namespace}:${key}`;
        const hit = map.get(full);
        if (hit) return hit;
        const made = factory();
        made.name = full;
        map.set(full, made);
        return made;
    };
    cache.namespace = namespace;
    cache.map = map;
    cache.clear = () => {
        for (const v of map.values()) disposeOne(v);
        map.clear();
        caches.delete(cache);
    };
    caches.add(cache);
    return cache;
}

/**
 * 材质缓存。
 *
 *   const mat = createMaterialCache('corridor');
 *   const woodMat = mat('table-oak', () => new THREE.MeshBasicMaterial({ color: '#8a5a2b' }));
 *
 * key 里要包含**所有会改变外观的参数**（颜色、贴图、side、opacity…），
 * 否则两个外观不同的对象会拿到同一个材质 —— 这是共享材质唯一的坑。
 */
export function createMaterialCache(namespace) {
    return makeCache(namespace, (m) => m.dispose());
}

/** 几何体缓存。桌腿、门环、瓦当、竹叶这类重复件都该从这里出。 */
export function createGeometryCache(namespace) {
    return makeCache(namespace, (g) => g.dispose());
}

/* ------------------------------------------------------------------ */
/* 共享图元                                                            */
/* ------------------------------------------------------------------ */

/**
 * 尺寸 → 构造器。**静态属性访问**，别写成 `new THREE[type + 'Geometry']` ——
 * 动态键会让打包器没法 tree-shake，把整个 three 拖进来。
 *
 * 默认值逐字抄 three.js 的（比如 SphereGeometry 是 32×16 而不是 16×12）。
 * 抄错的话，JSX 里省略了分段数的 `<sphereGeometry args={[r]} />` 换成
 * `sharedGeometry('sphere', r)` 就会悄悄改变网格密度。
 */
const PRIMITIVES = {
    plane: (w, h, ws = 1, hs = 1) => new THREE.PlaneGeometry(w, h, ws, hs),
    box: (w, h, d, ws = 1, hs = 1, ds = 1) => new THREE.BoxGeometry(w, h, d, ws, hs, ds),
    sphere: (r, ws = 32, hs = 16) => new THREE.SphereGeometry(r, ws, hs),
    cylinder: (rt, rb, h, rs = 32, hs = 1, open = false) =>
        new THREE.CylinderGeometry(rt, rb, h, rs, hs, open),
    cone: (r, h, rs = 32, hs = 1, open = false) => new THREE.ConeGeometry(r, h, rs, hs, open),
    circle: (r, seg = 32) => new THREE.CircleGeometry(r, seg),
    ring: (ri, ro, ts = 32) => new THREE.RingGeometry(ri, ro, ts),
    torus: (r, t, rs = 12, ts = 48) => new THREE.TorusGeometry(r, t, rs, ts),
    // ⚠️ CapsuleGeometry 的第二个参数叫 `height` 但其实是**圆柱段长度**
    // （不含两个半球），默认值也和直觉不同：capSegments 默认 4、radialSegments
    // 默认 8。照抄 three 的签名，别凭印象写。
    capsule: (r, h, cs = 4, rs = 8, hs = 1) =>
        new THREE.CapsuleGeometry(r, h, cs, rs, hs),
};

const primitiveCache = createGeometryCache('engine:primitive');

/**
 * 共享图元 —— 尺寸相同就全站共用一个 geometry。
 *
 * 为什么需要：R3F 里每一个 `<planeGeometry args={[w, h]} />` 都会 `new` 一个
 * 几何体。走廊是按段挂载的，同一段里 6 个 mesh 用同一个门板尺寸，就是 6 个
 * 一模一样的 `PlaneGeometry`；再乘上挂载的段数。实测 1008 个 geometry 只对应
 * 342 个不同签名，**666 个是纯浪费**。
 *
 * 用法（把 JSX 子元素换成 `geometry=` 属性）：
 *
 *   // 改造前 —— 每次挂载都新建一个
 *   <mesh position={p}>
 *       <planeGeometry args={[doorWidth, doorHeight]} />
 *       <meshBasicMaterial map={tex} />
 *   </mesh>
 *
 *   // 改造后 —— 同一个尺寸全站一份
 *   <mesh position={p} geometry={sharedGeometry('plane', doorWidth, doorHeight)}>
 *       <meshBasicMaterial map={tex} />
 *   </mesh>
 *
 * **可以在 render body 里直接调用**：命中是一次 Map 查找，不需要 useMemo。
 * 这也是它比 `useMemo(() => new PlaneGeometry(...), [])` 好的地方 —— 后者在
 * 每个挂载实例里还是各建一份。
 *
 * ⚠️ 只用于**尺寸固定**的图元。任何会逐帧改 `attributes` 的几何体
 * （烘世界坐标 uv、变形、morph）都不能共享 —— 一个 mesh 改，所有引用它的
 * mesh 一起变。那种情况要么先 `clone()`，要么单独建。
 */
export function sharedGeometry(type, ...args) {
    const build = PRIMITIVES[type];
    if (!build) throw new Error('sharedGeometry: 未知图元 ' + type);
    return primitiveCache(type + '|' + args.join('|'), () => build(...args));
}

/* ------------------------------------------------------------------ */
/* 抠图材质                                                            */
/* ------------------------------------------------------------------ */

const cutoutCache = createMaterialCache('engine:cutout');

/**
 * 硬边抠图材质 —— 契约 1 的唯一实现处。
 *
 * 它会**主动把 `transparent` 关掉**，即使调用方传了 `transparent: true`
 * 也会被覆盖，除非显式传 `forceTransparent: true`（比如你真的要羽化边）。
 *
 * 传 `side: 'double'` 比 `THREE.DoubleSide` 好记；`side` 省略时是单面 ——
 * 场景里有 435 个双面材质，大部分平面只需要看一面，双面意味着背面的三角形
 * 也要过一遍光栅化。
 */
export function cutoutMaterial(texture, {
    color = '#ffffff',
    alphaTest = 0.5,
    side = 'front',
    opacity = 1,
    forceTransparent = false,
    key,
} = {}) {
    const sideVal = side === 'double' ? THREE.DoubleSide
        : side === 'back' ? THREE.BackSide
            : THREE.FrontSide;
    // 真的半透明（opacity < 1）才需要 transparent。
    const transparent = forceTransparent || opacity < 1;
    const cacheKey = key || [
        texture?.name || texture?.uuid,
        color, alphaTest, side, opacity, transparent ? 'T' : 'O',
    ].join('|');

    return cutoutCache(cacheKey, () => new THREE.MeshBasicMaterial({
        map: texture,
        color,
        alphaTest,
        side: sideVal,
        opacity,
        transparent,
        // 抠图写深度；只有真半透明才不写。
        depthWrite: !transparent,
    }));
}

/* ------------------------------------------------------------------ */
/* 释放                                                                */
/* ------------------------------------------------------------------ */

/** 释放所有缓存。开发时热更新用，避免旧材质/几何体留在显存里。 */
export function disposeAllResources() {
    for (const c of [...caches]) c.clear();
}

/* ------------------------------------------------------------------ */
/* 自检                                                                */
/* ------------------------------------------------------------------ */

export function demo() {
    const assert = (c, m) => {
        if (!c) throw new Error('resources.demo: ' + m);
    };

    const mat = createMaterialCache('demo');
    let built = 0;
    const build = () => { built++; return new THREE.MeshBasicMaterial({ color: '#fff' }); };
    const a = mat('k', build);
    const b = mat('k', build);
    assert(a === b, '材质缓存没生效');
    assert(built === 1, 'factory 被跑了不止一次');

    // 契约 1：抠图默认不透明
    const tex = { name: 'fake', uuid: 'fake' };
    const cut = cutoutMaterial(tex, { alphaTest: 0.5 });
    assert(cut.transparent === false, '抠图材质不该是 transparent');
    assert(cut.alphaTest === 0.5, 'alphaTest 丢了');
    assert(cut.depthWrite === true, '抠图应该写深度');

    // 真的半透明仍然要 transparent
    const faded = cutoutMaterial(tex, { opacity: 0.3 });
    assert(faded.transparent === true, 'opacity<1 必须是 transparent');
    assert(faded.depthWrite === false, '半透明不该写深度');

    // 世界坐标 UV
    const g = worldUvPlane(4, 2, (lx, ly) => [lx, -ly]);
    const uv = g.attributes.uv;
    let minU = Infinity;
    let maxU = -Infinity;
    for (let i = 0; i < uv.count; i++) {
        minU = Math.min(minU, uv.getX(i));
        maxU = Math.max(maxU, uv.getX(i));
    }
    assert(Math.abs(minU + 2) < 1e-6 && Math.abs(maxU - 2) < 1e-6, 'worldUvPlane 的 u 不是世界米数');

    // 共享图元：同尺寸同对象，不同尺寸不同对象
    const p1 = sharedGeometry('plane', 3, 4);
    const p2 = sharedGeometry('plane', 3, 4);
    const p3 = sharedGeometry('plane', 3, 5);
    assert(p1 === p2, 'sharedGeometry 没共享同一个尺寸');
    assert(p1 !== p3, 'sharedGeometry 把不同尺寸混成一个了');
    assert(p1.parameters.width === 3 && p1.parameters.height === 4, 'plane 尺寸传丢了');
    // 默认分段数必须和 three.js 一致，否则「省略分段数」的调用点会悄悄变形
    const sp = sharedGeometry('sphere', 1);
    assert(sp.parameters.widthSegments === 32 && sp.parameters.heightSegments === 16,
        'sphere 的默认分段数和 three.js 不一致');
    const bx = sharedGeometry('box', 1, 2, 3);
    assert(bx.parameters.depth === 3, 'box 的第三个参数没传到 depth');
    assert(sharedGeometry('plane', 3, 4) === p1, '第二次取同一个尺寸又新建了');
    assert(primitiveCache.map.size >= 3, '图元缓存没记上');
    let threw = false;
    try { sharedGeometry('dodecahedron', 1); } catch (e) { threw = true; }
    assert(threw, '未知图元应该抛错而不是静默返回 undefined');

    mat.clear();
    g.dispose();
    return '✅ engine/resources 自检通过';
}

if (typeof window !== 'undefined') window.__engineResourcesDemo = demo;
