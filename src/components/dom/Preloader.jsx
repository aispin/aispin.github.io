import { useState, useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import gsap from 'gsap';
import { useAudio } from '../../context/AudioManager';
import { hashString, mulberry32 } from '../../engine/art';

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

/* The value the progress tween most recently wrote into the DOM.
 *
 * The tween drives the SVG attributes imperatively (see onUpdate below) to keep
 * 60 fps off React's render path, so on a re-render the component has no React
 * state to seed those attributes from. It used to read `displayProgressRef` for
 * that — which is a ref read during render. A module-level mirror carries the
 * same number without the anti-pattern. Safe as a module singleton: exactly one
 * Preloader is ever mounted. */
let lastDisplayedProgress = 0;

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
  // Seeded PRNG, not Math.random(): the tear silhouette must be identical on
  // every run (project determinism contract) and the value has to be pure
  // during render. A fixed key gives a stable, jittered-looking edge.
  const tearPoints = useMemo(() => {
    const points = [];
    const segments = 12; // Fewer segments
    const rand = mulberry32(hashString('paper-tear'));

    points.push([50, 0]);

    for (let i = 1; i < segments; i++) {
      const y = (i / segments) * 100;
      const xOffset = (rand() - 0.5) * 6;
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

  // ----------------------------------------
  // EXIT SEQUENCE
  // ----------------------------------------
  // Declared here, above every effect that can trigger it. `startExit` used to
  // sit at the bottom of the component, so the progress trigger and the ready
  // fallback both referenced it from its temporal dead zone.
  //
  // The "have we already started" latch lives *inside* startExit and nowhere
  // else: it used to be set in three places (two of which ran before startExit
  // had even been entered), so the callers could disagree about the state.
  const exitStartedRef = useRef(false);

  const startExit = () => {
    if (exitStartedRef.current) return;
    exitStartedRef.current = true;

    if (pencilSoundRef.current) {
      pencilSoundRef.current.stop();
      pencilSoundRef.current = null;
    }
    play('tear', { volume: 0.8 });

    // 背景音乐**不**在这里起播（2026-10-08 用户改的）。
    //
    // 曾经在这里调 autoplayBackgroundMusic()：加载完就请求播放，首访被自动播放
    // 策略拦下时再挂一次性手势补播。问题是"被拦下"是常态（首访必然被拦），
    // 于是站点一进来就是"要么没声音、要么说不清什么时候会响"，
    // 而右上角那个图标又画成"有声"，与实际不符。
    //
    // 现在改成完全手势驱动：**推开大门**（EntranceDoors 的 handleClick）
    // 或**面板里取消静音**才起播。图标默认因此画成静音态。

    const tl = gsap.timeline({
      onComplete: () => {
        setIsDone(true);


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
    if (val >= 99.5 && readyRef.current) {
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
        lastDisplayedProgress = val;

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


  // Fallback trigger if ready becomes true AFTER 99.5% reached
  useEffect(() => {
    if (displayProgressRef.current >= 99.5 && ready) {
      startExit();
    }
  }, [ready]);

  if (isDone) return null;

  const pathLength = 120;
  // Initialize values from the imperative mirror, not from a ref (see
  // lastDisplayedProgress above).
  const safeProgress = Math.min(100, Math.max(0, lastDisplayedProgress));
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
