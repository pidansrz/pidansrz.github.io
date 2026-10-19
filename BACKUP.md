# 备份 · 换电脑 · 长期维护

## 一句话结论

**GitHub 本身就是你的主备份。** 只要东西 push 上去了，电脑炸了也不会丢内容。
你要额外做的，只是防「GitHub 那一侧出问题」——定期另存一份副本即可。

---

## 一、到底要备份什么

### 1. 仓库里已经有的一切（主备份）

`personal-blog/` 里 **2704 个文件**，约 260M：

| 目录 / 文件 | 大小 | 是什么 | 丢了会怎样 |
|---|---|---|---|
| `drafts/` | 3M | **文章的唯一源头**（409 篇 .md） | 🔴 全站内容没了 |
| `images/` | 101M | 头图与配图（1814 张） | 🔴 图全没了 |
| `css/style.css`、`js/app.js`、`index.html`、`post.html`、`about.html`、`archive.html`、`404.html` | 小 | 站点代码与页面 | 🔴 站打不开 |
| `tools/` | 12M | 构建与检测脚本 | 🟠 无法本地重建（云端 CI 还能跑） |
| `.github/workflows/publish.yml` | 小 | 云端自动构建 | 🟠 无法自动发布 |
| **`js/data.js` 顶部的 `SITE` 块** | 极小 | 站名、域名、赞赏码、公众号二维码 | 🟠 要重配 |
| `CNAME` | 极小 | 自定义域名（绑定后才有） | 🟡 域名绑定失效 |
| `.gitignore`、`.nojekyll` | 极小 | 构建配置 | 🟡 可能有怪问题 |

> ⚠️ `js/data.js` 里只有**顶部 `SITE` 那一段**是手写的；下面的 `POSTS` 数组、
> 以及 `js/index-data.js`、`js/posts/*.js`、`js/search-text.js`、`feed.xml`、
> `sitemap.xml`、`robots.txt` **全是生成物**，丢了能一键重建，不需要备份。

### 2. 仓库外的东西（GitHub 上没有，换电脑会丢）

都在 `personal-blog/` 的**上一级目录**里，共约 404M：

| 目录 | 大小 | 要不要单独备份 |
|---|---|---|
| `_incoming/` | 198M | ✅ **要** —— 公众号的原始导出包，是全部内容的原始素材 |
| `_giffix-removed-20261009/` | 121M | ❌ 冗余（已处理掉的图） |
| `_images-backup-20261009/` | 30M | ❌ 冗余 |
| `_png-original-20261008/` | 27M | ❌ 冗余 |
| 其余 `_cropdup-*` `_bannerdup-*` `_innerdup-*` `_strip-*` 等 | 共约 20M | ❌ 冗余（都是被移出的重复图 / 旧草稿快照） |

**结论：仓库外唯一值得留的是 `_incoming/`**（如果你以后还想重新导入公众号内容）。
其余的都是「处理过程中移出去的东西」，站点已经不用它们了。

### 3. 建议的备份做法（挑一个）

| 做法 | 频率 | 说明 |
|---|---|---|
| **GitHub 网页 → Code → Download ZIP** | 每季度一次 | 最省事，存网盘或移动硬盘。**不含 git 历史**，但文件齐全 |
| **`git clone --mirror`** | 想完整保留历史时用 | 会打包全部提交记录 |
| **整个 `personal-blog` 文件夹复制一份** | 想省事 | 直接拷到网盘即可，`.git` 一起拷（含历史） |

> 真正要防的三件事：误删仓库、GitHub 账号异常、GitHub 服务不可用。
> 一年存两三次 ZIP 到网盘，就足够了。

---

## 二、换一台电脑怎么办

### 第 1 步：装两个东西（共 5 分钟）

1. **Git**：`git-scm.com` 下载安装，一路下一步
2. **GitHub Desktop**（可选，不想用命令行就装它）：`desktop.github.com`

> **不需要装 Node，也不需要装 Python。**
> 构建全部在 GitHub 云端跑（`.github/workflows/publish.yml`），本机只负责写文章和上传。

### 第 2 步：把博客拉下来

命令行：

```bash
git clone https://github.com/pidansrz/pidansrz.github.io.git
```

或者 GitHub Desktop：`File` → `Clone repository` → 选你的仓库 → 选本地路径 → `Clone`。

### 第 3 步：配一下身份（每台新电脑一次）

```bash
git config user.name "pidansrz"
git config user.email "你的GitHub邮箱"
```

用 Desktop 的话，第一次提交时会让你登录 GitHub，跟着点就行。

### 第 4 步：确认能跑通

随便改一个字（比如在 `drafts/` 里改篇旧文章的标点），
commit → Pull → Push，看到 Actions 变绿就说明环境没问题。

### 第 5 步：（可选）把 `_incoming/` 拷过来

从旧电脑复制过来，放新电脑的任意位置即可——它不在仓库里，只是原始素材存档。

### 第 6 步：让 AI 接手（关键）

⚠️ **AI 的「记忆」不在仓库里。** 本机的项目记忆放在仓库**上一级**的
`.workbuddy/memory/`（每日工作日志 + `MEMORY.md`），它不在 git 里，换电脑不会跟着走。

所以约定写在**仓库内**的 [`AGENTS.md`](./AGENTS.md) 里，它随 `git clone` 一起到新电脑。
新电脑上只要把工作目录指向仓库，跟 AI 说第一句话就行：

> 「先读仓库根目录的 `AGENTS.md`，然后按里面的约定帮我……」

`AGENTS.md` 里已经写全了：架构、六条铁律、改完必跑的四步命令、草稿写法、
部署注意事项。不读它，AI 很容易犯这几类错（都是真踩过的）：

- 直接改 `js/data.js` 的 `POSTS`（会被下次构建覆盖）
- 只跑 `import-posts` 就以为完事（缺图片尺寸、丢旧文标记，自检必挂）
- 补旧文正文时另建新草稿（标题被自动加「| 旧文」）
- 换域名后只跑 `build-feed.js`（首页那份 `SITE` 副本没更新）

**要不要把旧记忆也搬过去？** 可选。想搬就把旧电脑
`…/.workbuddy/memory/` 整个目录拷到新电脑同级位置，AI 能读到历史工作日志。
不搬也不影响——`AGENTS.md` + `README.md` + `DEPLOY.md` 已足够开工。

---

## 三、日常维护清单

### 每次写完文章

1. 往 `drafts/` 放 `.md`（或直接在 GitHub 网页上新建）
2. **Pull** → **Commit** → **Push**
3. 等 1–2 分钟，Actions 变绿，站点自动更新

### 每月 / 每次大改后

- 看一眼 GitHub 的 **Actions** 是不是绿的（红了说明自检没过，站点不会更新）
- 打开站点抽查几篇

### 每季度

- 下载一次 ZIP 存网盘（见上文）
- 检查一下域名续费是否开了自动续费

### 每年

- 域名续费（**务必开自动续费**，过期被抢注是最常见的事故）
- 确认 GitHub 账号的两步验证还在

---

## 四、几个「如果……怎么办」

**Q：误删了仓库里的文件？**
`git log` 找到删之前的提交 → `Revert`，或直接 `git checkout <提交号> -- 文件路径`。
只要 push 过，历史就在。

**Q：改坏了，想整站回退？**
GitHub 仓库 → 提交记录 → 找到坏的那次 → **Revert**。纯静态站点，回滚即恢复。

**Q：只剩 `drafts/` 和 `images/` 了，还能重建吗？**
能。只要有 `drafts/`（文章）+ `images/`（图）+ 代码和 `tools/`，
跑一次流水线就能重建全部生成物。这也是为什么 `drafts/` 必须是唯一源头。

**Q：`SITE` 配置丢了怎么办？**
重配一次即可：站名、`url`、赞赏码路径、公众号二维码路径，一共四五个字段。
改完记得跑 `node tools/build-all.js`。

**Q：GitHub 挂了 / 账号被封？**
用你存的 ZIP 副本，换个托管（Cloudflare Pages、Netlify 都支持直接传静态文件），
站点是纯静态的，一个字都不用改。

---

## 五、最小备份集（极端情况下）

如果你只能保存一样东西，按这个优先级：

1. **`drafts/`**（3M）—— 全部文章的文本
2. **`images/`**（101M）—— 全部配图
3. 站点代码（`css/`、`js/app.js`、`index.html`、`post.html` 等）
4. `tools/`（构建脚本）

这四样凑齐 = 可以完整重建站点。
