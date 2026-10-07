import { useEffect, useRef, useState } from 'react';
import { TOAST_EVENT } from '../../utils/toast';
import '../../styles/Toast.scss';

/**
 * Toast — the visual half of utils/toast.js.
 *
 * Renders the queue of messages dispatched as `aispin-toast` window events.
 *
 * Two behaviours worth knowing about:
 *
 * 1. REPEATS COLLAPSE. Spamming a blocked action (clicking the same map entry,
 *    double-tapping a door) would otherwise stack a column of identical toasts.
 *    If the incoming text matches the newest visible one, we refresh its timer
 *    instead of pushing another — so a frustrated user gets one steady toast,
 *    not a tower.
 *
 * 2. AT MOST `MAX_VISIBLE` ARE SHOWN. Anything beyond that drops the oldest,
 *    so a burst can never cover the scene.
 */

const MAX_VISIBLE = 3;

let nextId = 1;

const Toast = () => {
    const [toasts, setToasts] = useState([]);
    // Timers are kept outside state: they are bookkeeping, not render data.
    const timersRef = useRef(new Map());

    useEffect(() => {
        const timers = timersRef.current;

        const dismiss = (id) => {
            const timer = timers.get(id);
            if (timer) {
                clearTimeout(timer);
                timers.delete(id);
            }
            // Flip to the leaving state so CSS can animate it out, then unmount.
            setToasts((current) => current.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
            setTimeout(() => {
                setToasts((current) => current.filter((t) => t.id !== id));
            }, 320);
        };

        const arm = (id, duration) => {
            const existing = timers.get(id);
            if (existing) clearTimeout(existing);
            timers.set(id, setTimeout(() => dismiss(id), duration));
        };

        const onToast = (event) => {
            const { message, duration } = event.detail || {};
            if (!message) return;

            setToasts((current) => {
                const newest = current[current.length - 1];
                if (newest && newest.message === message && !newest.leaving) {
                    // Same text as the newest → just keep it alive longer.
                    arm(newest.id, duration);
                    return current;
                }
                const id = nextId++;
                arm(id, duration);
                return [...current, { id, message, duration, leaving: false }].slice(-MAX_VISIBLE);
            });
        };

        window.addEventListener(TOAST_EVENT, onToast);
        return () => {
            window.removeEventListener(TOAST_EVENT, onToast);
            timers.forEach((timer) => clearTimeout(timer));
            timers.clear();
        };
    }, []);

    // NOTE: the live region is rendered even when empty, on purpose. Assistive
    // tech only announces changes to a live region that already existed in the
    // DOM — if we returned `null` while idle, the very first toast would mount
    // its own container and never be read out.
    return (
        <div className="toast-stack" role="status" aria-live="polite">
            {toasts.map((toast) => (
                <div key={toast.id} className={`toast ${toast.leaving ? 'leaving' : ''}`}>
                    {toast.message}
                </div>
            ))}
        </div>
    );
};

export default Toast;
