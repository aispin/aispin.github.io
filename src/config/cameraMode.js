/**
 * 相机模式状态机 —— 全站**同一时刻只有一个相机所有者**。
 * ==================================================================
 *
 * 为什么需要它
 * ----------------------------------------------------------
 * 院子能绕着看之后，能写 `camera` 的东西变成了六个：
 *
 *   1. GSAP 入场 timeline（`EntranceDoors`）
 *   2. 环绕相机（用户拖拽）
 *   3. `?fly` 自由飞行调试相机
 *   4. `useInfiniteCamera`（走廊滚动 / 视差）
 *   5. `DoorSection` 的 `cameraOverride`（进房间 / 传送 / `HouseExit` 退出）
 *   6. `FlightCamera`（点前院小飞机 / `?flight`，WO-18 新增）
 *
 * 控制器本身只有十几行，**贵的是"谁现在说了算"**。以前这条规矩是隐式的
 * （"进走廊才开滚动"），加一个环绕相机就立刻打架：两边都在 `useFrame`
 * 里写 `camera.position`，谁的回调跑在后面谁赢 —— 而 R3F 的回调顺序按
 * 挂载顺序来，改一个 import 顺序就会翻面。所以把它写成显式的。
 *
 * 🔴 关键判据：**同一帧只允许一个所有者写相机**，其余一律 `return`。
 *
 * INTRO 不是一个模式，是一把锁
 * ----------------------------------------------------------
 * 入场那 2 秒里 `hasEntered` 还是 false，状态机给出的是 `COURTYARD` ——
 * 但真正的所有者是 GSAP。所以这里**不给 GSAP 单列一个模式**，而是规定：
 * 所有非 GSAP 的所有者每帧先问一句 `gsap.isTweening(camera.position)`，
 * 是就让位。比"记一个 `introDone` 标志"稳 —— 标志会漏（房间进出、退出
 * 动画都会再动相机，而那些时刻 `hasEntered` 已经是 true 了）。
 *
 * prefers-reduced-motion
 * ----------------------------------------------------------
 * 见 `hooks/useReducedMotion.js` 的判据：**停用户没要求的运动，留用户
 * 主动发起的运动。** 环绕相机没有任何自动运动（没有 auto-rotate、
 * 没有自动回中），拖拽才是唯一的输入源 —— 所以这个状态机对它**无事可做**。
 * 明确写在这儿，免得以后有人加自动旋转时忘了这条。
 */

/** 相机所有者的取值。同一时刻只可能是其中一个。 */
export const CAMERA_MODE = {
    /** `?fly` —— 自由飞行调试相机。优先级最高，压过一切。 */
    FLY: 'FLY',
    /** 飞行模式（点小飞机 / `?flight`）—— 见 `config/flightMode.js`。 */
    FLIGHT: 'FLIGHT',
    /** 传送中 / 房间内 —— `DoorSection` 通过 `cameraOverride` 直接控制。 */
    ROOM: 'ROOM',
    /** `HouseExit` 从前门滑出去的那一段。 */
    EXIT: 'EXIT',
    /** 院子里 —— 环绕相机（本项目的"面向访客的受限轨道"）。 */
    COURTYARD: 'COURTYARD',
    /** 走廊里 —— `useInfiniteCamera`。 */
    CORRIDOR: 'CORRIDOR',
};

/**
 * 由场景状态推出当前相机所有者。**纯函数**，没有 React、没有副作用 ——
 * 这样"在某个状态下谁拥有相机"这件事可以被单独验证，不用起整个场景。
 *
 * @param {object} s
 * @param {boolean} s.hasEntered          是否已进走廊（`SceneContext`）
 * @param {boolean} s.isTeleporting       是否在传送中
 * @param {boolean} s.isInRoom            是否在房间里
 * @param {boolean} s.houseExitRequested  是否正在播"走出大门"
 * @param {boolean} s.flyEnabled          URL 上有没有 `?fly`
 * @param {boolean} s.flightActive        飞行模式是否开着（点飞机 / `?flight`）
 */
export function resolveCameraMode({
    hasEntered, isTeleporting, isInRoom, houseExitRequested, flyEnabled, flightActive,
}) {
    // `?fly` 压过一切：它是 debug 后门，必要时得能从房间内部飞出去看。
    if (flyEnabled) return CAMERA_MODE.FLY;
    /**
     * 飞行模式排在第二。
     *
     * 为什么敢压在 ROOM / EXIT 上面：这两个状态在**实践上**不可能与飞行
     * 同时成立 —— 小飞机只在前院、`outdoorVisible` 为假时它整个卸载，
     * 而进房间 / 传送 / 退场都发生在那之后；`?flight` 又是页面加载即生效，
     * 那时人还在院子里。
     *
     * 那为什么还要把它放在前面？因为万一真撞上了，**用户显式要求的那个**
     * 应该赢。"点开飞机"是一次明确的意图，比"恰好还留在房间里"更该被尊重。
     */
    if (flightActive) return CAMERA_MODE.FLIGHT;
    // 传送 / 房间 / 退出：全都是 DoorSection 在 tween 相机。
    if (isTeleporting || isInRoom) return CAMERA_MODE.ROOM;
    if (houseExitRequested) return CAMERA_MODE.EXIT;
    if (!hasEntered) return CAMERA_MODE.COURTYARD;
    return CAMERA_MODE.CORRIDOR;
}

/**
 * URL 上有 `?fly` 吗。
 *
 * 刻意做成惰性求值而不是模块级常量：模块级常量在模块被 import 的那一刻
 * 就定死了，而 `Experience` 是 lazy chunk（在 preloader 之后才解析），
 * 那时 URL 早就有了 —— 但测试环境里 `window` 可能还没准备好，读早了会炸。
 */
export function isFlyEnabled() {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).has('fly');
}
