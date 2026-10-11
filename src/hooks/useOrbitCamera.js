import { useEffect, useRef, useCallback } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
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
 *   · 半径 18~28 —— 下限防穿墙（屋身四角离轴心 16.28），上限防进雾；
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

function urlNumber(key) {
    if (typeof window === 'undefined') return null;
    const v = new URLSearchParams(window.location.search).get(key);
    return v === null ? null : Number(v);
}

export function useOrbitCamera({ enabled }) {
    const { camera, gl } = useThree();

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
    });

    const enabledRef = useRef(enabled);

    /** 从相机当前机位反算轨道参数 —— 接手时画面不动。 */
    const adopt = useCallback(() => {
        const st = s.current;
        const dx = camera.position.x - I.ORBIT_CENTER[0];
        const dy = camera.position.y - I.ORBIT_CENTER[1];
        const dz = camera.position.z - I.ORBIT_CENTER[2];
        const r = clamp(Math.hypot(dx, dy, dz), I.ORBIT_MIN_R, I.ORBIT_MAX_R);
        const yaw = Math.atan2(dx, dz);
        const elev = clamp(Math.asin(dy / Math.max(r, 1e-3)), I.ORBIT_MIN_ELEV, I.ORBIT_MAX_ELEV);
        st.yaw = st.targetYaw = yaw;
        st.elev = st.targetElev = elev;
        st.r = st.targetR = r;
        st.active = true;
    }, [camera]);

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
            if (!st.active) adopt();
            st.targetR = clamp(
                st.targetR * (1 + Math.sign(e.deltaY) * I.ORBIT_ZOOM_STEP),
                I.ORBIT_MIN_R,
                I.ORBIT_MAX_R
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
        st.r = st.targetR = r === null ? I.ORBIT_MIN_R + 3 : clamp(r, I.ORBIT_MIN_R, I.ORBIT_MAX_R);
        st.active = true;
    }, []);

    useFrame((_, delta) => {
        const st = s.current;
        if (!enabled || !st.active) return;
        // 1) GSAP 正在 tween 相机（入场 / 退出 / 传送）⇒ 一帧都不碰
        if (gsap.isTweening(camera.position) || gsap.isTweening(camera.rotation)) return;

        // `delta` 交给 settleLerp 做 dt 补偿（WO-1）—— 0.18 是 60 fps 下的
        // 每帧系数，低帧率下会自动换算成更大的步长，手感不再挂在帧率上。
        st.yaw = settleLerp(st.yaw, st.targetYaw, 0.18, SETTLE_ANGLE, delta);
        st.elev = settleLerp(st.elev, st.targetElev, 0.18, SETTLE_ANGLE, delta);
        st.r = settleLerp(st.r, st.targetR, 0.18, SETTLE_ANGLE, delta);

        const ce = Math.cos(st.elev);
        const se = Math.sin(st.elev);
        const x = I.ORBIT_CENTER[0] + st.r * ce * Math.sin(st.yaw);
        const z = I.ORBIT_CENTER[2] + st.r * ce * Math.cos(st.yaw);
        let y = I.ORBIT_CENTER[1] + st.r * se;

        // 2) B2：y 的硬地板
        if (y < I.ORBIT_MIN_Y) y = I.ORBIT_MIN_Y;

        camera.position.set(x, y, z);
        camera.lookAt(I.ORBIT_CENTER[0], I.ORBIT_CENTER[1], I.ORBIT_CENTER[2]);
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
    return {
        setPose: (yaw, elev, r, snap = true) => {
            const st = s.current;
            const e = clamp(elev, I.ORBIT_MIN_ELEV, I.ORBIT_MAX_ELEV);
            const rr = clamp(r, I.ORBIT_MIN_R, I.ORBIT_MAX_R);
            st.targetYaw = yaw;
            st.targetElev = e;
            st.targetR = rr;
            if (snap) {
                st.yaw = yaw;
                st.elev = e;
                st.r = rr;
            }
            st.active = true;
        },
        isActive: () => s.current.active,
        /** 轴心（世界坐标）。给 harness 反算"这个机位该在哪"，好自检有没有吸附上。 */
        center: I.ORBIT_CENTER,
    };
}

export default useOrbitCamera;
