import { useMemo } from 'react';
import { SEASON_AUTO, seasonIdOf } from '../config/seasons';
import { useSitePreferences } from '../context/SitePreferences';

/**
 * 当前季节的 id（'spring' | 'summer' | 'autumn' | 'winter'）。
 *
 * 读的是 `SitePreferences` 里的季节**偏好**，返回的是**解析后**的 id
 * —— 选「自动」时按月份解析，`useSeason()` 本身永远不会返回 `'auto'`。
 *
 * 2026-10-09 之前它解析**每挂载一次**（`useMemo(..., [])`），季节因此是
 * "一次会话内恒定"的，昼夜插值机不需要第二级缓动就能原样复用。设置面板
 * 让季节变成**运行时可切**，所以这里改成读 context —— 于是每个消费者都会
 * 跟着重渲染。
 *
 * ⚠️ 重渲染**不等于**画面会更新。有两处必须自己动手，漏了会静默停在旧季节：
 *   1. 季节相关的 uniform —— 不能换对象，只能就地改 `.value`
 *      （见 `hooks/useSeasonUniforms.js` 与 `shaders/entranceTextures.js`
 *      的 `applyGroundSeason`）；
 *   2. 只在"过渡过程中"写值、稳定后 early-return 的插值机
 *      （`SceneLighting` 的背景/雾/三盏灯、灯笼、窗光）—— 换季要让它重写一遍。
 *
 * `'auto'` 仍然**每挂载解析一次**（`useMemo` 依赖只有偏好）：跨午夜/跨月
 * 不会自己重烘贴图 —— 与门联同理，一次可见的 pop 不值得为开着过夜的标签页付。
 */
export function useSeason() {
    const { season } = useSitePreferences();
    return useMemo(
        () => (season === SEASON_AUTO ? seasonIdOf() : season),
        [season]
    );
}

export default useSeason;
