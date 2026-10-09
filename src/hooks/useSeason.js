import { useMemo } from 'react';
import { resolveSeason } from '../config/seasons';

/**
 * 当前季节的 id（'spring' | 'summer' | 'autumn' | 'winter'）。
 *
 * 解析**每挂载一次**，不挂午夜定时器 —— 与门联（`config/couplets.js`）完全同理：
 * 跨午夜重烘一次贴图会是一次可见的 pop，而一个开着过夜的标签页不值得为它 pop。
 * 刷新即正确。
 *
 * 这个"一次会话内恒定"的性质是有用的：它让昼夜的插值机器可以原样保留
 * （季节是常量，不需要第二级缓动）。详见 `config/seasonLight.js`。
 *
 * 默认按月份自动，`?season=winter` / `?season=冬` 可覆盖。
 */
export function useSeason() {
    return useMemo(() => resolveSeason().id, []);
}

export default useSeason;
