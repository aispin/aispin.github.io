/**
 * Analytics seam.
 *
 * The template shipped PostHog wired directly into components. That is a
 * third-party dependency and a privacy question we do not need, so tracking is
 * now a no-op by default. Drop a provider in here later (or set
 * VITE_ANALYTICS_ENDPOINT and forward to your own endpoint) without touching
 * call sites.
 */

const endpoint = import.meta.env?.VITE_ANALYTICS_ENDPOINT

export function track(event, payload) {
  if (!endpoint) return
  try {
    const body = JSON.stringify({ event, payload, at: new Date().toISOString() })
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, body)
    }
  } catch {
    // analytics must never break the experience
  }
}
