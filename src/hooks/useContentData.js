import { useTexture } from '@react-three/drei'
import { useLoader } from '@react-three/fiber'
import { TextureLoader } from 'three'
import { useSitePreferences } from '../context/SitePreferences'

/**
 * useContentData — local content source for the 3D rooms.
 *
 * Replaces the original Sanity CMS layer. All content now ships as JSON under
 * src/data and is bundled at build time, so there is no network dependency and
 * nothing to configure. Each consumer keeps its old hook name so the room
 * components can be migrated one at a time.
 *
 * When a collection is missing or empty the hooks return null, which lets the
 * room fall back to its built-in sample content.
 */

const modules = import.meta.glob('../data/*.json', { eager: true })

const store = {}
for (const [path, mod] of Object.entries(modules)) {
  const key = path.split('/').pop().replace(/\.json$/, '')
  store[key] = mod.default ?? mod
}

export const contentStore = store

export function getLocalizedCollection(key, locale = 'zh') {
  const rows = Array.isArray(store[key]) ? store[key] : []
  if (key === 'music' || key === 'photography' || key === 'aiProjects' || key === 'videos') return rows
  const localized = rows.filter(item => item.locale === locale)
  return localized.length ? localized : rows.filter(item => item.locale === 'zh')
}

export function getSiteData() {
  return store.profile ?? store.site ?? {}
}

const supportsHover = typeof window !== 'undefined'
  && window.matchMedia('(hover: hover)').matches

const preloadBrowserImage = (path) => {
  if (typeof window === 'undefined' || !path) return
  const img = new Image()
  img.src = path
}

function isFilled(value) {
  return Array.isArray(value) ? value.length > 0 : Boolean(value)
}

// Gallery / photography cards: { id, title, description, url, front, painted }
const projects = isFilled(store.photography) ? store.photography : null

// Studio monitors: { id, platform, title, description, url, frontTexture, paintedFrontTexture }
const content = isFilled(store.studioContent)
  ? store.studioContent.map((item, index) => ({
      id: item.id ?? `${item.platform ?? 'item'}-${index}`,
      ...item,
    }))
  : null

// About room certificates / milestones.
// Stored flat (matches the SEO output), grouped here for the sky manager.
const AWARD_GROUPS = {
  sotd: { id: 'award-sotd', layout: 'certificate_grid', title: 'Site of the Day Awards', platformConfig: { label: 'ACHIEVEMENT', color: '#1a1a1a', icon: '🏆' } },
  sotm: { id: 'award-sotm', layout: 'certificate_grid', title: 'Site of the Month Awards', platformConfig: { label: 'AWARD', color: '#1a1a1a', icon: '📅' } },
  other: { id: 'award-other', layout: 'certificate_grid', title: 'Other Awards', platformConfig: { label: 'PRESTIGE', color: '#1a1a1a', icon: '👑' } },
}

const awards = isFilled(store.awards)
  ? Object.fromEntries(Object.entries(AWARD_GROUPS).map(([key, group]) => [
      key,
      {
        ...group,
        items: store.awards
          .filter(a => (a.category || 'other') === key)
          .map(a => ({
            label: a.title,
            date: a.date
              ? new Date(a.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
              : '',
            image: a.certificateImage ?? a.image ?? null,
            url: a.url || null,
          })),
      },
    ]))
  : null

let preloaded = false

function preload() {
  if (preloaded) return
  preloaded = true

  projects?.forEach((p) => {
    // Procedural cards are drawn on a canvas at runtime — nothing to fetch.
    if (p.placeholder) return
    if (p.front) {
      useTexture.preload(p.front)
      preloadBrowserImage(p.front)
    }
    if (p.painted && supportsHover) {
      useTexture.preload(p.painted)
      preloadBrowserImage(p.painted)
    }
  })

  content?.forEach((c) => {
    if (c.frontTexture) {
      useLoader.preload(TextureLoader, c.frontTexture)
      preloadBrowserImage(c.frontTexture)
    }
    if (c.paintedFrontTexture && supportsHover) {
      useLoader.preload(TextureLoader, c.paintedFrontTexture)
      preloadBrowserImage(c.paintedFrontTexture)
    }
  })

  if (awards) {
    Object.values(awards).forEach((group) => {
      group?.items?.forEach((item) => preloadBrowserImage(item.image))
    })
  }
}

export function loadContentData() {
  preload()
  return Promise.resolve({ projects, content, awards, loaded: true })
}

export function isContentDataLoaded() {
  return true
}

export function useGalleryProjects() {
  const { language } = useSitePreferences()
  return projects?.map((item) => ({
    ...item,
    title: typeof item.title === 'object' ? item.title[language] : item.title,
    description: typeof item.description === 'object' ? item.description[language] : item.description,
  })) ?? null
}

export function useStudioContent() {
  return content
}

export function useAwards() {
  return awards
}

loadContentData()
