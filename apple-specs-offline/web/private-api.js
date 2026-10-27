/* apple-specs-site — 私有数据运行时访问层
 *
 * 公开仓不含 Apple 官方归档素材；正文、原始资源、检索索引全部留在私有仓
 * ooghoo/apple-specs。授权用户在此输入 fine-grained PAT，浏览器直连
 * GitHub API 拉取（GitHub API 允许跨域：access-control-allow-origin: *）。
 *
 * 令牌只存 localStorage，不上传任何服务器。
 */
(function (global) {
  "use strict";

  var REPO = "ooghoo/apple-specs";
  var DEFAULT_API = "https://api.github.com/repos/" + REPO;
  // API 根可被覆盖：URL 参数 ?api=... 优先，其次 localStorage（联调 / 自建镜像用）
  var API = (function () {
    try {
      var m = /[?&]api=([^&]+)/.exec(location.search);
      if (m) return decodeURIComponent(m[1]);
      var s = localStorage.getItem("aps_api");
      if (s) return s;
    } catch (e) {}
    return DEFAULT_API;
  })();

  var TOKEN_KEY = "aps_token";
  var CACHE_KEY = "aps_cache_v1";
  var CACHE_MAX = 60;          // 最多缓存 60 个文件
  var CACHE_MAX_BYTES = 24 * 1024 * 1024;

  // ---- Service Worker 同步 ----
  var swReg = null;
  function syncTokenToSW(t) {
    if (!("serviceWorker" in navigator)) return;
    try {
      if (!swReg) swReg = navigator.serviceWorker.getRegistration();
      swReg.then(function (reg) {
        if (!reg) return;
        var target = reg.active || reg.waiting || reg.installing;
        if (target) {
          target.postMessage(
            t
              ? { type: "set-token", token: t, api: API }
              : { type: "clear-token" }
          );
        }
      });
    } catch (e) { /* 忽略 */ }
  }

  // ---- token 存取 ----
  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function setToken(t) {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* 隐私模式忽略 */ }
    syncTokenToSW(t);
    return !!t;
  }
  function hasToken() { return !!getToken(); }

  // ---- 本地缓存（LRU，按累计字节上限）----
  var cache = null;
  function loadCache() {
    if (cache) return cache;
    try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); }
    catch (e) { cache = {}; }
    if (!cache || typeof cache !== "object") cache = {};
    return cache;
  }
  function saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); }
    catch (e) {
      /* 配额满则清缓存 */
      try { localStorage.removeItem(CACHE_KEY); cache = {}; } catch (e2) {}
    }
  }
  function cacheGet(key) {
    var c = loadCache();
    var e = c[key];
    if (!e) return null;
    delete c[key];           // LRU：命中后移到最新
    c[key] = e;
    saveCache();
    return e;
  }
  function cachePut(key, val) {
    var c = loadCache();
    c[key] = val;
    var bytes = 0, keys = Object.keys(c);
    keys.forEach(function (k) { bytes += (c[k] && c[k].s) || 0; });
    while (keys.length > CACHE_MAX || bytes > CACHE_MAX_BYTES) {
      var oldest = keys.shift();
      if (!oldest) break;
      bytes -= (c[oldest] && c[oldest].s) || 0;
      delete c[oldest];
    }
    saveCache();
  }
  function clearCache() {
    cache = {};
    try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
  }

  // ---- GitHub API ----
  function apiHeaders() {
    var h = { "Accept": "application/vnd.github+json" };
    var t = getToken();
    if (t) h["Authorization"] = "Bearer " + t;
    return h;
  }

  function b64ToUtf8(b64) {
    var bin = atob(b64.replace(/\n/g, ""));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }

  /**
   * 拉取私有仓中的一个文件。
   * @param {string} path 仓库内路径，如 "apple-specs-offline/archive/mac/111343/index.html"
   * @param {string} ref  分支，默认 gh-pages
   */
  function fetchFile(path, ref) {
    ref = ref || "gh-pages";
    var key = ref + ":" + path;
    var hit = cacheGet(key);
    if (hit) return Promise.resolve(hit.v);

    var url = API + "/contents/" + path.split("/").map(encodeURIComponent).join("/") +
      "?ref=" + encodeURIComponent(ref);
    return fetch(url, { headers: apiHeaders() })
      .then(function (r) {
        if (r.status === 404) {
          var e = new Error("NOT_FOUND"); e.status = 404; e.path = path; throw e;
        }
        if (r.status === 401 || r.status === 403) {
          var e2 = new Error("UNAUTHORIZED"); e2.status = r.status; throw e2;
        }
        if (!r.ok) {
          var e3 = new Error("HTTP " + r.status); e3.status = r.status; throw e3;
        }
        return r.json();
      })
      .then(function (j) {
        if (Array.isArray(j)) {
          var e4 = new Error("IS_DIRECTORY"); e4.status = 400; throw e4;
        }
        var out;
        if (j.encoding === "base64") {
          var raw = j.content || "";
          try {
            out = { text: b64ToUtf8(raw), size: j.size, path: path };
          } catch (err) {
            out = { base64: raw, size: j.size, path: path };
          }
        } else {
          out = { text: j.content || "", size: j.size, path: path };
        }
        cachePut(key, { v: out, s: out.size || 0 });
        return out;
      });
  }

  /** 拉取并返回文本内容 */
  function fetchText(path, ref) {
    return fetchFile(path, ref).then(function (o) {
      if (o.base64) throw new Error("BINARY");
      return o.text;
    });
  }

  /** 拉取二进制并返回 Blob（用于 PDF） */
  function fetchBlob(path, ref) {
    return fetchFile(path, ref).then(function (o) {
      if (o.base64) {
        var bin = atob(o.base64.replace(/\n/g, ""));
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: "application/pdf" });
      }
      return new Blob([o.text], { type: "text/plain;charset=utf-8" });
    });
  }

  /** 列出私有仓某目录下的条目 */
  function listDir(path, ref) {
    ref = ref || "gh-pages";
    var url = API + "/contents/" + path.split("/").map(encodeURIComponent).join("/") +
      "?ref=" + encodeURIComponent(ref);
    return fetch(url, { headers: apiHeaders() }).then(function (r) {
      if (!r.ok) { var e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
      return r.json();
    }).then(function (j) {
      return Array.isArray(j) ? j : [];
    });
  }

  /** 校验令牌是否可读私有仓 */
  function verify() {
    if (!hasToken()) return Promise.resolve({ ok: false, reason: "NO_TOKEN" });
    return fetch(API, { headers: apiHeaders() })
      .then(function (r) {
        if (r.status === 200) return { ok: true };
        if (r.status === 401) return { ok: false, reason: "BAD_TOKEN" };
        if (r.status === 404) return { ok: false, reason: "NO_ACCESS" };
        return { ok: false, reason: "HTTP_" + r.status };
      })
      .catch(function () { return { ok: false, reason: "NETWORK" }; });
  }

  global.PrivateAPI = {
    REPO: REPO,
    API: API,
    getToken: getToken,
    setToken: setToken,
    hasToken: hasToken,
    verify: verify,
    fetchText: fetchText,
    fetchBlob: fetchBlob,
    listDir: listDir,
    clearCache: clearCache,
  };
})(window);
