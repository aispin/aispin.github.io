import { useEffect, useMemo, useRef, useCallback } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { Matrix4, Quaternion, Vector3 } from 'three';
import gsap from 'gsap';
import { settleLerp, SETTLE_ANGLE } from '../utils/settle';
import * as I from '../config/island';

/**
 * useOrbitCamera — 院子的环绕相机（DR-B 的 B1 + B2）。
 * ==================================================================
 *
 * **B1 受限轨道**：相机被锁在"以岛心为轴心的一个球面"上 ——
 * 只有 yaw / 仰角 / 半径三个自由度，**永远不可能走到没建模的地方**。
 * 不需要地形高度场、不需要碰撞体（那正是"自由行走"最贵的两件事）。
 *
 * **B2 边界**：三个量全夹住（见 `config/island.js`）：
 *   · 半径 18~28 —— 下限防穿墙（屋身四角离轴心 16.28），上限防进雾。
 *     ⚠️ 上限是**横屏的**上限；窄视口下按 `orbitMaxR(aspect)` 放大（最高 ×1.5
 *     = 42），见 DR-I。**下限和默认机位都不跟着视口走** —— 那会破坏"接手不跳"。
 *   · 仰角 1°~50° —— 不许钻到地面以下，也不许变成航拍；
 *   · 算完再夹一次 y 的硬地板（双保险）。
 *
 * 三个必须避开的冲突（这才是这个 hook 真正的活，控制器本身只有十几行）
 * -------------------------------------------------------------------
 *   1. **GSAP 入场动画**：`EntranceDoors` 有一整条 timeline 在 tween 相机。
 *      判据用 `gsap.isTweening(camera.position)` —— 只要 GSAP 还在动，
 *      这个 hook 一帧都不写相机。比"记一个 `introDone` 标志"稳，
 *      因为标志会漏（房间进出、退出动画都会再动相机）。
 *   2. **点门进屋**：`EntranceDoors` 的 onClick 走 R3F 的事件。拖拽结束那一下
 *      浏览器照旧会派发 click —— 于是"转一圈松手正好停在门上"就进屋了。
 *      这里在**捕获阶段**挂一个 click 监听：刚刚拖拽过就 `stopPropagation()`。
 *      阈值 6 px：小于它算点击（保持不变），大于它算拖拽。
 *   3. **进走廊 / 房间**：`enabled` 由调用方给 —— 见 `config/cameraMode.js`
 *      的状态机。关掉之后相机交回 `useInfiniteCamera`，两边不会同时写。
 *
 * 不接管，直到用户真的拖了一下
 * ----------------------------
 * 入场结束的那一帧画面是 GSAP 定的，本 hook **不去动它** ——
 * 否则接手瞬间会有一个 0.2 单位的上抬（夹半径/仰角带来的）。
 * 所以 `active` 默认是关的，第一次拖拽或滚轮才打开，并且**打开时从当前
 * 机位反算** yaw/仰角/半径（抄 tidewater `setFreeCam()` 的交接）。
 *
 * URL 参数（给 harness 用，截图才能复现）
 * --------------------------------------
 *   ?orbit                     立刻进入环绕（不等拖拽）
 *   ?yaw=1.2&r=20&elev=0.4     直接指定姿态
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * 进场"滑到门前"用多久（秒）。
 *
 * 用户 2026-10-20 的原话是「缓冲前进到门前」—— 手动那一下之所以像"缓冲"，
 * 是因为滚轮连续给 targetR 递减、相机一路追着走。这里用一条 ease-in-out
 * 的 tween 复现同一段位移（34.85 → 18，约 17 个世界单位），1.4s 走完：
 * 短了像"啪"地一下被吸过去，长了（>2s）会让人以为页面卡了。
 */
const APPROACH_SECONDS = 1.4;

/**
 * 交接那一帧「朝向残差」的消散时间常数（秒）。
 *
 * 位置已经连续了（`adopt` 反算 yaw/仰角/半径，不夹），但**朝向**仍差一点点：
 * 两套相机看向的目标不是同一个点 ——
 *   · `useInfiniteCamera`：`lookAt(lookX, 0.13 + 视差, z − 10)` ⇒ 俯仰 −0.2546°
 *   · 轨道相机：`lookAt(ORBIT_CENTER)`（y = 0.15，距离 34.85）⇒ 俯仰 −0.0822°
 * 差 **0.1724°**（900px 高、58° 竖视角下约 2.7px）。用户报的「咯噔一下往下跳」
 * 主因是位置那 0.5424 个单位（约 19px），这条是它剩下的尾巴。
 *
 * 不去改任何一方的取景（`REST_LOOK_Y` 是走廊/首屏共用的，`ORBIT_CENTER` 是
 * 整个轨道系统的轴心），而是在**接手那一刻量出残差、再用 0.12s 把它化掉** ——
 * 残差是"当时那个姿态"的属性，改常量只能挪走一处、别处又冒出来。
 */
const ORIENT_FIX_TAU = 0.12;

/**
 * 接手后多久把平滑系数从 0 拉满（秒）。
 *
 * `adopt()` 是**如实读出**当前姿态（不夹 yaw/仰角/半径），但轨道有它自己的
 * 设计姿态（`ORBIT_MIN_ELEV` 等）⇒ 接手后总有一点"要收敛过去的量"。如果
 * 帧循环立刻用 0.18 的系数去追，**第一帧就走掉 18% 的差**：休息机位那
 * 0.0156 rad 的仰角差换算成 0.096 个世界单位（≈2.2px），读起来是起步
 * 轻轻"咯噔"一下 —— 正是用户 2026-10-20 报的那个症状的残余。
 *
 * 所以接手后先让系数从 0 线性起坡：**第一帧系数是 0，相机一个像素都不动**，
 * 之后才逐渐接管。这不是给某个具体 bug 打的补丁，而是这个 hook 的一条
 * 不变量：*接手那一帧不许改变画面*。
 */
const WARMUP_SECONDS = 0.18;

/** 单位四元数。只作 `slerp` 的终点，**永不写**。 */
const IDENTITY_Q = new Quaternion();

function urlNumber(key) {
    if (typeof window === 'undefined') return null;
    const v = new URLSearchParams(window.location.search).get(key);
    return v === null ? null : Number(v);
}

export function useOrbitCamera({ enabled }) {
    const { camera, gl } = useThree();
    // 视口宽高比。DR-I 的 I1：**上限**跟着它走（窄视口允许拉更远），
    // 下限和默认机位都不动 —— 理由写在 `config/island.js` 的 `orbitMaxR` 上面。
    // 选择器返回的是**数字**（不是对象），所以不会每次渲染都触发更新。
    const aspect = useThree((state) => state.size.width / state.size.height);

    // ⚠️ 项目约定：`useRef(...)` 的 `.current` **只在回调/effect 里碰**，
    //    绝不在 render body 里解引用（`react-hooks/refs` 会直接报错）。
    //    所以这里存的是 ref 本身，回调里写作 `s.current.yaw`。
    const s = useRef({
        yaw: 0, elev: 0, r: 0,
        targetYaw: 0, targetElev: 0, targetR: 0,
        active: false,
        dragging: false,
        moved: 0,
        lastX: 0, lastY: 0,
        // 接手瞬间"相机现在的朝向 ÷ 轨道想要它有的朝向"。单位四元数 = 已经对齐。
        // 见 `ORIENT_FIX_TAU`。
        orientFix: new Quaternion(),
        // 接手后过了多少秒（见 `WARMUP_SECONDS`）。`adopt` 归零。
        warmup: WARMUP_SECONDS,
    });

    const enabledRef = useRef(enabled);
    // 半径上限。用 ref 而不是闭包变量：`onWheel` / `adopt` 都注册在
    // `[gl, adopt]` 的 effect 里，把 aspect 塞进依赖会让**每次转屏都重挂
    // 一遍全部监听器**（转屏那一瞬间正好在拖拽的话，拖拽会断）。
    const maxRRef = useRef(I.ORBIT_MAX_R);

    /** 从相机当前机位反算轨道参数 —— 接手时画面不动。 */
    const adopt = useCallback(() => {
        const st = s.current;
        const dx = camera.position.x - I.ORBIT_CENTER[0];
        const dy = camera.position.y - I.ORBIT_CENTER[1];
        const dz = camera.position.z - I.ORBIT_CENTER[2];
        // 距离同样**如实读出**（`rRaw`），夹过的版本只给 `targetR` 用 —— 见
        // 下面仰角那段注释。休息机位是 34.85，本来就在 [18, 视口上限] 内。
        const rRaw = Math.hypot(dx, dy, dz);
        const yaw = Math.atan2(dx, dz);
        /* 🔴 仰角：**如实读出**，一个数都不夹。
         *
         * 夹了就会在接手那一帧把相机**抬起来**：休息机位 (0, 0.2, 45) 反算出来是
         * `asin(0.05 / 34.85) = 0.0014`，而 `ORBIT_MIN_ELEV` 是 **0.017**（差 12 倍）
         * ⇒ y 从 0.2 跳到 0.7424、俯仰从 -0.25° 跳到 -0.97°，画面整体**往下跳
         * ~19px**。用户 2026-10-20 报的「加载完毕后画面咯噔一下往下跳动才滑行
         * 到门前」就是这个（以前只有"第一次滚轮"时才碰得到，藏得住；改成进场
         * 自动滑行之后它每次都发生）。
         *
         * 那"设计最低仰角"谁来管？——**写进 `targetElev`，由帧循环的平滑系数
         * 起坡去收**（`WARMUP_SECONDS`）：
         *   · 第一帧系数是 0 ⇒ 相机原地不动，没有任何台阶；
         *   · 之后 0.18s 内系数拉满，仰角从 0.0014 平滑爬到 0.017
         *     （y 0.2 → 0.456，全程约 0.6s，混在推近里看不出来）；
         *   · 手动滚轮走的是**同一条路**（它也先 `adopt`），所以"滚到底"和
         *     "自动滑到门前"落在同一个机位（`probe-enter-zoom.mjs` 判差值全 0）。
         * 拖拽时 `onMove` 也照旧把 `targetElev` 夹进 `[MIN, MAX]`。
         * 这里只负责"如实读出当前姿态"。
         */
        const elevRaw = Math.asin(dy / Math.max(rRaw, 1e-3));

        /* 朝向也要"如实读出"，不能一接手就换一套 —— 见 `ORIENT_FIX_TAU`。
         *
         * 先按帧循环**同样的算法**（连 `ORBIT_MIN_Y` 地板一起）算出**第一帧**
         * 轨道会摆出的机位，再算出那一帧 `lookAt(ORBIT_CENTER)` 会给出的四元数，
         * 然后记下 `qNow · qWant⁻¹`。帧循环里每帧把它左乘回去、再慢慢 slerp 到
         * 单位元，于是第一帧的朝向**逐位等于**接手前的朝向，之后 0.12s 内归位。
         *
         * 🔴 这里必须用**未夹**的 `elevRaw` / `rRaw`：帧循环第一帧用的就是它们
         *    （下面 `st.elev = elevRaw`），用夹过的值算出来的是"以后那一帧"的
         *    朝向，残差补不上（实测漏了这层，Δpitch 还剩 -0.157°）。
         *
         * ⚠️ 不要改成"直接 `camera.lookAt` 一下再读"：`adopt` 可能在 GSAP 入场
         *    补间还在跑的时候被调用（`?orbit` / 快速滚轮），那样会当场把相机
         *    挪走，比它要修的那 0.17° 严重得多。这里只用一次矩阵运算，不碰相机。
         */
        const ce = Math.cos(elevRaw);
        const se = Math.sin(elevRaw);
        const px = I.ORBIT_CENTER[0] + rRaw * ce * Math.sin(yaw);
        const pz = I.ORBIT_CENTER[2] + rRaw * ce * Math.cos(yaw);
        const py = Math.max(I.ORBIT_CENTER[1] + rRaw * se, I.ORBIT_MIN_Y);
        const qWant = new Quaternion().setFromRotationMatrix(
            new Matrix4().lookAt(
                new Vector3(px, py, pz),
                new Vector3(I.ORBIT_CENTER[0], I.ORBIT_CENTER[1], I.ORBIT_CENTER[2]),
                new Vector3(0, 1, 0)
            )
        );
        st.orientFix.copy(camera.quaternion).multiply(qWant.invert());

        st.yaw = st.targetYaw = yaw;
        // 现状 vs 设计姿态。两者差多少由帧循环的平滑系数**起坡**去消化
        // （`WARMUP_SECONDS`），所以接手那一帧画面不会动。
        st.elev = elevRaw;
        st.targetElev = clamp(elevRaw, I.ORBIT_MIN_ELEV, I.ORBIT_MAX_ELEV);
        st.r = rRaw;
        st.targetR = clamp(rRaw, I.ORBIT_MIN_R, maxRRef.current);
        st.warmup = 0;
        st.active = true;
    }, [camera]);

    // 视口变化 ⇒ 重算上限。**变窄要放开、变宽要把已经拉出去的收回来**，
    // 否则横屏切回竖屏再切回来时 `r` 会卡在 42（超过横屏上限）不回来。
    useEffect(() => {
        const m = I.orbitMaxR(aspect);
        maxRRef.current = m;
        const st = s.current;
        if (st.targetR > m) st.targetR = m;
        if (st.r > m) st.r = m;
    }, [aspect]);

    // `enabled` 是给 DOM 事件回调读的，那些回调活在 React 的渲染之外，
    // 拿不到最新的 prop。写进 ref 必须在 effect 里 —— render body 里写 ref
    // 同样会被 `react-hooks/refs` 拦下。
    useEffect(() => {
        enabledRef.current = enabled;
        // 交出控制权时把"拖拽位移"清零：否则下一次真实点击会被下面的
        // 捕获监听误判成拖拽余波而吞掉（门点不动，且没有任何报错）。
        if (!enabled) s.current.moved = 0;
    }, [enabled]);

    useEffect(() => {
        const dom = gl.domElement;

        const onDown = (e) => {
            if (!enabledRef.current) return;
            const st = s.current;
            // 同 onWheel：拖拽一开始就掐掉进场滑行。
            gsap.killTweensOf(st);
            st.dragging = true;
            st.moved = 0;
            st.lastX = e.clientX;
            st.lastY = e.clientY;
        };
        const onMove = (e) => {
            const st = s.current;
            if (!st.dragging || !enabledRef.current) return;
            const dx = e.clientX - st.lastX;
            const dy = e.clientY - st.lastY;
            st.lastX = e.clientX;
            st.lastY = e.clientY;
            st.moved += Math.abs(dx) + Math.abs(dy);
            if (!st.active) adopt();
            st.targetYaw -= dx * I.ORBIT_DRAG_SPEED;
            st.targetElev = clamp(
                st.targetElev + dy * I.ORBIT_DRAG_SPEED,
                I.ORBIT_MIN_ELEV,
                I.ORBIT_MAX_ELEV
            );
        };
        const onUp = () => {
            s.current.dragging = false;
        };
        // 捕获阶段，抢在 R3F 的 onClick 之前。
        //
        // ⚠️ `!enabledRef.current` 那一行不是防御性编程：不写的话，
        //    「拖了一大圈 → 松手时指针已经移出 canvas（于是不派发 click）
        //    → 点门进走廊 → orbit 关闭」之后，`moved` 会**永远卡在 300 多**，
        //    下一次点门（那时 orbit 已关、本该照常进屋）会被误判成拖拽余波
        //    而吞掉。上面的 effect 也在关掉时清一次，这里是双保险。
        const onClickCapture = (e) => {
            const st = s.current;
            if (!enabledRef.current) {
                st.moved = 0;
                return;
            }
            if (st.moved > I.ORBIT_DRAG_THRESHOLD) {
                e.stopPropagation();
                st.moved = 0;
            }
        };
        const onWheel = (e) => {
            if (!enabledRef.current) return;
            e.preventDefault();
            const st = s.current;
            // 用户一动滚轮就**立刻放弃**进场那段自动滑行，交回给人 —— 否则
            // 两边同时改 targetR，滚轮像是"被拽回去"。
            gsap.killTweensOf(st);
            if (!st.active) adopt();
            st.targetR = clamp(
                st.targetR * (1 + Math.sign(e.deltaY) * I.ORBIT_ZOOM_STEP),
                I.ORBIT_MIN_R,
                maxRRef.current
            );
        };

        dom.addEventListener('pointerdown', onDown);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        dom.addEventListener('click', onClickCapture, true);
        dom.addEventListener('wheel', onWheel, { passive: false });

        return () => {
            dom.removeEventListener('pointerdown', onDown);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            dom.removeEventListener('click', onClickCapture, true);
            dom.removeEventListener('wheel', onWheel);
        };
    }, [gl, adopt]);

    // ?orbit / ?yaw / ?elev / ?r —— 让截图脚本能复现一个机位
    useEffect(() => {
        const yaw = urlNumber('yaw');
        const elev = urlNumber('elev');
        const r = urlNumber('r');
        const force = typeof window !== 'undefined'
            && new URLSearchParams(window.location.search).has('orbit');
        if (!force && yaw === null && elev === null && r === null) return;
        const st = s.current;
        st.yaw = st.targetYaw = yaw === null ? 0 : yaw;
        st.elev = st.targetElev = elev === null ? 0.12 : clamp(elev, I.ORBIT_MIN_ELEV, I.ORBIT_MAX_ELEV);
        st.r = st.targetR = r === null ? I.ORBIT_MIN_R + 3 : clamp(r, I.ORBIT_MIN_R, maxRRef.current);
        st.active = true;
    }, []);

    useFrame((_, delta) => {
        const st = s.current;
        if (!enabled || !st.active) return;
        // 1) GSAP 正在 tween 相机（入场 / 退出 / 传送）⇒ 一帧都不碰
        if (gsap.isTweening(camera.position) || gsap.isTweening(camera.rotation)) return;

        // `delta` 交给 settleLerp 做 dt 补偿（WO-1）—— 0.18 是 60 fps 下的
        // 每帧系数，低帧率下会自动换算成更大的步长，手感不再挂在帧率上。
        //
        // 接手后的头 `WARMUP_SECONDS` 秒里，系数从 0 线性起坡：第一帧是 0，
        // 相机**一个像素都不动**（`settleLerp` 遇到 k=0 原样返回）。之后才
        // 用正常的 0.18 去追 `targetElev` / `targetR` 那些设计姿态。
        const ramp = Math.min(st.warmup / WARMUP_SECONDS, 1);
        st.warmup += delta;
        const k = 0.18 * ramp;

        st.yaw = settleLerp(st.yaw, st.targetYaw, k, SETTLE_ANGLE, delta);
        st.elev = settleLerp(st.elev, st.targetElev, k, SETTLE_ANGLE, delta);
        st.r = settleLerp(st.r, st.targetR, k, SETTLE_ANGLE, delta);

        const ce = Math.cos(st.elev);
        const se = Math.sin(st.elev);
        const x = I.ORBIT_CENTER[0] + st.r * ce * Math.sin(st.yaw);
        const z = I.ORBIT_CENTER[2] + st.r * ce * Math.cos(st.yaw);
        let y = I.ORBIT_CENTER[1] + st.r * se;

        // 2) B2：y 的硬地板
        if (y < I.ORBIT_MIN_Y) y = I.ORBIT_MIN_Y;

        camera.position.set(x, y, z);
        camera.lookAt(I.ORBIT_CENTER[0], I.ORBIT_CENTER[1], I.ORBIT_CENTER[2]);

        // 3) 交接残差：把"接手前那一刻的朝向"原样保留在屏幕上，再用 0.12s
        //    化掉（`ORIENT_FIX_TAU`）。左乘 = 世界空间叠加，和 `adopt` 里
        //    `qNow · qWant⁻¹` 的顺序对应。
        if (!st.orientFix.equals(IDENTITY_Q)) {
            camera.quaternion.premultiply(st.orientFix);
            st.orientFix.slerp(IDENTITY_Q, 1 - Math.exp(-delta / ORIENT_FIX_TAU));
            // 渐近收敛永远到不了单位元，不吸附的话相机永远"还在写矩阵"
            // （同 `utils/settle.js` 的理由）。
            if (st.orientFix.angleTo(IDENTITY_Q) < 1e-4) st.orientFix.identity();
        }
    });

    /**
     * 给 harness / 照片模式的外部接口。
     *
     * 🔴 `snap` 默认 **true**，直接吸附到目标，不走那 0.18/帧的平滑。
     * ------------------------------------------------------------------
     * 为什么：截图要的是**可复现的定机位**，不是动画。`settleLerp` 现在
     * 做了 dt 补偿（WO-1，2026-10-11）—— 收敛**时长**不再挂在帧率上 ——
     * 但**一帧**仍然走不完：0.18 的系数在 60 fps 下也要 ~25 帧才收敛，
     * 而 swiftshader 下 1600×900 只有个位数 fps，脚本等 1200 ms 也只够
     * 三四帧。不吸附的话那张图就停在半路，机位根本不是它要的那个
     * （第一轮 `rest` 定妆照就是这么拍成"从左侧斜看院墙"的，而日志里
     * 当时什么都没说 —— 现在 `shot-island.mjs` 有 `poseErr` 自检兜着）。
     *
     * 用户拖拽那条路径不受影响（它走的是 `targetYaw` + 平滑）。
     *
     * @param {number} yaw
     * @param {number} elev
     * @param {number} r
     * @param {boolean} [snap=true]
     */
    /**
     * 🔴 返回值必须**引用稳定**（`useMemo`）。
     *
     * 调用方拿它当 effect 依赖（`Experience` 的"进场自动滚一格"就是），
     * 而裸的对象字面量每次渲染都是新引用 ⇒ 那个 effect 每渲染一次就重跑，
     * `clearTimeout` 会把还没到点的定时器一起清掉：**这一下永远推不出去**，
     * 而且控制台里一个错都没有（实测踩过）。
     *
     * 内部全是闭包在操作 ref（`s` / `maxRRef`），所以只需要跟着 `adopt`
     * （它只依赖 camera）重建。
     */
    return useMemo(() => ({
        setPose: (yaw, elev, r, snap = true) => {
            const st = s.current;
            const e = clamp(elev, I.ORBIT_MIN_ELEV, I.ORBIT_MAX_ELEV);
            const rr = clamp(r, I.ORBIT_MIN_R, maxRRef.current);
            st.targetYaw = yaw;
            st.targetElev = e;
            st.targetR = rr;
            if (snap) {
                st.yaw = yaw;
                st.elev = e;
                st.r = rr;
                // 指定机位 = 要的就是轨道姿态本身，别把上一段交接的残差带进来。
                st.orientFix.identity();
            }
            st.active = true;
        },
        isActive: () => s.current.active,
        /** 轴心（世界坐标）。给 harness 反算"这个机位该在哪"，好自检有没有吸附上。 */
        center: I.ORBIT_CENTER,
        /**
         * 从当前机位**缓冲滑到门前**（= 轨道最近点 `ORBIT_MIN_R`）。
         *
         * 用户 2026-10-20：「我希望页面加载完，不用鼠标滚动，就自动缓冲前进到门前」
         * —— 也就是把他手动滚一下之后停住的那个机位，替他走到。
         *
         * 目标半径就是 `ORBIT_MIN_R`：它本来就是"能靠多近"的设计下限（防穿墙），
         * 手动一直往前滚最终也是停在这里（实测 `z = 28.147`，与用户截图的取景
         * 逐处吻合：门高约占屏 33.7%）。
         *
         * 🔴 这里**只管半径**。仰角/半径的"设计姿态"是 `adopt` 写进 `targetElev`
         *    /`targetR` 的，由帧循环按 `WARMUP_SECONDS` 起坡收敛 —— 手动滚轮走
         *    的是同一条路，所以"滚到底"和"自动滑到门前"落在**同一个机位**上
         *    （`probe-enter-zoom.mjs` 就判这一条：差值必须全 0）。
         *
         * ⚠️ 用 tween 改 `targetR`（不是直接赋值）才有"缓冲"的手感：直接赋值
         *    只剩 `settleLerp` 的指数收敛，起步就是最大速度，读起来是"被吸过去"。
         *    `immediate` 给 `prefers-reduced-motion` 用 —— 不做动画，直接到位。
         */
        approachDoor: ({ immediate = false } = {}) => {
            const st = s.current;
            if (!st.active) adopt();
            gsap.killTweensOf(st);
            if (immediate) {
                st.targetR = I.ORBIT_MIN_R;
                return;
            }
            gsap.to(st, {
                targetR: I.ORBIT_MIN_R,
                duration: APPROACH_SECONDS,
                ease: 'power2.inOut',
                overwrite: true,
            });
        },
    }), [adopt]);
}

export default useOrbitCamera;
