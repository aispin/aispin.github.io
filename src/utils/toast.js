/**
 * showToast — minimal, framework-free toast dispatcher.
 *
 * Fire-and-forget by design:
 *
 *     showToast('正在传送中…')
 *
 * Why a CustomEvent instead of a context/hook: the callers that need to report
 * "nothing happened" are not all in the React render tree. `SceneContext`'s
 * teleport guards and R3F pointer handlers both want to say something, and
 * threading a context through them would mean re-rendering consumers on every
 * toast. A window event keeps the toast out of the render path entirely — the
 * same pattern the site already uses for `aispin-language-change` and
 * `sw-update-ready`.
 *
 * A single <Toast /> listens for `aispin-toast` and renders the queue.
 */

export const TOAST_EVENT = 'aispin-toast';

/**
 * @param {string} message  already-localised text; empty values are ignored
 * @param {{ duration?: number }} [options]  ms on screen, default 2600
 * @returns {boolean} whether the toast was dispatched
 */
export function showToast(message, { duration = 2600 } = {}) {
    if (typeof window === 'undefined') return false;
    if (typeof message !== 'string' || !message.trim()) return false;

    window.dispatchEvent(new CustomEvent(TOAST_EVENT, {
        detail: { message, duration },
    }));
    return true;
}
