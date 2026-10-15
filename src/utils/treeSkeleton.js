import * as THREE from 'three';

import { randRange } from '../engine/art';

/**
 * 树骨架的**共用机器** —— 柿子树和樱花树都从这里长出来。
 * ==================================================================
 *
 * 为什么要有这个文件（而不是各写一份）
 * ------------------------------------
 * 柿子树（`utils/persimmonTree.js`）里那套骨架做法是从
 * `public/demos/web3d/tree/index.html` 学来的，它有三条**缺一不可**的原则：
 *
 *   1. **锥形管**（`emitTube`）：每根枝条是一条 CatmullRom 曲线，半径从
 *      `r0` 线性收到 `r1`。管比圆柱自然得多。
 *   2. 🔴 **关节椭球**（`emitEllipsoid`）：两根圆柱以某个角度相接，接缝
 *      外侧必然裂开一个口子；贴在父枝末端的一个**沿父枝方向拉长的椭球**
 *      正好把口子包住，看起来就是枝杈自身的膨大。硬约束：椭球垂直于父枝
 *      的半径必须 ≥ 父枝末端半径，否则包不住。
 *   3. **子枝起点回退 + 起始方向偏向父枝**（`childInset` / `childDirBias`）：
 *      子枝从关节**内部**长出来，出发时顺着父枝方向、再逐渐分开。少了这两条，
 *      枝杈会读成"用胶水粘上去的"。
 *
 * 樱花树要的正是这三条。**如果各写一份**，那三条就变成了两处实现 ——
 * 下次谁把关节椭球调好看了，另一棵树不会跟着变；谁改坏了一个，
 * 另一棵还是好的，于是"看起来一样的两棵树"在细节上永远对不齐。
 * 所以：**骨架机器只有这一份，两棵树各自提供一套"形态参数"。**
 *
 * 一棵树 = 一个 **spec**
 * ---------------------
 * spec 里的每个字段都有明确的物理含义（长度 / 半径 / 每层衰减 / 每层偏置…）。
 * `persimmonTree.js` 和 `sakuraTree.js` 各自在文件顶上写一份 spec ——
 * 「改树」就是改自己那份 spec，不用碰这个文件。
 *
 * 🔴 **可选**字段（不写 = 该特性整个关掉，逐位不影响原来那棵树）
 * ------------------------------------------------------------
 * 目前只有一个：`spec.reach`（**横展枝**）。给了就按那套参数把一部分枝条长成
 * **又长又细、先横着出去、末段转上扬**的枝；**不给就一行都不执行** ——
 * 所以柿子树的几何哈希（`probe-tree-pair.mjs` W1 的锚点）不会因为这台机器
 * 多了一个特性而漂。
 *
 * ⚠️ 它原来叫 `droop`（垂枝）—— WO-28b 做的是「先上后垂」，竖直侧写是
 *    `up − sink·u²`。**WO-33f 用户说「取消下垂，横着长，然后正常往上长」**
 *    ⇒ 侧写改成 `flat + rise·u²`，名字一并改成 `reach`
 *    （继续叫"垂枝"会骗人）。改的**只是竖直分量的写法**：
 *    段数 / 长度 / 取数顺序一个没动 ⇒ 除这几根之外的骨架**逐位不变**。
 *
 * 加新可选特性的铁律：**绝不能多抽一次随机数**，否则后面所有枝的形态整体错位。
 *
 * 🔴 确定性（项目契约 1）
 * ----------------------
 * 生长过程**只能**通过 `spec.rand` 取随机数，而且**取数顺序即形态**：
 * 同样的 spec + 同样的 seed ⇒ 逐位相同的树。所以下面任何一行都**不能**
 * 随手挪位置、加一次 `rand()`、或者把 `randRange` 换成 `Math.random()`。
 * 判据见 `harness/probe-tree-identity.mjs`（逐字节比几何）。
 */

/* ------------------------------------------------------------------ */
/* 低层：三角形累加器                                                  */
/* ------------------------------------------------------------------ */

/** 一个累加器：非索引三角形，逐顶点写 position / normal / 可选 part。 */
export function makeAcc(withPart = false) {
    return { pos: [], nrm: [], part: withPart ? [] : null };
}

export function pushVert(acc, v) {
    acc.pos.push(v.px, v.py, v.pz);
    acc.nrm.push(v.nx, v.ny, v.nz);
    if (acc.part) acc.part.push(v.part || 0);
}

export function pushTri(acc, a, b, c) {
    pushVert(acc, a);
    pushVert(acc, b);
    pushVert(acc, c);
}

/** 把一个方向在**任意轴**上抖 `angle` 弧度。取数顺序：轴 x / y / z / 无。 */
export function jitterDir(rand, dir, angle) {
    const ax = randRange(rand, -1, 1);
    const ay = randRange(rand, -1, 1);
    const az = randRange(rand, -1, 1);
    const axis = new THREE.Vector3(ax, ay, az);
    if (axis.lengthSq() < 1e-6) axis.set(0, 1, 0);
    axis.normalize();
    return dir.clone().applyAxisAngle(axis, angle).normalize();
}

/* ------------------------------------------------------------------ */
/* 低层：锥形管 / 椭球                                                  */
/* ------------------------------------------------------------------ */

/**
 * 沿一条曲线铺一根**锥形管**。
 *
 * 帧（法线 / 副法线）用**平行输运**逐环推进，不是每环重新叉乘一个固定参考轴
 * —— 后者在切线转到与参考轴平行时会**翻转**，管子上会出现一道拧劲。
 */
export function emitTube(acc, curve, r0, r1, tubular, radial) {
    const P = new THREE.Vector3();
    const T = new THREE.Vector3();
    const REF_UP = new THREE.Vector3(0, 1, 0);
    const REF_SIDE = new THREE.Vector3(1, 0, 0);
    let prevRing = null;
    let prevN = null;

    for (let i = 0; i <= tubular; i++) {
        const t = i / tubular;
        curve.getPointAt(t, P);
        curve.getTangentAt(t, T).normalize();

        let n = null;
        if (prevN) {
            // 把上一环的法线投影到当前环的法平面上
            n = prevN.clone().addScaledVector(T, -prevN.dot(T));
            if (n.lengthSq() < 1e-8) n = null;
        }
        if (!n) {
            const ref = Math.abs(T.y) < 0.9 ? REF_UP : REF_SIDE;
            n = ref.clone().addScaledVector(T, -ref.dot(T));
            if (n.lengthSq() < 1e-8) n = new THREE.Vector3(1, 0, 0);
        }
        n.normalize();
        const b = new THREE.Vector3().crossVectors(T, n).normalize();

        const r = r0 + (r1 - r0) * t;
        const ring = new Array(radial);
        for (let j = 0; j < radial; j++) {
            const a = (j / radial) * Math.PI * 2;
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            const dx = n.x * ca + b.x * sa;
            const dy = n.y * ca + b.y * sa;
            const dz = n.z * ca + b.z * sa;
            ring[j] = {
                px: P.x + dx * r, py: P.y + dy * r, pz: P.z + dz * r,
                nx: dx, ny: dy, nz: dz,
            };
        }
        if (prevRing) {
            for (let j = 0; j < radial; j++) {
                const k = (j + 1) % radial;
                pushTri(acc, prevRing[j], prevRing[k], ring[k]);
                pushTri(acc, prevRing[j], ring[k], ring[j]);
            }
        }
        prevRing = ring;
        prevN = n;
    }
}

/**
 * 关节椭球：极轴对齐 `axis`，沿轴拉长 `elong`、垂直方向压扁 `squash`。
 * 缠绕方向与 `emitTube` 一致（都是朝外的）。
 */
export function emitEllipsoid(acc, c, axis, radius, elong, squash, latSeg = 6, lonSeg = 8, part = 0) {
    const w = axis.clone().normalize();
    const ref = Math.abs(w.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(ref, w).normalize();
    const v = new THREE.Vector3().crossVectors(w, u).normalize();

    const rx = radius * squash;
    const ry = radius * elong;
    const rz = radius * squash;

    const at = (i, j) => {
        const phi = (i / latSeg) * Math.PI;
        const theta = (j / lonSeg) * Math.PI * 2;
        const sp = Math.sin(phi);
        const cp = Math.cos(phi);
        const ct = Math.cos(theta);
        const st = Math.sin(theta);
        const lx = sp * ct;
        const ly = cp;
        const lz = sp * st;
        // 椭球的法线 ∝ (lx/rx, ly/ry, lz/rz)，再转回世界
        const nx = (lx / rx) * u.x + (ly / ry) * w.x + (lz / rz) * v.x;
        const ny = (lx / rx) * u.y + (ly / ry) * w.y + (lz / rz) * v.y;
        const nz = (lx / rx) * u.z + (ly / ry) * w.z + (lz / rz) * v.z;
        const nl = Math.hypot(nx, ny, nz) || 1;
        return {
            px: c.x + u.x * rx * lx + w.x * ry * ly + v.x * rz * lz,
            py: c.y + u.y * rx * lx + w.y * ry * ly + v.y * rz * lz,
            pz: c.z + u.z * rx * lx + w.z * ry * ly + v.z * rz * lz,
            nx: nx / nl, ny: ny / nl, nz: nz / nl,
            part,
        };
    };

    for (let i = 0; i < latSeg; i++) {
        for (let j = 0; j < lonSeg; j++) {
            const v00 = at(i, j);
            const v01 = at(i, j + 1);
            const v10 = at(i + 1, j);
            const v11 = at(i + 1, j + 1);
            pushTri(acc, v00, v11, v01);
            pushTri(acc, v00, v10, v11);
        }
    }
}

/* ------------------------------------------------------------------ */
/* 骨架生长                                                            */
/* ------------------------------------------------------------------ */

/**
 * 递归生长。把骨架写进 `acc`，并记录：
 *   · `tips`   —— 末梢位置 + 朝向（叶团 / 花簇撒在这附近）
 *   · `joints` —— （保留）分叉点的位置与半径
 *   · `branches` —— 一级枝的曲线（用来挑挂件锚点）
 *   · `hangCandidates` —— 一级枝上"够远、朝 +z、高度合适"的两个候选点
 *
 * ⚠️ 这个函数里 `spec.rand` 的**调用次数和顺序**就是树的形态本身。
 *    任何改动都要跑 `probe-tree-identity.mjs` 对一次字节。
 */
function grow(state, spec, start, dir, length, r0, r1, depth, reaching = false) {
    const { acc, rand } = state;
    const pts = [start.clone()];
    const p = start.clone();
    let d = dir.clone().normalize();

    // ---- 横展枝判定（**可选**，见文件头）--------------------------------
    // 🔴 这一段**一次随机数都不抽**。计数器只在 `spec.reach` 存在时才动 ——
    //    柿子树不给这个字段 ⇒ 整块跳过 ⇒ 几何逐位不变
    //    （判据 `probe-tree-pair.mjs` 的 W1 锚点）。
    //
    // ⚠️ 计数器**按深度分开**（`every` 是 `{深度: 步长}` 的表），不是全局一个。
    //    全局一个会栽跟头：一级枝的序号是 0/4/8（深度优先 + 二级枝数量不定），
    //    `% 2` 正好**全是偶数** ⇒ 三根一级枝**全部**中招 —— 整棵树的主骨架都变了
    //    （实测 44/44 个末梢全被标成"横展枝子树"，冠体积退化成空集）。
    //    分开之后：一级枝 3 根里挑 1 根，二级枝每 2 根挑 1 根。
    //    ⚠️ 还有一条：**已经在横展枝枝系里的枝不再中招**（`!reaching`）。
    //       否则会**串成一条链**：一级横展枝的梢头再挑一根横展枝、再挑一层，
    //       整条链一路叠下去（WO-28b 当年做下垂时实测冠的叶团下探到树高的 8%，
    //       快贴地了）。一棵树上"几根横展枝"是分散的几根，不是一条长到底的链。
    let reach = null;
    if (spec.reach && !reaching && depth >= 1 && depth <= spec.reach.depthMax) {
        const n = (state.branchIdxByDepth[depth] = (state.branchIdxByDepth[depth] || 0) + 1);
        const stride = spec.reach.every[depth] || 0;
        if (stride > 0 && n % stride === 0) reach = spec.reach;
    }
    // 横展枝是**细枝**：整根（含它的子枝）按同一个系数收细。
    // ⚠️ 只改半径，不改任何抽数 ⇒ 形态序列不动。
    const r0s = reach ? r0 * reach.radiusScale : r0;
    const r1s = reach ? r1 * reach.radiusScale : r1;

    // 主干抖得小一点（它要立得住），越往上越放肆
    const jit = depth === 0 ? spec.trunkJitter : spec.branchJitter;
    const lift = depth === 0 ? spec.trunkLift : spec.branchLift;
    // 横展枝：段数更多（弧才圆）且更长（才垂得下来）。
    // ⚠️ 段数变了 ⇒ `jitterDir` 的调用次数变了 ⇒ 后面所有枝的随机序列整体挪位。
    //    这只对**开了横展枝的那棵树**成立 —— 柿子树的 `reach` 恒为 null，
    //    走的还是 `spec.segs` / `length` 那条老路，逐位不变。
    const segs = reach ? reach.segs : spec.segs;
    const len = reach ? length * reach.lengthScale : length;
    for (let i = 1; i <= segs; i++) {
        d = jitterDir(rand, d, jit);
        d.y += lift;
        // 🔴 横展枝的竖直侧写：**直接构造竖直分量**，不从父枝继承。
        //
        // 当前形态（WO-33f，用户原话「取消下垂，横着长，然后正常往上长」）：
        //     `d.y = flat + rise · u²` —— 起步几乎水平（`u→0` 时 ≈ `flat`），
        //     然后按二次曲线**一路转上扬**。水平分量（`d.x` / `d.z`）照旧吃抖动
        //     ⇒ 枝**先横着出去、末段抬起**。
        //
        // ⚠️ 为什么竖直分量必须**由 `u` 完全决定**（而不是在继承来的 `d.y` 上做加减）
        //    —— 这是这个特性最容易做错的一处，历史上两版都栽过，都留档：
        //    ① 第一版写 `d.y -= gravity * u`（**减一个量**）⇒ 假绿。
        //       深度 1 的枝是从**主干方向**抖出来的，本身接近竖直（`d.y ≈ 0.87`），
        //       减 0.62 还剩 +0.25 ⇒ 整根一路往上，**梢头反而是最高点**。
        //    ② 第二版写 `d.y = d.y*(1−u) − sink*u`（按 `u` 插值）⇒ 深度 1 修好了，
        //       但**深度 2 又坏了**：它的父枝末段朝向已经朝下，子枝从那个方向抖出来
        //       ⇒ 一出生就往下扎，实测梢头 y = −0.20（**扎到地面以下**）。
        //    ⇒ 正解是**直接写 `d.y`**：父枝朝哪、抖动多大都影响不到它
        //       ⇒ 深度 1 / 2 行为一致，"末段朝上/朝下"是构造保证的。
        //    ⚠️ 所以**调形态只改 `flat` / `rise` 两个数**，别回到"在 d.y 上加减"的写法。
        if (reach) {
            const u = i / segs;
            d.y = reach.flat + reach.rise * u * u;
        }
        d.normalize();
        p.addScaledVector(d, len / segs);
        pts.push(p.clone());
    }

    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    const tubular = spec.tubular[depth];
    const radial = spec.radial[depth];
    emitTube(acc, curve, r0s, r1s, tubular, radial);

    if (depth === 0) state.branches.push(curve);

    const tip = p.clone();
    const tipDir = d.clone();

    // 横展枝的折线留档 —— 判据要能量"先横后扬"（`probe-tree-reach.mjs`）。
    // ⚠️ 存的是**折线点**，不是 `curve`：`leanCrownForward` 要就地转这些点，
    //    而 `curve` 只在 `state.branches` 里被挂件锚点用（那边单独转）。
    if (reach) {
        state.reaches.push({ depth, pts });
        // 🔴 横展枝**自己也要挂叶子**：把它的梢头也记成一个"撒叶团的点"。
        //    不记的话它是**光杆** —— 一根根秃枝伸在冠外面。标 `reach: true`
        //    ⇒ 它照样**不参与冠体积**（见调用方那段），但会拿到自己的 `perTip` 团。
        state.tips.push({ p: tip, d: tipDir, r: r1s, reach: true });
    }

    if (depth >= spec.maxDepth) {
        // 🔴 `reach` 标记"这根末梢属于一根横展枝的子树"。调用方要用它把
        //    **横展枝的末梢排除在冠体积之外** —— 否则这几根长枝会把"末梢包围盒"
        //    的三个方向一起拉大，冠心被拽偏、冠半径被撑开（WO-28b 当时实测
        //    冠宽 6.1 → 24.4）。横展枝是**装饰性的外延**，它不该定义冠的体积。
        state.tips.push({ p: tip, d: tipDir, r: r1s, reach: reaching });
        return;
    }

    // ---- 子枝 ----------------------------------------------------
    // ⚠️ depth === 0 时**不取随机数**（固定 3 条）；这本身就是形态的一部分。
    const n = spec.childCount(depth, rand);
    const children = [];
    // 向外方向：从主干轴指向本枝末梢（在 xz 平面上）
    const outward = new THREE.Vector3(tip.x, 0, tip.z);
    if (outward.lengthSq() < 1e-6) {
        outward.set(randRange(rand, -1, 1), 0, randRange(rand, -1, 1));
    }
    outward.normalize();

    // 🔴 子枝的**参考方向**用"这根枝**进入时**的方向"，不是它末段（已经转上扬/或
    //    当年是转下垂）的朝向。
    //
    //    为什么：子枝的出发方向是 `jitterDir(rand, refDir, spread)` —— **从参考方向
    //    抖出来的**。只把最后那次 `lerp` 的目标换掉是不够的（WO-28b 第一版就是
    //    这么改的，仍然扎穿地面）：抖动的**底**还是那根枝末段的朝向
    //    （当年 ≈ 竖直向下），抖完再往回 lerp 32% 也还是朝下。
    //    ⇒ 参考方向必须**整条换掉**：横展枝的侧枝照常向上/向外长，
    //      变的是那一根，不是它整条枝系。
    //    判据：`probe-tree-reach.mjs` 的 D7。
    const refDir = reach ? dir.clone().normalize() : tipDir;

    for (let i = 0; i < n; i++) {
        const spread = spec.spread[depth];
        const nd = jitterDir(rand, refDir, randRange(rand, spread * 0.55, spread));
        nd.addScaledVector(outward, spec.outBias[depth]);
        nd.y += spec.upBias[depth];
        nd.z += spec.fwdBias[depth];
        nd.normalize();
        // 子枝起点半径提到父枝末端的 0.84~0.98：粗细过渡才不"断"
        const nr0 = r1s * randRange(rand, spec.childRadiusJit[0], spec.childRadiusJit[1]);
        const lenBase = spec.lenFalloff[depth];
        // 🔴 用 `length`（**父枝传进来的、没有横展枝放大的**长度），不是 `len`。
        //    `lengthScale` 只作用于横展枝**自己**那一节。让它沿深度级联的话，
        //    4 级枝链的总长从 2.7 涨到 4.5，冠被撑成一朵蘑菇云
        //    （实测冠宽 6.1 → 24.4）。注释和代码必须一致 —— 这里踩过一次。
        const nlen = length * randRange(rand, lenBase - spec.childLenJit[0], lenBase + spec.childLenJit[1]);
        children.push({ nd, nr0, nlen });
    }

    // ---- 关节 ----------------------------------------------------
    // ⚠️ 用 `r1s`（横展枝收细之后的值）—— 关节椭球的硬约束是"垂直于父枝的半径
    //    ≥ 父枝末端半径"，父枝是这一根自己，所以跟着它一起收才仍然包得住。
    const jointR = r1s * spec.jointScale;
    const jointC = tip.clone().addScaledVector(tipDir, -jointR * spec.jointInset);
    emitEllipsoid(acc, jointC, tipDir, jointR, spec.jointElong, spec.jointSquash);

    // 🔴 记下**一级枝**上的两个点做挂件候选（柿子树的风铃用它）。
    //    条件是"离主干够远、朝镜头这一侧、高度合适" —— 挂在主干附近或者
    //    朝墙里那一侧，画面上就是悬空的。
    if (depth === 1 && spec.collectHang !== false) {
        state.hangCandidates.push({
            far: Math.hypot(tip.x, tip.z),
            z: tip.z,
            y: tip.y,
            p: curve.getPointAt(0.72),
            dir: curve.getTangentAt(0.72),
        });
    }

    // ---- 递归 ----------------------------------------------------
    const inset = tipDir.clone().multiplyScalar(-jointR * spec.childInset);
    const childStart = tip.clone().add(inset);
    for (const c of children) {
        // ⚠️ `refDir`（见上面那段）—— 横展枝的子枝从"进入方向"出发，不从垂下来的末段出发。
        const biased = c.nd.clone().lerp(refDir, spec.childDirBias).normalize();
        // ⚠️ 子枝长度用**原来的** `length`，不是放大过的 `len` ——
        //    `lengthScale` 只作用于横展枝**自己**那一节。让它沿深度级联的话，
        //    4 级枝链的总长会从 2.7 涨到 4.5，冠被撑成一朵蘑菇云。
        grow(state, spec, childStart, biased, c.nlen, c.nr0, c.nr0 * spec.radFalloff, depth + 1,
            reaching || !!reach);
    }
}

/**
 * 长一棵树（树**自己的一套单位**，还没归一化）。
 *
 * @param {object} spec 见 `persimmonTree.js` / `sakuraTree.js` 顶上的形态参数表
 * @returns {{ acc, tips, branches, hangCandidates, reaches }}
 *   `reaches` 只在 spec 给了 `reach` 时非空（横展枝）。
 */
export function growSkeleton(spec) {
    const state = {
        rand: spec.rand,
        acc: makeAcc(),
        tips: [],
        branches: [],
        hangCandidates: [],
        // 横展枝用的计数器（**按深度分开**，见 `grow` 里那段）+ 折线留档。
        // 不给 `spec.reach` 时它们一路是空的，不参与任何计算。
        branchIdxByDepth: {},
        reaches: [],
    };
    grow(
        state, spec,
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 1, 0),
        spec.trunkLen, spec.trunkR0, spec.trunkR1, 0
    );
    return state;
}

/* ------------------------------------------------------------------ */
/* 包围盒                                                              */
/* ------------------------------------------------------------------ */

export function makeBox() {
    return { x0: 1e9, y0: 1e9, z0: 1e9, x1: -1e9, y1: -1e9, z1: -1e9 };
}

export function boxAdd(b, p) {
    if (p.x < b.x0) b.x0 = p.x;
    if (p.y < b.y0) b.y0 = p.y;
    if (p.z < b.z0) b.z0 = p.z;
    if (p.x > b.x1) b.x1 = p.x;
    if (p.y > b.y1) b.y1 = p.y;
    if (p.z > b.z1) b.z1 = p.z;
}

export function boxOfPoints(points) {
    const b = makeBox();
    for (const p of points) boxAdd(b, p);
    return b;
}

export function boxOfPositions(positions) {
    const b = makeBox();
    for (let i = 0; i < positions.length; i += 3) {
        boxAdd(b, { x: positions[i], y: positions[i + 1], z: positions[i + 2] });
    }
    return b;
}

/* ------------------------------------------------------------------ */
/* 「团」几何：一片叶 / 一簇花                                          */
/* ------------------------------------------------------------------ */

/**
 * 一团 = 把 `count` 个**小片**烘进一个几何体。
 *
 * 🔴 为什么是"一团"而不是"一片"：`InstancedMesh` 的实例数就是 draw 之外最贵的
 *    一笔开销（每个实例一份矩阵 + 4 个属性）。把若干片烘进一个几何体，同样的
 *    覆盖度只要几分之一的实例，而三角形总数一模一样。
 *
 * 🔴 各片的朝向必须**散开**（尤其不能都躺在同一个平面里）：整团的明暗差异
 *    完全来自法线，朝向单一时整冠会是同一个颜色 —— 那正是"看着不饱满"。
 *
 * @param {object} o
 * @param {Array<[number,number,number]>} o.rot 每个小片的欧拉角（固定表）
 * @param {Array<[number,number,number]>} o.off 每个小片的原点偏移（固定表）
 * @param {() => number} o.rand 形状抖动的随机源。**由调用方**用固定的 key 建好
 *   （`seededRand('...')`）⇒ 同一棵树的小片形状永远一样（契约 1）。
 *   ⚠️ 刻意**不在这里**收一个 `seedKey` 字符串再自己建：那样"每团叶用哪个 key"
 *      就藏进了机器里，两棵树想给不同的 key 还得改机器。
 * @param {(mat, out, rand, o) => void} o.emit 画一个小片
 * @param {object} o.piece 传给 `emit` 的形状参数
 */
export function makeClusterGeometry({ rot, off, emit, piece, rand }) {
    const acc = makeAcc();
    for (let k = 0; k < rot.length; k++) {
        const m = new THREE.Matrix4()
            .makeRotationFromEuler(new THREE.Euler(rot[k][0], rot[k][1], rot[k][2]))
            .setPosition(off[k][0], off[k][1], off[k][2]);
        emit(m, acc, rand, piece);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(acc.nrm, 3));
    return geo;
}

/**
 * 一片**折起来**的叶 = 4 个三角（有中脉）。
 *
 * 🔴 为什么不是 2 个三角的平菱形：平片在正对镜头时是一整块**同色的多边形**，
 *    放大之后读成"绿色纸屑"而不是叶子。把中脉抬起来（`ridge`）之后，
 *    两半叶面朝向不同 ⇒ 明暗不同 ⇒ 立刻读成一片叶子。法线**逐面**给
 *    （不跨中脉插值），那条折痕才看得出来。
 *
 * 🔴 每片叶**自己的形状**都要抖（长 / 宽 / 中脉深浅 / 左右不对称）：
 *    不抖的话，几千团 × 几片 ≈ 几万片叶**形状完全一致** —— 重复的轮廓比
 *    任何缺失的细节都显眼，那正是"一眼看出是纸片"的来源。
 */
export function emitBlade(mat, out, rand, o) {
    const l = o.len * randRange(rand, o.lenJit[0], o.lenJit[1]);
    const w = o.wid * randRange(rand, o.widJit[0], o.widJit[1]);
    const RIDGE = randRange(rand, o.ridgeJit[0], o.ridgeJit[1]);  // 中脉抬起的量（相对叶宽）
    const asym = randRange(rand, o.asymJit[0], o.asymJit[1]);     // 左右肩不等高 ⇒ 不轴对称
    const curl = RIDGE * w * randRange(rand, o.curlJit[0], o.curlJit[1]);
    const at = (x, y, z) => {
        const v = new THREE.Vector3(x, y, z).applyMatrix4(mat);
        return { x: v.x, y: v.y, z: v.z };
    };
    const base = at(0, 0, -RIDGE * w);
    const left = at(-w / 2, l * (0.42 + asym), curl);
    const tip = at(w * randRange(rand, -0.12, 0.12), l, -RIDGE * w * 0.5);
    const right = at(w / 2, l * (0.42 - asym), curl);
    // 中脉上的一个点：两半叶面在这里相交
    const ridge = at(0, l * 0.50, -RIDGE * w * 1.6);

    // 逐面法线（不用顶点法线）：折痕要硬
    const tri = (a, b, c) => {
        const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
        const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        const p = (q) => ({ px: q.x, py: q.y, pz: q.z, nx, ny, nz });
        pushTri(out, p(a), p(b), p(c));
    };
    tri(base, left, ridge);
    tri(left, tip, ridge);
    tri(base, ridge, right);
    tri(ridge, tip, right);
}

/**
 * 一团叶**从自己的原点往外能探多远**（世界单位）。
 *
 * 🔴 归一化那一步要用它 —— 树顶不只是最高那团叶的**中心**，还要加上这团叶
 *    自己探出去的那一截（叶尖离原点的距离 + 那几片叶的固定偏移）。
 *    少了这一截，冠顶会比目标高度高出一小段。
 * ⚠️ 按**抖动上限**算（`*_JIT[1]`）：保守只会让树矮一点点，安全。
 * ⚠️ 算的是**外接球**（不挑朝向）。
 *
 * @param {number} pad 固定偏移那一截。**必须显式给**，不要在这里算 ——
 *   它是 spec 的一部分，改了会让归一化尺度变化（进而整棵树变尺寸）。
 */
export function clusterExtent(len, wid, lenJit, widJit, pad) {
    return Math.hypot(len * lenJit[1], (wid * widJit[1]) / 2) + pad;
}

/* ------------------------------------------------------------------ */
/* 冠：撒团                                                             */
/* ------------------------------------------------------------------ */

/**
 * 在冠体积里撒团。
 *
 * 两半来源，缺一不可：
 *   · **末梢附近**（每根末梢撒 `perTip` 团，半径 `tipBall`）：保证枝梢不秃。
 *   · **冠体积里**（`fill` 团，按 `cbrt` 均匀撒；其中 `shellChance` 的比例
 *     刻意贴到外壳上）：纯撒末梢的话冠内是空的（能看见枝干），
 *     纯均匀撒又会留下一个"毛边很薄"的冠、轮廓不够实。
 *
 * ⚠️ `rand` 的取数顺序是形态的一部分（见文件头）。
 */
export function scatterCluster({
    tips, crownC, crownR, rand,
    perTip, tipBall, tipBallYSquash,
    fill, shellChance, shellRange,
}) {
    const spots = [];
    for (const t of tips) {
        for (let k = 0; k < perTip; k++) {
            const theta = randRange(rand, 0, Math.PI * 2);
            const phi = Math.acos(randRange(rand, -1, 1));
            const rad = tipBall * Math.cbrt(rand());
            spots.push(new THREE.Vector3(
                t.p.x + rad * Math.sin(phi) * Math.cos(theta),
                t.p.y + rad * Math.cos(phi) * tipBallYSquash,
                t.p.z + rad * Math.sin(phi) * Math.sin(theta)
            ));
        }
    }
    for (let k = 0; k < fill; k++) {
        const shell = rand() < shellChance;
        const rad = shell ? randRange(rand, shellRange[0], shellRange[1]) : Math.cbrt(rand());
        const theta = randRange(rand, 0, Math.PI * 2);
        const phi = Math.acos(randRange(rand, -1, 1));
        spots.push(new THREE.Vector3(
            crownC.x + crownR.x * rad * Math.sin(phi) * Math.cos(theta),
            crownC.y + crownR.y * rad * Math.cos(phi),
            crownC.z + crownR.z * rad * Math.sin(phi) * Math.sin(theta)
        ));
    }
    return spots;
}

/**
 * 冠心 / 冠半径（椭球）—— 由**末梢包围盒**推出来。
 *
 * `padX` / `padZ` / `padY` 分开给，是因为枝梢的包围盒在竖向上天生就扁
 * （每层子枝都往上收），用同一个系数会长出一个**扁饼**。要"饱满"就得
 * 竖向单独放宽 —— 而且只改**叶/花**的分布，不动枝干骨架。
 */
export function crownFromTips(tipBox, padX, padY, padZ) {
    return {
        c: new THREE.Vector3(
            (tipBox.x0 + tipBox.x1) / 2,
            (tipBox.y0 + tipBox.y1) / 2,
            (tipBox.z0 + tipBox.z1) / 2
        ),
        r: new THREE.Vector3(
            Math.max((tipBox.x1 - tipBox.x0) / 2, 0.4) * padX,
            Math.max((tipBox.y1 - tipBox.y0) / 2, 0.35) * padY,
            Math.max((tipBox.z1 - tipBox.z0) / 2, 0.4) * padZ
        ),
    };
}

/** 点在冠里的归一化半径：0 = 冠心、1 = 冠壳。冠内遮蔽就按它给。 */
export function makeRhoOf(crownC, crownR) {
    return (p) => Math.hypot(
        (p.x - crownC.x) / crownR.x,
        (p.y - crownC.y) / crownR.y,
        (p.z - crownC.z) / crownR.z
    );
}

/**
 * 把一「团」的位置 / 朝向 / 属性写成 `InstancedMesh` 要的扁平数组。
 *
 * 🔴 `scales` 和 `shade` 都必须由**调用方**算好再传进来，不能在这里现算：
 *   · `scales` 是在"撒完团、还没算果"那一步抽的，抽早了/晚了都会把后面
 *     所有随机数**整体错位** ⇒ 树长成另一棵（契约 1 失效）。
 *   · `shade`（冠内遮蔽）必须用**归一化之前**的坐标算 —— `rho` 是相对冠心
 *     冠壳的归一化半径，而 `spots` 已经是最终空间，拿它去比 raw 空间的
 *     冠心冠壳是错的（两棵树的归一化方式还不一样）。
 */
export function packInstances({ spots, rand, scales, shade, accentChance = 0.34 }) {
    const n = spots.length;
    const matrices = new Float32Array(n * 16);
    const phase = new Float32Array(n);
    const tint = new Float32Array(n);
    const accent = new Float32Array(n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const scl = new THREE.Vector3();

    for (let i = 0; i < n; i++) {
        // 整团随机朝向（明暗差异全靠它）+ 小幅度缩放
        e.set(randRange(rand, 0, 6.283), randRange(rand, 0, 6.283), randRange(rand, 0, 6.283));
        q.setFromEuler(e);
        const kk = scales[i];
        scl.set(kk, kk, kk);
        m.compose(spots[i], q, scl);
        m.toArray(matrices, i * 16);
        phase[i] = randRange(rand, 0, Math.PI * 2);
        tint[i] = rand();
        accent[i] = rand() < accentChance ? randRange(rand, 0.6, 1) : 0;
    }
    return { matrices, phase, tint, accent, shade, count: n };
}

/** 冠内遮蔽：0 = 冠壳（晒得到）· 1 = 冠心（晒不到）。用 **raw** 坐标算。 */
export function shadeOf(spotsRaw, rhoOf) {
    const out = new Float32Array(spotsRaw.length);
    for (let i = 0; i < spotsRaw.length; i++) {
        out[i] = Math.min(1, Math.max(0, 1 - rhoOf(spotsRaw[i])));
    }
    return out;
}
