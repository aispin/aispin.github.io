import { useState, useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import gsap from 'gsap';
import { useAudio } from '../../context/AudioManager';
import { autoplayBackgroundMusic } from '../../utils/audioManager';

/* How long to wait for the loading manager to say *anything* before assuming
 * there is nothing left to load. Only used when no asset ever reported — a
 * page with managed assets gets its answer from onLoad instead. */
const ASSET_GRACE_MS = 1200;

/* …and how long to wait when assets *did* report but onLoad never arrives.
 * Without this the bar had a real hang: one stalled request (a texture that
 * never resolves, a font blocked on a flaky network) keeps `active` true
 * forever, so phase 2 never starts and the bar sits below 85 % for good.
 * Generous, because assets genuinely take a while on a slow link — and it is
 * safe, since both phases only ever raise the value (Math.max), so a late
 * onLoad still jumps the bar to 100. */
const ASSET_STALL_MS = 9000;

// Reusable SVG Line Component (now accepts ref)
const TearLineSVG = ({ svgPathData, pathLength, strokeDashoffset, pathRef }) => (
  <svg
    className="preloader__overlay"
    viewBox="0 0 100 100"
    preserveAspectRatio="none"
    style={{ pointerEvents: 'none' }}
  >
    <path
      ref={pathRef}
      d={svgPathData}
      fill="none"
      stroke="#1a1a1a"
      strokeWidth="0.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        strokeDasharray: pathLength,
        strokeDashoffset: strokeDashoffset,
      }}
    />
  </svg>
);

// New Ring Loader - Cleaner circle that spins around text
const RingLoader = () => (
  <div className="preloader__ring">
    <svg width="120" height="120" viewBox="0 0 100 100" style={{ overflow: 'visible' }}>
      <circle
        cx="50" cy="50" r="45"
        fill="none"
        stroke="#000"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="10 15"
        opacity="0.8"
      />
      <circle
        cx="50" cy="50" r="35"
        fill="none"
        stroke="#000"
        strokeWidth="1"
        strokeLinecap="round"
        strokeDasharray="5 10"
        opacity="0.5"
        style={{
          animation: 'ring-spin-reverse 4s linear infinite',
          transformOrigin: '50% 50%'
        }}
      />
    </svg>
    <style>{`
      @keyframes ring-spin {
        0% { transform: translate(-50%, -50%) rotate(0deg); }
        100% { transform: translate(-50%, -50%) rotate(360deg); }
      }
      @keyframes ring-spin-reverse {
        0% { transform: rotate(360deg); }
        100% { transform: rotate(0deg); }
      }
      .preloader__ring {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 120px;
        height: 120px;
        pointer-events: none;
        z-index: 5;
        animation: ring-spin 10s linear infinite;
      }
    `}</style>
  </div>
);

const percentageStyle = {
  position: 'absolute',
  top: '50%',
  left: '0',
  width: '100%',
  transform: 'translateY(-50%)',
  textAlign: 'center',
  zIndex: 20,
  fontFamily: "'Inter', sans-serif",
  fontSize: '2rem',
  fontWeight: 'bold',
  mixBlendMode: 'multiply',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  overflow: 'visible'
};

const Preloader = ({ onComplete, ready }) => {
  const [isDone, setIsDone] = useState(false);

  // Custom throttled progress state to prevent React 'Maximum update depth exceeded'
  const [realProgress, setRealProgress] = useState(0);
  const [active, setActive] = useState(true);

  // Did anything ever report through the loading manager? A page with no
  // managed assets never fires onLoad, and without knowing that we cannot
  // tell "still loading" from "nothing to load".
  const sawAssetActivity = useRef(false);

  useEffect(() => {
    let t = 0;
    const origOnStart = THREE.DefaultLoadingManager.onStart;
    const origOnProgress = THREE.DefaultLoadingManager.onProgress;
    const origOnLoad = THREE.DefaultLoadingManager.onLoad;

    THREE.DefaultLoadingManager.onStart = (url, loaded, total) => {
      sawAssetActivity.current = true;
      setActive(true);
      origOnStart?.(url, loaded, total);
    };

    THREE.DefaultLoadingManager.onProgress = (url, loaded, total) => {
      sawAssetActivity.current = true;
      cancelAnimationFrame(t);
      t = requestAnimationFrame(() => {
        setRealProgress((loaded / total) * 100);
      });
      origOnProgress?.(url, loaded, total);
    };

    THREE.DefaultLoadingManager.onLoad = () => {
      cancelAnimationFrame(t);
      setRealProgress(100);
      setActive(false);
      
      const loadEnd = performance.now();
      const loadDuration = ((loadEnd - loadStartTime.current) / 1000).toFixed(2);
      // console.info(`📦 Assets Loaded: ${loadDuration}s`);
      
      origOnLoad?.();
    };

    return () => {
      THREE.DefaultLoadingManager.onStart = origOnStart;
      THREE.DefaultLoadingManager.onProgress = origOnProgress;
      THREE.DefaultLoadingManager.onLoad = origOnLoad;
    };
  }, []);

  const { play } = useAudio();
  // Track audio handle to stop loop
  const pencilSoundRef = useRef(null);

  // Performance Tracking
  const loadStartTime = useRef(performance.now());

  // Use refs for animation targets
  const containerRef = useRef(null);
  const leftHalfRef = useRef(null);
  const rightHalfRef = useRef(null);
  const pathLeftRef = useRef(null);
  const pathRightRef = useRef(null);
  const textLeftRef = useRef(null);
  const textRightRef = useRef(null);

  // Track visual progress entirely in refs to skip React renders 60x/sec!
  const [targetProgress, setTargetProgress] = useState(0);
  const displayProgressRef = useRef(0);
  const trackerRef = useRef({ val: 0 });
  const readyRef = useRef(ready);

  useEffect(() => { readyRef.current = ready; }, [ready]);

  // ----------------------------------------
  // GENERATE TEAR PATH
  // ----------------------------------------
  const tearPoints = useMemo(() => {
    const points = [];
    const segments = 12; // Fewer segments

    points.push([50, 0]);

    for (let i = 1; i < segments; i++) {
      const y = (i / segments) * 100;
      const xOffset = (Math.random() - 0.5) * 6;
      const x = 50 + xOffset;
      points.push([x, y]);
    }

    points.push([50, 100]);
    return points;
  }, []);

  const svgPathData = useMemo(() => {
    return tearPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]} `).join(' ');
  }, [tearPoints]);

  const leftClipPoly = useMemo(() => {
    let poly = '0% 0%, ';
    tearPoints.forEach(p => { poly += `${p[0]}% ${p[1]}%, `; });
    poly += '0% 100%';
    return `polygon(${poly})`;
  }, [tearPoints]);

  const rightClipPoly = useMemo(() => {
    let poly = '100% 0%, ';
    poly += '100% 100%, ';
    [...tearPoints].reverse().forEach(p => { poly += `${p[0]}% ${p[1]}%, `; });
    return `polygon(${poly.slice(0, -2)})`;
  }, [tearPoints]);


  // ----------------------------------------
  // LOADING PROGRESS — two honest phases
  // ----------------------------------------
  // Assets report real progress through THREE.DefaultLoadingManager; the 3D
  // scene build reports nothing at all. So the bar has three rules:
  //
  //   phase 1  assets   0 .. 85    driven by onStart / onProgress / onLoad
  //   phase 2  scene    85 .. 99   a time-based creep while the scene builds
  //   done              100        only when `ready` flips
  //
  // The old code returned a constant 90 in the second phase. Once the
  // textures were cleared, onLoad began firing almost immediately, so every
  // visitor watched the bar jump to exactly 90 % and then stop — a number
  // that means nothing, and which reads as "hung". A creep that never lands
  // on a round number and never claims to be finished says the same thing
  // honestly: still working.
  const [assetsDone, setAssetsDone] = useState(false);

  useEffect(() => {
    if (!active) { setAssetsDone(true); return; }
    // If nothing ever reports, onLoad will never fire either, and the bar
    // would sit at 0 until the scene was ready. Fall through to phase 2.
    // Same fallback, longer fuse, if assets started but never finished.
    const wait = sawAssetActivity.current ? ASSET_STALL_MS : ASSET_GRACE_MS;
    const id = window.setTimeout(() => setAssetsDone(true), wait);
    return () => window.clearTimeout(id);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    setTargetProgress(prev => Math.max(prev, (realProgress / 100) * 85));
  }, [realProgress, active]);

  useEffect(() => {
    if (ready) { setTargetProgress(100); return; }
    if (!assetsDone) return;
    const t0 = performance.now();
    const id = window.setInterval(() => {
      const s = (performance.now() - t0) / 1000;
      // 85 -> 99, decelerating but *never* stopping: 92 % at 5 s, 94 % at 10 s,
      // 96 % at 20 s, 98 % at 40 s. An exponential saturates hard — with the
      // first cut (τ = 2.2 s) the bar read 98.9 % by the 10 s mark and then sat
      // motionless, which is the same "hung" complaint at a different number.
      setTargetProgress(prev => Math.max(prev, 85 + 14 * (s / (s + 5))));
    }, 100);
    return () => window.clearInterval(id);
  }, [assetsDone, ready]);

  // Handle Pencil Sound & Exit checking dynamically
  const checkProgressTriggers = (val) => {
    // Pencil Sound
    if (val < 99 && !pencilSoundRef.current) {
      pencilSoundRef.current = play('pencil', { loop: true, volume: 0.5 });
    }
    else if (val >= 99 && pencilSoundRef.current) {
      pencilSoundRef.current.stop();
      pencilSoundRef.current = null;
    }

    // Exit phase
    if (val >= 99.5 && readyRef.current && !exitStarted.current) {
      exitStarted.current = true;
      startExit();
    }
  };

  useEffect(() => {
    return () => {
      if (pencilSoundRef.current) {
        pencilSoundRef.current.stop();
        pencilSoundRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const distance = targetProgress - displayProgressRef.current;
    let duration = 0.5;

    if (distance > 60) {
      duration = 1.5;
    } else if (distance > 30) {
      duration = 1.0;
    } else if (distance > 10) {
      duration = 0.6;
    } else if (distance > 0) {
      duration = 0.4;
    }

    gsap.to(trackerRef.current, {
      val: targetProgress,
      duration: duration,
      ease: "power2.out",
      overwrite: true, // Auto kill previous tweens on trackerRef
      onUpdate: () => {
        const val = trackerRef.current.val;
        displayProgressRef.current = val;

        const safeProgress = Math.min(100, Math.max(0, val));
        const strokeDashoffset = 120 - (120 * safeProgress) / 100;
        const percentageText = `${Math.round(safeProgress)}%`;

        // Direct DOM manipulation - BYPASS React Render!
        if (textLeftRef.current) textLeftRef.current.innerText = percentageText;
        if (textRightRef.current) textRightRef.current.innerText = percentageText;
        if (pathLeftRef.current) pathLeftRef.current.style.strokeDashoffset = strokeDashoffset;
        if (pathRightRef.current) pathRightRef.current.style.strokeDashoffset = strokeDashoffset;

        checkProgressTriggers(val);
      }
    });

  }, [targetProgress]);


  // ----------------------------------------
  // EXIT SEQUENCE
  // ----------------------------------------
  const exitStarted = useRef(false);

  // Fallback trigger if ready becomes true AFTER 99.5% reached
  useEffect(() => {
    if (displayProgressRef.current >= 99.5 && ready && !exitStarted.current) {
      exitStarted.current = true;
      startExit();
    }
  }, [ready]);

  const startExit = () => {
    exitStarted.current = true;

    if (pencilSoundRef.current) {
      pencilSoundRef.current.stop();
      pencilSoundRef.current = null;
    }
    play('tear', { volume: 0.8 });

    // 加载完成 —— 背景音乐从这里开始（用户要求：不再等到推门）。
    // 首访没有用户手势时会被自动播放策略拦下，audioManager 里挂了
    // 一次性手势补播兜底，见 autoplayBackgroundMusic 的说明。
    autoplayBackgroundMusic();

    const tl = gsap.timeline({
      onComplete: () => {
        setIsDone(true);
        
        const exitEnd = performance.now();
        const totalDuration = ((exitEnd - loadStartTime.current) / 1000).toFixed(2);
        // console.group("⏱️ Portfolio Loading Performance");
        // console.log(`- Start: %c${loadStartTime.current.toFixed(0)}ms`, "color: #888");
        // console.log(`- Total Duration: %c${totalDuration}s`, "color: #00ff00; font-weight: bold;");
        // console.groupEnd();
        
        onComplete?.();
      }
    });

    // 1. Quick pause before tear
    tl.to({}, { duration: 0.1 });

    // 2. Tear Apart
    tl.to(leftHalfRef.current, {
      xPercent: -100,
      rotation: -2,
      duration: 1.8,
      ease: "power3.inOut"
    }, 'tear');

    tl.to(rightHalfRef.current, {
      xPercent: 100,
      rotation: 2,
      duration: 1.8,
      ease: "power3.inOut"
    }, 'tear');

    // 3. Fade container
    tl.to(containerRef.current, {
      opacity: 0,
      duration: 0.5
    }, '-=0.5');
  };

  if (isDone) return null;

  const pathLength = 120;
  // Initialize values
  const safeProgress = Math.min(100, Math.max(0, displayProgressRef.current));
  const strokeDashoffset = pathLength - (pathLength * safeProgress) / 100;
  const percentageText = `${Math.round(safeProgress)}%`;

  return (
    <div className="preloader" ref={containerRef}>
      {/* LEFT HALF */}
      <div
        className="preloader__half preloader__half--left"
        ref={leftHalfRef}
        style={{ clipPath: leftClipPoly }}
      >
        {/* Content: Percentage & Line */}
        <div className="preloader__percentage" style={percentageStyle}>
          <span ref={textLeftRef}>{percentageText}</span>
          <RingLoader />
        </div>

        {/* SVG is now INSIDE the clipped half */}
        <TearLineSVG pathRef={pathLeftRef} svgPathData={svgPathData} pathLength={pathLength} strokeDashoffset={strokeDashoffset} />
      </div>

      {/* RIGHT HALF */}
      <div
        className="preloader__half preloader__half--right"
        ref={rightHalfRef}
        style={{ clipPath: rightClipPoly }}
      >
        {/* Content: Percentage & Line */}
        <div className="preloader__percentage" style={percentageStyle}>
          <span ref={textRightRef}>{percentageText}</span>
          <RingLoader />
        </div>

        {/* SVG is now INSIDE the clipped half */}
        <TearLineSVG pathRef={pathRightRef} svgPathData={svgPathData} pathLength={pathLength} strokeDashoffset={strokeDashoffset} />
      </div>
    </div>
  );
};

export default Preloader;
