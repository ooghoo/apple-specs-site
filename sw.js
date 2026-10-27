/* apple-specs-site — Service Worker：私有归档资源的同源代理
 *
 * 公开仓只放站点壳（落地页 / 时间线 / 离线站导航与元数据 / 文档缩略图）；
 * Apple 官方归档素材（archive/、assets/ 中的 CSS/字体/图片、mirror/）与正文
 * 检索索引留在私有仓 ooghoo/apple-specs。授权用户在本机输入 token 后，
 * 由本 SW 拦截这些路径的同源请求，转为向私有仓 API 拉取并**永久缓存**。
 *
 * 为什么必须用 SW：iframe / 子资源请求无法携带 Authorization 头，
 * 只有在同源拦截层补上请求头，归档页的 CSS/字体/图片才能完整还原。
 */

const DEFAULT_API = "https://api.github.com/repos/ooghoo/apple-specs";
const CACHE_NAME = "aps-private-v2";

// 站点根（项目站形如 /apple-specs-site/）
const SITE_ROOT = self.location.pathname.replace(/\/sw\.js$/, "");

// 需要代理到私有仓的路径前缀（相对站点根）
const PROXY_PREFIXES = [
  "apple-specs-offline/archive/",
  "apple-specs-offline/assets/",
  "apple-specs-offline/mirror/",
  "apple-specs-offline/resolve-doc/",
  "apple-specs-offline/wss/",
  "apple-specs-offline/us/",
  "apple-specs-offline/search-services/",
  "apple-specs-offline/api-www/",
  "apple-specs-offline/ols/",
  "apple-specs-offline/data/search-index.json",
  "apple-specs-offline/data/zh-cn-map.json",
  "apple-specs-offline/data/discovered-documents.json",
];

// API 根可由页面经 postMessage 覆盖（联调 / 自建镜像）；默认 GitHub 官方
let API = DEFAULT_API;
// 页面同步过来的令牌
let cachedToken = "";

self.addEventListener("install", (e) => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k.startsWith("aps-private-"))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type === "set-token") {
    cachedToken = d.token || "";
    if (d.api) API = d.api;
    e.source && e.source.postMessage({ type: "token-ack" });
  } else if (d.type === "clear-token") {
    cachedToken = "";
    e.source && e.source.postMessage({ type: "token-ack" });
  } else if (d.type === "ping") {
    e.source && e.source.postMessage({ type: "pong", hasToken: !!cachedToken });
  } else if (d.type === "cache-stats") {
    caches.open(CACHE_NAME).then((c) => c.keys()).then((keys) => {
      e.source && e.source.postMessage({ type: "cache-stats-result", count: keys.length });
    });
  } else if (d.type === "clear-cache") {
    caches.delete(CACHE_NAME).then(() => {
      e.source && e.source.postMessage({ type: "cache-cleared" });
    });
  }
});

function shouldProxy(pathname) {
  if (!pathname.startsWith(SITE_ROOT + "/")) return false;
  const rel = pathname.slice(SITE_ROOT.length + 1);
  return PROXY_PREFIXES.some((p) => rel.startsWith(p));
}

function apiPathFor(pathname) {
  return pathname.slice(SITE_ROOT.length + 1);
}

async function fetchFromPrivate(pathname) {
  const url =
    API + "/contents/" + apiPathFor(pathname).split("/").map(encodeURIComponent).join("/") +
    "?ref=gh-pages";
  const headers = { Accept: "application/vnd.github+json" };
  if (cachedToken) headers.Authorization = "Bearer " + cachedToken;

  const res = await fetch(url, { headers });
  if (res.status === 404) return new Response("Not found in private repo", { status: 404 });
  if (res.status === 401 || res.status === 403) {
    return new Response("Unauthorized: token missing or invalid", { status: 401 });
  }
  if (!res.ok) return new Response("Upstream error " + res.status, { status: 502 });

  const j = await res.json();
  if (Array.isArray(j)) return new Response("Unexpected directory listing", { status: 400 });

  const raw = (j.content || "").replace(/\n/g, "");
  const bin = atob(raw);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": j.content_type || "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}

/** 拉取单个资源并写入永久缓存 */
async function loadAndCache(cache, path) {
  const req = new Request(SITE_ROOT + "/" + path);
  const hit = await cache.match(req);
  if (hit) return { path, cached: true };
  // 公开仓已有的文件（如缩略图）优先走静态站（不消耗私有仓 API 配额）
  try {
    const direct = await fetch(req);
    if (direct && direct.ok) {
      await cache.put(req, direct.clone());
      return { path, cached: false, local: true };
    }
  } catch (e) { /* 回落到私有仓 */ }
  const resp = await fetchFromPrivate(SITE_ROOT + "/" + path);
  if (resp && resp.ok) {
    await cache.put(req, resp.clone());
    return { path, cached: false };
  }
  return { path, cached: false, error: resp ? resp.status : 0 };
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!shouldProxy(url.pathname)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(req);
      if (hit) return hit;              // 永久缓存命中：直接返回，零 API 调用
      // 公开仓已存在的文件（如缩略图）优先用静态站的，不消耗私有仓 API 配额
      try {
        const direct = await fetch(req);
        if (direct && direct.ok) {
          await cache.put(req, direct.clone());
          return direct;
        }
      } catch (e) { /* 回落到私有仓 */ }
      try {
        const resp = await fetchFromPrivate(url.pathname);
        if (resp && resp.ok) await cache.put(req, resp.clone());
        return resp;
      } catch (err) {
        return new Response("Network error while reaching private repo", { status: 504 });
      }
    })()
  );
});
