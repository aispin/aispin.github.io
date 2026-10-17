import { useMemo, memo } from 'react';
import { Text } from '@react-three/drei';

import CorridorWalls from './CorridorWalls';
import DoorSection from './DoorSection';
import SegmentDoors from './SegmentDoors';
import Avatar from './Avatar';
import AvatarFloorStack from './AvatarFloorStack';
import HeroText from './HeroText';
import Doodles from './Doodles';
import CorridorDecorations from './CorridorDecorations';
import { useSitePreferences } from '../../../context/SitePreferences';
import { ROOMS, SCENE_FONTS } from '../../../config/theme';
import * as I from '../../../config/island';

const SEGMENT_LENGTH = 80;
const WALL_X_OUTER = 3.5;
const WALL_X_INNER = 1.7;
const DOOR_Z_SPAN = 4;
const WALL_ANGLE = Math.atan2(WALL_X_OUTER - WALL_X_INNER, DOOR_Z_SPAN);

/**
 * 🔴 段 0 的**前沿** —— 也就是室内的起点，见 `config/island.js` 的
 * `INTERIOR_FRONT_Z`（= 院子的后罩墙）。
 *
 * 为什么基准不是 0：走廊的可见几何（地板 / 墨墙 / 暖白顶）**不能露到露天的
 * 院子里**，一露出来从上面看就是院子正中间一大片暖白顶。把段 0 的前沿钉在
 * 后罩墙上，未入场时只要摘掉段号 < 0 的整段，走廊就一根线都不进院子 ——
 * 而且**不需要 zClip**：裁剪面与段前沿重合，入场前后几何逐位一致。
 *
 * ⚠️ 这个值同时出现在 `InfiniteCorridorManager`（段索引反查）、
 * `useInfiniteCamera`（自动回头看门的 zOffset）和 `DoorSection`（进屋时算段号）。
 * 改这里必须一起改，判据是 `grep -rn 'INTERIOR_FRONT_Z' src/`。
 */
const CORRIDOR_FRONT_Z = I.INTERIOR_FRONT_Z;

/**
 * 英雄机位（ZEO + AISPIN 大字 + 地板贴花 + 涂鸦）在段内相对前沿的深度。
 *
 * 入场落点必须**在屋里**（见 `EntranceDoors` 的相机终点）：落点一进屋，
 * `hasEntered` 翻转时院子那些道具（地面 / 院墙 / 竹林 / 门楼）卸载就发生在
 * 相机**背后**，不会看见地面凭空消失。所以英雄机位要跟着往深里挪，
 * 让 ZEO 仍然落在相机前 ~3.3 单位。
 */
const HERO_INSET = 6.65;

const FIRST_RUN = [
    { roomId: 'career', relativeZ: -18, side: 'left', icon: '▤', color: '#f5efe6' },
    { roomId: 'gallery', relativeZ: -32, side: 'right', icon: '◇', color: '#e6f5ef' },
    { roomId: 'studio', relativeZ: -48, side: 'left', icon: '⌂', color: '#efe6f5' },
    { roomId: 'posts', relativeZ: -62, side: 'right', icon: '▧', color: '#f5e6e6' },
];
const SECOND_RUN = [
    { roomId: 'videos', relativeZ: -18, side: 'left', icon: '▷', color: '#f5efe6' },
    { roomId: 'music', relativeZ: -32, side: 'right', icon: '♫', color: '#e6f5ef' },
    { roomId: 'ai', relativeZ: -48, side: 'left', icon: '✳', color: '#efe6f5' },
    { roomId: 'contact', relativeZ: -62, side: 'right', icon: '✉', color: '#f5e6e6' },
];

/**
 * The corridor is a CLOSED LOOP — `LOOP_SPACES` is the ring, one entry per
 * 80-unit space, and the list repeats in both directions forever.
 *
 * WHY THIS EXISTS
 * The environment was already periodic. Walls, floor, ceiling, the wall
 * paintings and vents, the doodles, the big sawtooth segment doors with the
 * infinity painting above them, and even ZEO himself are all rebuilt
 * identically every SEGMENT_LENGTH, because every one of them is positioned
 * from `zOffset` alone (see CorridorDecorations: it is not even passed the
 * segment index).
 *
 * Room doors were the single exception. They were hardcoded as
 *   segmentIndex === 0 ? FIRST_RUN : segmentIndex === 1 ? SECOND_RUN : []
 * so the eight rooms existed exactly once, in the two segments you walk into
 * from the entrance, and every other segment was a stretch of corridor with
 * nothing in it. Walk back through the first segment door and the content
 * repeats forever while the rooms do not — and once the nearest room door is
 * further than fogFar (60), even those are erased. That mismatch is the whole
 * "infinite loop that runs out of rooms" report.
 *
 * Assigning by a WRAPPED index puts the rooms on the same 160-unit period as
 * everything else, so the corridor becomes a genuine ring: walking either
 * direction cycles through all eight rooms, and no position on the loop is
 * featureless.
 *
 * EXTENDING IT LATER IS PURE DATA
 *   - one more door in an existing space -> add an entry to that space's array
 *     (relativeZ must stay inside 0..-80 and clear of the other doors)
 *   - a whole new space, period grows to 240 -> push a third array in here
 * Because the index is wrapped rather than compared against fixed values,
 * neither change needs any geometry or placement maths.
 */
const LOOP_SPACES = [FIRST_RUN, SECOND_RUN];

const CorridorSegment = ({
    segmentIndex = 0,
    onDoorEnter,
    setCameraOverride,
}) => {
    const zOffset = CORRIDOR_FRONT_Z - (segmentIndex * SEGMENT_LENGTH);
    const { language } = useSitePreferences();

    // Wrapped index: segment -1 maps to the LAST space, segment 2 back to the
    // first, and so on — that wrapping is what closes the loop. It is hoisted
    // out of the memo because the space's floor label uses it too: without
    // that, segments 2 and beyond would repeat the decoration while showing no
    // "AISPIN · 0n" at all, which reads as a broken clone of segment 0.
    const loopIndex = ((segmentIndex % LOOP_SPACES.length) + LOOP_SPACES.length) % LOOP_SPACES.length;

    const doors = useMemo(() => {
        // ⚠️ 2026-10-11（WO-6）：这里原来有一个 `hideSegmentDoors` 分支，
        //    用来"入场前把段 −1 的门摘掉，免得在院子里看见一排飘着的门"。
        //    门楼并进屋身之后 `InfiniteCorridorManager` **整段**不渲染段号 < 0
        //    的段，那个开关永远不会被打开 —— 所以连同它的调用方一起删了。
        //    段 0 的门照常渲染：它在 z ≈ 6，离前门 16 单位，入场前看不见
        //    （屋身前墙挡着），入场后就是走廊里的第一扇门。
        return LOOP_SPACES[loopIndex].map((def) => {
            const xBase = (WALL_X_OUTER + WALL_X_INNER) / 2;
            const baseRotation = def.side === 'left' ? Math.PI / 2 : -Math.PI / 2;
            const rotationOffset = def.side === 'left' ? -WALL_ANGLE : WALL_ANGLE;
            const room = ROOMS.find((item) => item.id === def.roomId);
            return {
                ...def,
                id: `${def.roomId}-${segmentIndex}`,
                label: room?.[language] ?? def.roomId.toUpperCase(),
                x: def.side === 'left' ? -xBase : xBase,
                rotation: baseRotation + rotationOffset,
            };
        });
    }, [segmentIndex, loopIndex, language]);

    return (
        <group position={[0, 0, 0]}>
            <CorridorWalls
                zStart={zOffset}
                length={SEGMENT_LENGTH}
                doorPositions={doors}
            />

            <group position={[0, 0, zOffset - HERO_INSET]}>
                {/* Tech stack decal on the floor behind ZEO — he is standing on it. */}
                <AvatarFloorStack avatarLocalZ={-0.3} />
                <HeroText position={[0, -0.1, -0.5]} />
                <Avatar position={[0, -0.61, -0.3]} />
                <Doodles />
                <Text font={SCENE_FONTS.maple} position={[1.7, 1.4, 0.3]} fontSize={0.12} color="#C89B7B" anchorX="center">
                    {`AISPIN · 0${loopIndex + 1}`}
                </Text>
            </group>

            {doors.map((door) => (
                <DoorSection
                    key={door.id}
                    position={[door.x, 0, zOffset + door.relativeZ + 2]}
                    side={door.side}
                    label={door.label}
                    roomId={door.roomId}
                    icon={door.icon}
                    color={door.color}
                    onEnter={() => onDoorEnter?.(door.roomId)}
                    setCameraOverride={setCameraOverride}
                    segmentIndex={segmentIndex}
                    segmentLength={SEGMENT_LENGTH}
                />
            ))}

            <CorridorDecorations
                segmentLength={SEGMENT_LENGTH}
                zOffset={zOffset}
                corridorWidth={WALL_X_OUTER * 2}
                corridorHeight={3.5}
                setCameraOverride={setCameraOverride}
            />

            <SegmentDoors
                position={[0, 0, zOffset - SEGMENT_LENGTH + 5]}
                corridorHeight={3.5}
            />
        </group>
    );
};

const MemoizedCorridorSegment = memo(CorridorSegment);

export { SEGMENT_LENGTH, CORRIDOR_FRONT_Z, WALL_X_OUTER, WALL_X_INNER, DOOR_Z_SPAN };
export default MemoizedCorridorSegment;
