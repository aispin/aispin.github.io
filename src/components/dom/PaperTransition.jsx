import { useEffect, useRef, useMemo } from 'react';
import gsap from 'gsap';
import { useScene } from '../../context/SceneContext';
import { useAudio } from '../../context/AudioManager';
import { hashString, mulberry32 } from '../../engine/art';
import '../../styles/Preloader.scss'; // Reuse preloader styles

/**
 * PaperTransition - Reusable paper tear transition for teleportation
 * 
 * Listens to SceneContext teleportPhase:
 * - 'closing': Paper halves slide together (reverse of tear)
 * - 'teleporting': Paper is closed, waiting for destination load
 * - 'opening': Paper tears apart revealing new room
 */

// Reusable SVG Line Component (copied from Preloader)
const TearLineSVG = ({ svgPathData }) => (
    <svg
        className="preloader__overlay"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ pointerEvents: 'none' }}
    >
        <path
            d={svgPathData}
            fill="none"
            stroke="#1a1a1a"
            strokeWidth="0.1"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
);

const PaperTransition = () => {
    const {
        teleportPhase,
        startTeleportTransition,
        finishPaperOpen,
    } = useScene();
    const { play } = useAudio();

    const containerRef = useRef(null);
    const leftHalfRef = useRef(null);
    const rightHalfRef = useRef(null);
    const timelineRef = useRef(null);

    // Generate tear path (same logic as Preloader).
    // Seeded PRNG, not Math.random(): the tear silhouette must be identical on
    // every run (project determinism contract) and the value has to be pure
    // during render. A fixed key gives a stable, jittered-looking edge.
    const tearPoints = useMemo(() => {
        const points = [];
        const segments = 12;
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

    // Handle teleport phases
    //
    // WHY THE CALLBACKS GO THROUGH REFS
    // ---------------------------------
    // This effect owns the teleport timeline, and its cleanup kills whatever
    // timeline is current. `play` comes from useAudio() and is recreated on
    // every `isMuted` / `globalVolume` change (see AudioManager), so with `play`
    // in the dependency array ANY audio tweak — dragging the volume slider, or
    // the achievement popup's own `setGlobalVolume(0/1)` — re-ran this effect
    // and killed a timeline that was still mid-flight.
    //
    // A killed timeline never fires its onComplete, so the phase machine stalls:
    //   - stuck on 'closing'  -> the camera never moves, the paper stays shut
    //     over the screen, AND `isTeleporting` is never cleared, which makes
    //     teleportTo() refuse every later request. Every room, permanently.
    //   - stuck on 'opening'  -> the fade-out that parks the paper at
    //     `display:none` lives in the same killed timeline, so the paper stays
    //     opaque on top of the room.
    // Both present as "the room never appears", and both are intermittent
    // because they need an audio change to land inside a 0.8-1.2s window.
    //
    // Keeping the callbacks in refs pins the dependency array to `teleportPhase`
    // alone, so unrelated re-renders can no longer cancel a running teleport.
    const startTransitionRef = useRef(startTeleportTransition);
    const finishOpenRef = useRef(finishPaperOpen);
    const playRef = useRef(play);
    useEffect(() => {
        startTransitionRef.current = startTeleportTransition;
        finishOpenRef.current = finishPaperOpen;
        playRef.current = play;
    }, [startTeleportTransition, finishPaperOpen, play]);

    // Phase advancement is guarded so it can only happen once per phase, and is
    // additionally armed with a timeout: if a timeline is ever killed by
    // something we haven't anticipated, the machine still moves on instead of
    // wedging the whole room system.
    const advanceRef = useRef({ phase: null, done: false });
    const armRef = useRef(null);

    useEffect(() => {
        if (!leftHalfRef.current || !rightHalfRef.current || !containerRef.current) return;

        // Kill any existing timeline
        if (timelineRef.current) {
            timelineRef.current.kill();
        }
        if (armRef.current) clearTimeout(armRef.current);

        const phase = teleportPhase;
        advanceRef.current = { phase, done: false };

        // Run `fn` at most once for this phase, whether it arrives from gsap's
        // onComplete or from the safety timeout.
        const advanceOnce = (fn) => {
            if (advanceRef.current.phase !== phase || advanceRef.current.done) return;
            advanceRef.current.done = true;
            fn();
        };

        if (phase === 'closing') {
            // Show container
            gsap.set(containerRef.current, { opacity: 1, display: 'block' });

            // Start with halves apart (like at end of preloader)
            gsap.set(leftHalfRef.current, { xPercent: -100, rotation: -2 });
            gsap.set(rightHalfRef.current, { xPercent: 100, rotation: 2 });

            // Animate halves together
            timelineRef.current = gsap.timeline({
                onComplete: () => advanceOnce(() => startTransitionRef.current())
            });

            // Play paper sound
            playRef.current('tear', { volume: 0.6 });

            timelineRef.current.to(leftHalfRef.current, {
                xPercent: 0,
                rotation: 0,
                duration: 0.8,
                ease: "power2.inOut"
            }, 'close');

            timelineRef.current.to(rightHalfRef.current, {
                xPercent: 0,
                rotation: 0,
                duration: 0.8,
                ease: "power2.inOut"
            }, 'close');

            // Safety net: the close tween is 0.8s. If onComplete is lost, move on.
            armRef.current = setTimeout(() => advanceOnce(() => startTransitionRef.current()), 1200);
        }

        if (phase === 'teleporting') {
            // Paper is closed, TeleportRoom is loading the destination
            // TeleportRoom will call openTeleportTransition() when room is ready
            // No action needed here - just wait
        }

        if (!phase) {
            // Idle: no teleport in flight, so the paper must NOT be covering the
            // screen. Previously the only code that parked the halves at
            // `display: none` lived inside the 'opening' fade-out, so any path
            // that skipped 'opening' — a teleport aborted mid-flight, or the
            // state being reset by the SceneContext watchdog — left the sheet
            // fully opaque on top of the room forever. Parking it here makes
            // "nothing is happening" self-correcting.
            gsap.set(containerRef.current, { opacity: 0, display: 'none' });
        }

        if (phase === 'opening') {
            // Tear the paper apart
            timelineRef.current = gsap.timeline({
                onComplete: () => advanceOnce(() => finishOpenRef.current())
            });

            playRef.current('tear', { volume: 0.8 });

            timelineRef.current.to(leftHalfRef.current, {
                xPercent: -100,
                rotation: -2,
                duration: 1.2,
                ease: "power3.inOut"
            }, 'tear');

            timelineRef.current.to(rightHalfRef.current, {
                xPercent: 100,
                rotation: 2,
                duration: 1.2,
                ease: "power3.inOut"
            }, 'tear');

            // Fade out container at end
            timelineRef.current.to(containerRef.current, {
                opacity: 0,
                duration: 0.3,
                onComplete: () => {
                    gsap.set(containerRef.current, { display: 'none' });
                }
            }, '-=0.3');

            // Safety net: the tear is 1.2s and parks the paper at display:none.
            // If the timeline is lost, at least clear the phase and un-cover the
            // screen, or the room stays hidden behind an opaque sheet.
            armRef.current = setTimeout(() => {
                gsap.set(containerRef.current, { opacity: 0, display: 'none' });
                advanceOnce(() => finishOpenRef.current());
            }, 1600);
        }

        return () => {
            if (timelineRef.current) {
                timelineRef.current.kill();
            }
            if (armRef.current) clearTimeout(armRef.current);
        };
    }, [teleportPhase]);

    // Zostawiamy komponent cały czas w DOM (bez "return null"), 
    // żeby uniknąć laga pierwszego załadowania skomplikowanych ścieżek SVG.
    // if (!teleportPhase) return null;

    return (
        <div
            className="preloader"
            ref={containerRef}
            style={{ pointerEvents: 'none', display: 'none' }} // DOM starts hidden
        >
            {/* LEFT HALF */}
            <div
                className="preloader__half preloader__half--left"
                ref={leftHalfRef}
                style={{ clipPath: leftClipPoly }}
            >
                <TearLineSVG svgPathData={svgPathData} />
            </div>

            {/* RIGHT HALF */}
            <div
                className="preloader__half preloader__half--right"
                ref={rightHalfRef}
                style={{ clipPath: rightClipPoly }}
            >
                <TearLineSVG svgPathData={svgPathData} />
            </div>
        </div>
    );
};

export default PaperTransition;
