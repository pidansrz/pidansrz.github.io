# AGENTS.md — 本项目的硬约定（AI / 协作者开工前必读）

这是「皮蛋瘦肉舟」静态博客的项目约定文件。
**任何 AI 助手或协作者在本仓库里动手前，先把这份文件读完**，尤其是「铁律」一节——
那几条都是踩过坑后定下的，违反会直接造成线上事故或返工。

> 只对人类看的说明在 `README.md`（功能与用法）、`DEPLOY.md`（上线）、`BACKUP.md`（备份换机）。
> 本文件只写**约束与操作规范**。

---

## 一、架构一句话

```
drafts/*.md  ──(import-posts --replace)──►  js/data.js  ──►  index-data.js / js/posts/*.js / search-text.js / feed.xml / sitemap.xml / robots.txt
```

- 站点**零依赖**：HTML + CSS + 原生 JS，双击 `index.html` 可看。
- 线上：`https://pidansrz.github.io`（GitHub Pages）。
- 云端 CI（`.github/workflows/publish.yml`）在每次 push 到 `main` 后自动重建并**把结果 commit 回仓库**。

## 二、铁律（违反必返工）

### 1. `drafts/` 是唯一内容源头
- 改文章 = 改 `drafts/*.md`。**永远不要手改** `js/data.js` 的 `POSTS` 数组、
  `js/index-data.js`、`js/posts/*.js`、`js/search-text.js`、`feed.xml`、`sitemap.xml`、`robots.txt`
  —— 它们全是生成物，下次构建会被覆盖。
- `js/data.js` **顶部 `SITE` 配置块是唯一例外**（`import-posts.js` 会读旧值再写回）。
- `drafts/` 下**以 `_` 开头的文件**和 `README.md` 不会被导入（所以 `_模板.md` 可以留着当模板）。

### 2. 禁止「头图是正文某张图的裁切版」
- 含义：`cover` 不能是正文里某图的裁切/残缺版（详情页用残缺图、正文里却还有完整版 = 重复且别扭）。
- 发布前必须跑 `python tools/guard-cover-crop.py`（仅检查，有问题退出码 1）；
  要自动修就加 `--fix`。
- 另有四类重复要扫（见「第三节」的五个脚本），本轮已全部清零，新导入文章也要扫。
- 已知盲区：同一插画的**不同渲染/裁剪版本** NCC 只有约 0.83，脚本抓不到，靠人工发现。

### 3. 从文章页返回首页，必须停在该文章的位置
- 文章页所有回首页入口的链接都带 `index.html#post-<id>`。
- 首页卡片带 `id="post-<id>"`；`initHome()` 的 `scrollToPostFromHash()` 负责定位
  （含 sticky 顶栏偏移、load/120ms/400ms 三次校正）。
- 定位时必须给 `body` 加 `reveal-instant`，否则 `.reveal` 动画延迟会让目标位置一片空白。
- 改这块后跑 `node tools/verify.js`（含「返回首页定位回原文」4 条断言）。

### 4. Pages 的 Source 必须是「Deploy from a branch → main → /(root)」
- 不能选「GitHub Actions」。CI 是把结果 commit 回仓库，不是上传 artifact，选错站点不会更新。

### 5. 构建产物必须可复现
- 任何脚本**不许用 `new Date()` 当输出内容**（曾导致 `feed.xml` 的 `lastBuildDate`
  本地与云端各生成一版 → 合并冲突）。时间一律取自「最新文章日期」。

### 6. 补旧文正文时不要另建新草稿
- `mark-reposts.js` 会给「存在更早同标题文章」的新文自动加「| 旧文」后缀。
- 补正文就**直接填进原来那篇 `drafts/*.md`**。

### 7. 文章详情页有「静态规范页」，分享卡靠它
- 构建会为每篇生成 `post/<id>.html`（`tools/build-posts.js`），把该篇标题/描述/**绝对路径头图**
  直接写进 `<meta>`。微信/社交平台的爬虫不执行 JS，只有这种静态页才能读到每篇自己的头图。
- 静态页里注入 `<base href="/">`：模板里所有相对路径（css/js/images）照常写，位于 `post/`
  子目录也按站点根解析；并注入 `window.__POST_ID__`，`app.js` 的 `query("id")` 优先用它（不依赖 `?id=`）。
- 站内文章链接统一是 `post/<id>.html`（`app.js` 的 `articleHref()`）；`feed.xml`/`sitemap.xml` 也指向它。
- 旧的 `post.html?id=<id>` 仍可打开（向后兼容，只是分享图用默认图）；`post/<id>.html` 是规范地址。
- 默认分享图 `images/og-default.jpg` 由 `python tools/gen-og-default.py` 生成（1200×630，
  需 Pillow + Windows 微软雅黑 `msyh.ttc`；已提交，CI 不重生成）。

## 三、改完必跑的四步（一条都不能少）

```bash
node tools/import-posts.js --replace      # drafts → js/data.js（并自动触发 build-all）
python tools/add-image-sizes.py --apply   # 给图片补 width/height（否则 verify 会挂）
node tools/mark-reposts.js --apply        # 标「| 旧文」（否则 og:title 断言会挂）
node tools/verify.js                      # 自检，必须 51 通过 / 0 失败
```

只跑 `import-posts` 是不够的：会缺 1489 张图的尺寸、丢旧文标记，verify 直接红。

发布前把关（建议都跑，发现问题各自处理）：

```bash
python tools/guard-cover-crop.py          # 头图是正文图裁切版（退出码 1 = 有问题）
python tools/scan-cover-identical.py      # 头图与正文图 md5 完全相同
python tools/scan-cover-neardup.py        # 同画面不同尺寸（NCC）
python tools/scan-cover-banner.py         # 微信 2.35:1 横幅裁切（同宽、封面更矮、NCC≥0.70）
python tools/scan-body-inner-dup.py       # 同一篇正文内部引用了同一张图（只看 ≥300px 大图）
```

改了 `SITE`（站名 / url / 赞赏码 / 公众号二维码）后，**必须跑 `node tools/build-all.js`**，
只跑 `build-feed.js` 首页不会变——`js/index-data.js` 里还有一份 SITE 副本。
`build-all.js` 现在依次跑 `build-split → build-feed → build-posts`，会一并重新生成 `post/<id>.html`
（其中的 `og:image`/canonical 是绝对地址，依赖 `SITE.url`，改域名后必须重跑）。

## 四、草稿写法要点

- front-matter 必须是**裸 `---`**。从聊天窗口/网页复制容易变成 `\---` 且行尾带双空格，
  会导致解析失败（已踩过一次，`_模板.md` 被写坏）。
- 不写 `excerpt` 时，导入脚本自动取正文开头；想指定就写 `excerpt:`。
- 空摘要的 32 篇是图片消息，正常；`2019-12-24` 摘要是「一」，是真实内容，不要动。
- 图片放 `images/<slug>/`（与文章 id 同名目录），正文用 `![](images/<slug>/xxx.jpg)` 引用。

## 五、部署相关（改前先读 `DEPLOY.md`）

- 换域名：改 `js/data.js` 的 `SITE.url` → 跑 `build-all.js` → Pages 填 Custom domain → DNS 加记录。
- ⚠ 在 Pages 填了 Custom domain 后，GitHub 会在仓库根生成 `CNAME`。
  **下次本地 push 前必须先 `git pull`**，覆盖掉会导致域名绑定失效。
- CI 的自检是硬的（`verify.js` 失败 = 不提交），头图检查目前是告警（`continue-on-error`）。
- 沙箱/受限环境常常连不上 GitHub（代理 502 / SSL 失败），此时**提交照做，push 交给用户在本机执行**。

## 六、动文件前的通用习惯

- 改草稿或图片前**先备份**；移出文件用脚本里的 `move_away()`（冲突安全），不要硬删。
- 处理过程产生的 `_xxx-backup-<日期>/`、`_xxx-removed-<日期>/` 目录在仓库**上一级**，
  不进仓库，也不需要提交。
- 不确定的脚本先跑它的「试算」模式（多数脚本默认试算，`--apply` / `--fix` 才落盘）。
