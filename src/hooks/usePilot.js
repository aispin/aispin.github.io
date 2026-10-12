import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';

import { bindPilotInput } from '../utils/pilotInput';
import { pilot } from '../utils/pilotMotion';
import { canPilotControl } from '../config/flightMode';
import { showToast } from '../utils/toast';

/**
 * usePilot — 驾驶输入的 React 胶水（WO-22，2026-10-12）。
 * ==================================================================
 *
 * 用户：「另外还需**可以控制它的方向**。」
 *
 * 这个 hook 只做三件事：
 *   1. 飞行中把键盘 / 拖拽输入**绑到 canvas 上**（`utils/pilotInput.js`）；
 *   2. 进出飞行时**重置**驾驶状态（否则退出再进来飞机还歪着）；
 *   3. 把控制器交给调用方（`Airplane`），由它每帧 `sample(dt)`。
 *
 * 🔴 单例 `pilot` 的**唯一写入点**在 `Airplane` 的 `useFrame` 里
 *    （`pilot.update`）。相机那边只**读**（`pilot.applyCamera`）。
 *    所以 `Airplane` 必须排在 `FlightCamera` 前面挂载 —— `Experience.jsx`
 *    里就是这样，那边有注释。
 *
 * ⚠️ `canPilotControl()` 是**每次事件现问**的（不是闭包里的一份快照）：
 *    冻结时间（`?flight&t=N`）可以在会话中途生效，而"能不能操控"必须
 *    跟着它变。这个判断的真源在 `config/flightMode.js`。
 */
export function usePilot(active) {
    const gl = useThree((state) => state.gl);
    /** 稳定的返回值：调用方每帧读它，`active` 变化时内容会变。 */
    const control = useRef(null);

    useEffect(() => {
        if (!active) return undefined;

        // 每次进入飞行都从零开始 —— 包括"上一轮退出时还歪着"的情况。
        pilot.reset();

        const c = bindPilotInput(gl.domElement, {
            canControl: canPilotControl,
            onReset: () => {
                pilot.reset();
                showToast('已回到自动航线', { duration: 2200 });
            },
        });
        control.current = c;

        return () => {
            c.dispose();
            control.current = null;
            pilot.reset();
        };
    }, [active, gl]);

    return control;
}

export default usePilot;
