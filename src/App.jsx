import { useState, Suspense, useEffect, useCallback, useRef, lazy } from 'react';
import { Canvas, useLoader } from '@react-three/fiber';
import { Preload, useTexture, Text, PerformanceMonitor } from '@react-three/drei';
import * as THREE from 'three';

import Preloader from './components/dom/Preloader';
import PaperTransition from './components/dom/PaperTransition';
import { AudioProvider, useAudio } from './context/AudioManager';
import { initAudio } from './utils/audioManager';
import { PerformanceProvider, usePerformance } from './context/PerformanceContext';
import { SceneProvider, useScene } from './context/SceneContext';
import NavigationUI from './components/ui/NavigationUI';
import GlobalOverlay from './components/ui/GlobalOverlay';
import CareerHud from './components/ui/CareerHud';
import ScreenReaderOverlay from './components/ui/ScreenReaderOverlay';
import Toast from './components/ui/Toast';
import { useDocumentMeta, getInitialRoomFromUrl } from './hooks/useDocumentMeta';
import { loadContentData } from './hooks/useContentData';
import SceneLighting from './components/canvas/SceneLighting';
import { REST_POSE } from './config/restPose';
import { SitePreferencesProvider } from './context/SitePreferences';
import SiteControls from './components/ui/SiteControls';

// Lazy load the heavy 3D experience
const Experience = lazy(() => import('./components/canvas/Experience'));

import './styles/main.scss';

// --- CONDITIONAL ASSET PRELOADING ---
// On high-end devices, preloads everything for zero stutter.
// On mobile/low-end devices, only preloads core textures to prevent Out Of Memory crashes.
import { 
  ENTRANCE_TEXTURES, 
  CORRIDOR_TEXTURES, 
  UI_TEXTURES,
  PRELOAD_ALL, 
  PRELOAD_LOADER,
  ABOUT_TEXTURES,
  IMAGE_ASSETS,
  filterTexturesByDevice
} from './config/texturePreloadList';
import { TextureLoader } from 'three';

// Standard Browser-level Image Preloader (for <img> tags)
const preloadBrowserImage = (path) => {
  if (typeof window === 'undefined') return;
  const img = new Image();
  img.src = path;
};

const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
const isWeakCPU = typeof navigator.hardwareConcurrency !== 'undefined' && navigator.hardwareConcurrency <= 4;
const isLowRAM = typeof navigator.deviceMemory !== 'undefined' && navigator.deviceMemory <= 4;
const isSmallScreen = typeof window !== 'undefined' && window.innerWidth < 450;
const isLowEnd = isMobileDevice || isWeakCPU || isLowRAM || isSmallScreen;

// Refined check for "hover capability" (non-touch devices should have hover: hover)
// Laptops with touch screens (which also have a mouse/trackpad) will return true here.
const supportsHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;

// Trigger Three.js preloads at module level (as standard for Drei)
if (isLowEnd) {
  const CORE_TEXTURES = [...ENTRANCE_TEXTURES, ...CORRIDOR_TEXTURES, ...UI_TEXTURES, ...IMAGE_ASSETS];
  const filteredCore = filterTexturesByDevice(CORE_TEXTURES, supportsHover);
  const filteredAbout = filterTexturesByDevice(ABOUT_TEXTURES, supportsHover);

  filteredCore.forEach(path => useTexture.preload(path));
  filteredAbout.forEach(path => useLoader.preload(TextureLoader, path));
} else {
  const filteredAll = filterTexturesByDevice(PRELOAD_ALL, supportsHover);
  const filteredLoader = filterTexturesByDevice(PRELOAD_LOADER, supportsHover);
  
  filteredAll.forEach(path => useTexture.preload(path));
  filteredLoader.forEach(path => useLoader.preload(TextureLoader, path));
}

// Debug bypass flag, read once before the router can wipe location.search
const NO_LOADER = typeof window !== 'undefined' && window.location.search.includes('noloader');

/* 首帧地址栏是不是一个深链（`/career` 之类）。与 NO_LOADER 同一个理由：
 * 模块级读一次，路由随后会用 replaceState 抹掉 query string。
 * 它的唯一用途是给 Preloader 一个初值 —— 深链的幕帘要按住，等传送落地再揭。 */
const DEEP_LINK_ROOM = typeof window !== 'undefined' ? getInitialRoomFromUrl() : null;

// Helper component to handle global audio enable on interaction
const GlobalAudioEnabler = () => {
  const { enableAudio } = useAudio();
  useEffect(() => {
    const handleInteraction = () => enableAudio();
    window.addEventListener('click', handleInteraction, { once: true });
    window.addEventListener('touchstart', handleInteraction, { once: true });
    window.addEventListener('keydown', handleInteraction, { once: true });
    return () => {
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('touchstart', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
    };
  }, [enableAudio]);
  return null;
};

// (There used to be a `PaperSceneBackground` component here that set
// `scene.background = paperTexture()`. It was never rendered by anything — the
// scene's background came from the declarative `<color attach="background">`
// in AppContent, which is now SceneLighting's job. Deleted rather than kept
// "just in case": the paper sheet still reaches the DOM side through
// installPaperVariables(), so nothing was using this one.)

// Bridge component to use hooks inside SceneProvider
// Handles dynamic meta tags + deep link auto-teleport
function DocumentMetaBridge({ sceneReady, onHoldChange }) {
  useDocumentMeta();

  const {
    initialRoom, markDeeplinkHandled, hasEntered, markEntered, teleportTo,
    currentRoom, isTeleporting, teleportPhase,
  } = useScene();

  const firedRef = useRef(false);
  /* 这条传送有没有真的飞起来过。用来区分「还没开始」和「飞了但被打断」，
     只有后者才该放手（看门狗把 isTeleporting 放掉的路径）。 */
  const sawFlightRef = useRef(false);

  /* 深链：`/career` 这类地址**直接进房间**，不再要求先自己走进大门。
     原来的条件是 `initialRoom && hasEntered` —— 别人点开分享出去的链接，会停在
     院子里，还得自己找到那扇门、走进去、再点一次；分享出去等于没分享。
     现在没进过屋就替他 `markEntered()`，再走正常的纸片转场进房间。

     🔴 去重用 `firedRef`，**不能**靠 effect 里 `clearTimeout` 清理：
     `markEntered()` 会让 `hasEntered` 变 true ⇒ 这个 effect 必然再跑一次，
     而重跑时的 cleanup 会把还没到点的 timer 清掉，深链就静默失效了。

     🔴 必须等 `sceneReady`（场景建完）再发传送。原来固定在挂载后 450ms 就发，
     那时走廊和 DoorSection 都还没注册，传送要么被丢弃、要么卡在纸片 'closing'
     阶段干等看门狗 —— 而幕帘早已揭开，用户看到的就是「走廊 → 合上 → 再揭开」。 */
  useEffect(() => {
    if (!initialRoom || firedRef.current || !sceneReady) return;
    firedRef.current = true;
    markDeeplinkHandled();
    if (!hasEntered) markEntered();
    // 等走廊挂载 + 相机切到 CORRIDOR 再转场，否则 DoorSection 还没注册。
    setTimeout(() => teleportTo(initialRoom), 450);
  }, [initialRoom, sceneReady, hasEntered, markEntered, teleportTo, markDeeplinkHandled]);

  /* 幕帘什么时候揭：传送**整条跑完**那一帧。
     只等 `currentRoom === initialRoom` 是不够的 —— 那一刻纸片还在 'opening'
     （1.2s 的撕开），幕帘一揭就露出正在撕的纸片，还是"两次幕帘"。
     必须等 `teleportPhase` 归 null（纸片已 display:none）再放手。

     传送中途失败（看门狗放掉 isTeleporting）也必须揭 —— 否则幕帘永远盖着，
     整站看起来就是"卡在加载页"。 */
  useEffect(() => {
    if (!initialRoom) return;
    if (isTeleporting) {
      sawFlightRef.current = true;
      return;
    }
    const landed = currentRoom === initialRoom && !teleportPhase;
    const failed = sawFlightRef.current && currentRoom !== initialRoom;
    onHoldChange(!(landed || failed));
  }, [initialRoom, currentRoom, isTeleporting, teleportPhase, onHoldChange]);

  return null;
}

/**
 * DebugBridge — headless probe hooks (no-op in normal sessions).
 * Exposes window.__aispin so puppeteer scripts can skip the entrance click +
 * door animation and snap the camera directly into a room. The `snap` path
 * also forces the paper overlay closed and the ContentRoom mounted, so layout
 * measurements reflect the real in-room state without waiting on GSAP.
 */
function DebugBridge() {
  const scene = useScene();
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const DOOR_Z = {
      career: -6, gallery: -20, studio: -36, posts: -50,
      videos: -86, music: -100, ai: -116, contact: -130,
    };
    window.__aispin = {
      enter: () => scene.markEntered(),
      teleport: (id) => scene.teleportTo(id),
      probe: () => ({
        currentRoom: scene.currentRoom,
        hasEntered: scene.hasEntered,
        phase: scene.teleportPhase,
        isTeleporting: scene.isTeleporting,
        pending: scene.pendingDoorClick,
        // WO-6 封口③ 的验收要用它：退到门前会先置 `houseExitRequested`，
        // **然后** `HouseExit` 把相机滑到 z = 28，最后才 `markExited()`。
        // 也就是说滑行全程 `hasEntered` 仍是 true —— 光看 `hasEntered` 分不清
        // "玩家在往后退"和"退出动画在把相机拉出去"。见 probe-corridor-seal.mjs。
        houseExitRequested: scene.houseExitRequested,
      }),
      // Force-snap into a room: bypass paper / door animation entirely.
      snap: (id) => {
        const cam = window.__cam;
        const sc = window.__scene;
        const z = DOOR_Z[id] ?? -6;
        if (cam) {
          cam.position.set(0, 0.2, z + 8);
          cam.rotation.set(0, 0, 0);
        }
        // Hide the paper overlay if present.
        document.querySelectorAll('.preloader').forEach((el) => {
          el.style.display = 'none';
          el.style.opacity = '0';
        });
        window.__forceRoom = id;
        scene.enterRoom(id);
        scene.finishPaperOpen?.();
        if (sc) sc.needsUpdate = true;
      },
      clearForce: () => {
        window.__forceRoom = null;
      },
      // 文章 / 项目覆盖层。进房间点卡片才能打开它，headless 里没有真实指针，
      // 所以直接把 scene 的开关暴露出来 —— 覆盖层里渲染的是 MarkdownBody，
      // 这是唯一能验证 markdown 表格/图片/行内 HTML 的入口。
      openOverlay: (content) => scene.openOverlay(content),
      closeOverlay: () => scene.closeOverlay(),
    };
  }, [scene]);
  return null;
}

function AppContent() {
  // `?noloader=1` means no Preloader exists to ever call onComplete, so the
  // scene must consider itself loaded from the first render. Seeding the state
  // with NO_LOADER does that without a mount effect (an effect would render
  // once "unloaded" and then immediately re-render, and react-hooks flags the
  // synchronous setState).
  const [isLoaded, setIsLoaded] = useState(NO_LOADER);
  const [sceneReady, setSceneReady] = useState(false);
  /* 深链时幕帘先按住，等传送落地再揭 —— 否则会看到「走廊 → 合上 → 再揭开」。
     初值直接给 `true`（模块级读的地址栏），不能等 effect 设，否则第一帧
     就已经放行了。没有深链时恒为 false，普通加载路径完全不变。 */
  const [holdLoader, setHoldLoader] = useState(Boolean(DEEP_LINK_ROOM));

  // Use Performance Context
  const { settings, downgradeTier, tier } = usePerformance();

  // Force initialize audio in the background on mount
  useEffect(() => {
    initAudio();
  }, []);

  const handleSceneReady = useCallback(() => {
    requestAnimationFrame(() => {
      setSceneReady(true);
    });
  }, []);

  return (
    <AudioProvider>
      <SceneProvider>
        <DocumentMetaBridge sceneReady={sceneReady} onHoldChange={setHoldLoader} />
        <DebugBridge />
        <GlobalAudioEnabler />
        <div className="app">
          {/* Full screen 3D Canvas */}
          <div className="canvas-wrapper">
            <Canvas
              camera={{
                // ⚠️ 必须与 `useInfiniteCamera` 的 targetZ/currentZ 初值一致 ——
                // 两者都用 `config/restPose.js` 的 REST_POSE，见那个文件的注释。
                position: [REST_POSE.x, REST_POSE.y, REST_POSE.z],
                fov: 60,
                near: 0.1,
                far: 150
              }}
              gl={{
                antialias: settings.antialias,
                alpha: false,
                powerPreference: settings.powerPreference,
                // ⚠️ 不要打开 failIfMajorPerformanceCaveat。
                // 它会在只支持软件 WebGL 的机器上（老 GPU、驱动黑名单、Linux
                // VM）直接让 getContext 返回 null —— 整站黑屏，而不是降级。
                // 而我们本来就有三级降级（PerformanceContext 的 HIGH/MEDIUM/LOW），
                // 这个开关和那套策略是互相打架的。
                // 同理 localClippingEnabled 也不开：全站没有一个 clippingPlanes，
                // 开着只会让 804 个材质的 program 都带上一段裁剪分支。
              }}
              dpr={settings.dpr}
              // 全场景没有任何 mesh 设 castShadow / receiveShadow（`grep -c` 为 0），
              // theme.js 自己写着 shadows: false，Experience.jsx 的注释写着
              // "shadows stay off" —— 但 PerformanceContext 的 HIGH 档把它打开，
              // 于是 three 每帧仍然分配并跑一遍 shadow map，什么都没画出来。
              shadows={false}
            >
              <SceneLighting isLowTier={tier === 'LOW'} />

              {/* Scale performance down if fps drops */}
              <PerformanceMonitor
                onDecline={() => downgradeTier()}
                flipflops={3}
                onFallback={() => downgradeTier()}
              />

              {/* Advanced FPS & Performance Monitor */}
              {/* <Perf position="top-left" minimal={false} /> */}

              <Suspense fallback={null}>
                <Experience
                  isLoaded={isLoaded}
                  // 进场自动"滚一格"（把用户送到门前）只在**真跑过 Preloader**
                  // 的路径上开。`?noloader=1` 下 `isLoaded` 初值就是 true，
                  // 若让它也推一下，所有以 REST_POSE 为基准的截图/判据都会漂。
                  enterFlourish={!NO_LOADER && isLoaded}
                  onSceneReady={handleSceneReady}
                  performanceTier={tier}
                />
                <Preload all />
              </Suspense>
            </Canvas>
          </div>

          {/* Navigation UI - Hamburger, Map, Back, Audio */}
          {isLoaded && (
            <>
              <SiteControls />
              <NavigationUI />
              <CareerHud />
              <GlobalOverlay />
              <ScreenReaderOverlay />
            </>
          )}

          {/* 🔴 `PaperTransition` **不能**放在 `isLoaded` 闸门里（2026-11-05）。
              深链的传送在幕帘还盖着的时候就发了，那时 isLoaded 还是 false ——
              纸片组件没挂载 ⇒ 'closing' 阶段没人播动画 ⇒ 一直卡到看门狗。
              等 isLoaded 翻真、组件补挂载，它才把 'closing' 从零播一遍：
              用户看到的就是「幕帘揭开露出走廊 → 纸片又合上 → 再揭开进房间」。
              它平时 `display: none`，提前挂载没有副作用。 */}
          <PaperTransition />

          {/* Transient feedback ("why did nothing happen?"). Mounted outside the
              isLoaded gate: the toast exists to explain blocked interactions, and
              some of those happen before the loader finishes. It renders nothing
              until something dispatches to it. */}
          <Toast />

          {/* 2D Preloader (debug: ?noloader=1 skips it for screenshot testing).
              Captured ONCE at module level - the router wipes the query string
              via history.replaceState shortly after mount, which used to
              re-enable the Preloader mid-session and block all input. */}
          {!NO_LOADER && (
            <Preloader
              ready={sceneReady}
              hold={holdLoader}
              onComplete={() => setIsLoaded(true)}
            />
          )}
        </div>
      </SceneProvider>
    </AudioProvider>
  );
}

import { AchievementsProvider } from './context/AchievementsContext';

export default function App() {
  // Preload browser-based images (for standard <img> tags) immediately upon mounting App
  // This ensures they are in the network waterfall during the initial loading phase.
  useEffect(() => {
    // Eagerly preload local content data and images
    loadContentData();

    const filteredImages = filterTexturesByDevice(IMAGE_ASSETS, supportsHover);
    // console.log(`[Preload] Triggering browser-level image preloads for ${filteredImages.length} assets.`);
    filteredImages.forEach(path => preloadBrowserImage(path));
  }, []);

  return (
    <SitePreferencesProvider>
      <PerformanceProvider>
        <AchievementsProvider>
          <AppContent />
        </AchievementsProvider>
      </PerformanceProvider>
    </SitePreferencesProvider>
  );
}
