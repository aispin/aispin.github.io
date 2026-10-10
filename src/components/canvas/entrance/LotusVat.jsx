import { useMemo } from 'react';
import * as THREE from 'three';
import { sharedGeometry } from '../../../engine/resources';
import { useSeason } from '../../../hooks/useSeason';
import { makeVatWaterTexture } from '../../../utils/entranceArt';

/**
 * LotusVat — 院子里的荷花缸（§6.1，P3「用户点名」那一件）
 * ======================================================
 *
 * 位置由调用方给：**与花箱并列**（窗下木花箱外侧）。用户 2026-10-09 定的。
 *
 * 三分法（docs/seasons.md §2）：
 *   · **A 档 常驻** —— 陶缸本体 + 水面。几何四季不动。
 *   · **B 档 季变** —— 内容物：荷钱 / 荷叶+荷花+蜻蜓 / 残荷+莲蓬 / 薄冰+积雪。
 *
 * ---------------------------------------------------------------------------
 * 为什么内容物是**条件挂载**（`{isSummer && …}`）而不是 `visible={false}`
 * ---------------------------------------------------------------------------
 * `StoneTable` 用的是 `visible={isWinter}` —— 那件东西只有 1 个季生网格，
 * 留着不画是"一次 draw 都不发"，代价可以忽略。
 *
 * 荷花缸不一样：四季内容物**加起来** 5+9+5+1 ≈ 20 个网格，而任意时刻只该有
 * 一季在场上。全挂上再靠 `visible` 关掉，`scene.traverse` 仍然数得到它们 ——
 * WO-3 的验收判据是 **mesh ≤ 760**（基线 704，只留 +56），20 个白占的网格
 * 会直接吃掉三分之一预算。条件挂载则只留当前季那一组（最多 9 个）。
 *
 * 几何全部走 `sharedGeometry` ⇒ 换季重挂是 Map 查表，不是重新 new。
 *
 * ---------------------------------------------------------------------------
 * 🔴 圆盘/平面都要 `rotation={[-Math.PI/2, 0, 0]}` 才是**水平**的
 * ---------------------------------------------------------------------------
 * three 的 `CircleGeometry` / `PlaneGeometry` 生在 XY 平面、法线朝 +Z。
 * 不转就是竖在空中的一块圆板（而且从默认机位看是一张"纸片"）。
 * 绕 X 转 −90° 之后法线朝 +Y，才是水面。倾斜的荷叶在此基础上再叠 ±。
 *
 * ⚠️ 本组件**不加任何几何进 `config/entranceMetrics.js`** —— 那文件是入口竖向
 * 几何的唯一真源，缸是独立的摆件（§7 硬约束）。
 */

/** 陶缸剖面（半径, 高度）。车削 = 外壁上行 → 过缸沿 → 内壁下行 → 缸底。 */
const VAT_PROFILE = [
    [0.000, 0.000],
    [0.120, 0.000],
    [0.178, 0.022],
    [0.238, 0.072],
    [0.282, 0.152],
    [0.300, 0.252],
    [0.305, 0.342],
    [0.300, 0.402],   // 缸沿外
    [0.287, 0.422],   // 缸沿顶
    [0.271, 0.414],   // 缸沿内
    [0.262, 0.382],
    [0.248, 0.300],
    [0.222, 0.200],
    [0.182, 0.122],
    [0.128, 0.076],
    [0.000, 0.062],   // 缸内底
].map(([x, y]) => new THREE.Vector2(x, y));

const VAT_RIM_Y = 0.422;
/** 水面高度：略低于缸沿（真缸不会满到边）。 */
const WATER_Y = 0.360;
const WATER_R = 0.262;

/** 陶色。比花箱的木色更冷、更灰 —— 免得两口容器读成一套。 */
const CLAY = '#6E5B4A';
const CLAY_DARK = '#57463A';

/** 荷叶 / 荷钱 / 残荷的盘子（位置 + 半径 + 倾角），确定性写死，不用随机。 */
const PADS_SPRING = [
    { x: -0.10, z: 0.04, r: 0.045, tilt: 0.10 },
    { x: 0.02, z: -0.10, r: 0.038, tilt: -0.14 },
    { x: 0.11, z: 0.06, r: 0.042, tilt: 0.08 },
    { x: -0.05, z: 0.12, r: 0.035, tilt: -0.06 },
    { x: 0.06, z: 0.12, r: 0.033, tilt: 0.16 },
];
const PADS_SUMMER = [
    { x: -0.09, z: 0.05, r: 0.125, tilt: 0.20 },
    { x: 0.08, z: -0.06, r: 0.105, tilt: -0.16 },
    { x: 0.02, z: 0.10, r: 0.092, tilt: 0.12 },
    { x: -0.06, z: -0.10, r: 0.086, tilt: -0.22 },
];
const PADS_AUTUMN = [
    { x: -0.08, z: 0.06, r: 0.098, tilt: 0.34 },
    { x: 0.09, z: -0.04, r: 0.082, tilt: -0.30 },
    { x: 0.00, z: 0.11, r: 0.072, tilt: 0.26 },
];

/** 荷花：一朵偏粉、一朵偏白（§6.1「粉/白」）。 */
const FLOWERS = [
    { x: 0.04, z: -0.02, color: '#E7A7BE', h: 0.115 },
    { x: -0.07, z: -0.07, color: '#EFE2E6', h: 0.095 },
];
/** 莲蓬：秋天两个，微微歪着。 */
const PODS = [
    { x: -0.05, z: 0.03, tilt: 0.22 },
    { x: 0.08, z: 0.07, tilt: -0.16 },
];

export function LotusVat({ position }) {
    const season = useSeason();
    const isSpring = season === 'spring';
    const isSummer = season === 'summer';
    const isAutumn = season === 'autumn';
    const isWinter = season === 'winter';

    // 车削缸体：26 段（和燕子窝同款做法）。不共享 —— LatheGeometry 不在
    // engine/resources 的 PRIMITIVES 表里，且全站只有这一口缸。
    const vatGeo = useMemo(() => new THREE.LatheGeometry(VAT_PROFILE, 26), []);
    // 水面/薄冰：**缓存键含季节**（§7），所以这里必须把 season 传进去。
    const waterTex = makeVatWaterTexture(season);

    return (
        <group position={position}>
            {/* ---- 陶缸本体（A 档，四季不动）---- */}
            <mesh geometry={vatGeo}>
                <meshStandardMaterial
                    color={CLAY}
                    roughness={0.78}
                    side={THREE.DoubleSide}
                />
            </mesh>

            {/* ---- 水面 / 薄冰（A 档的位置，B 档的贴图）----
                圆盘铺满缸内壁；冬天换成冰的贴图，几何不动。 */}
            <mesh position={[0, WATER_Y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <primitive object={sharedGeometry('circle', WATER_R, 24)} attach="geometry" />
                <meshStandardMaterial
                    map={waterTex}
                    roughness={isWinter ? 0.34 : 0.22}
                    metalness={isWinter ? 0.02 : 0.10}
                />
            </mesh>

            {/* ---- 春：荷钱（刚冒出的小圆叶）---- */}
            {isSpring && PADS_SPRING.map((p, i) => (
                <mesh
                    key={`pad-${i}`}
                    position={[p.x, WATER_Y + 0.012, p.z]}
                    rotation={[-Math.PI / 2 + p.tilt, 0, i * 0.7]}
                >
                    <primitive object={sharedGeometry('circle', p.r, 14)} attach="geometry" />
                    <meshStandardMaterial color="#5FA84E" roughness={0.72} side={THREE.DoubleSide} />
                </mesh>
            ))}

            {/* ---- 夏：荷叶田田 + 荷花 + 蜻蜓 ---- */}
            {isSummer && PADS_SUMMER.map((p, i) => (
                <mesh
                    key={`pad-${i}`}
                    position={[p.x, WATER_Y + 0.02 + p.r * 0.30, p.z]}
                    rotation={[-Math.PI / 2 + p.tilt, 0, i * 0.9]}
                >
                    <primitive object={sharedGeometry('circle', p.r, 18)} attach="geometry" />
                    <meshStandardMaterial
                        color={i % 2 ? '#3E7C36' : '#4C8F3E'}
                        roughness={0.66}
                        side={THREE.DoubleSide}
                    />
                </mesh>
            ))}
            {isSummer && FLOWERS.map((f, i) => (
                <mesh key={`flower-${i}`} position={[f.x, WATER_Y + f.h / 2 + 0.02, f.z]}>
                    <primitive object={sharedGeometry('cone', 0.042, f.h, 9)} attach="geometry" />
                    <meshStandardMaterial color={f.color} roughness={0.62} />
                </mesh>
            ))}
            {isSummer && (
                /* 蜻蜓：一根身子 + 两片翅膀。§6.1 只要"一只蜻蜓"，
                   所以刻意做成 3 个 mesh 的最小可读形态 —— 蜻蜓在这个尺度上
                   本来就读作"荷叶上方一个十字"。 */
                <group position={[0.10, WATER_Y + 0.20, -0.04]} rotation={[0, 0.6, 0.12]}>
                    <mesh rotation={[0, 0, Math.PI / 2]}>
                        <primitive object={sharedGeometry('cylinder', 0.004, 0.005, 0.075, 6)} attach="geometry" />
                        <meshStandardMaterial color="#4E6E8C" roughness={0.5} />
                    </mesh>
                    <mesh position={[0.012, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0.35]}>
                        <primitive object={sharedGeometry('plane', 0.055, 0.020)} attach="geometry" />
                        <meshStandardMaterial color="#DCE8F2" roughness={0.4} transparent opacity={0.72} side={THREE.DoubleSide} />
                    </mesh>
                    <mesh position={[0.012, 0.006, 0]} rotation={[-Math.PI / 2, 0, -0.35]}>
                        <primitive object={sharedGeometry('plane', 0.055, 0.020)} attach="geometry" />
                        <meshStandardMaterial color="#DCE8F2" roughness={0.4} transparent opacity={0.72} side={THREE.DoubleSide} />
                    </mesh>
                </group>
            )}

            {/* ---- 秋：残荷 + 莲蓬（「留得残荷听雨声」）---- */}
            {isAutumn && PADS_AUTUMN.map((p, i) => (
                <mesh
                    key={`pad-${i}`}
                    position={[p.x, WATER_Y + 0.012 + p.r * 0.34, p.z]}
                    rotation={[-Math.PI / 2 + p.tilt, 0, i * 1.1]}
                >
                    <primitive object={sharedGeometry('circle', p.r, 16)} attach="geometry" />
                    <meshStandardMaterial
                        color={i % 2 ? '#8C7A34' : '#9E8A3C'}
                        roughness={0.86}
                        side={THREE.DoubleSide}
                    />
                </mesh>
            ))}
            {isAutumn && PODS.map((p, i) => (
                <group key={`pod-${i}`} position={[p.x, WATER_Y + 0.055, p.z]} rotation={[p.tilt, 0, 0]}>
                    <mesh>
                        <primitive object={sharedGeometry('cylinder', 0.030, 0.020, 0.060, 10)} attach="geometry" />
                        <meshStandardMaterial color="#6F7A34" roughness={0.85} />
                    </mesh>
                    {/* 莲子：莲蓬顶上那圈小凸点 —— 1 个圆盘代掉 8 个球 */}
                    <mesh position={[0, 0.031, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                        <primitive object={sharedGeometry('circle', 0.028, 10)} attach="geometry" />
                        <meshStandardMaterial color="#556026" roughness={0.9} />
                    </mesh>
                </group>
            ))}

            {/* ---- 冬：缸沿积雪（水面已经换成冰的贴图）---- */}
            {isWinter && (
                <mesh position={[0, VAT_RIM_Y - 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                    <primitive object={sharedGeometry('ring', 0.250, 0.300, 26)} attach="geometry" />
                    <meshStandardMaterial color="#E4E9EF" roughness={0.94} side={THREE.DoubleSide} />
                </mesh>
            )}
        </group>
    );
}

export default LotusVat;
