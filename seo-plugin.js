import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));

// Content is local JSON under src/data — no CMS, no network at build time.
const DATA_DIR = resolve(PLUGIN_DIR, 'src/data');

// 主站入口。多页构建后 /me 也是一条 entry，但它有自己的 title/description，
// 不该被这里注入的「八个房间」文案覆盖。
const MAIN_ENTRY = resolve(PLUGIN_DIR, 'index.html');

/**
 * 这个 HTML 是不是主站入口？
 *
 * dev 下 ctx.path 是 URL 形态（'/index.html'），build 下可能是不带前导斜杠
 * 的相对路径 —— 所以优先用绝对路径 ctx.filename 判断，取不到再退回 path。
 */
function isMainEntry(ctx) {
    if (ctx && ctx.filename) return resolve(ctx.filename) === MAIN_ENTRY;
    const p = (ctx && ctx.path) || '';
    return p === '/' || p === '/index.html' || p === 'index.html';
}

function readJson(name, fallback) {
    try {
        return JSON.parse(readFileSync(resolve(DATA_DIR, `${name}.json`), 'utf-8'));
    } catch {
        return fallback;
    }
}

function loadSeoData() {
    return {
        site: readJson('site', null),
        projects: readJson('projects', []),
        articles: readJson('articles', []),
        photography: readJson('photography', []),
        labs: readJson('labs', []),
        music: readJson('music', []),
        aiProjects: readJson('aiProjects', []),
    };
}

const SITE_URL = 'https://aispin.github.io';

function formatIsoDate(dateString) {
    if (!dateString) return undefined;
    if (dateString.includes('T')) return dateString;
    return `${dateString}T12:00:00Z`;
}

function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Build the schema.org @graph from local JSON data.
 * Person -> WebSite -> ProfilePage, plus ItemLists for projects / articles /
 * photography / AI skills, so AI search engines can cite the rooms' content.
 */
function buildJsonLd(site, projects, articles, photography, aiProjects) {
    const author = site?.author || {};
    const graph = [];

    graph.push({
        '@type': 'Person',
        '@id': `${SITE_URL}/#person`,
        name: author.name || 'AISPIN',
        alternateName: author.alternateName || ['aispin'],
        url: SITE_URL,
        jobTitle: author.jobTitle,
        description: site?.aboutMe,
        knowsAbout: site?.knowsAbout || [],
        sameAs: site?.sameAs || [],
    });

    graph.push({
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: SITE_URL,
        name: site?.siteTitle || 'AISPIN',
        description: site?.siteDescription,
        inLanguage: ['zh-CN', 'en-US'],
        publisher: { '@id': `${SITE_URL}/#person` },
    });

    graph.push({
        '@type': 'ProfilePage',
        '@id': `${SITE_URL}/#profilepage`,
        url: SITE_URL,
        mainEntity: { '@id': `${SITE_URL}/#person` },
        about: { '@id': `${SITE_URL}/#person` },
    });

    if (projects.length > 0) {
        graph.push({
            '@type': 'ItemList',
            '@id': `${SITE_URL}/#projects`,
            name: 'Projects & Labs',
            numberOfItems: projects.length,
            itemListElement: projects.map((p, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                item: {
                    '@type': 'CreativeWork',
                    name: p.title,
                    description: p.summary || p.description || '',
                    ...(p.url ? { url: p.url } : {}),
                    creator: { '@id': `${SITE_URL}/#person` },
                },
            })),
        });
    }

    if (articles.length > 0) {
        graph.push({
            '@type': 'ItemList',
            '@id': `${SITE_URL}/#articles`,
            name: 'Articles & Essays',
            numberOfItems: articles.length,
            itemListElement: articles.map((a, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                item: {
                    '@type': 'Article',
                    headline: a.title,
                    ...(a.date ? { datePublished: formatIsoDate(a.date) } : {}),
                    ...(a.summary ? { description: a.summary } : {}),
                    author: { '@id': `${SITE_URL}/#person` },
                },
            })),
        });
    }

    if (photography.length > 0) {
        graph.push({
            '@type': 'ImageGallery',
            '@id': `${SITE_URL}/#photography`,
            name: 'Photography',
            numberOfItems: photography.length,
            creator: { '@id': `${SITE_URL}/#person` },
        });
    }

    if (aiProjects.length > 0) {
        graph.push({
            '@type': 'ItemList',
            '@id': `${SITE_URL}/#ai-projects`,
            name: 'AI Skills & Apps',
            numberOfItems: aiProjects.length,
            itemListElement: aiProjects.map((p, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                item: {
                    '@type': 'SoftwareApplication',
                    name: p.name || p.title,
                    ...(p.description ? { description: p.description } : {}),
                    ...(p.url ? { url: p.url } : {}),
                    ...(p.html_url ? { url: p.html_url } : {}),
                    applicationCategory: 'DeveloperApplication',
                    author: { '@id': `${SITE_URL}/#person` },
                },
            })),
        });
    }

    return { '@context': 'https://schema.org', '@graph': graph };
}

function buildLlmsTxt(site, projects, articles, labs, music, aiProjects) {
    let content = `# ${site?.siteTitle || 'AISPIN'}\n`;
    content += `> ${site?.siteDescription || 'A walkable 3D personal site.'}\n\n`;

    content += `## About\n${site?.aboutMe || ''}\n\n`;

    if (site?.knowsAbout?.length) {
        content += `## Skills\n${site.knowsAbout.map((k) => `- ${k}`).join('\n')}\n\n`;
    }

    if (projects.length) {
        content += `## Projects\n`;
        projects.forEach((p) => {
            content += `- ${p.title}${p.url ? ` (${p.url})` : ''}: ${p.summary || p.description || ''}\n`;
        });
        content += '\n';
    }

    if (labs.length) {
        content += `## Labs\n`;
        labs.forEach((l) => {
            content += `- ${l.title}: ${l.summary || l.description || ''}\n`;
        });
        content += '\n';
    }

    if (articles.length) {
        content += `## Articles\n`;
        articles.forEach((a) => {
            content += `- ${a.title}${a.date ? ` (${a.date})` : ''}: ${a.summary || ''}\n`;
        });
        content += '\n';
    }

    if (music.length) {
        content += `## Music\n`;
        music.forEach((m) => {
            content += `- ${m.title}: ${m.summary || m.description || ''}\n`;
        });
        content += '\n';
    }

    if (aiProjects.length) {
        content += `## AI Skills & Apps\n`;
        aiProjects.forEach((p) => {
            content += `- ${p.name || p.title}${p.html_url ? ` (${p.html_url})` : ''}: ${p.description || ''}\n`;
        });
        content += '\n';
    }

    content += `## Links\n`;
    (site?.sameAs || []).forEach((u) => { content += `- ${u}\n`; });
    content += `- Novels: https://zeobooks.app.workbuddy.host\n`;

    return content;
}

export function generateSeoHtml() {
    let cachedLlmsContent = '';

    async function getLlmsContent() {
        if (!cachedLlmsContent) {
            try {
                const data = loadSeoData();
                cachedLlmsContent = buildLlmsTxt(
                    data.site, data.projects, data.articles,
                    data.labs, data.music, data.aiProjects
                );
            } catch (e) {
                console.error('SEO Plugin Error: Failed to build llms.txt', e);
                cachedLlmsContent = `# AISPIN\n> Walkable 3D personal site\n`;
            }
        }
        return cachedLlmsContent;
    }

    return {
        name: 'aispin-seo-plugin',

        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                if (req.url === '/llms.txt') {
                    const content = await getLlmsContent();
                    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                    res.end(content);
                } else {
                    next();
                }
            });
        },

        /**
         * ⚠️ transformIndexHtml 会对**每一个** HTML entry 跑，而这里注入的是
         * 主站（3D 房子）的 title / description / JSON-LD。多页构建之后，
         * /me 也是一条 entry —— 不拦一下，/me 的标题会被主站的覆盖掉，
         * 并且页面上会多出一段描述「八个房间」的结构化数据。
         *
         * ctx.path 是 URL 形态（如 '/index.html'、'/me/index.html'）。
         */
        async transformIndexHtml(html, ctx) {
            if (!isMainEntry(ctx)) return html;   // /me 自带完整 meta，原样放行
            try {
                const data = loadSeoData();
                const { site, projects, articles, photography, aiProjects } = data;

                const siteTitle = site?.siteTitle || 'AISPIN';
                const siteDescription = site?.siteDescription || 'A walkable 3D personal site.';

                cachedLlmsContent = buildLlmsTxt(
                    site, data.projects, data.articles,
                    data.labs, data.music, data.aiProjects
                );

                const jsonLdScript = `\n  <!-- Structured data generated from local JSON at build time -->\n  <script type="application/ld+json">\n${JSON.stringify(buildJsonLd(site, projects, articles, photography, aiProjects), null, 2)}\n  </script>\n`;

                let transformedHtml = html.replace(
                    /<title>(.*?)<\/title>/,
                    `<title>${escapeHtml(siteTitle)}</title>`
                );

                if (/<meta name="description" content="(.*?)"\s*\/?>/.test(transformedHtml)) {
                    transformedHtml = transformedHtml.replace(
                        /<meta name="description" content="(.*?)"\s*\/?>/,
                        `<meta name="description" content="${escapeHtml(siteDescription)}" />`
                    );
                } else {
                    transformedHtml = transformedHtml.replace(
                        '</head>',
                        `  <meta name="description" content="${escapeHtml(siteDescription)}" />\n</head>`
                    );
                }

                transformedHtml = transformedHtml.replace('</head>', `${jsonLdScript}</head>`);

                return transformedHtml;
            } catch (error) {
                console.error('SEO Plugin Error:', error);
                return html;
            }
        },

        async generateBundle() {
            const content = await getLlmsContent();
            this.emitFile({
                type: 'asset',
                fileName: 'llms.txt',
                source: content,
            });
        },
    };
}
