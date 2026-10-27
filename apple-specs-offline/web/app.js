/* Apple Specs Offline — hub logic */
(function () {
  "use strict";

  var BASE = (function () {
    var p = location.pathname, i = p.lastIndexOf("/web/");
    return i >= 0 ? p.slice(0, i) : "";
  })();

  var state = {
    docs: [],
    categories: [],          // official tree with live counts
    category: "all",         // "all" | category id
    subcategory: null,       // subcategory id (null = whole category)
    view: "docs",            // "docs" | "recent"
    query: "",
    searchMode: false,
    searchResults: [],
    searchCat: "all",
    lang: "zh",              // 文档语言：zh（默认；无中文版回退英文） | en
    modalLang: "zh",         // 弹窗内文档语言：独立于站点全局语言，打开文档时重置
    currentDoc: null,        // 弹窗当前文档
  };

  var $ = function (id) { return document.getElementById(id); };
  var grid = $("doc-grid"), empty = $("empty"), pageTitle = $("page-title"),
      resultCount = $("result-count"), searchInput = $("search"),
      clearBtn = $("search-clear"), catNav = $("category-nav"),
      mainNav = $("main-nav"), tabsEl = $("tabs"),
      searchCatFilters = $("search-cat-filters"),
      statPill = $("stat-pill"), failedBadge = $("failed-badge"),
      recentTrash = $("recent-trash");
  var modal = $("doc-modal"), modalUrl = $("doc-modal-url"),
      modalOpen = $("doc-modal-open"),
      modalClose = $("doc-modal-close"), modalFrame = $("doc-modal-frame"),
      langSwitch = $("lang-switch"), modalLang = $("doc-modal-lang"),
      toastEl = $("lang-toast");
  var authPill = $("auth-pill"), authMask = $("auth-mask"),
      authToken = $("auth-token"), authError = $("auth-error"),
      authSave = $("auth-save"), authCancel = $("auth-cancel");

  var CAT_LABELS = {
    mac: "Mac", ipad: "iPad", iphone: "iPhone", watch: "Watch", vision: "Vision",
    airpods: "AirPods", "apple-tv": "Apple TV", homepod: "HomePod", ipod: "iPod",
    displays: "Displays", accessories: "Accessories", software: "Software", other: "其他",
  };
  var TAB_LABELS = {};   // tab id -> official label

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function catLabel(id) { return CAT_LABELS[id] || id; }

  function statusBadge(doc) {
    var v = doc.validation_status, c = doc.capture_status;
    var time = captureTime(doc);
    var tip = time ? '<span class="badge-tip">更新于 ' + esc(time) + "</span>" : "";
    if (v === "passed" || v === "passed-with-notes")
      return '<span class="badge ok" tabindex="0" title="">已验证' + tip + "</span>";
    if (c === "captured")
      return '<span class="badge warn" tabindex="0">已归档' + tip + "</span>";
    if (c === "failed")
      return '<span class="badge err" tabindex="0">抓取失败' + tip + "</span>";
    return '<span class="badge">' + esc(c || "未知") + "</span>";
  }

  function captureTime(doc) {
    if (!doc.captured_at) return "";
    var d = new Date(doc.captured_at);
    return isNaN(d) ? doc.captured_at : d.toLocaleString("zh-CN", { hour12: false });
  }

  // ---------- 文档语言（中文优先；无中文版的文档回退英文并提示） ----------
  function loadLang() {
    try {
      var v = localStorage.getItem("aso-lang");
      return v === "en" || v === "zh" ? v : "zh";
    } catch (e) { return "zh"; }
  }
  function saveLang(v) {
    try { localStorage.setItem("aso-lang", v); } catch (e) {}
  }
  state.lang = loadLang();

  // 指定语言下应打开的页面：该语言为中文且文档有中文版 -> zh-cn/index.html
  function pageUrlFor(doc, lang) {
    var url = localUrl(doc.local_path);
    if (lang === "zh" && doc.zh_cn) {
      return url.replace(/index\.html$/, "zh-cn/index.html");
    }
    return url;
  }
  // 站点全局语言下的页面（卡片、顶栏逻辑用）
  function docPageUrl(doc) { return pageUrlFor(doc, state.lang); }

  function renderLangSwitch() {
    // 顶栏跟随全局语言；弹窗跟随弹窗内的独立语言（两者互不影响）
    if (langSwitch) {
      langSwitch.querySelectorAll("button[data-lang]").forEach(function (btn) {
        btn.classList.toggle("active",
          btn.getAttribute("data-lang") === state.lang);
      });
    }
    if (modalLang) {
      modalLang.querySelectorAll("button[data-lang]").forEach(function (btn) {
        btn.classList.toggle("active",
          btn.getAttribute("data-lang") === state.modalLang);
      });
    }
  }

  function setLang(v) {
    if (v !== "en" && v !== "zh" || v === state.lang) return;
    state.lang = v;
    saveLang(v);
    renderLangSwitch();
    render();
    // 只影响站点（卡片/搜索结果）；弹窗打开时弹窗内语言保持独立，不跟着切
  }

  // 弹窗内语言切换：只重载弹窗 iframe，不写入全局语言、不重渲染站点
  function setModalLang(v) {
    if (v !== "en" && v !== "zh" || v === state.modalLang) return;
    state.modalLang = v;
    renderLangSwitch();
    if (!modal.hidden && state.currentDoc) {
      var url = pageUrlFor(state.currentDoc, v);
      modalUrl.textContent = url;
      modalOpen.href = url;
      modalFrame.src = url;
    }
  }

  var toastTimer = null;
  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.hidden = false;
    void toastEl.offsetWidth;   // reflow: replay the transition on every show
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
      setTimeout(function () { toastEl.hidden = true; }, 200);
    }, 2600);
  }

  function shortUrl(url) {
    return String(url || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  }

  function thumbHtml(doc) {
    if (doc.thumbnail) {
      return '<img class="thumb" src="' + BASE + '/' + esc(doc.thumbnail) + '" alt="" loading="lazy">';
    }
    return '<span class="thumb-placeholder">&#63743;</span>';
  }

  function docCard(doc, snip) {
    // card label: the most specific tab that belongs to the doc's OWN category
    var tabLabel = "";
    (doc.tabs || []).forEach(function (t) {
      if (t.split("_")[1] === doc.category && TAB_LABELS[t]) tabLabel = TAB_LABELS[t];
    });
    // 中文模式优先显示中文标题，另一语言标题作为副标题；英文模式反之
    var zhAvail = !!doc.zh_cn;
    var showZh = state.lang === "zh" && zhAvail && doc.zh_title;
    var mainTitle = showZh ? doc.zh_title : (doc.title || "");
    var altTitle = showZh ? (doc.title || "")
      : (zhAvail && doc.zh_title ? doc.zh_title : "");
    return (
      '<div class="doc-card" role="button" tabindex="0" data-doc="' + esc(doc.doc_id || "") + '">' +
      '<span class="card-top">' +
      '<span class="cat-wrap"><span class="cat">' + esc(catLabel(doc.category)) + (tabLabel ? " · " + esc(tabLabel) : "") + "</span>" +
      (zhAvail ? '<span class="zh-flag" title="已收录中文版本">中</span>' : "") + "</span>" +
      statusBadge(doc) + "</span>" +
      '<span class="card-main">' +
      thumbHtml(doc) +
      '<span class="card-info">' +
      '<h3 class="card-title">' + esc(mainTitle) + "</h3>" +
      (altTitle ? '<span class="card-line card-title-alt">' + esc(altTitle) + "</span>" : "") +
      '<span class="card-line card-url">' + esc(shortUrl(doc.original_url)) + "</span>" +
      (snip ? '<span class="card-line card-snip">' + snip + "</span>" : "") +
      "</span>" +
      "</span>" +
      "</div>"
    );
  }

  // ---------- filtering ----------
  function visibleDocs() {
    if (state.searchMode) {
      var byId = {};
      state.docs.forEach(function (d) { byId[d.doc_id] = d; });
      var list = state.searchResults.map(function (r) { return byId[r.doc_id] || r; });
      if (state.searchCat !== "all") {
        list = list.filter(function (d) { return d.category === state.searchCat; });
      }
      return list;
    }
    if (state.view === "recent") {
      var byPath = {};
      state.docs.forEach(function (d) {
        if (d.local_path) byPath[d.local_path] = d;
      });
      return readRecent().map(function (r) { return byPath[r.path]; })
        .filter(function (d) { return d; });
    }
    return state.docs.filter(function (d) {
      if (state.category !== "all" && d.category !== state.category) return false;
      if (state.subcategory &&
          !(d.tabs || []).some(function (t) { return t === state.subcategory; }))
        return false;
      return true;
    });
  }

  function render() {
    var list = visibleDocs();
    grid.innerHTML = list.map(function (d) { return docCard(d); }).join("");
    empty.hidden = list.length > 0;
    if (!list.length) {
      if (state.view === "recent" && !state.searchMode) {
        empty.innerHTML = "<p>暂无浏览记录——点击任意文档卡片即可开始浏览。</p>";
      } else {
        empty.innerHTML = "<p>没有匹配的文档。</p>";
      }
    }
    // the big title always mirrors the sidebar selection (never the tab):
    // its article count is the sidebar's total and does NOT change when
    // switching subcategory tabs (each tab carries its own count already)
    if (state.searchMode) {
      pageTitle.textContent = "搜索结果";
      resultCount.textContent = list.length + " 篇";
    } else if (state.view === "recent") {
      pageTitle.textContent = "最近浏览";
      resultCount.textContent = list.length + " 篇";
    } else if (state.category === "all") {
      pageTitle.textContent = "全部文档";
      resultCount.textContent = state.docs.length + " 篇";
    } else {
      pageTitle.textContent = catLabel(state.category);
      var cat = state.categories.filter(function (c) { return c.id === state.category; })[0];
      resultCount.textContent = (cat ? cat.count : list.length) + " 篇";
    }
  }

  // ---------- sidebar ----------
  function renderMainNav() {
    var html = '<button class="cat-item' +
      (state.view === "docs" && state.category === "all" && !state.subcategory ? " active" : "") +
      '" data-cat="all"><span class="label">全部</span><span class="n">' +
      state.docs.length + "</span></button>";
    html += '<button class="cat-item' + (state.view === "recent" ? " active" : "") +
      '" data-view="recent"><span class="label">最近浏览</span></button>';
    mainNav.innerHTML = html;
    updateTrashBtn();
  }

  // trash icon next to the page title — only on the 最近浏览 page with records
  function updateTrashBtn() {
    if (!recentTrash) return;
    recentTrash.hidden = !(state.view === "recent" && !state.searchMode && readRecent().length);
  }

  function renderCategories() {
    var html = "";
    state.categories.forEach(function (c) {
      // keep the category highlighted while one of its subcategory tabs is active
      var active = state.view === "docs" && state.category === c.id;
      html += '<button class="cat-item' + (active ? " active" : "") +
        '" data-cat="' + esc(c.id) + '"><span class="label">' + esc(c.label) +
        '</span><span class="n">' + c.count + "</span></button>";
    });
    catNav.innerHTML = html;
  }

  // ---------- official subcategory tabs (content area) ----------
  function renderTabs() {
    var html = "";
    if (state.view === "docs" && state.category !== "all" && !state.searchMode) {
      var cat = state.categories.filter(function (c) { return c.id === state.category; })[0];
      if (cat && cat.tabs && cat.tabs.length) {
        // categories whose official page has no "whole category" tab
        // (e.g. Software) get a synthetic leading tab showing the full set
        if (!cat.first_tab) {
          html += '<button class="tab' +
            (!state.subcategory ? " active" : "") +
            '" data-tab="cat-all">' + esc(cat.label) +
            '<span class="n">' + cat.count + "</span></button>";
        }
        cat.tabs.forEach(function (t) {
          TAB_LABELS[t.id] = t.label;
          var isFirst = cat.first_tab ? t.id === cat.first_tab : false;
          // hide tabs with nothing archived (the category's first tab stays)
          if (!isFirst && !t.count) return;
          html += '<button class="tab' +
            (state.subcategory === t.id ? " active" : "") +
            '" data-tab="' + esc(t.id) + '">' + esc(t.label) +
            '<span class="n">' + t.count + "</span></button>";
        });
      }
    }
    // a single tab is not a tab switcher — hide the row (like Vision)
    var tabCount = html ? html.split('<button class="tab').length - 1 : 0;
    tabsEl.innerHTML = html;
    tabsEl.hidden = !html || tabCount <= 1;
  }

  function renderSearchCatFilters() {
    if (!state.searchMode) { searchCatFilters.hidden = true; searchCatFilters.innerHTML = ""; return; }
    var byId = {};
    state.docs.forEach(function (d) { byId[d.doc_id] = d; });
    var counts = {};
    state.searchResults.forEach(function (r) {
      var d = byId[r.doc_id] || r;
      counts[d.category] = (counts[d.category] || 0) + 1;
    });
    var cats = Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a] || catLabel(a).localeCompare(catLabel(b));
    });
    if (cats.length < 2) { searchCatFilters.hidden = true; return; }
    var html = '<button class="chip' + (state.searchCat === "all" ? " active" : "") +
      '" data-scat="all">全部<span class="n">' + state.searchResults.length + "</span></button>";
    cats.forEach(function (c) {
      html += '<button class="chip' + (state.searchCat === c ? " active" : "") +
        '" data-scat="' + esc(c) + '">' + esc(catLabel(c)) +
        '<span class="n">' + counts[c] + "</span></button>";
    });
    searchCatFilters.innerHTML = html;
    searchCatFilters.hidden = false;
  }


  // ---- static search (replaces the server's SQLite FTS5 endpoint) ----
  var _searchIdx = null;
  function loadSearchIndex() {
    if (!_searchIdx) {
      // 检索索引含 Apple 正文全文，保存在私有仓；需授权后经 SW 同源拉取
      if (!PrivateAPI.hasToken()) return Promise.reject(new Error("NO_TOKEN"));
      var p = fetch(BASE + "/data/search-index.json").then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      });
      _searchIdx = p.catch(function (e) { _searchIdx = null; throw e; });
    }
    return _searchIdx;
  }
  function esc2(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function markSnippet(text, q) {
    var t = String(text || ""), l = t.toLowerCase(), k = q.toLowerCase();
    var i = l.indexOf(k);
    if (i < 0) return esc2(t.slice(0, 120));
    var from = Math.max(0, i - 40), to = Math.min(t.length, i + k.length + 60);
    return (from > 0 ? "…" : "") + esc2(t.slice(from, i)) +
           "<mark>" + esc2(t.slice(i, i + k.length)) + "</mark>" +
           esc2(t.slice(i + k.length, to)) + (to < t.length ? "…" : "");
  }
  function staticSearch(q) {
    return loadSearchIndex().then(function (idx) {
      var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      var hits = [];
      if (!terms.length) return { query: q, results: [] };
      for (var i = 0; i < idx.length; i++) {
        var it = idx[i];
        var hay = (it.t + " " + it.pn + " " + it.z + " " + it.b).toLowerCase();
        var ok = true;
        for (var j = 0; j < terms.length; j++) {
          if (hay.indexOf(terms[j]) < 0) { ok = false; break; }
        }
        if (!ok) continue;
        var ql = q.toLowerCase();
        var tl = (it.t || "").toLowerCase(), pl = (it.pn || "").toLowerCase();
        var score = 3;
        if (tl.indexOf(ql) === 0 || pl.indexOf(ql) === 0) score = 0;
        else if (tl.indexOf(ql) >= 0 || pl.indexOf(ql) >= 0) score = 1;
        else if ((it.z || "").toLowerCase().indexOf(ql) >= 0) score = 2;
        hits.push({ s: score, it: it });
      }
      hits.sort(function (a, b) {
        return a.s - b.s || (a.it.t || "").length - (b.it.t || "").length;
      });
      return {
        query: q,
        results: hits.slice(0, 50).map(function (h) {
          var it = h.it;
          return {
            doc_id: it.id, title: it.t, local_path: it.lp, category: it.c,
            capture_status: it.cs, validation_status: it.vs,
            snip: markSnippet(it.t.indexOf(q) >= 0 ? it.t : (it.pn || it.t), q)
          };
        })
      };
    });
  }

  // ---------- stats ----------
  function renderStats() {
    fetch(BASE + "/data/stats.json").then(function (r) { return r.json(); }).then(function (s) {
      var byCap = s.by_capture || {}, byVal = s.by_validation || {};
      var validated = 0;
      Object.keys(byVal).forEach(function (k) {
        if (k.indexOf("passed") === 0) validated += byVal[k];
      });
      var failed = byCap.failed || 0;
      statPill.innerHTML = "<b>" + validated + "</b> 篇" +
        '<span class="tip">' +
        '<span class="tip-row"><span>已发现文档</span><span>' + s.total + "</span></span>" +
        '<span class="tip-row"><span>已归档</span><span>' + (byCap.captured || 0) + "</span></span>" +
        (s.zh_cn ? '<span class="tip-row"><span>其中中文版</span><span>' + s.zh_cn + "</span></span>" : "") +
        '<span class="tip-row"><span>离线验证通过</span><span>' + validated + "</span></span>" +
        (failed ? '<span class="tip-row bad"><span>抓取失败</span><span>' + failed + "</span></span>" : "") +
        "</span>";
      if (failed) {
        failedBadge.hidden = false;
        failedBadge.textContent = "⚠ " + failed + " 篇抓取失败";
        failedBadge.title = failed + " 篇文档抓取失败，可运行 python3 src/cli.py retry-failed 重试";
      } else {
        failedBadge.hidden = true;
      }
    }).catch(function () {});
  }

  // ---------- recent ----------
  function readRecent() {
    try { return JSON.parse(localStorage.getItem("aso-recent") || "[]"); } catch (e) { return []; }
  }
  function clearRecent() {
    localStorage.removeItem("aso-recent");
    renderMainNav();
    if (state.view === "recent") render();
  }
  function recordRecent(path, title) {
    var recent = readRecent().filter(function (r) { return r.path !== path; });
    recent.unshift({ path: path, title: title || path });
    localStorage.setItem("aso-recent", JSON.stringify(recent.slice(0, 20)));
    renderMainNav();
  }

  // trash icon: clear all recent records
  if (recentTrash) {
    recentTrash.addEventListener("click", function (e) {
      e.stopPropagation();
      clearRecent();
    });
  }

  // ---------- doc viewer modal (bottom sheet) ----------
  function localUrl(path) { return BASE + "/" + path + "/index.html"; }

  /**
   * 归档页在公开站上的「同源虚拟路径」。
   * 公开仓不存这些文件，Service Worker 拦截后从私有仓 API 拉取，
   * 因此页面内的相对资源（CSS/字体/图片）也能自然解析并被一并代理。
   */
  function proxyUrl(path, lang) {
    var rel = "apple-specs-offline/" + path + (lang === "zh" ? "/zh-cn" : "") + "/index.html";
    var siteRoot = BASE.slice(0, BASE.lastIndexOf("/apple-specs-offline"));
    return siteRoot + "/" + rel;
  }

  function setDocLoading(msg) {
    var box = $("doc-loading");
    if (!box) return;
    if (!msg) { box.hidden = true; return; }
    box.hidden = false;
    box.textContent = msg;
  }

  /**
   * 打开文档：先经 API 确认归档页可达（404 / 401 时给出明确提示），
   * 再让 iframe 走同源虚拟路径 —— 页面内的 CSS/字体/图片由浏览器并发请求，
   * Service Worker 逐个代理到私有仓并写入永久缓存（第二次打开即秒开）。
   */
  function loadDocViaProxy(doc, lang) {
    var rel = "apple-specs-offline/" + doc.local_path + (lang === "zh" ? "/zh-cn" : "") + "/index.html";
    setDocLoading("正在获取文档…");
    return PrivateAPI.fetchText(rel, "gh-pages");
  }

  function openDocModal(doc) {
    if (!doc || !doc.local_path) return;
    state.currentDoc = doc;
    // 弹窗语言独立：打开时重置为站点当前语言；无中文版的文档没有切换意义，
    // 直接隐藏弹窗内的切换控件并固定英文
    state.modalLang = doc.zh_cn ? state.lang : "en";
    if (modalLang) modalLang.hidden = !doc.zh_cn;
    // 必须重新同步高亮：每篇文档的 modalLang 可能不同（上一个是纯英文文档时
    // 停在 en），不重新渲染就会「中文页 + EN 高亮」，且再点 EN 被
    // setModalLang 的 v === state.modalLang 挡掉、点中文无反应
    renderLangSwitch();
    var url = pageUrlFor(doc, state.modalLang);
    modal.classList.remove("closing");
    modalUrl.textContent = url;
    modalOpen.href = url;
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    document.documentElement.style.scrollbarGutter = "auto";
    modalClose.focus();
    recordRecent(doc.local_path, doc.title);
    if (state.view === "recent" && !state.searchMode) render();
    if (state.lang === "zh" && !doc.zh_cn) {
      showToast("该文档暂无中文版本，已显示英文原版");
    }

    if (PrivateAPI.hasToken()) {
      // 授权模式：先经 API 取正文并预取资源，再由 SW 代理载入
      swReady.then(function (reg) {
        if (reg && reg.active) {
          reg.active.postMessage({
            type: "set-token",
            token: PrivateAPI.getToken(),
            api: PrivateAPI.API,
          });
        }
      });
      setDocLoading("正在准备…");
      loadDocViaProxy(doc, state.modalLang)
        .then(function () {
          if (!state.currentDoc || state.currentDoc.local_path !== doc.local_path) return;
          setDocLoading(null);
          modalFrame.src = proxyUrl(doc.local_path, state.modalLang);
        })
        .catch(function (err) {
          setDocLoading(null);
          if (err && err.status === 401) {
            showAuthError("令牌无效或已过期，请重新授权");
            openAuthDialog();
          } else if (err && err.status === 404) {
            showAuthError("未在私有仓找到该文档：" + (err.path || ""));
          } else {
            showAuthError("加载失败：" + (err && err.message ? err.message : "未知错误"));
          }
        });
    } else {
      // 未授权：给出明确提示，不发起私有请求
      modalFrame.src = "about:blank";
      setDocLoading(null);
      showAuthError("本文档正文保存在私有仓库，需授权后查看。");
    }
  }

  function closeDocModal() {
    if (modal.hidden) return;
    state.currentDoc = null;
    // slide back down + fade, then hide (quick: does not travel all the way)
    modal.classList.add("closing");
    setTimeout(function () {
      modal.hidden = true;
      modal.classList.remove("closing");
      modalFrame.src = "about:blank";
      document.body.style.overflow = "";
      document.documentElement.style.scrollbarGutter = "";
    }, 200);
  }

  modalClose.addEventListener("click", closeDocModal);
  modal.addEventListener("click", function (e) {
    if (e.target.getAttribute && e.target.getAttribute("data-close")) closeDocModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !modal.hidden) closeDocModal();
  });

  // 中英文切换：顶栏 = 站点全局语言；弹窗工具栏 = 弹窗内语言（两者互不影响）
  function onLangClick(e) {
    var btn = e.target.closest ? e.target.closest("button[data-lang]") : null;
    if (!btn) return;
    var lang = btn.getAttribute("data-lang");
    if (modalLang && modalLang.contains(btn)) setModalLang(lang);
    else setLang(lang);
  }
  if (langSwitch) langSwitch.addEventListener("click", onLangClick);
  if (modalLang) modalLang.addEventListener("click", onLangClick);

  document.addEventListener("click", function (e) {
    // source link inside a card -> open the live Apple page, not the modal
    var srcLink = e.target.closest ? e.target.closest("[data-srclink]") : null;
    if (srcLink) { e.stopPropagation(); return; }

    var card = e.target.closest ? e.target.closest(".doc-card") : null;
    if (card) {
      var doc = state.docs.filter(function (d) {
        return d.doc_id === card.getAttribute("data-doc");
      })[0];
      if (doc && doc.local_path) openDocModal(doc);
      return;
    }
  });

  // keyboard: Enter/Space opens the card (role=button)
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var card = document.activeElement && document.activeElement.closest
      ? document.activeElement.closest(".doc-card") : null;
    if (!card) return;
    e.preventDefault();
    var doc = state.docs.filter(function (d) {
      return d.doc_id === card.getAttribute("data-doc");
    })[0];
    if (doc && doc.local_path) openDocModal(doc);
  });

  // ---------- search ----------
  var searchTimer = null;
  searchInput.addEventListener("input", function () {
    var q = searchInput.value.trim();
    clearBtn.hidden = !q;
    state.query = q;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      if (!q) {
        state.searchMode = false; state.searchResults = []; state.searchCat = "all";
        searchCatFilters.hidden = true;
        renderTabs(); render(); return;
      }
      staticSearch(q)
        .then(function (data) {
          state.searchMode = true;
          state.searchResults = data.results || [];
          state.searchCat = "all";
          renderSearchCatFilters();
          render();
        })
        .catch(function () {
          state.searchMode = false;
          state.searchResults = [];
          searchCatFilters.hidden = true;
          render();
          if (!PrivateAPI.hasToken()) {
            showAuthError("全文检索需要访问私有检索索引，请先授权。");
            openAuthDialog();
          } else {
            showAuthError("检索失败：令牌可能无效或已过期，请重新授权。");
          }
        });
    }, 250);
  });

  clearBtn.addEventListener("click", function () {
    searchInput.value = ""; clearBtn.hidden = true;
    state.query = ""; state.searchMode = false; state.searchResults = [];
    state.searchCat = "all"; searchCatFilters.hidden = true;
    renderTabs(); render();
  });

  searchCatFilters.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-scat]");
    if (!btn) return;
    state.searchCat = btn.getAttribute("data-scat");
    renderSearchCatFilters();
    render();
  });

  // ---------- navigation ----------
  function onNavClick(e) {
    var recentBtn = e.target.closest("[data-view='recent']");
    if (recentBtn) {
      state.view = "recent";
      state.subcategory = null;
      state.searchMode = false; state.searchCat = "all"; searchCatFilters.hidden = true;
      renderMainNav(); renderCategories(); renderTabs(); render();
      return;
    }
    var btn = e.target.closest("[data-cat]");
    if (!btn) return;
    state.category = btn.getAttribute("data-cat");
    state.view = "docs";
    state.searchMode = false; state.searchCat = "all"; searchCatFilters.hidden = true;
    // activate the category's first (whole-category) tab, like Apple's site
    var cat = state.categories.filter(function (c) { return c.id === state.category; })[0];
    state.subcategory = (cat && cat.first_tab) || null;
    renderMainNav(); renderCategories(); renderTabs(); render();
  }
  catNav.addEventListener("click", onNavClick);
  mainNav.addEventListener("click", onNavClick);

  tabsEl.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-tab]");
    if (!btn) return;
    var tab = btn.getAttribute("data-tab");
    state.view = "docs";
    // "cat-all" is the synthetic whole-category tab (no filter)
    state.subcategory = (tab === "cat-all") ? null : tab;
    var cat = state.categories.filter(function (c) {
      return (c.tabs || []).some(function (t) { return t.id === state.subcategory; });
    })[0];
    if (cat) state.category = cat.id;
    renderMainNav(); renderCategories(); renderTabs(); render();
  });

  // ---------- 私有数据授权 ----------
  // SW 必须注册在站点根，scope 才能覆盖 archive/、assets/ 等被代理路径
  var SITE_ROOT = (function () {
    var b = BASE, i = b.lastIndexOf("/apple-specs-offline");
    return i >= 0 ? b.slice(0, i) : b;
  })();
  var swReady = (function () {
    if (!("serviceWorker" in navigator)) return Promise.resolve(null);
    return navigator.serviceWorker.register(SITE_ROOT + "/sw.js", { scope: SITE_ROOT + "/" })
      .then(function (reg) {
        // 就绪后立即同步令牌与 API 根（未授权时 token 为空，api 仍需同步）
        var target = reg.active || reg.waiting || reg.installing;
        if (target) {
          target.postMessage({
            type: "set-token",
            token: PrivateAPI.getToken(),
            api: PrivateAPI.API,
          });
        } else {
          reg.addEventListener("updatefound", function () {
            var w = reg.installing;
            if (w) w.addEventListener("statechange", function () {
              if (w.state === "activated") {
                w.postMessage({
                  type: "set-token",
                  token: PrivateAPI.getToken(),
                  api: PrivateAPI.API,
                });
              }
            });
          });
        }
        return reg;
      })
      .catch(function () { return null; });
  })();

  function showAuthError(msg) {
    if (!authError) return;
    authError.textContent = msg || "";
    authError.hidden = !msg;
  }
  function openAuthDialog() {
    if (!authMask) return;
    showAuthError("");
    if (authToken) authToken.value = PrivateAPI.getToken();
    authMask.hidden = false;
    if (authToken) setTimeout(function () { authToken.focus(); }, 30);
  }
  function closeAuthDialog() {
    if (authMask) authMask.hidden = true;
    showAuthError("");
  }
  function updateAuthPill() {
    if (!authPill) return;
    var ok = PrivateAPI.hasToken();
    authPill.textContent = ok ? "已授权" : "未授权";
    authPill.classList.toggle("granted", ok);
    authPill.title = ok
      ? "已授权访问私有归档数据（点击可清除）"
      : "点击输入访问令牌以读取私有归档数据";
  }
  if (authPill) {
    authPill.addEventListener("click", function () {
      if (PrivateAPI.hasToken()) {
        PrivateAPI.setToken("");
        PrivateAPI.clearCache();
        updateAuthPill();
        showToast("已清除本机保存的访问令牌");
        if (!modal.hidden) closeDocModal();
      } else {
        openAuthDialog();
      }
    });
  }
  if (authCancel) authCancel.addEventListener("click", closeAuthDialog);
  if (authMask) {
    authMask.addEventListener("click", function (e) {
      if (e.target === authMask) closeAuthDialog();
    });
  }
  if (authSave) {
    authSave.addEventListener("click", function () {
      var t = (authToken && authToken.value || "").trim();
      if (!t) { showAuthError("请输入访问令牌"); return; }
      PrivateAPI.setToken(t);
      showAuthError("正在验证…");
      PrivateAPI.verify().then(function (r) {
        if (r.ok) {
          closeAuthDialog();
          updateAuthPill();
          showToast("授权成功，可查看完整归档正文");
          if (state.currentDoc) openDocModal(state.currentDoc);
        } else {
          PrivateAPI.setToken("");
          var msg = {
            NO_TOKEN: "请输入访问令牌",
            BAD_TOKEN: "令牌无效，请检查后重试",
            NO_ACCESS: "该令牌无权读取 ooghoo/apple-specs",
            NETWORK: "网络错误，请稍后重试",
          }[r.reason] || ("验证失败：" + r.reason);
          showAuthError(msg);
        }
      });
    });
  }
  if (authToken) {
    authToken.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); if (authSave) authSave.click(); }
    });
  }
  updateAuthPill();

  // ---------- boot ----------
  // 先等 Service Worker 接管页面，再拉数据并渲染——否则首批资源请求
  // （文档缩略图等）会绕过 SW 直接打到静态站，导致私有素材 404。
  var swControlling = (function () {
    if (!("serviceWorker" in navigator)) return Promise.resolve(false);
    if (navigator.serviceWorker.controller) return Promise.resolve(true);
    return Promise.race([
      navigator.serviceWorker.ready
        .then(function () { return navigator.serviceWorker.controller; })
        .then(function (c) { return !!c; })
        .catch(function () { return false; }),
      new Promise(function (r) { setTimeout(function () { r(false); }, 8000); }),
    ]);
  })();

  swControlling.then(function () {
    return Promise.all([
      fetch(BASE + "/data/documents.json").then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }),
      fetch(BASE + "/data/categories.json").then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }),
    ]);
  }).then(function (res) {
    if (!res) return;
    state.docs = (res[0].documents || []).map(function (d) {
      d.tabs = d.tabs || [];
      return d;
    });
    state.categories = (res[1].categories || []).filter(function (c) { return c.count > 0; });
    renderMainNav(); renderCategories(); renderTabs(); renderLangSwitch(); renderStats(); render();
    if (!state.docs.length) {
      grid.innerHTML = "";
      empty.hidden = false;
      empty.innerHTML = "<p>索引为空——数据文件 <code>data/documents.json</code> 未正确部署。</p>";
    }
  }).catch(function (err) {
    var connRefused = err && err.name === "TypeError";
    grid.innerHTML = "";
    empty.hidden = false;
    empty.innerHTML = "<p>" +
      (connRefused
        ? "无法加载索引数据（" + location.origin + "）。<br>请检查网络连接后刷新。"
        : "索引加载失败（" + (err && err.message ? err.message : "未知错误") + "）。") +
      "</p>";
  });
})();
