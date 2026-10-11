import { useMemo } from 'react';
import * as THREE from 'three';
import { INK_WALL_FRAG, WARM_CEILING_FRAG, makeRoomMaterial, makeFloorMaterial, bakeWorldUVs, WORLD_UV_VERT } from '../../../shaders/roomSurfaces';
import { trimTexture } from '../../../utils/proceduralTextures';
import { sharedGeometry } from '../../../engine/resources';

// Import constants to match CorridorSegment logic
// Note: In a real project these might be in a shared config file.
// For now, we duplicate the values to avoid circular dependencies or complex imports if check is not rigorous.
const WALL_X_OUTER = 3.5;
const WALL_X_INNER = 1.7;
// Note: DOOR_Z_SPAN = 4 (from CorridorSegment)

// NOTE: the old `DoorWallSegment` (a camera-tilting wall for the angled walls
// beside doors) was removed — it was never rendered and the angled door walls
// are now owned by DoorSection.jsx.

/**
 * CorridorWalls Component
 * 
 * Renders the floor, ceiling, and the Sawtooth Walls.
 * 
 * 🔴 `zClip` 已于 2026-10-11 删除（WO-6）—— 它是一个**陷阱**，不要再加回来。
 * ---------------------------------------------------------------------------
 * 它叫 "clip"，做的却是**几何截断**：
 *
 *     effectiveStart  = Math.min(zStart, zClip)
 *     effectiveLength = effectiveStart - (zStart - length)
 *     if (effectiveLength <= 0) return null;
 *
 * 段 −1 的 `zStart` 是 102.15（= 22.15 + 80），一旦有人传
 * `zClip = CORRIDOR_FRONT_Z`（22.15，一个看起来完全合理的值），
 * `effectiveLength` 就变成 **0 / 负数** ⇒ 这个组件**整段 `return null`**：
 * 墙 / 地板 / 天花板全没了，而 `DoorSection` / `CorridorDecorations` /
 * `SegmentDoors` / 英雄机位**都不认 zClip**，照样渲染 ⇒ 画面上只剩
 * 「一堆门 / 画 / 花盆 / 通风口飘在雾色里」。用户 2026-10-11 报的
 * 「进入房间后，往后退进入循环时，墙壁丢失了」就是这一条。
 *
 * 现在**不需要**任何裁剪：走廊的段相位钉在 `INTERIOR_FRONT_Z`（屋身前墙）上，
 * 而 `InfiniteCorridorManager` 把段号 < 0 的段**整段**从渲染列表里摘掉 ——
 * 截断是那个 filter 的职责，而且是整段粒度，不会出现"墙没了、门还在"。
 *
 * @param {Array} doorPositions - Array of door objects with { relativeZ, side, ... }
 */
const CorridorWalls = ({ zStart = 10, length = 80, doorPositions = [] }) => {
    const corridorHeight = 3.5;
    const CORRIDOR_WIDTH = 7;

    // =============================================
    // SURFACES — all procedural, zero image textures
    // =============================================
    // The floor is a warm light-oak plank surface drawn by GLSL, the ceiling a
    // warm-white plaster shader, and the walls carry an ink-wash landscape
    // (INK_WALL_FRAG) — they used to be a flat meshBasicMaterial in #f7f1e6,
    // which is what left the corridor reading as an empty tube. Only the
    // baseboard keeps a texture, generated on canvas instead of shipped as a
    // webp.
    const FLOOR_TILE_LENGTH = 10;
    const ceilingMaterial = useMemo(
        () => makeRoomMaterial(WARM_CEILING_FRAG, CORRIDOR_WIDTH, FLOOR_TILE_LENGTH),
        []
    );
    const wallMaterial = useMemo(
        // WORLD_UV_VERT, not ROOM_VERT: the ink wash reads vUv in world metres
        // and uses vViewZ to fade hairline detail with distance.
        () => makeRoomMaterial(INK_WALL_FRAG, CORRIDOR_WIDTH, corridorHeight, {}, WORLD_UV_VERT),
        []
    );
    const baseboardTexture = useMemo(() => trimTexture('corridor-baseboard'), []);

    // 这一段的两个端点。段从 `zStart`（前沿，靠院子那一侧）往 −z 铺 `length`。
    // ⚠️ 这里**没有** `effectiveStart` / `effectiveLength` 了 —— 那两个名字
    //    是 `zClip` 时代的产物（见组件顶部的说明）。zClip 删掉之后它们恒等于
    //    `zStart` / `length`，所以直接用，别再引入一层"看起来像被裁过"的别名。
    const effectiveEndZ = zStart - length;

    // ---- FLOOR ----------------------------------------------------------
    // ONE plane per segment instead of a run of 10-unit tiles. The plank
    // layout is authored in world metres (baked into the UVs), so it runs
    // continuously through the segment instead of restarting every tile —
    // which is what produced the unnatural cross-corridor lines.
    //
    // 橡木地板（默认，uPaving = 0）。
    //
    // ⚠️ 这里曾经是 方砖墁地，理由是"过道是交通空间，青砖黑瓦的墙下铺暖橡木
    // 等于把两个世纪放进同一张画面"。**2026-10-07 用户决定改回来**：走进去
    // 是一整条冷灰方砖，屋子不像屋子，而且要"温馨一点"。年代解释权归用户。
    // 那个理由留在 `roomSurfaces.js` 的 uPaving 分支里，方砖本身没有删——
    // 想改回方砖只要把这个 `paving: true` 加回来。
    const floorMaterial = useMemo(() => makeFloorMaterial(), []);
    const floorGeometry = useMemo(() => {
        const geo = new THREE.PlaneGeometry(length, CORRIDOR_WIDTH);
        // Mesh rotation is [-PI/2, 0, -PI/2]: local Y -> world X, local X -> world Z.
        return bakeWorldUVs(geo, length, CORRIDOR_WIDTH, (lx, ly) => [
            ly,                       // world X (across the corridor)
            effectiveEndZ + lx        // world Z (along the corridor)
        ]);
    }, [length, effectiveEndZ]);

    // =============================================
    // REGULACJA PRZYCIĘCIA LISTWY PRZY DRZWIACH
    // =============================================
    // O ile (w unitach 3D) skrócić listwę z każdej strony przy ramce drzwi.
    // Zwiększ wartość → większa przerwa między listwą a drzwiami.
    // Zmniejsz wartość → listwa bliżej drzwi (może najeżdżać na ramkę).
    const BASEBOARD_DOOR_MARGIN = 0.5;

    // Helper to generate wall segments for a side ('left' or 'right')
    const generateWallSegments = (side) => {
        const segments = [];
        const isLeft = side === 'left';
        const baseX = isLeft ? -WALL_X_OUTER : WALL_X_OUTER;
        const innerX = isLeft ? -WALL_X_INNER : WALL_X_INNER;

        // We build the wall from Start (High Z) to End (Low Z).
        // Current 'cursor' for Z
        let currentZ = zStart;
        const endZ = zStart - length;

        // Sort doors by relativeZ descending (closest to start first) if needed
        // relativeZ is negative (-18, -32...). -18 > -32.
        const sideDoors = doorPositions
            .filter(d => d.side === side)
            .sort((a, b) => b.relativeZ - a.relativeZ);

        sideDoors.forEach(door => {
            const doorZ = zStart + door.relativeZ; // Use original zStart for correct world position
            const doorStartZ = doorZ + 2.0; // Start of angled section
            const doorEndZ = doorZ - 2.0;   // End of angled section

            // Skip doors that are completely clipped (starts "behind" us)
            if (doorStartZ > currentZ) return;
            // Also skip if door is fully "ahead" of us (shouldn't happen with standard logic but safe)
            if (doorEndZ < endZ) return;

            // 1. Straight Filler Segment (from currentZ to doorStartZ)
            if (currentZ > doorStartZ) {
                const segLength = currentZ - doorStartZ;
                const segCenterZ = currentZ - segLength / 2;
                segments.push({
                    type: 'filler',
                    position: [baseX, 0, segCenterZ],
                    rotation: [0, isLeft ? Math.PI / 2 : -Math.PI / 2, 0],
                    width: segLength,
                    isLeft,
                    // Ten segment kończy się przy drzwiach (od strony niższego Z)
                    trimLowZ: true
                });
            }

            // 2. Connector (Step Out) - The wall that faces the camera
            // Wait, if we are at baseX (Outer), and we want to start angled wall?
            // Actually, the angled wall GOES from Outer to Inner.
            // So we are rightfully at Outer.
            // Wait, the "Filler" is at Outer (Recessed).
            // So we are already at the start point of the angled wall.
            // No connector needed BEFORE the door?
            // Let's trace Left Wall (-X):
            // Filler is at x = -3.5.
            // Angled wall starts at x = -3.5.
            // Angled wall ends at x = -1.7.
            // So continuous join. Good.

            // 3. Angled Wall (Door holder)
            // From (baseX, doorStartZ) to (innerX, doorEndZ).
            const dx = innerX - baseX;
            const dz = doorEndZ - doorStartZ; // Negative (-4)
            const dist = Math.sqrt(dx * dx + dz * dz);
            // atan2(dx, dz). Left: dx = 1.8, dz = -4. Angle ~ 155 deg.
            // Standard wall normal is 90 deg.
            // We want rotation around Y.
            // Center of segment:
            const midX = (baseX + innerX) / 2;
            const midZ = (doorStartZ + doorEndZ) / 2;

            // Rotation:
            // Plane defaults to facing +Z (if simple plane)? No planeGeometry defaults to XY plane.
            // LookAt approach is easiest.
            // Wall normal should point inwards?
            // Actually simpler: Position geometry center and rotate.
            // Vector from Start to End: (dx, 0, dz).
            // Rotation Y = -atan2(dz, dx).
            // Left: dx=1.8, dz=-4. atan2(-4, 1.8) = -1.14 rad ~ -65 deg.
            // -(-65) = 65 deg.
            // Check: 0 deg = +X alignment. 90 deg = -Z alignment.
            // 65 deg = Pointing mostly +X, slightly -Z.
            // This aligns with vector.
            // Normal is +90 deg from that?
            // Left: dx=1.8, dz=-4. atan2(-4, 1.8) = -1.14 rad. -(-1.14) = +1.14. 
            // Normal (+0.9, +0.4) -> Right/Back. Correct for Left Wall.
            // Right: dx=-1.8, dz=-4. atan2(-4, -1.8) = -1.9 rad (-110deg). -(-1.9) = +1.9. 
            // Normal (+0.3, -0.9)? No. Check Math.
            // We need Right Wall Normal to point (-X, +Z). 
            // Adding PI fixes the backface issue.

            const baseRotation = -Math.atan2(dz, dx);
            const finalRotation = isLeft ? baseRotation : baseRotation + Math.PI;

            segments.push({
                type: 'door',
                position: [midX, 0, midZ],
                rotationY: finalRotation,
                width: dist,
                side: side  // For dynamic tilt direction
            });

            // 4. Reset Connector (The hidden face)
            // We are now at (innerX, doorEndZ).
            // We need to return to (baseX, doorEndZ).
            // Or (baseX, doorEndZ - eps).
            // This is a straight wall segment facing AWAY (-Z direction).
            // Left: From -1.7 to -3.5. Vector (-1.8, 0).
            // Facing -Z? Normal should be -Z.
            // Only need to render it.
            const connWidth = Math.abs(baseX - innerX);
            const connX = (innerX + baseX) / 2;

            segments.push({
                type: 'connector',
                position: [connX, 0, doorEndZ],
                rotation: [0, 0, 0], // Plane facing +Z.
                // If Face +Z, and we view from +Z, we see it.
                // We want it facing -Z (Away).
                // So Rotation Y = PI.
                rotationY: Math.PI,
                width: connWidth
            });

            currentZ = doorEndZ;
        });

        // Final filler segment
        if (currentZ > endZ) {
            const segLength = currentZ - endZ;
            const segCenterZ = currentZ - segLength / 2;
            segments.push({
                type: 'filler',
                position: [baseX, 0, segCenterZ],
                rotation: [0, isLeft ? Math.PI / 2 : -Math.PI / 2, 0],
                width: segLength,
                isLeft,
                // Ten segment zaczyna się zaraz po drzwiach (od strony wyższego Z)
                trimHighZ: currentZ !== zStart
            });
        }

        return segments;
    };

    // Cheap (a handful of small objects) — recomputed inline rather than
    // memoized so the hook order stays simple and correct.
    const leftSegments = generateWallSegments('left');
    const rightSegments = generateWallSegments('right');

    // ---- WALL PANELS ----------------------------------------------------
    // The wall is one quad per filler segment. Each gets world-space UVs baked
    // in (see INK_WALL_FRAG) so the ink wash runs continuously through the
    // corridor instead of restarting at every panel — the same treatment the
    // floor gets. Memoized because baking rewrites the geometry's UV
    // attribute, which is not something to redo on every render.
    const wallPanels = useMemo(
        () => [...leftSegments, ...rightSegments]
            .filter((seg) => seg.type === 'filler')
            .map((seg) => ({
                ...seg,
                geometry: bakeWorldUVs(
                    new THREE.PlaneGeometry(seg.width, corridorHeight),
                    seg.width, corridorHeight,
                    (lx, ly) => [
                        // Local +X runs along the wall: left wall points at
                        // world -Z, right wall at world +Z. Converting both to
                        // world Z parameterises the two walls by the same
                        // corridor coordinate, so a bamboo clump on the left
                        // is mirrored by one directly opposite it.
                        seg.isLeft ? seg.position[2] - lx : seg.position[2] + lx,
                        ly + corridorHeight / 2,   // 0 at the floor, 3.5 at the ceiling
                    ],
                ),
            })),
        // generateWallSegments() reads exactly these; it is recreated each
        // render, so it cannot itself be a dependency.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [zStart, length, doorPositions]
    );

    // 空段直接不画。保留这个守卫纯粹是防御性的（现在 `length` 恒为
    // `SEGMENT_LENGTH` = 80），而且必须留在**每一个 hook 调用之后**，
    // 否则 hook 顺序会随参数变化。
    if (length <= 0) return null;

    return (
        // `name` 是给 harness 用的（与 `infinite-corridor` / `house-shell` 同一套）：
        // 用户 2026-10-11 报的「往后退时墙壁丢失」说的就是**这一组网格**，所以
        // 验收探针要能直接数"墙还在不在"。数全场景网格数是**不行**的 —— 走廊的
        // 挂载网格数会随时间和机位在 205~480 之间变（异步加载 / Suspense 之类的
        // 非可见性因素，与墙无关），见 `probe-corridor-seal.mjs` 的注释。
        <group name="corridor-walls">
            {/* =============================================
                PODŁOGA - Kafelki (FLOOR TILES)
                =============================================
                Każdy kafelek jest płaskim plane z teksturą kawalekpodlogi.webp
                Co drugi kafelek jest obrócony o 180° i lustrzanie odbity
                żeby fajnie się łączyły ze sobą.
                
                USTAWIENIA DO RĘCZNEJ REGULACJI:
                - TILE_LENGTH: długość jednego kafelka (w unitach 3D)
                - TILE_WIDTH: szerokość (powinna pasować do korytarza = 7)
                - FLOOR_START_OFFSET: przesunięcie startu podłogi
            */}
            {/* =============================================
                PODŁOGA - jednolity pas desek (SINGLE PLANK FLOOR)
                =============================================
                Wcześniej: kafelki 10-unitowe z bitmapą (co drugi obrócony
                i lustrzany). Teraz jeden płaski plane na segment, a układ
                desek liczy shader w przestrzeni świata (patrz
                bakeWorldUVs) — dzięki temu deski biegną nieprzerwanie
                przez cały korytarz, bez sztucznych linii w poprzek.
            */}
            <mesh
                position={[0, -corridorHeight / 2, effectiveEndZ + length / 2]}
                rotation={[-Math.PI / 2, 0, -Math.PI / 2]}
                geometry={floorGeometry}
                material={floorMaterial}
            />


            {/* Ceiling with procedural warm-white plaster */}
            {(() => {
                const tileLength = FLOOR_TILE_LENGTH; // Match floor tile length
                const tileWidth = CORRIDOR_WIDTH;     // Ceiling width (matching corridor)
                const tiles = [];
                const ceilingY = corridorHeight / 2;

                // Use same global Z alignment as floor
                const segmentEndZ = effectiveEndZ;

                /**
                 * 🔴 第一块瓦片的**前沿**必须正好落在 `zStart` 上。
                 *
                 * 旧写法是 `floor(zStart / tileLength) * tileLength
                 * − tileLength / 2 + 2` —— 一个"全局对齐"的网格。问题是第一块
                 * 瓦片最多会比段前沿**多伸出 7 单位**。
                 *
                 * 段 0 前沿在 z = 10 时没人发现（多出来的那截正好被段 −1 的
                 * 瓦片盖住）；前沿钉到屋身前墙（`INTERIOR_FRONT_Z` = 22.15）之后，
                 * 多出来的那截就直接盖到**露天的前院**上了 —— 射线取证
                 * （`harness/probe-court-top.mjs`）在 z = 6 / 10 / 14 / 18 打到的
                 * 最上面一层全是 `PlaneGeometry{7,10}` @ `y = 1.75`。
                 *
                 * 对齐到 `zStart` 之后段与段仍然连续：`SEGMENT_LENGTH`
                 * 是 `tileLength` 的整数倍（80 / 10 = 8），所以相邻段的网格首尾相接。
                 */
                let tileZ = zStart - tileLength / 2;

                while (tileZ + tileLength / 2 > segmentEndZ) {
                    tiles.push(
                        <mesh
                            key={`ceiling-tile-${tileZ.toFixed(1)}`}
                            position={[0, ceilingY, tileZ]}
                            rotation={[Math.PI / 2, 0, 0]}
                            material={ceilingMaterial}
                        >
                            <primitive object={sharedGeometry('plane', tileWidth, tileLength)} attach="geometry" />
                        </mesh>
                    );
                    tileZ -= tileLength;
                }
                return tiles;
            })()}

            {/* Render Wall Segments with the ink-wash shader */}
            {/* Skip 'connector' and 'door' segments - door segments are now handled by DoorSection */}
            {wallPanels
                .map((seg, i) => {
                    // Baseboard texture clone
                    // Texture: 512x32 px canvas tile → natural tile 2.524 units wide
                    const bbTexture = baseboardTexture.clone();
                    bbTexture.needsUpdate = true;
                    bbTexture.wrapS = bbTexture.wrapT = THREE.RepeatWrapping;
                    bbTexture.rotation = 0; // CRITICAL: reset rotation (shared texture may have PI/2 from threshold)
                    bbTexture.offset.set(0, 0);
                    const NATURAL_TILE_W = 2.524;
                    bbTexture.repeat.set(seg.width / NATURAL_TILE_W, 1);

                    // =============================================
                    // PRZYCINANIE LISTWY PRZY DRZWIACH
                    // =============================================
                    // Listwa jest węższa o BASEBOARD_DOOR_MARGIN z każdej strony
                    // gdzie segment sąsiaduje z drzwiami (trimStart / trimEnd).
                    // Środek listwy jest przesunięty, żeby wyrównać do ściany.
                    // trimHighZ = przytnij od strony wyższego Z (gdzie zaczyna się wnęka drzwi)
                    // trimLowZ  = przytnij od strony niższego Z  (gdzie kończy się wnęka drzwi)
                    const bbMarginHighZ = seg.trimHighZ ? BASEBOARD_DOOR_MARGIN : 0;
                    const bbMarginLowZ = seg.trimLowZ ? BASEBOARD_DOOR_MARGIN : 0;
                    const bbWidth = seg.width - bbMarginHighZ - bbMarginLowZ;

                    // Przesunięcie środka listwy wzdłuż osi lokalnej (X w przestrzeni grupy)
                    // Segment jest obrócony, więc lokalna oś X = wzdłuż ściany.
                    // Po rotacji +PI/2 (lewa ściana): lokalna oś +X → świat -Z (niższy Z)
                    // Po rotacji -PI/2 (prawa ściana): lokalna oś +X → świat +Z (wyższy Z)
                    // Dlatego offset jest odwrócony między lewą a prawą ścianą.
                    let bbOffsetX;
                    if (seg.isLeft) {
                        // +X lokalny = -Z świat = strona lowZ
                        bbOffsetX = (bbMarginLowZ - bbMarginHighZ) / 2;
                    } else {
                        // +X lokalny = +Z świat = strona highZ
                        bbOffsetX = (bbMarginHighZ - bbMarginLowZ) / 2;
                    }

                    return (
                        <group key={i} position={seg.position} rotation={seg.rotation || [0, seg.rotationY, 0]}>
                            {/* Main Wall Segment — ink-wash landscape, UVs in world metres */}
                            <mesh geometry={seg.geometry} material={wallMaterial} />

                            {/* Baseboard (Listwa przypodłogowa) - przycięta przy drzwiach */}
                            <mesh position={[bbOffsetX, -corridorHeight / 2 + 0.075, 0.01]}>
                                <primitive object={sharedGeometry('plane', bbWidth, 0.15)} attach="geometry" />
                                <meshBasicMaterial color="#ffffff"
                                    map={bbTexture}
                                    roughness={0.8}
                                    side={THREE.DoubleSide}
                                />
                            </mesh>
                        </group>
                    );
                })}



            {/* Baseboards (Approximated or skip for complex geo for now) */}
            {/* Simplified: Just skip baseboards on zigzag for MVP efficiency */}
        </group>
    );
};

export default CorridorWalls;
