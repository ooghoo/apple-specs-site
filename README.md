# apple-specs-site

Apple 历史产品规格相关项目的**公开站点仓库**（GitHub Pages 发布源）。

站点地址：<https://ooghoo.github.io/apple-specs-site/>

## 与私有仓的关系

数据与源码全部在私有仓 [`ooghoo/apple-specs`](https://github.com/ooghoo/apple-specs)（私有），本仓只放站点壳。

| 内容 | 所在仓库 | 公开站如何取用 |
|---|---|---|
| 落地页 | 本仓 | 直接静态访问 |
| Apple Product Timeline（762 款产品图鉴） | 本仓 | 直接静态访问 |
| 离线规格库导航与元数据（511 份文档标题/分类/缩略图） | 本仓 | 直接静态访问 |
| 归档页正文、原始 CSS/字体/图片、正文检索索引 | **私有仓** | 运行时经 Service Worker 代理 |

## 运行时私有数据映射

浏览离线规格库的文档正文时，页面通过 `sw.js`（Service Worker）拦截同源请求，
转发到 GitHub API 读取私有仓内容：

```
浏览器 ──► sw.js（同源拦截）──► api.github.com/repos/ooghoo/apple-specs/contents/...?ref=gh-pages
```

- **令牌**：使用者在本机输入 fine-grained PAT，浏览器直连 GitHub API
  （GitHub API 允许跨域：`access-control-allow-origin: *`）。
  令牌只存 `localStorage`，**不上传任何服务器**，也不写进本仓任何文件。
  需要权限：`Contents: Read-only`，且仅限 `ooghoo/apple-specs` 一个仓库。
- **永久缓存**：拉到的内容写入 Cache Storage（`aps-private-v2`），
  第二次打开同一文档直接命中缓存，零 API 调用。
- **未授权时**：文档列表与元数据可见，点开正文会提示需要授权。

### 为什么不直接把私有数据放进本仓

`archive/`、`assets/`、`mirror/` 与正文检索索引含 Apple Inc. 版权素材，
按 `apple-specs-offline/AGENTS.md` 的版权红线仅限个人离线查阅，不得再发布。

## 目录

```
index.html                          落地页
sw.js                                Service Worker：私有资源同源代理
apple-product-timeline/              时间线站（静态）
apple-specs-offline/
  web/                               离线规格库导航（index.html / app.js / private-api.js / styles.css）
  data/                              文档元数据（documents.json / categories.json / stats.json / category-tree.json）
  assets/thumbnails/                 511 张文档缩略图
  resolve-doc/                       文档 ID → 归档页的重定向
  api-www/ ols/ us/ wss/ search-services/   Apple 域接口快照
```

## 本地预览

```bash
cd site
python3 -m http.server 8125
# 打开 http://127.0.0.1:8125/
```

离线规格库在子路径 `/apple-specs-offline/web/` 下，需通过子路径访问
（`BASE` 按 `location.pathname` 中的 `/web/` 推导，不要用文件协议直接打开）。

## 版权

资料版权归 Apple Inc. 所有。
