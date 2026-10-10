import { useLayoutEffect, useRef } from 'react';
import { useSeason } from './useSeason';

/**
 * 建一组「跟着季节走」的地面 uniform，并在季节变化时**就地**更新它。
 *
 * 用法：
 *
 *     const uniforms = useSeasonUniforms(
 *         (season) => makeSurfaceUniforms(w, h, origin, season),
 *         [w, h, origin]
 *     );
 *
 * 🔴 契约：**返回的对象身份永远不变，只有里面的 `.value` 会变。**
 * ------------------------------------------------------------------------
 * three 在材质上缓存 `materialProperties.uniformsList` —— 一串指向 uniform
 * **对象**（`{ value }`）的引用，上传时读的是这些对象里的 `.value`。它只在
 * **program 变化**时被置 null 重建（three 的 `getProgram()` 末尾），而 R3F 更新
 * `uniforms` prop 走的是 `applyProps` 的最后一个分支 `root[key] = value`
 * —— **整体替换**。
 *
 * ⇒ 一旦这个对象被换成新的，`uniformsList` 还指着**第一个**：之后无论怎么改
 *   新对象，画面都读不到 ⇒ **静默冻在首季**，没有任何报错。
 *   （`material.needsUpdate = true` 也救不了：program 缓存命中且 currentProgram
 *   未变时 early-return，`uniformsList` 照样不重建。）
 *
 * ⚠️ 2026-10-10 的教训：**光靠 `useMemo(..., deps)` 挡不住这件事。**
 * 本 hook 原来写的是 `useMemo(() => factory(season), deps)`，deps 里只要混进
 * **一个不稳定引用**，每次渲染都会造一个新对象 —— 而调用方很容易无意中传进来
 * （`EntranceDoors` 的 deps 里就有父组件内联的 `position={[0,0,z]}`）。
 * 症状正是用户报的「石板永远停在首次进入的那个季节」。
 *
 * 更阴的是：**读 `material.uniforms` 会读出"已经更新了"的假象** ——
 * 那里是**新**对象，值是对的；GPU 用的却是**旧**对象。所以这个 bug 必须靠
 * 「对象身份指纹」查（`harness/probe-stone-season-stuck.mjs`），不能靠读值。
 *
 * 所以这里改成：**身份由 ref 锁死，任何变化都只往同一批对象里写 `.value`。**
 * 首帧直接用当前季节建（不会先闪一帧秋天）；deps 或季节变化时把新值写回同一批
 * 对象；调用方新加的键（`uInLawn` 等）只在第一次出现时补进去。
 *
 * @param {(season: string) => object} factory
 * @param {Array} deps 除 season 以外的依赖（**允许不稳定** —— 不稳定只会多跑几次
 *                     effect，不会再破坏对象身份）
 */
export function useSeasonUniforms(factory, deps) {
    const season = useSeason();

    // 身份锁：只在首帧建一次，之后**永不替换**。
    const ref = useRef(null);
    if (ref.current === null) ref.current = factory(season);
    const uniforms = ref.current;

    // deps 或 season 变化时，把新值**就地**写进同一批 uniform 对象。
    // ⚠️ 不要改回 `useMemo(() => factory(season), deps)` —— 见上面那段推导。
    useLayoutEffect(() => {
        const next = factory(season);
        for (const key in next) {
            const slot = uniforms[key];
            if (slot) slot.value = next[key].value;
            // 调用方新增的键：只在第一次补进去。之后 uniformsList 已经抓到了它，
            // 再改 `.value` 就够了（键本身不能换，换了 uniformsList 里就没有它）。
            else uniforms[key] = next[key];
        }
        // deps 故意展开 —— 长度在每个调用点都是常量，符合 React 的要求。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [season, ...deps]);

    return uniforms;
}

export default useSeasonUniforms;
