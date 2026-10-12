/**
 * pilotInput — 驾驶输入（WO-22，2026-10-12）。
 * ==================================================================
 *
 * 用户：「另外还需**可以控制它的方向**。」
 *
 * 三路输入，合成一对 `{ x, y }` 轴（−1..1）：
 *
 *   · **键盘** WASD / 方向键
 *   · **指针拖拽**（触屏 / 鼠标）：从按下点开始的位移，归一化到"屏幕短边
 *     的一半"，拖出这个距离就是满舵
 *   · 松开 / 失焦 / 切标签页 ⇒ **回零**
 *
 * ---------------------------------------------------------------------------
 * 🔴 `sample(dt)` 为什么要吃 `dt`：**保住一次点按的冲量**
 * ---------------------------------------------------------------------------
 * 如果只读"现在按着哪些键"，那么一次 16 毫秒的轻点（或者一次快速滑过）
 * 有大概率**整个落在两帧之间** —— 玩家觉得"我明明按了，它没动"。
 *
 * 参考实现（`pilot-input.js`）的办法：按下时记 `MIN_TAP_SECONDS = 0.075`
 * 的**待兑现时间**，`sample(dt)` 每帧从中扣掉本帧时长，没按着的那部分按
 * 比例给一个**分数轴**（`weights[d] = pending[d] / seconds`）。于是：
 *
 *   · 一直按着 ⇒ 权重恒为 1（长按没有"尾巴"）；
 *   · 轻轻一点 ⇒ 那一帧拿到一个分数，`∫轴·dt` 与"真的按了 75 毫秒"一致；
 *   · 快速连点 / 别名键（W 和 ↑）同时按 ⇒ **饱和而不是排队**（`pending`
 *     取 max 不累加），否则按住不放会攒出一个巨大的尾巴。
 *
 * 这条性质让"操控手感"与帧率无关 —— 60 fps 和 30 fps 下同一串按键
 * 给出的**位移积分**相同。
 *
 * ⚠️ `y` 的正方向是**上**（`up` 减 `down`），与屏幕坐标相反。姿态那边
 *    直接用这个符号（见 `utils/pilotMotion.js`）。
 */

/** 键位 → 方向。方向名而不是向量，因为一个方向可以有两个键（别名）。 */
const DIRECTIONS = {
    KeyW: 'up',
    ArrowUp: 'up',
    KeyS: 'down',
    ArrowDown: 'down',
    KeyA: 'left',
    ArrowLeft: 'left',
    KeyD: 'right',
    ArrowRight: 'right',
};

/** 一次轻点的"待兑现时长"（秒）。 */
const MIN_TAP_SECONDS = 0.075;
/** 单帧最多兑现多少秒 —— 掉帧时不要把一整个尾巴一次性兑现掉。 */
const MAX_SAMPLE_SECONDS = 0.1;
/** 拖拽到满舵所需的屏幕距离（占**短边**的比例）。 */
const DRAG_FULL_SCALE = 0.22;

/** 焦点在输入控件里时**不抢键盘**（和全站其他快捷键同一条规矩）。 */
function ownsKeyboard(target) {
    return Boolean(
        target?.closest?.('input,textarea,select,[contenteditable],dialog[open]'),
    );
}

/**
 * 绑定驾驶输入。
 *
 * @param {HTMLElement} element 拖拽的宿主（canvas）
 * @param {object} opts
 *   · `canControl()` —— 现在能不能操控（飞行中 && 没暂停 && 没冻时间）
 *   · `onReset()`     —— `G` 被按下
 *   · `onChange(axes)` —— 轴变化时通知（给 HUD / toast 用）
 */
export function bindPilotInput(element, {
    canControl = () => true,
    onReset = () => {},
    onChange = () => {},
} = {}) {
    const doc = element.ownerDocument;
    const win = doc.defaultView;

    /** 现在按着哪些键（`event.code`）。 */
    const held = new Set();
    /** 每个方向还有多少秒的"待兑现"（一次轻点的尾巴）。 */
    const pending = { left: 0, right: 0, down: 0, up: 0 };
    /** 拖拽：按下点（null = 没在拖）。 */
    let dragFrom = null;
    let dragAxes = { x: 0, y: 0 };
    /** 拖到满舵所需的**像素**距离（按下时按视口算一次）。 */
    let dragFull = 1;

    const listeners = [];
    let disposed = false;

    const heldDirections = () => new Set([...held].map((code) => DIRECTIONS[code]));

    const keyAxes = () => {
        const d = heldDirections();
        return {
            x: Number(d.has('right')) - Number(d.has('left')),
            y: Number(d.has('up')) - Number(d.has('down')),
        };
    };

    /** 键盘与拖拽**取绝对值大的那个**（不是相加）—— 免得两边打架时超界。 */
    const axes = () => {
        const k = keyAxes();
        return Math.abs(dragAxes.x) + Math.abs(dragAxes.y) >= Math.abs(k.x) + Math.abs(k.y)
            ? dragAxes
            : k;
    };

    const notify = () => onChange(axes());

    const clear = () => {
        const changed = held.size > 0
            || dragFrom !== null
            || dragAxes.x !== 0 || dragAxes.y !== 0;
        held.clear();
        for (const d of Object.keys(pending)) pending[d] = 0;
        dragFrom = null;
        dragAxes = { x: 0, y: 0 };
        if (changed) notify();
    };

    const sample = (dt) => {
        if (disposed || !canControl() || doc.hidden) {
            clear();
            return { x: 0, y: 0 };
        }
        if (!Number.isFinite(dt) || dt <= 0) return axes();
        const seconds = Math.min(dt, MAX_SAMPLE_SECONDS);
        const d = heldDirections();
        const w = {};
        for (const dir of Object.keys(pending)) {
            // 按着 ⇒ 1；没按着 ⇒ 把待兑现的那点时间按比例换成**分数轴**。
            // 注意 `pending` 的扣减对"按着"的情况也发生 ⇒ 长按不会攒尾巴。
            w[dir] = d.has(dir) ? 1 : Math.min(pending[dir], seconds) / seconds;
            pending[dir] = Math.max(0, pending[dir] - seconds);
        }
        const k = { x: w.right - w.left, y: w.up - w.down };
        return Math.abs(dragAxes.x) + Math.abs(dragAxes.y) >= Math.abs(k.x) + Math.abs(k.y)
            ? dragAxes
            : k;
    };

    const on = (target, type, handler, options) => {
        target.addEventListener(type, handler, options);
        listeners.push(() => target.removeEventListener(type, handler, options));
    };

    const yields = (event) => disposed
        || !canControl()
        || doc.hidden
        || ownsKeyboard(event.target)
        || event.isComposing
        || event.keyCode === 229;

    on(doc, 'keydown', (event) => {
        if (yields(event)) { clear(); return; }
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        if (event.code === 'KeyG') {
            if (!event.repeat) { clear(); onReset(); }
            return;
        }
        if (!Object.hasOwn(DIRECTIONS, event.code)) return;
        // 暂停 / 失焦之后的系统连发不能"复活"一次已经被取消的按下。
        if (event.repeat && !held.has(event.code)) return;
        event.preventDefault();
        if (!held.has(event.code)) {
            const dir = DIRECTIONS[event.code];
            // **饱和，不排队** —— 别名键与快速连点都不会攒出尾巴。
            if (!heldDirections().has(dir)) pending[dir] = MIN_TAP_SECONDS;
            held.add(event.code);
            notify();
        }
    });

    on(doc, 'keyup', (event) => {
        if (yields(event)) { clear(); return; }
        if (held.delete(event.code)) notify();
    });

    // ---- 指针拖拽 ----
    // ⚠️ 用 `pointerdown` 而不是 `mousedown` / `touchstart`：一套事件覆盖
    //    鼠标 / 触屏 / 触控笔，而且 `setPointerCapture` 能在手指滑出 canvas
    //    之后继续收到 `pointermove`（否则拖出边界就断）。
    const onPointerDown = (event) => {
        if (disposed || !canControl()) return;
        if (event.button !== undefined && event.button !== 0) return;
        const rect = element.getBoundingClientRect();
        dragFrom = { x: event.clientX, y: event.clientY };
        dragFull = Math.max(1, Math.min(rect.width, rect.height) * DRAG_FULL_SCALE);
        dragAxes = { x: 0, y: 0 };
        try { element.setPointerCapture(event.pointerId); } catch { /* 无所谓 */ }
        notify();
    };
    const onPointerMove = (event) => {
        if (!dragFrom || disposed) return;
        const dx = event.clientX - dragFrom.x;
        const dy = event.clientY - dragFrom.y;
        // 屏幕 y 向下 ⇒ 往上拖要得到正的轴 ⇒ 取负。
        dragAxes = {
            x: clamp1(dx / dragFull),
            y: clamp1(-dy / dragFull),
        };
        notify();
    };
    const onPointerUp = () => {
        if (!dragFrom) return;
        dragFrom = null;
        dragAxes = { x: 0, y: 0 };
        notify();
    };

    on(element, 'pointerdown', onPointerDown);
    on(element, 'pointermove', onPointerMove);
    on(element, 'pointerup', onPointerUp);
    on(element, 'pointercancel', onPointerUp);
    // 失焦 / 切页 / 隐藏 ⇒ 回零。否则"松手那一刻正好切标签"会留下一个
    // 永远按着的键。
    on(win, 'blur', clear);
    on(win, 'pagehide', clear);
    on(doc, 'visibilitychange', () => { if (doc.hidden) clear(); });
    on(doc, 'focusin', (event) => { if (ownsKeyboard(event.target)) clear(); });
    on(doc, 'compositionstart', clear);

    return {
        axes,
        sample,
        clear,
        dispose() {
            if (disposed) return;
            disposed = true;
            clear();
            listeners.forEach((remove) => remove());
        },
    };
}

function clamp1(v) {
    return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
}

export default bindPilotInput;
