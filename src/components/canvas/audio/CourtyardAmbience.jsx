import { useAudio } from '../../../context/AudioManager';
import { SEASON_BED } from '../../../audio/ambience';
import { useSeason } from '../../../hooks/useSeason';
import AmbientSource from './AmbientSource';

/**
 * 院子声床 —— 四季各一条，见 `docs/seasons.md` §5.3 与 `audio/ambience.js`。
 *
 * 为什么是一个独立组件、而不是塞进 EntranceDoors
 * ============================================================
 * **互斥关系要写在结构上，不能写在注释里。**
 *
 * 四条声床属于**院子**，走廊和房间各有自己的底噪（Gallery=city、
 * Contact=sea）。如果把它挂在院子之外的地方，就得靠一堆条件判断去保证
 * "进走廊之后院子声别还在响" —— 那种约束迟早会被下一个人改掉。
 *
 * 而 `Experience.jsx` 里院子本来就有一个**现成的、唯一的结构边界**：
 *
 *     {!hasEntered && <EntranceDoors … />}   // 院子（含大门、石桌、树、燕巢）
 *     <InfiniteCorridorManager … />          // 走廊
 *     {isInRoom && <…Room />}                // 房间
 *
 * `hasEntered` 为假 ⇔ 相机在门外看院子（进门动画跑完才翻真；从 HouseExit
 * 走回来时又翻回假）。所以**只要挂在同一个 `!hasEntered` 分支下**，
 * "院子声音只在院子里响"就是免费得到的，一行条件都不用写。
 *
 * ⚠️ 别改成读 `isInRoom` —— 那是走廊里"是否进了某个房间"，院子阶段它
 * 一直是 false，用它当闸门等于四季声床在走廊里也会响。
 *
 * 起播闸门沿用既有契约：`createAmbience` 内部走 `whenUnlocked`，
 * 用户手势之前只排队、不建 AudioContext —— 所以**不会加载即播**。
 * 第一次点击（推门、或面板里拨开关）就是起播点。门开了院子卸载，
 * 声床随之淡出；从大门走出去时院子重新挂载，`whenUnlocked` 已经是
 * 已解锁态，会立刻重建 —— 所以"出院子再回来"也有声，不会哑掉。
 */
const COURTYARD_VOLUME = 0.5;

export default function CourtyardAmbience() {
    const season = useSeason();
    const { globalVolume, ambienceOn } = useAudio();

    // 与房间同一套算法：开关归 `ambienceOn`（不是音乐开关 `isMuted`），
    // 音量归 SFX 滑杆 `globalVolume`。见 AudioManager 的注释。
    const effectiveVolume = ambienceOn ? COURTYARD_VOLUME * globalVolume : 0;

    // `name` 一变 AmbientSource 就重建音频图 —— 换季因此是一次淡出 + 淡入，
    // 不需要额外的交叉淡化逻辑。
    return (
        <AmbientSource
            name={SEASON_BED[season]}
            volume={effectiveVolume}
            muted={!ambienceOn}
        />
    );
}
