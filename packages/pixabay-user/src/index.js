export { launch, findChrome, UA } from './browser.js'
export { scrapeUser } from './scrape.js'

import { launch } from './browser.js'
import { scrapeUser } from './scrape.js'

/**
 * 一步到位：起浏览器 → 抓 → 关浏览器。
 *
 * @example
 * const data = await buildUser({ user: 'aispin-40699950', latest: 12 })
 */
export async function buildUser(opts = {}) {
  const { log = () => {}, chrome, headless = true, ...rest } = opts
  const { page, close } = await launch({ chrome, headless })
  try {
    return await scrapeUser(page, { ...rest, log })
  } finally {
    await close()
  }
}