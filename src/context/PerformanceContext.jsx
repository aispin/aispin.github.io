import { createContext, useContext, useState, useEffect } from "react";

// Performance Tiers
export const TIERS = {
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
};

// Settings for each tier
const SETTINGS = {
  [TIERS.HIGH]: {
    dpr: [1, 2], // Allow up to 2x pixel density
    // ⚠️ 一直是 true，但**全场景没有任何物体投影**（src/ 里 castShadow /
    // receiveShadow 出现 0 次），所以它只是让 three 每帧白跑一遍 shadow map。
    // 2026-10-07 关掉。真要用阴影时：先给物体加 castShadow/receiveShadow，
    // 再把这里改回 true，并且只让 key light 投影。
    shadows: false,
    antialias: true,
    powerPreference: "high-performance",
    physicsStep: 1 / 60,
    textureQuality: "high",
    particleCount: 1.0, // 100% particles
  },
  [TIERS.MEDIUM]: {
    dpr: [1, 1.5], // Cap at 1.5x on mobile to balance quality and GPU fillrate
    shadows: false, // Disable shadows for better mobile performance
    antialias: true,
    powerPreference: "default",
    physicsStep: 1 / 60,
    textureQuality: "medium",
    particleCount: 0.6, // 60% particles
  },
  [TIERS.LOW]: {
    dpr: [0.8, 1], // Minimum 0.8x pixel density to avoid extreme pixelation
    shadows: false, // Disable shadows completely
    antialias: false, // Disable AA to maximize FPS
    powerPreference: "low-power",
    physicsStep: 1 / 45, // Slower physics updates if needed
    textureQuality: "low",
    particleCount: 0.3, // 30% particles
  },
};

const PerformanceContext = createContext(null);

export const usePerformance = () => {
  const context = useContext(PerformanceContext);
  if (!context) {
    throw new Error("usePerformance must be used within a PerformanceProvider");
  }
  return context;
};

export const PerformanceProvider = ({ children }) => {
  const [tier, setTier] = useState(TIERS.HIGH); // Default to HIGH, degrade if needed
  const [isDetecting, setIsDetecting] = useState(true);

  useEffect(() => {
    const detectTier = () => {
      let detectedTier = TIERS.HIGH;

      // 1. Mobile Check
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (isMobile) {
        detectedTier = TIERS.MEDIUM;
      }

      // 2. Hardware Concurrency (CPU Cores)
      // Low-end devices usually have 4 or fewer cores
      if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) {
        detectedTier = isMobile ? TIERS.LOW : TIERS.MEDIUM;
      }

      // 3. GPU/FPS Estimate (Simplistic)
      // Override for very weak hardware or low RAM (<= 4GB)
      if (navigator.deviceMemory && navigator.deviceMemory <= 4) {
        detectedTier = TIERS.LOW;
      }
      
      // Removed small screen heuristic because modern phones have CSS width < 430px (e.g. iPhone 15 Pro Max is 430px)

      // console.log(
      //   `[Performance] Detected Tier: ${detectedTier} | Cores: ${navigator.hardwareConcurrency} | Mobile: ${isMobile}`
      // );
      setTier(detectedTier);
      setIsDetecting(false);
    };

    detectTier();
  }, []);

  /* 判据的抓手（只 dev）：把**档位本身**挂出来。和 `window.__skyClouds` /
     `window.__flightFinish` 同一个套路。
     🔴 没有它，探针只能从**副产物**反推档位，而两条副产物都不够用：
        `dpr` 在这台机器上三档都解析成 1（`clamp(devicePixelRatio, …)`），
        `uDetail` 只区分 LOW / 非 LOW —— HIGH 与 MEDIUM **根本分不开**。
        2026-10-14 为此白跑了两轮定妆照。 */
  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return undefined;
    window.__tier = tier;
    return () => { delete window.__tier; };
  }, [tier]);

  // Function to manually downgrade tier (called by PerformanceMonitor)
  const downgradeTier = () => {
    /* 🔴 判据的抓手（只 dev）：`window.__tierLock` 一挂上，fps 监视器就降不动档。
       为什么必须有：本环境（swiftshader + dev）实测只有 **~1 fps**，而 drei 的
       PerformanceMonitor 是**按真实 fps 降档**的 —— 它数的是真实帧、
       读的是 `performance.now()`（**不是** `Clock.getDelta`，试过掰时钟，没用）。
       `bounds` 在刷新率 ≤100 时是 [40, 60]，于是每批 10 个窗口全部 < 40
       ⇒ 头几帧就把 HIGH 一路降到 LOW。2026-10-14 实测：三张定妆照**全是 LOW**，
       连 `cores=真值` 的 HIGH 那页也是。
       **只锁"降档"，不碰 detectTier()** ⇒ 档位仍然由伪造的硬件信号真判出来，
       只是不让 fps 再改它。 */
    if (import.meta.env.DEV && typeof window !== 'undefined' && window.__tierLock) return;
    setTier((current) => {
      if (current === TIERS.HIGH) return TIERS.MEDIUM;
      if (current === TIERS.MEDIUM) return TIERS.LOW;
      return TIERS.LOW;
    });
  };

  const value = {
    tier,
    settings: SETTINGS[tier],
    isDetecting,
    downgradeTier,
  };

  return (
    <PerformanceContext.Provider value={value}>
      {children}
    </PerformanceContext.Provider>
  );
};
