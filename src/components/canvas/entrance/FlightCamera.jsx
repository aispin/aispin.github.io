import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';

import { flightCameraAt } from '../../../utils/flightPath';
import { useFlightMode, exitFlight, flightTime } from '../../../config/flightMode';
import { showToast } from '../../../utils/toast';

/**
 * FlightCamera — 飞行模式的相机所有者（WO-18，2026-10-12）。
 * ==================================================================
 *
 * DR-M 定：「查询参数 + **接管主站相机**」。用户追加：「效果要保障」。
 *
 * 它只做一件事：每帧把 `utils/flightPath.js` 的 `flightCameraAt(t)` 写进相机。
 * **航线与镜头全是纯函数**，所以这里没有状态、没有积分、没有"上一帧" ——
 * 给一个 `t`，相机就在确定的位置上。
 *
 * 为什么这条性质值钱（而不是"优雅"）
 * ----------------------------------
 *   · 探针可以在**任意 t** 断言机位，不用"跑 N 秒再看"（后者会被帧率、
 *     丢帧、swiftshader 的慢速污染 —— 见 memory「截图不可复现」那条）；
 *   · `?flight&t=12` 直接落到第 12 秒的机位 ⇒ 定妆照可复现；
 *   · 暂停 / 拖进度 / 循环点无缝全都是免费的。
 *
 * ---------------------------------------------------------------------------
 * 🔴 退出不留残留 —— 而且**结构上**不留（这是本文件最要紧的地方）
 * ---------------------------------------------------------------------------
 * 第一版按参考实现直接改 `camera.fov`（镜头切到 44°），于是动了相机的
 * **三样东西**：`position` / `quaternion` / `fov`。前两样下一帧会被环绕相机
 * 覆盖，但 **`fov` 不会** —— 没人把它改回去，于是"退出飞行之后整个院子的
 * 透视变了"，而且看起来不像 bug，像"这游戏本来就这样"。
 * 当时的对策是"进入时存档三样、退出时写回"，而**那是一条纪律，纪律会忘**。
 *
 * 现在的做法：**镜头根本不写进 `fov`**。`flightPath.js` 把"长焦"换算成了
 * **推远距离**（`lensDolly()`，见那边的推导）⇒ 相机的投影矩阵从头到尾
 * 没被碰过 ⇒ **残留这件事结构上不存在**，不需要靠"记得写回"。
 *
 * 所以这里只存档两样（`position` / `quaternion`），而且 `fov` **根本不存**
 * —— 不是省事，是因为它没被动过。
 *
 * 判据：`harness/probe-flight-camera.mjs` 的 F2 断言退出前后
 * `projectionMatrix` 的 16 个元素**逐位相同**（不是"差不多"）。
 *
 * ---------------------------------------------------------------------------
 * 交接是**硬切**，不是过渡（这是有意的）
 * ---------------------------------------------------------------------------
 * 第一帧就从"院子机位"切到"飞机后上方"。看着像跳，但那正是"上飞机"
 * 这个动作该有的读感（电影的切镜语法），而且：
 *
 *   如果做 0.8 秒的插值过渡，`t < 0.8` 的机位就**不再是** `flightCameraAt(t)`
 *   —— 纯采样这条性质当场破掉，探针不能再断言 t=0 的机位。
 *   拿"可验证性"换"过渡软一点"，这笔账不划算。
 *
 * 另外补一条交互：飞行中**吞掉 canvas 上的 click**（捕获阶段 stopPropagation）
 * —— 否则"天上点一下"可能正好命中门 / 院子里的其他可点物，把访客送进屋。
 * 与 `useOrbitCamera` 的拖拽判定是同一个位置、同一条做法。
 */

export function FlightCamera({ enabled }) {
    const { camera, gl } = useThree();
    const flight = useFlightMode();

    // ⚠️ 拿 `enabled`（状态机给的）而不是自己看 `flight.active`：
    //    项目约定是**控制器不判断场景状态**，只执行（见 config/cameraMode.js）。
    //    这样"谁现在说了算"只有一处判断，`?fly` 与飞行模式同时开着时不会两边都写。
    const active = enabled && flight.active;

    const saved = useRef(null);

    useEffect(() => {
        if (!active) return undefined;

        // ---- 存档（退出时原样写回，见文件头）----
        // 只存 position / quaternion：`fov` **根本不用存**，因为
        // 这套镜头把"长焦"换算成了推拉距离，投影矩阵从头到尾没被碰过。
        saved.current = {
            position: camera.position.clone(),
            quaternion: camera.quaternion.clone(),
        };

        const dom = gl.domElement;
        const swallow = (e) => { e.stopPropagation(); };
        dom.addEventListener('click', swallow, true);

        // Esc 退出。⚠️ 只在**飞行中**挂这个监听 —— 常驻的话会和
        // 走廊 / 房间的 Esc 语义打架（那是"退出房间"）。
        const onKey = (e) => {
            if (e.key === 'Escape') exitFlight();
        };
        window.addEventListener('keydown', onKey);

        showToast('飞行中 · 按 Esc 退出', { duration: 3200 });

        return () => {
            dom.removeEventListener('click', swallow, true);
            window.removeEventListener('keydown', onKey);
            const s = saved.current;
            if (s) {
                camera.position.copy(s.position);
                camera.quaternion.copy(s.quaternion);
                saved.current = null;
            }
        };
    }, [active, camera, gl]);

    useFrame(() => {
        if (!active) return;
        const cam = flightCameraAt(flightTime());
        // ⚠️ 全部走**方法**（`copy` / `set` / `lookAt`），不碰任何属性 ——
        //    项目里改相机一贯如此，也是 `react-hooks/immutability`（error）
        //    允许的形式（见 `eslint.config.js` 的那条注释）。
        camera.position.copy(cam.position);
        // `lookAt` 用的是 `camera.up`：显式写回世界 up。
        // 镜头在飞机**动坐标系**里的偏移已经用世界 up 分解过（见 flightPath），
        // 所以地平线是稳的 —— 飞机横滚时画面不会跟着翻。
        camera.up.set(0, 1, 0);
        camera.lookAt(cam.target);
    });

    return null;
}

export default FlightCamera;
