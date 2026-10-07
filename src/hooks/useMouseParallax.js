import { useRef, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { reducedMotion } from './useReducedMotion';

/**
 * useMouseParallax Hook
 * 
 * Camera follows mouse movement - creates "looking around the room" effect.
 * Mouse right = camera right, Mouse up = camera up.
 *
 * ⚠️ prefers-reduced-motion: 这个效果整体关掉。
 * 让整个视野跟着鼠标持续平移是前庭反应最强的几类动画之一 —— 对晕动症
 * 用户来说，这比场景里任何一处"飘动"都更难受。而且它不承载任何信息：
 * 用户不动鼠标时相机自己也在缓动回位。所以这里不是"减小幅度"，是直接
 * 让相机停在基准位（连 mousemove 监听都不挂）。
 */
const useMouseParallax = ({
    intensity = 0.5,
    smoothing = 0.05
} = {}) => {
    const { camera } = useThree();
    const mouse = useRef({ x: 0, y: 0 });
    const target = useRef({ x: 0, y: 0 });
    const basePosition = useRef({ x: 0, y: 0.2 }); // Store initial camera X, Y

    useEffect(() => {
        basePosition.current = { x: camera.position.x, y: camera.position.y };

        if (reducedMotion()) {
            // 相机钉在基准位，不订阅鼠标
            camera.position.x = basePosition.current.x;
            camera.position.y = basePosition.current.y;
            return;
        }

        const handleMouseMove = (e) => {
            // Normalize mouse position to -1 to 1
            mouse.current.x = (e.clientX / window.innerWidth) * 2 - 1;
            mouse.current.y = -((e.clientY / window.innerHeight) * 2 - 1); // Invert Y
        };

        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, [camera]);

    useFrame(() => {
        if (reducedMotion()) return;

        // Smooth interpolation toward mouse position
        target.current.x = THREE.MathUtils.lerp(
            target.current.x,
            mouse.current.x * intensity,
            smoothing
        );
        target.current.y = THREE.MathUtils.lerp(
            target.current.y,
            mouse.current.y * intensity * 0.6, // Less vertical movement
            smoothing
        );

        // Apply to camera position
        camera.position.x = basePosition.current.x + target.current.x;
        camera.position.y = basePosition.current.y + target.current.y;

        // Camera looks slightly toward center (creates natural feel)
        camera.lookAt(0, 0, 0);
    });

    return { mouse: mouse.current, target: target.current };
};

export default useMouseParallax;
