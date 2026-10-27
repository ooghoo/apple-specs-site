# apple-specs-site

Apple 历史产品规格相关项目的**公开站点仓库**（GitHub Pages 发布源）。

站点地址：<https://ooghoo.github.io/apple-specs-site/>

## 内容

线上只发布一个项目：**Apple Product Timeline** —— 1976–2026 年共 762 款 Apple 产品的
时间线图鉴，中英双语，时间线 + 分类双视图，详情弹窗含官方技术规格与产品图。

```
index.html        时间线站页面
data.js           产品数据（window.APPLE_DATA，含规格字段与时间线数据）
assets/official/  官方产品图（463 张）
assets/img/       历史产品图（126 张）
assets/favicon.png
```

页面资源全部使用相对路径，部署在仓库根目录即可直接访问，无需子路径适配。

## 与私有仓的关系

源码与完整数据在私有仓 [`ooghoo/apple-specs`](https://github.com/ooghoo/apple-specs)（私有），
本仓只发布对外展示的站点内容。

| 内容 | 所在仓库 |
|---|---|
| 时间线站页面与产品数据 | 本仓 |
| 产品图片 | 本仓 |
| 构建脚本（`build_site.py` 等）、源数据（`Apple规格整合/`）、规格文档离线归档 | **私有仓** |

Apple Specs Offline（官方技术规格文档的离线归档与浏览系统）**不在公开站发布**：
其归档内容版权归 Apple Inc. 所有，按项目内 `AGENTS.md` 的版权红线仅限个人离线查阅。
该系统继续在私有仓中本地运行（`apple-specs-offline/start.command`）。

## 本地预览

```bash
python3 -m http.server 8125
# 打开 http://127.0.0.1:8125/
```

## 版权

资料版权归 Apple Inc. 所有。
