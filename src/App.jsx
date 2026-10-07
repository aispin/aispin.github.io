import { useState, Suspense, useEffect, useCallback, useLayoutEffect, lazy } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
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
import ScreenReaderOverlay from './components/ui/ScreenReaderOverlay';
import Toast from './components/ui/Toast';
import { useDocumentMeta } from './hooks/useDocumentMeta';
import { loadContentData } from './hooks/useContentData';
import SceneLighting from './components/canvas/SceneLighting';
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
function DocumentMetaBridge() {
  useDocumentMeta();

  const { initialRoom, deeplinkHandled, hasEntered, teleportTo, markEntered } = useScene();

  // Deep linking: if user lands on e.g. /gallery, auto-teleport after scene loads
  useEffect(() => {
    if (initialRoom && hasEntered && !deeplinkHandled.current) {
      deeplinkHandled.current = true;
      // Small delay to let the corridor render first
      setTimeout(() => teleportTo(initialRoom), 300);
    }
  }, [initialRoom, hasEntered, teleportTo, deeplinkHandled]);

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
      about: -6, gallery: -20, studio: -36, posts: -50,
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
  const [isLoaded, setIsLoaded] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);

  // Use Performance Context
  const { settings, downgradeTier, tier } = usePerformance();

  // Force initialize audio in the background on mount
  useEffect(() => {
    initAudio();
  }, []);

  // Debug (?noloader=1): no Preloader exists to call onComplete, so mark loaded
  // ourselves - otherwise UI overlays (PaperTransition etc) never mount and
  // teleport flows stall forever.
  useEffect(() => {
    if (NO_LOADER) setIsLoaded(true);
  }, []);

  const handleSceneReady = useCallback(() => {
    requestAnimationFrame(() => {
      setSceneReady(true);
    });
  }, []);

  return (
    <AudioProvider>
      <SceneProvider>
        <DocumentMetaBridge />
        <DebugBridge />
        <GlobalAudioEnabler />
        <div className="app">
          {/* Full screen 3D Canvas */}
          <div className="canvas-wrapper">
            <Canvas
              camera={{
                position: [0, 0.2, 28],
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
              <GlobalOverlay />
              <PaperTransition />
              <ScreenReaderOverlay />
            </>
          )}

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
