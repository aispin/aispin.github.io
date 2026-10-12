import * as THREE from 'three';

/**
 * airplane — 前院那架小飞机的**几何生成器**（WO-18，2026-10-12）。
 * ==================================================================
 *
 * 用户：「前院摆一架小飞机，**点击**在 `/flight` 路由下进入飞行模式。」
 * DR-M 定：走**查询参数** + 接管主站相机。用户追加：**「效果要保障」**。
 *
 * 本文件只管**造**：尺寸、零件、三角形。它**不知道**自己停在哪儿 ——
 * 停机位在 `utils/flightPath.js` 的 `PARKED`（那才是航线的起点），
 * 组件在 `components/canvas/entrance/Airplane.jsx`。
 *
 * ---------------------------------------------------------------------------
 * 为什么**不**复用 `utils/treeSkeleton.js`
 * ---------------------------------------------------------------------------
 * 那套机器是给**有机体**用的：锥形管沿曲线铺、关节处贴椭球把裂口包住、
 * 子枝从关节内部回退着长出来。三条原则都是为"两圆柱以任意角度相接"服务的。
 *
 * 飞机是**制成品**：直的展向轴、锐利的前缘、平板一样的蒙皮、能数得清的铆钉线。
 * 拿树的机器来造，等于每一步都要跟它的有机假设打架（比如它会坚持把
 * 接缝包圆）。所以两棵树**共用**骨架机器（它们是同一类东西），
 * 飞机**另写一份**（它不是）。
 *
 * 代价是多了一份低层三角累加器 —— 但那份东西只有三十行，而且它的
 * "闭合剖面沿直轴扫出"跟"锥形管沿曲线铺"根本不是一个算法。
 *
 * ---------------------------------------------------------------------------
 * 🔴 确定性（项目契约 1）—— 这里比"种子确定"还强一档
 * ---------------------------------------------------------------------------
 * 这个文件里**没有任何随机源**：连 `seededRand` 都没有。
 *
 * 为什么：飞机是**制成品**，它的形态是"设计出来的"，不是"长出来的"。
 * 第一版我给蒙皮加了一点沿法线的抖动（想让面别那么数学完美），结果
 * 探针立刻报出两个数：
 *   · A3 左右不对称 1.9e-5 —— **翼展不再关于 x=0 对称**；
 *   · A5 轮胎底比 `−GEAR_H` 低了 3.59e-3 —— 飞机**陷进草地**了。
 * 两个都是"抖动幅度"本身，也都是**可判定的不变量**被破坏。
 *
 * 换句话说：为了让表面少一点塑料感，我拿一个能被探针检查的对称性
 * 去换了一个亚像素的视觉收益 —— 这笔账不划算。真飞机的机身**就是**
 * 左右对称的，所以"没有随机源"在这里不是偷懒，是**更强的**确定性保证
 * （不依赖"取数顺序"这种约定，而是结构上不可能不确定）。
 *
 * 判据：`harness/probe-airplane.mjs` 的 A1（造两次逐位相同）+ A3（对称）。
 * 表面细节（铆钉线 / 蒙皮接缝 / 面板色差）走**片元着色器**，不碰几何。
 *
 * ---------------------------------------------------------------------------
 * 🔴 朝向约定：**机头朝 +z**
 * ---------------------------------------------------------------------------
 * 与 `flightPath.js` 的航线约定一致：局部 +z 是**机头方向**（也抄自参考实现）。
 * ⚠️ 停机时的朝向**不是** `yaw = 0`（机头朝 +z）—— 那是第一版的错。
 *    朝向的唯一真源是航线：`parkedPose() = poseAt(0)`，机头偏航 62.4°。
 *    本文件只管**几何在局部坐标系里怎么摆**，不管它被放到哪、朝哪。
 * 局部原点在**机身轴线**上（y = 0 = 机身中心线），所以起落架挂在 y < 0，
 * 而"离地高度"就是 `GEAR_H`（见下）。改成原点在轮胎底会让
 * `PARKED.position.y` 的语义变成"轮胎底"，和 `flightPath` 里
 * "机身中心 = 草地 + GEAR_H"的写法对不上。
 *
 * ⚠️ GLSL 不在这个文件里（在 `shaders/airplane.js`）。
 */

/* -------------------------------------------------------------------------
 * 尺寸（世界单位）
 *
 * 参照系：院子 22 宽 × 16 深、屋身檐口高 6.34（草地上方）、樱花树 5.35 高。
 * 翼展 3.90 ⇒ 停在左院草地（10 宽）里两侧各余 3 单位，读起来是"一架小飞机"
 * 而不是"一架真飞机停在院子里"。
 * ---------------------------------------------------------------------- */

export const PLANE = Object.freeze({
    /** 机身长（机头 → 机尾）。 */
    LEN: 2.60,
    /** 翼展（含两侧）。 */
    SPAN: 3.90,
    /** 机翼所在 z（略在重心之前 —— 重心在机翼之后飞起来才稳）。 */
    WING_Z: 0.10,
    WING_ROOT_CHORD: 0.66,
    WING_TIP_CHORD: 0.40,
    WING_THICK: 0.070,
    /** 上反角（弧度）—— 翼尖抬高。没有它侧面看是一把尺子。 */
    WING_DIHEDRAL: 0.085,
    /** 后掠（翼尖相对翼根往后多少）。 */
    WING_SWEEP: 0.10,

    /** 平尾（水平安定面）。 */
    HTAIL_SPAN: 1.30,
    HTAIL_CHORD: 0.34,
    HTAIL_Z: -1.02,
    HTAIL_THICK: 0.048,

    /** 垂尾（垂直安定面）。 */
    VTAIL_H: 0.62,
    VTAIL_CHORD: 0.40,
    VTAIL_Z: -1.00,
    VTAIL_THICK: 0.050,

    /** 螺旋桨。 */
    PROP_R: 0.60,
    PROP_BLADES: 3,
    /** 桨叶弦长（根部 / 尖部）。 */
    PROP_CHORD_ROOT: 0.175,
    PROP_CHORD_TIP: 0.095,
    PROP_THICK: 0.026,
    /** 桨叶扭转（弧度，根部 → 尖部）。这个是"看着像螺旋桨"的唯一来源。 */
    PROP_TWIST_ROOT: 0.42,
    PROP_TWIST_TIP: 0.13,
    /** 桨毂（整流罩）长度与半径。 */
    HUB_LEN: 0.34,
    HUB_R: 0.135,

    /** 起落架：轮胎半径 / 轮距（两轮中心的 x 距离）。 */
    WHEEL_R: 0.115,
    WHEEL_W: 0.085,
    GEAR_TRACK: 0.92,
    /** 轮轴（局部 y）。 */
    AXLE_Y: -0.505,
    /** 撑杆的 x 落点（比轮轴靠内一点，看着像"外八"）。 */
    STRUT_TOP_X: 0.30,
});

/**
 * 🔴 离地高度 —— **派生**，不是写死的。
 *
 * 机身中心线到地面的距离 = 轮轴高度 + 轮胎半径。`flightPath.js` 用它把
 * 停机位摆到草地上（`GRASS_Y + GEAR_H`），所以它必须**就是**起落架的几何结果，
 * 不能是另一个"看起来差不多"的常数 —— 否则飞机要么陷进草地要么悬空，
 * 而这两种错在截图里都只是"差一点点"，看不出来。
 */
export const GEAR_H = -PLANE.AXLE_Y + PLANE.WHEEL_R;

/* -------------------------------------------------------------------------
 * 零件编号（写进 `part` 顶点属性，着色器按它配色）
 *
 * 一个 mesh 一个材质 ⇒ 颜色差异**只能**来自顶点属性。用枚举而不是裸数字：
 * 着色器那边是 `if (p < 0.5) … else if (p < 1.5) …` 的一串比较，
 * 加零件时两边必须一起改，写名字比写 0/1/2/3 不容易错位。
 * ---------------------------------------------------------------------- */

export const PART = Object.freeze({
    FUSELAGE: 0,
    WING: 1,
    STRUT: 2,
    TYRE: 3,
    SPINNER: 4,
    BLADE: 5,
});

/* -------------------------------------------------------------------------
 * 低层：三角形累加器
 *
 * 与 `treeSkeleton.js` 的 `makeAcc` 同形（`pos` / `nrm` / `part` 三个
 * 平行数组，非索引三角形）—— 同形是有意的：探针 / 统计脚本读起来一样。
 * ---------------------------------------------------------------------- */

function makeAcc() {
    return { pos: [], nrm: [], part: [] };
}

function push(acc, p, n, part) {
    acc.pos.push(p[0], p[1], p[2]);
    acc.nrm.push(n[0], n[1], n[2]);
    acc.part.push(part);
}

function tri(acc, a, b, c, n, part) {
    push(acc, a, n, part);
    push(acc, b, n, part);
    push(acc, c, n, part);
}

/** 一个三角形面的几何法线（未归一化）。 */
function faceNormal(a, b, c) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

/**
 * 🔴 把一段三角形里**绕序反了**的翻过来。**只翻绕序，绝不碰法线。**
 *
 * 为什么需要：闭合剖面沿直轴扫出的曲面，它的三角形绕序对不对，取决于
 * 「剖面的绕序」×「扫出方向」×「(u,v,s) → (x,y,z) 这个映射的奇偶性」
 * 三件事。三件里错一件，整个翼面就变成**里外翻的** —— 而它在外观上
 * 只表现为"光照看着怪"，非常难判断。
 *
 * 与其去推那个奇偶性（改一个轴就要重推一次），不如**事后验**：
 * 零件的顶点云有个质心，每个三角形的面法线只要背对质心就是反的。
 * 对**凸**零件（机身 / 翼 / 尾 / 杆 / 轮，本文件里全是凸的）这条判据是精确的。
 * 所以按**零件**调用，不要跨零件调（跨零件的质心落在零件外面，判据就失效了）。
 *
 * ---------------------------------------------------------------------------
 * 🔴 为什么不能顺手把法线也一起翻（我第一版就是那么写的，错了两处）
 * ---------------------------------------------------------------------------
 * 「绕序」和「法线」是**两件事**：
 *   · 绕序决定 `side: FrontSide` 时哪一面被剔除；
 *   · 法线决定光照。
 * 本文件里两类曲面对这两件事的处理**故意不同**：
 *   · 旋转体（机身）用**解析平滑法线**（读起来是圆的）；
 *   · 扫出曲面（翼面）用**分面法线**（读起来是钣金件）。
 * 一旦"翻绕序"顺手把法线也取反，解析法线那一路就被推成朝内 ⇒ 机身
 * 背光。所以职责分开：**这个函数只管绕序**。
 *
 * @param {object} acc
 * @param {number} from 起始顶点号（三角号 × 3）
 */
function flipWindingIfInward(acc, from) {
    const P = acc.pos;
    const n = P.length / 3;
    // 该零件的顶点云质心
    let cx = 0, cy = 0, cz = 0;
    for (let i = from; i < n; i++) { cx += P[i * 3]; cy += P[i * 3 + 1]; cz += P[i * 3 + 2]; }
    const m = n - from;
    cx /= m; cy /= m; cz /= m;

    for (let t = from; t < n; t += 3) {
        const a = [P[t * 3], P[t * 3 + 1], P[t * 3 + 2]];
        const b = [P[(t + 1) * 3], P[(t + 1) * 3 + 1], P[(t + 1) * 3 + 2]];
        const c = [P[(t + 2) * 3], P[(t + 2) * 3 + 1], P[(t + 2) * 3 + 2]];
        const fn = faceNormal(a, b, c);
        const mx = (a[0] + b[0] + c[0]) / 3 - cx;
        const my = (a[1] + b[1] + c[1]) / 3 - cy;
        const mz = (a[2] + b[2] + c[2]) / 3 - cz;
        if (fn[0] * mx + fn[1] * my + fn[2] * mz >= 0) continue; // 朝外，留着
        for (let k = 0; k < 3; k++) {
            const i1 = (t + 1) * 3 + k, i2 = (t + 2) * 3 + k;
            const tmp = P[i1]; P[i1] = P[i2]; P[i2] = tmp;
        }
    }
}

/**
 * 给一段**扫出的闭合曲面**收尾：先修绕序，再把每个三角形的**分面法线**
 * 写回它的三个顶点。
 *
 * 🔴 为什么要"写回"，而不是在发射时就算好（第一版的做法，错在这里）
 * ------------------------------------------------------------------
 * 发射时每个四边形拆成两个三角形，两个我都给了**第一个三角形**的面法线
 * （`faceNormal(A, D, C)`）。非平面四边形里两个三角形的真实面法线**不同**，
 * 于是第二个三角形的法线可能指向背面 —— 探针报出 893 个顶点法线朝内。
 *
 * 更根本的问题是：**发射时的法线符号，和修完绕序之后的绕序，是两套独立的
 * 判断**。它们可以互相打架（一个说朝外、一个说朝内），而只要打架，
 * 症状就是"某几片翼面背光"，在截图上很难定位。
 *
 * 所以顺序改成：**先定绕序（唯一的真源），再从绕序反推法线。**
 * 修完绕序的凸壳，`(b−a)×(c−a)` 必然朝外 —— 这时法线不再是"另一个猜测"，
 * 而是绕序的**推论**，两者结构上不可能不一致。
 *
 * ⚠️ 所以翼面是**分面**（faceted）的：这是想要的，钣金件就该有硬边。
 *    机身那边走 `emitSpindle` 的解析平滑法线（回转体），两者刻意不同。
 */
function closeSurfaceFlat(acc, from) {
    flipWindingIfInward(acc, from);
    const P = acc.pos, N = acc.nrm;
    for (let t = from; t < P.length / 3; t += 3) {
        const a = [P[t * 3], P[t * 3 + 1], P[t * 3 + 2]];
        const b = [P[(t + 1) * 3], P[(t + 1) * 3 + 1], P[(t + 1) * 3 + 2]];
        const c = [P[(t + 2) * 3], P[(t + 2) * 3 + 1], P[(t + 2) * 3 + 2]];
        const fn = faceNormal(a, b, c);
        const len = Math.hypot(fn[0], fn[1], fn[2]) || 1;
        for (let v = t; v < t + 3; v++) {
            N[v * 3] = fn[0] / len;
            N[v * 3 + 1] = fn[1] / len;
            N[v * 3 + 2] = fn[2] / len;
        }
    }
}

/** 给 `[from, end)` 这段顶点整体乘一个矩阵（位置与法线都乘，法线用逆转置）。 */
function transformRange(acc, from, mat) {
    const P = acc.pos, N = acc.nrm;
    const nm = new THREE.Matrix3().getNormalMatrix(mat);
    const v = new THREE.Vector3();
    for (let i = from; i < P.length / 3; i++) {
        v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(mat);
        P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
        v.set(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]).applyMatrix3(nm).normalize();
        N[i * 3] = v.x; N[i * 3 + 1] = v.y; N[i * 3 + 2] = v.z;
    }
}

/* -------------------------------------------------------------------------
 * 旋转体（机身 / 桨毂 / 轮胎）
 * ---------------------------------------------------------------------- */

/**
 * 一条 **z 轴旋转体**：给一串 `{ z, r }` 剖面（z 递增），铺出管面 + 两端封盖。
 *
 * 法线是**解析**的，不是差分：
 *
 *   参数化 `F(θ, z) = (r(z)·cosθ, r(z)·sinθ, z)`
 *   `∂F/∂θ = (−r·sinθ, r·cosθ, 0)`
 *   `∂F/∂z = (r′·cosθ, r′·sinθ, 1)`
 *   叉乘取 θ=0 那一支 ⇒ 方向 `(r, 0, −r·r′)` ⇒ **`normalize(cosθ, sinθ, −r′)`**
 *
 * 🔴 注意那个 `−r′` 是**裸的**，不是 `−r′/r`。第一版写成了 `−r′/r`
 *    —— 那是"过原点的锥面"（`r = k·z` ⇒ `r′ = k` 且 `r/z = k`）的特例公式。
 *    机身的 `r` 在 0.05~0.20 之间，于是法线的**轴向分量被放大了 5~20 倍**，
 *    整条机身读起来像"两头是刀口"。
 *    而它**不会**被"法线是单位向量"或"有符号体积为正"抓住（两条都过），
 *    只会被"法线 vs 质心方向"那条抓住 —— 起落架那根细锥杆（`r′/r ≈ 2.5`）
 *    于是报了 54/144 朝内。
 *
 * 解析法线让机身读起来是**圆的**（这是"平滑"那一半），
 * 而下面扫出来的翼面是**平的**（faceted）—— 两种刻意混着用：
 * 机身是回转体、翼面是钣金件，本来就该这样。
 *
 * ⚠️ 侧面的三角形绕序**天生是反的**（推一下就知道：θ 递增 × z 递增
 * 在这个映射下是左手系）⇒ 末尾统一走 `flipWindingIfInward`。
 * 它的症状本来会是"机身整个不可见"（`FrontSide` 把正面剔掉），
 * 而那很容易被误诊成"材质写错了"。
 *
 * ---------------------------------------------------------------------------
 * 🔴 剖面可以**倒着给**（z 递减），内部会自己翻正
 * ---------------------------------------------------------------------------
 * `r′(z)` 是中心差分算的，`−r′/r` 那一项**带着 z 的方向**：同一根锥形杆，
 * 剖面按 z 递增写和按 z 递减写，算出来的法线 z 分量**差一个符号**。
 * 第一版就是这样：起落架的撑杆（从机腹往下写，z 递减）90/144 个法线朝内
 * ⇒ 杆背光发黑。绕序没事（`flipWindingIfInward` 按质心判，与方向无关），
 * 所以症状**只有光照不对**，最难查。
 *
 * 与其要求每个调用方"记得按 z 递增写"（这条约定迟早被忘），不如在这里
 * 一次性吃掉：倒着给就翻正再用。这样"剖面方向"就不再是一个隐藏前提。
 */
function emitSpindle(acc, profile, radial, part, capEnds = true) {
    // 统一成 z 递增。倒着给不会报错，也不会算错 —— 见上面那段。
    const prof = profile[0].z <= profile[profile.length - 1].z ? profile : [...profile].reverse();
    const from = acc.pos.length / 3;
    const n = prof.length;
    const ring = [];

    for (let i = 0; i < n; i++) {
        const { z, r } = prof[i];
        // 中心差分求 r′(z)。端点用单侧差分。
        const zPrev = prof[Math.max(0, i - 1)].z;
        const zNext = prof[Math.min(n - 1, i + 1)].z;
        const rPrev = prof[Math.max(0, i - 1)].r;
        const rNext = prof[Math.min(n - 1, i + 1)].r;
        const rp = (rNext - rPrev) / Math.max(1e-6, zNext - zPrev);

        const row = [];
        for (let j = 0; j < radial; j++) {
            const a = (j / radial) * Math.PI * 2;
            const ca = Math.cos(a), sa = Math.sin(a);
            // n ∝ (cosθ, sinθ, −r′)。见函数头那段推导 —— 别改回 −r′/r。
            const len = Math.hypot(1, rp);
            row.push({
                p: [ca * r, sa * r, z],
                n: [ca / len, sa / len, -rp / len],
            });
        }
        ring.push(row);
    }

    for (let i = 0; i < n - 1; i++) {
        for (let j = 0; j < radial; j++) {
            const k = (j + 1) % radial;
            const A = ring[i][j], B = ring[i][k], C = ring[i + 1][k], D = ring[i + 1][j];
            // 每个四边形拆两个三角形，用**面**法线（钣金件的分面感）。
            tri(acc, A.p, D.p, C.p, A.n, part);
            tri(acc, A.p, C.p, B.p, A.n, part);
        }
    }

    if (capEnds) {
        const c0 = [0, 0, prof[0].z];
        const c1 = [0, 0, prof[n - 1].z];
        for (let j = 0; j < radial; j++) {
            const k = (j + 1) % radial;
            tri(acc, c0, ring[0][k].p, ring[0][j].p, [0, 0, -1], part);
            tri(acc, c1, ring[n - 1][j].p, ring[n - 1][k].p, [0, 0, 1], part);
        }
    }

    flipWindingIfInward(acc, from);
}

/* -------------------------------------------------------------------------
 * 扫出曲面（机翼 / 尾翼 / 桨叶）
 * ---------------------------------------------------------------------- */

/**
 * 把一个**闭合剖面**沿一条直轴扫出去。
 *
 * @param {Array<[number,number]>} section
 *        闭合剖面，单位弦长 / 单位半厚。`u` 沿弦向（0 = 前缘，1 = 后缘），
 *        `v` 是厚度方向。
 * @param {Array<object>} stations
 *        `{ s, chord, thick, twist, off }` —— `s` 是展向坐标，`chord` 是该
 *        站位的弦长，`twist` 是绕展向轴的扭转（弧度），`off` 是弦向平移。
 * @param {(s:number,u:number,v:number)=>number[]} frame
 *        把 `(展向, 弦向分量, 厚度分量)` 映到局部 3D。用回调而不是写死轴序：
 *        机翼（展向 x）/ 垂尾（展向 y）/ 桨叶（展向是**径向**，在旋转坐标系里）
 *        三种映射差别很大，写死一个就得复制三遍。
 */
function emitSwept(acc, section, stations, frame, part) {
    const from = acc.pos.length / 3;
    const rows = stations.map((st) => {
        const ct = Math.cos(st.twist || 0), stw = Math.sin(st.twist || 0);
        return section.map(([u0, v0]) => {
            const u1 = u0 * st.chord;
            const v1 = v0 * st.thick;
            // 绕展向轴扭转：把 (弦向, 厚度) 两个分量转一个角。
            const u = u1 * ct - v1 * stw;
            const v = u1 * stw + v1 * ct;
            return frame(st.s, u + (st.off || 0), v);
        });
    });

    const M = section.length;
    const ZERO = [0, 0, 0];
    for (let i = 0; i < rows.length - 1; i++) {
        for (let j = 0; j < M; j++) {
            const k = (j + 1) % M;
            const A = rows[i][j], B = rows[i][k], C = rows[i + 1][k], D = rows[i + 1][j];
            // 法线先随便给（`closeSurfaceFlat` 会按修好的绕序重算）——
            // 这里**刻意不算**：算出来的那个符号跟绕序无关，两者打架过一次。
            tri(acc, A, D, C, ZERO, part);
            tri(acc, A, C, B, ZERO, part);
        }
    }

    // 两端封盖：扇到剖面质心。
    for (const [idx, flip] of [[0, false], [rows.length - 1, true]]) {
        const row = rows[idx];
        const c = [0, 0, 0];
        for (const p of row) { c[0] += p[0] / M; c[1] += p[1] / M; c[2] += p[2] / M; }
        for (let j = 0; j < M; j++) {
            const k = (j + 1) % M;
            if (flip) tri(acc, c, row[k], row[j], ZERO, part);
            else tri(acc, c, row[j], row[k], ZERO, part);
        }
    }

    // 唯一的收尾：定绕序 → 由绕序反推分面法线。
    closeSurfaceFlat(acc, from);
}

/**
 * 翼型剖面（单位弦长 / 单位半厚）。
 *
 * 7 个点就够：一个**尖**前缘 + 上表面两个折点 + 后缘上下两点 + 下表面一个折点。
 * 用真翼型（NACA 那套）在这里是浪费 —— 这个尺度下它只会变成"一个光滑的板"，
 * 反而丢掉"玩具飞机"的读感。折点是**故意**留的。
 */
const AIRFOIL = [
    [0.00, 0.00],
    [0.13, 0.55],
    [0.46, 0.62],
    [1.00, 0.07],
    [1.00, -0.07],
    [0.46, -0.62],
    [0.13, -0.55],
];

/**
 * 机翼（展向 x，厚度 y，弦向 z）。
 *
 * ⚠️ `off` 必须把剖面**居中**：剖面的 `u ∈ [0,1]` 乘上弦长之后是
 * `[0, chord]`，也就是"前缘在 z、后缘在 z+chord"。不减去 `chord/2`
 * 的话整片翼会**往前偏半个弦长** —— 而它的症状只是"机翼看着装得太靠前"，
 * 光看截图很难判断是偏了还是本来就这样。
 */
function emitWing(acc, span, rootChord, tipChord, thick, z, dihedral, sweep, stations = 5) {
    const st = [];
    for (let i = 0; i < stations; i++) {
        const t = i / (stations - 1);           // 0 = 左翼尖，1 = 右翼尖
        const x = (t - 0.5) * span;
        const f = Math.abs(t - 0.5) * 2;        // 0 = 翼根，1 = 翼尖
        const chord = rootChord + (tipChord - rootChord) * f;
        st.push({
            s: x,
            chord,
            thick,
            twist: 0,
            off: -chord / 2 - sweep * f,
        });
    }
    emitSwept(
        acc, AIRFOIL, st,
        (s, u, v) => [s, v + dihedral * Math.abs(s), u + z],
        PART.WING,
    );
}

/** 垂尾（展向 y，厚度 x，弦向 z）。 */
function emitFin(acc, height, chord, thick, z, stations = 4) {
    const st = [];
    for (let i = 0; i < stations; i++) {
        const t = i / (stations - 1);
        const c = chord * (1 - 0.42 * t);
        st.push({
            s: t * height,
            chord: c,
            thick,
            twist: 0,
            off: -c / 2 - 0.16 * t,
        });
    }
    emitSwept(acc, AIRFOIL, st, (s, u, v) => [v, s, u + z], PART.WING);
}

/* -------------------------------------------------------------------------
 * 螺旋桨
 * ---------------------------------------------------------------------- */

/**
 * 桨叶 —— 展向是**径向**，所以 frame 直接按旋转坐标写：
 *
 *   radial(a)     = (cos a, sin a, 0)
 *   tangential(a) = (−sin a, cos a, 0)
 *   出平面         = (0, 0, 1)
 *
 * 位置 = ρ·radial + u·tangential + v·出平面，其中 (u, v) 是**已扭转**的剖面分量。
 * 扭转是"看着像螺旋桨"的唯一来源：根部桨距大、尖部小（真实螺旋桨也这样，
 * 因为尖部的切向速度大）。不扭转的桨叶是一片三叉风扇。
 */
function emitBlade(acc, angle, stations = 4) {
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const st = [];
    for (let i = 0; i < stations; i++) {
        const t = i / (stations - 1);
        const chord = PLANE.PROP_CHORD_ROOT + (PLANE.PROP_CHORD_TIP - PLANE.PROP_CHORD_ROOT) * t;
        st.push({
            // 根部从 0.13 起（桨毂半径 0.135）—— 桨叶是**插在整流罩上**的，
            // 从 ρ=0 起会有一截穿在机身里。
            s: 0.13 + t * (PLANE.PROP_R - 0.13),
            chord,
            thick: PLANE.PROP_THICK * (1 - 0.35 * t),
            twist: PLANE.PROP_TWIST_ROOT + (PLANE.PROP_TWIST_TIP - PLANE.PROP_TWIST_ROOT) * t,
            // 弦向中心落在径向线上：剖面的 u ∈ [0,1] ⇒ 往 −chord/2 偏。
            off: -chord / 2,
        });
    }
    emitSwept(
        acc, AIRFOIL, st,
        (rho, u, v) => [rho * ca - u * sa, rho * sa + u * ca, v],
        PART.BLADE,
    );
}

/* -------------------------------------------------------------------------
 * 总装
 * ---------------------------------------------------------------------- */

/** 机身剖面（z 递增：机尾 → 机头）。 */
const FUSELAGE_PROFILE = [
    { z: -1.30, r: 0.050 },
    { z: -1.18, r: 0.086 },
    { z: -1.00, r: 0.122 },
    { z: -0.72, r: 0.158 },
    { z: -0.32, r: 0.190 },
    { z: 0.08, r: 0.203 },
    { z: 0.48, r: 0.200 },
    { z: 0.80, r: 0.188 },
    { z: 1.04, r: 0.163 },
    { z: 1.20, r: 0.122 },
    { z: 1.30, r: 0.062 },
];

/** 轮胎剖面（沿 z 的短鼓形；造完再转 90° 变成"轴沿 x"）。 */
const TYRE_PROFILE = [
    { z: -PLANE.WHEEL_W / 2, r: PLANE.WHEEL_R * 0.62 },
    { z: -PLANE.WHEEL_W / 2 + 0.012, r: PLANE.WHEEL_R * 0.94 },
    { z: -PLANE.WHEEL_W / 4, r: PLANE.WHEEL_R },
    { z: PLANE.WHEEL_W / 4, r: PLANE.WHEEL_R },
    { z: PLANE.WHEEL_W / 2 - 0.012, r: PLANE.WHEEL_R * 0.94 },
    { z: PLANE.WHEEL_W / 2, r: PLANE.WHEEL_R * 0.62 },
];

/**
 * 🔴 轮胎的**周向分段数必须是 4 的倍数**。
 *
 * 旋转体是在 `j/radial × 2π` 这些**离散角度**上取顶点的，圆是内接多边形
 * ⇒ 实际半径 = `R · cos(π/radial)` 处的最近顶点。要让它**正好**在最低点
 * （−90°）上有一个顶点，`radial` 就得能被 4 整除（−90° 落在第 `3·radial/4` 个）。
 *
 * 这不是洁癖：`GEAR_H` 是**解析**值（`−AXLE_Y + WHEEL_R`），而停机位
 * `GRASS_Y + GEAR_H` 直接用它。radial = 10 时最低顶点只有
 * `−R·sin(72°) = −0.951R` ⇒ 实测轮胎底比 `−GEAR_H` **高 5.6e-3**
 * ⇒ 飞机**悬在草地上方** 5.6 毫米。截图里看不出来，但探针 A5 一测就报。
 * 取 12 顺便让轮胎更圆。
 */
const TYRE_RADIAL = 12;

/** 桨毂剖面（机头整流罩）。 */
const HUB_PROFILE = [
    { z: 0.0, r: PLANE.HUB_R },
    { z: 0.08, r: PLANE.HUB_R * 1.02 },
    { z: 0.18, r: PLANE.HUB_R * 0.86 },
    { z: 0.27, r: PLANE.HUB_R * 0.56 },
    { z: PLANE.HUB_LEN, r: 0.02 },
];

/**
 * 桨的安装位置（局部 z）= 机身鼻尖。
 *
 * 桨毂底半径 0.135、鼻尖处机身半径只剩 0.062 ⇒ 桨毂会在鼻尖外露出
 * 一圈 0.073 的箍。那是**想要的**（整流罩压边），不是穿帮。
 * 往后挪到 1.22 反而会让桨叶根部扎进机身。
 */
const HUB_Z = 1.30;

function toGeometry(acc) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(acc.nrm, 3));
    g.setAttribute('part', new THREE.Float32BufferAttribute(acc.part, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
}

/**
 * 造一架飞机。
 *
 * @returns {{
 *   body: THREE.BufferGeometry,   // 机身 + 翼 + 尾 + 起落架（一个 mesh）
 *   prop: THREE.BufferGeometry,   // 桨毂 + 桨叶（**另一个 mesh，它会转**）
 *   hubZ: number,                 // 桨的旋转轴在局部 z 上的位置
 *   dims: typeof PLANE,
 *   gearH: number,
 *   ranges: Array<{name:string, from:number, to:number, acc:'body'|'prop'}>,
 *   stats: { bodyTris: number, propTris: number },
 * }}
 *
 * 🔴 为什么桨要单独一个 mesh：它得转。塞进 body 就只能靠着色器转，
 *    而"整片几何在顶点着色器里绕 z 转"会连带把法线也转错（法线不跟着
 *    顶点着色器里的位置变换走）—— 那就得手写一套法线旋转。
 *    多一个 draw call 换掉一整类 bug，值。
 *
 * 🔴 `ranges` 是给探针用的：绕序 / 法线朝向这两条判据都**只对凸零件成立**
 *    （见 `flipWindingIfInward` 的注释），而整机是"机身 + 两片翼 + 尾 +
 *    起落架"拼起来的**非凸**顶点云。所以把每个 emitter 的顶点区间记下来，
 *    探针按区间分别验。第一版没记，探针只能拿整机质心去判 ⇒ 607/1020 个面
 *    被误报成"朝内"（翼尖的面法线本来就跟质心方向几乎垂直，符号是随机的）。
 */
export function buildAirplane() {
    const body = makeAcc();
    const prop = makeAcc();
    const ranges = [];
    const mark = (name, acc, accName, fn) => {
        const from = acc.pos.length / 3;
        fn();
        ranges.push({ name, from, to: acc.pos.length / 3, acc: accName });
    };

    // ---- 机身 ----
    mark('fuselage', body, 'body', () => emitSpindle(body, FUSELAGE_PROFILE, 10, PART.FUSELAGE));

    // ---- 机翼（一整片穿过机身，不是左右两片）----
    mark('wing', body, 'body', () => emitWing(
        body, PLANE.SPAN, PLANE.WING_ROOT_CHORD, PLANE.WING_TIP_CHORD,
        PLANE.WING_THICK, PLANE.WING_Z, PLANE.WING_DIHEDRAL, PLANE.WING_SWEEP,
    ));

    // ---- 平尾 ----
    mark('htail', body, 'body', () => emitWing(
        body, PLANE.HTAIL_SPAN, PLANE.HTAIL_CHORD, PLANE.HTAIL_CHORD * 0.72,
        PLANE.HTAIL_THICK, PLANE.HTAIL_Z, 0, 0.04,
    ));

    // ---- 垂尾 ----
    mark('vtail', body, 'body', () => emitFin(
        body, PLANE.VTAIL_H, PLANE.VTAIL_CHORD, PLANE.VTAIL_THICK, PLANE.VTAIL_Z,
    ));

    // ---- 起落架：两根撑杆 + 两个轮 ----
    for (const side of [-1, 1]) {
        const sx = side * PLANE.STRUT_TOP_X;
        const wx = side * (PLANE.GEAR_TRACK / 2);
        const topY = -0.18;                     // 撑杆从机腹里长出来
        const topZ = PLANE.WING_Z - 0.06;
        const tag = side < 0 ? 'L' : 'R';

        // 撑杆：从机腹斜插到轮轴（"外八"，比垂直的杆稳当好看）。
        // 造的时候沿 −z，再整体旋到 (top → axle) 这个方向。
        mark(`strut${tag}`, body, 'body', () => {
            const from = body.pos.length / 3;
            emitSpindle(body, [
                { z: 0.0, r: 0.030 },
                { z: -0.10, r: 0.026 },
                { z: -0.22, r: 0.021 },
                { z: -0.31, r: 0.017 },
            ], 6, PART.STRUT);

            const dir = new THREE.Vector3(wx - sx, PLANE.AXLE_Y - topY, 0.02).normalize();
            const strutMat = new THREE.Matrix4().makeRotationFromQuaternion(
                new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir),
            );
            strutMat.setPosition(sx, topY, topZ);
            transformRange(body, from, strutMat);
        });

        // 轮：造在 z 轴上再转 90°（轴变成 x）。
        mark(`wheel${tag}`, body, 'body', () => {
            const from = body.pos.length / 3;
            emitSpindle(body, TYRE_PROFILE, TYRE_RADIAL, PART.TYRE);
            const wheelMat = new THREE.Matrix4()
                .makeTranslation(wx, PLANE.AXLE_Y, PLANE.WING_Z - 0.04)
                .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));
            transformRange(body, from, wheelMat);
        });
    }

    // ---- 桨（单独 mesh）----
    mark('hub', prop, 'prop', () => emitSpindle(prop, HUB_PROFILE, 10, PART.SPINNER));
    for (let i = 0; i < PLANE.PROP_BLADES; i++) {
        mark(`blade${i}`, prop, 'prop', () => emitBlade(prop, (i / PLANE.PROP_BLADES) * Math.PI * 2 + 0.35));
    }

    const bodyGeo = toGeometry(body);
    const propGeo = toGeometry(prop);

    return {
        body: bodyGeo,
        prop: propGeo,
        hubZ: HUB_Z,
        ranges,
        dims: PLANE,
        gearH: GEAR_H,
        stats: {
            bodyTris: bodyGeo.getAttribute('position').count / 3,
            propTris: propGeo.getAttribute('position').count / 3,
        },
    };
}

export default buildAirplane;
