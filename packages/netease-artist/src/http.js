/**
 * 极小的 HTTP 层：网易云那几个 `/api/*` 端点只认 Referer / UA，不要 cookie。
 *
 * 三件事必须做对，否则会拿到一个"看着像成功"的空结果：
 * 1. 带 `Referer: https://music.163.com/` —— 不带有时直接 403 / 返回空列表；
 * 2. `code !== 200` 也要当失败（网易云会用 200 + `{code: 4xx}` 表示"没有权限"）；
 * 3. 超时。构建脚本最怕挂住不动，15s 一刀切。
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET 一个 JSON，带超时与重试。
 * @param {string} url
 * @param {{ timeout?: number, retries?: number, headers?: Record<string,string> }} [opts]
 */
export async function getJson(url, opts = {}) {
  const { timeout = 15000, retries = 2, headers = {} } = opts;
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': UA,
          Referer: 'https://music.163.com/',
          Accept: 'application/json, text/plain, */*',
          ...headers,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
      const json = await res.json();
      /* 网易云失败时也回 200，靠 body 里的 code 区分 */
      if (json && typeof json.code === 'number' && json.code !== 200) {
        throw new Error(`API code ${json.code} — ${url}`);
      }
      return json;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(350 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/** 有限并发地跑一组任务，结果按输入顺序返回；单个失败记 null 不炸整批。 */
export async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        out[i] = await fn(items[i], i);
      } catch (err) {
        out[i] = null;
        if (typeof fn.onError === 'function') fn.onError(err, items[i], i);
      }
    }
  });
  await Promise.all(workers);
  return out;
}
