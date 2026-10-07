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

const SEGMENT_LENGTH = 80;
const WALL_X_OUTER = 3.5;
const WALL_X_INNER = 1.7;
const DOOR_Z_SPAN = 4;
const WALL_ANGLE = Math.atan2(WALL_X_OUTER - WALL_X_INNER, DOOR_Z_SPAN);

const FIRST_RUN = [
    { roomId: 'about', relativeZ: -18, side: 'left', icon: '▤', color: '#f5efe6' },
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
    hideSegmentDoors = false,
    zClip = 100000,
    setCameraOverride,
}) => {
    const zOffset = 10 - (segmentIndex * SEGMENT_LENGTH);
    const { language } = useSitePreferences();

    // Wrapped index: segment -1 maps to the LAST space, segment 2 back to the
    // first, and so on — that wrapping is what closes the loop. It is hoisted
    // out of the memo because the space's floor label uses it too: without
    // that, segments 2 and beyond would repeat the decoration while showing no
    // "AISPIN · 0n" at all, which reads as a broken clone of segment 0.
    const loopIndex = ((segmentIndex % LOOP_SPACES.length) + LOOP_SPACES.length) % LOOP_SPACES.length;

    const doors = useMemo(() => {
        // The segment directly behind the front doors is left blank while the
        // user is still outside — it is the approach to the entrance and must
        // not advertise rooms through the closed doors. This is the room-door
        // counterpart of `hideDoorsForSegments`, which already suppresses that
        // segment's big sawtooth doors. Once inside, the entrance is gone from
        // the scene entirely and that segment becomes an ordinary ring space.
        const definitions = hideSegmentDoors ? [] : LOOP_SPACES[loopIndex];
        return definitions.map((def) => {
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
    }, [segmentIndex, loopIndex, language, hideSegmentDoors]);

    return (
        <group position={[0, 0, 0]}>
            <CorridorWalls
                zStart={zOffset}
                length={SEGMENT_LENGTH}
                doorPositions={doors}
                zClip={zClip}
            />

            <group position={[0, 0, zOffset - 2]}>
                {/* Tech stack decal on the floor behind ZEO — he is standing on it. */}
                <AvatarFloorStack avatarLocalZ={-0.3} />
                <HeroText position={[0, -0.1, -0.5]} />
                <Avatar position={[0, -0.61, -0.3]} />
                <Doodles />
                <Text font={SCENE_FONTS.maple} position={[1.7, 1.4, 0.3]} fontSize={0.12} color="#C89B7B" anchorX="center">
                    {`AISPIN · 0${loopIndex + 1}`}
                </Text>
            </group>

            {!hideSegmentDoors && doors.map((door) => (
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
                zClip={zClip}
                setCameraOverride={setCameraOverride}
            />

            {!hideSegmentDoors && (
                <SegmentDoors
                    position={[0, 0, zOffset - SEGMENT_LENGTH + 5]}
                    corridorHeight={3.5}
                />
            )}
        </group>
    );
};

const MemoizedCorridorSegment = memo(CorridorSegment);

export { SEGMENT_LENGTH, WALL_X_OUTER, WALL_X_INNER, DOOR_Z_SPAN };
export default MemoizedCorridorSegment;
