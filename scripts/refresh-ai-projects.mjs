import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, 'src/data/aiProjects.json')
const owner = 'aispin'
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'aispin-portfolio-refresh',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
}

async function request(url) {
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${url}`)
  return response.json()
}

const allRepos = await request(`https://api.github.com/users/${owner}/repos?per_page=100&type=owner&sort=updated`)
const candidates = allRepos.filter((repo) =>
  repo.visibility === 'public'
  && !repo.archived
  && !repo.fork
  && (repo.name.startsWith('iskill-') || repo.name.startsWith('ai-')),
)

const hasPages = await Promise.all(candidates.map(async (repo) => {
  try {
    const branches = await request(`https://api.github.com/repos/${owner}/${repo.name}/branches?per_page=100`)
    return branches.some((branch) => branch.name === 'gh-pages') ? repo : null
  } catch (error) {
    console.warn(`Skipping ${repo.name}: ${error.message}`)
    return null
  }
}))

const items = hasPages.filter(Boolean).map((repo) => ({
  id: repo.name,
  title: repo.name,
  name: repo.name,
  description: repo.description || 'AI skill or application project by AISPIN.',
  repository: repo.html_url,
  url: repo.html_url,
  demoUrl: `https://${owner}.github.io/${repo.name}/`,
  stars: repo.stargazers_count,
  topics: repo.topics || [],
  updatedAt: repo.updated_at,
  language: repo.language,
  defaultBranch: repo.default_branch,
  category: repo.name.startsWith('iskill-') ? 'skill' : 'application',
})).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(items, null, 2)}\n`, 'utf8')
console.log(`Wrote ${items.length} public AI projects with gh-pages to ${output}`)
for (const item of items) console.log(`- ${item.name}: ${item.demoUrl}`)
