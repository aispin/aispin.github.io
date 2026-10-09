import { useLayoutEffect, useMemo, useRef } from 'react';
import { useSeason } from './useSeason';
import { applyGroundSeason } from '../shaders/entranceTextures';

/**
 * 建一组「跟着季节走」的地面 uniform，并在季节变化时**就地**更新它。
 *
 * 用法与 `useMemo` 完全一样，只是 `season` 不写进 deps：
 *
 *     const uniforms = useSeasonUniforms(
 *         (season) => makeSurfaceUniforms(w, h, origin, season),
 *         [w, h, origin]
 *     );
 *
 * 为什么不是 `useMemo(..., [..., season])`
 * --------------------------------------
 * 那样每次换季都会造一个**新的 uniforms 对象**，而 three 只认 program 建立时
 * 抓住的那批 uniform 对象（`materialProperties.uniformsList`），R3F 又是整体
 * 替换 `material.uniforms` —— 结果是画面静默停在旧季节。完整推导见
 * `shaders/entranceTextures.js` 的 `applyGroundSeason`。
 *
 * 所以这里的契约是：**对象身份永远不变，只有 `.value` 会变**。
 * - 首帧直接用当前季节建（不会先闪一帧秋天）；
 * - `deps` 变化时重建（新对象，内部已按当前季节建好）；
 * - 季节变化时走 `useLayoutEffect` 就地改值 —— 用 layout effect 而不是
 *   `useEffect`，是为了在浏览器下一次绘制前就写完，不闪一帧旧色。
 *
 * @param {(season: string) => object} factory
 * @param {Array} deps 除 season 以外的依赖
 */
export function useSeasonUniforms(factory, deps) {
    const season = useSeason();

    // ⚠️ `season` 故意不在 deps 里 —— 它的变化走下面的就地更新。
    // 其余 deps 变化时重建，重建时用的仍是**当前**季节（闭包是新的）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const uniforms = useMemo(() => factory(season), deps);

    const applied = useRef(season);

    useLayoutEffect(() => {
        if (applied.current === season) return;
        applied.current = season;
        applyGroundSeason(uniforms, season);
    }, [season, uniforms]);

    return uniforms;
}

export default useSeasonUniforms;
