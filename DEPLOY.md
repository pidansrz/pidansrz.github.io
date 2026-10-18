# 部署指南：把博客挂到自己的域名上

> 目标：`https://你的域名.com` 能打开你的博客，免备案，有 HTTPS，不花托管费。
> 预计耗时：域名准备 10 分钟 + 部署 15 分钟（DNS 生效另需几分钟到 1 小时）。

---

## 总览

**走 Cloudflare 一条龙（推荐，全程不碰境内注册商）**：

```
在 Cloudflare 注册域名  →  上传站点到 Cloudflare Pages  →  绑定域名  →  完成
      (10min)                  (拖拽上传文件夹)            (点两下)
```

**域名已在腾讯云/阿里云买的**：

```
买域名(已实名) → 把 DNS 改到 Cloudflare → 上传站点到 Cloudflare Pages → 绑定域名 → 完成
                   (改一次 NS，10min~1h)
```

上传的目录就是本项目根目录 `personal-blog/`，**里面的全部文件**（`index.html`、`404.html`、`css/`、`js/` 等）。站点已全部使用相对路径，不需要改任何代码。

> 不想用 Cloudflare 托管站点的话，第二步也可以换成 GitHub Pages（方案 A），
> 域名那一步的做法完全一样。

---

## 第一步：买域名（两条路，选一条）

### 买法 1：境内注册商（腾讯云 / 阿里云）

| 后缀 | 参考价格 |
|---|---|
| `.com` | 约 70–90 元/年 |
| `.cn` | 约 30 元/年 |
| `.me` `.xyz` | 约 30–60 元/年 |

**⚠️ 买完立刻做实名认证。** 境内注册商的域名按工信部要求必须实名，一般 1–2 天通过。**没实名认证的域名无法正常解析**，这一步卡住后面全白做。

买完还要多做一步：把 DNS（NS）改到 Cloudflare —— 见下面「第二步（方案 B）」。

### 买法 2：直接在 Cloudflare Registrar 注册（不用碰境内注册商）

**省掉实名认证、省掉改 NS**，域名买下来就直接在 Cloudflare 手里，DNS 立刻可用。

1. 登录 Cloudflare → **域名注册 / Domain Registration** → **注册域名 / Register a Domain**
   （若控制台改版，入口一般在首页 **Add a site** 旁或账户菜单里，以当前显示为准）
2. 搜索想要的域名，看各后缀报价。Cloudflare 按**注册局成本价**卖、不加价：
   - `.com` 约 **10 美元/年**（≈70 元）
   - `.net` `.org` `.io` `.me` `.xyz` 等从几美元到几十美元不等，以后台报价为准
3. 结算时填 WHOIS 联系信息 → **免费隐私保护默认开启**（这点比境内注册商省心）
4. 付款：**Visa / Mastercard / Amex / PayPal**。⚠️ **不支持支付宝和微信**——这是这条路唯一的硬门槛
5. 付款后域名自动出现在你的 Cloudflare 账户里，**DNS 已由 Cloudflare 接管，不需要改 NS**
6. 确认域名状态是 **Active**（通常几分钟内）

**这条路要注意的三件事**：

- **不支持 `.cn`**。Cloudflare Registrar 只卖国际后缀（`.com` `.net` `.org` `.io` `.me` 等）。
  想要 `.cn` 只能回境内注册商，也就必须实名认证。
- **域名期间不能改 NS**。Cloudflare Registrar 的域名强制使用 Cloudflare DNS；
  哪天想换别家 DNS，只能先把域名**转出**到别的注册商。
- **新注册 60 天内不能转移**（ICANN 规定，各家都一样，不是 Cloudflare 的限制）。

**安全设置（买完顺手做，两分钟）**：
- 开 **Registrar Lock / 注册局锁定**，防止域名被恶意转出
- 开 **自动续费**，域名过期被抢注是最常见的事故
- 账户开 **两步验证（2FA）**

> 顺带一提：Cloudflare 注册 + Cloudflare Pages 托管是「一站式」的——
> 绑定自定义域名时 DNS 记录由 Cloudflare 自动加好，比跨两家服务商少很多折腾。

### 补充：域名已经在腾讯云/阿里云了，想彻底转到 Cloudflare

可以转，但有门槛，先看三个条件：

| 条件 | 说明 |
|---|---|
| 后缀 | 必须是国际后缀。`.cn` **转不进** Cloudflare |
| 时间 | 注册满 **60 天**（ICANN 规定，新域名转不了） |
| 状态 | 域名已解锁、实名认证已通过、能提供转移码 |

步骤：

1. 境内注册商后台：解除域名锁定 → 申请**转移码 / 授权码**（Auth Code，会发到你的注册邮箱）
2. 关掉域名的 WHOIS 隐私保护（部分注册商会因隐私开启而拒绝转移）
3. Cloudflare → **域名注册 → 转移域名 / Transfer a domain** → 输入域名和转移码
4. 付费（转移等于续费 1 年，约 10 美元）→ 提交
5. 回境内注册商后台**确认同意转出**（有的需要主动点，有的会自动放行）
6. 等 **5–7 天**完成转移，期间网站照常解析，不会中断

**值不值得转？** 如果你只是嫌改 NS 麻烦——**没必要转**，改一次 NS 就一劳永逸了，
域名注册商在境内、DNS 在 Cloudflare 是常见组合，不影响使用也不影响免备案。
只有当你确实不想再跟境内注册商打交道时，才值得花这一周时间。

---

## 第二步（方案 A）：用 GitHub Pages 上线 —— 推荐

> 如果你已经有 GitHub 账号，走这条最顺：免费、有 HTTPS、能绑自己的域名，
> 而且**以后每次 `git push` 自动重新部署**，不用手动拖文件。

### A1. 建仓库

1. GitHub 右上角 **+** → **New repository**
2. 仓库名填 **`你的用户名.github.io`**（比如我叫 `zhangsan` 就填 `zhangsan.github.io`）
   - ⚠️ 必须用这个格式，站点的根地址才是 `https://你的用户名.github.io`；
     换成别的名字，地址会变成 `https://你的用户名.github.io/仓库名/`
3. 选 **Public**（私有仓库的 Pages 要付费）、**不要**勾选 README / .gitignore
4. 点 **Create repository**

### A2. 本地初始化并推送

在项目根目录 `personal-blog/` 里执行：

```bash
git init
git add .
git commit -m "first publish"
git branch -M main
git remote add origin https://github.com/你的用户名/你的用户名.github.io.git
git push -u origin main
```

首次推送约 130M（图片占 107M），可能要几分钟，之后都是增量，很快。

**已经替你准备好的三个文件**，不用再手动建：

| 文件 | 作用 |
|---|---|
| `.gitignore` | 排除 `js/data.backup*.js`、`tools/_*/` 等临时产物（约 20M，发布出去没用） |
| `.nojekyll` | 跳过 Jekyll 构建，部署更快（本站没有 `_` 开头的目录，不放也不出错） |
| `.github/workflows/publish.yml` | 云端自动构建：push 后自动生成站点 + 自检 + 头图检查，详见「随时随地更新」 |

### A3. 开启 Pages

仓库 → **Settings** → 左侧 **Pages** → **Build and deployment**：

- **Source** 选 **Deploy from a branch**
- **Branch** 选 `main`，目录选 `/ (root)` → **Save**

等 1–2 分钟，打开 `https://你的用户名.github.io` 检查一遍：
年份分组、搜索、文章头图、深浅色、右侧支持栏都正常再继续。

> 建议顺手在仓库根目录放一个空的 `.nojekyll` 文件，跳过 Jekyll 构建，部署更快。
> 本项目没有 `_` 开头的目录，不放也不会出错。

### A4. 绑定你自己的域名

1. **Settings → Pages → Custom domain** 填入你的域名 → **Save**
2. 去域名的 DNS 后台加记录（二选一）：

   | 想用的地址 | 记录类型 | 主机名 | 记录值 |
   |---|---|---|---|
   | `blog.你的域名.com`（推荐，最简单） | CNAME | `blog` | `你的用户名.github.io` |
   | `www.你的域名.com` | CNAME | `www` | `你的用户名.github.io` |
   | `你的域名.com`（根域） | A | `@` | `185.199.108.153`、`185.199.109.153`、`185.199.110.153`、`185.199.111.153`（四条都加） |

   > 根域那四个 IP 以 [GitHub 官方文档](https://docs.github.com/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site) 为准，若以后变更照文档填。

3. 等 DNS 生效（几分钟到 24 小时）。Windows 可用 `nslookup -type=CNAME blog.你的域名.com` 验证
4. 生效后回到 **Pages** 页面勾选 **Enforce HTTPS**（证书自动签发，可能要等一会儿才可选）

> **注意**：设置自定义域名后，GitHub 会在仓库根目录自动生成一个 `CNAME` 文件（内容是你的域名）。
> **下次推送前先 `git pull`**，别把它覆盖掉，否则域名绑定会被清掉。

### A5. 把站内地址改成你的域名（必做）

`js/data.js` 里的 `SITE.url` 还指向临时预览地址，**必须改**，否则订阅源、
站点地图、分享出去的链接都还是旧地址：

```js
url: "https://你的域名.com",   // 改成你最终绑定的地址（带 https://）
```

改完重新生成订阅源与站点地图：

```bash
node tools/build-feed.js
git add . && git commit -m "use custom domain" && git push
```

### A6. 方案 A 的取舍

- ✅ 完全免费、自动部署、有 HTTPS、绑域名简单
- ⚠️ `github.io` 在中国大陆访问**速度不稳定，部分地区可能较慢**。
  读者主要在国内的话，上线后建议再加一层 Cloudflare 加速（见下面方案 B），
  或直接改用方案 B 托管——站点是纯静态的，随时可迁，文件一个都不用动。

---

## 第二步（方案 B）：把域名托管到 Cloudflare

Cloudflare 负责 DNS 解析 + 免费 HTTPS + 免费托管，是这套方案的核心。

> **如果你是按「买法 2」在 Cloudflare Registrar 直接注册的域名，这一步整个跳过** ——
> DNS 已经是 Cloudflare 在管，直接去第三步。

1. 打开 [cloudflare.com](https://cloudflare.com) 注册账号（邮箱验证即可，免费）
2. 控制台点 **Add a site**，输入你刚买的域名，套餐选 **Free**
3. Cloudflare 会扫描现有解析记录，直接继续
4. **关键一步**：Cloudflare 会给你两个专属 NS 地址，形如：
   ```
   ivy.ns.cloudflare.com
   tom.ns.cloudflare.com
   ```
5. 回到**腾讯云/阿里云**的域名管理后台，找到「DNS 修改 / 修改 DNS 服务器」，把这**两个 NS 地址填进去**替换掉原来的
6. 等生效：通常 **10 分钟到 1 小时**，最长 24 小时。Cloudflare 后台状态变成 **Active** 就成功了

> 这一步只是把「域名归谁管」从腾讯云交给 Cloudflare，域名所有权还是你的。

---

## 第三步：上传站点

1. Cloudflare 控制台左侧 → **Workers & Pages** → **Create** → 选 **Pages** → **Upload assets**
2. 项目名填一个英文短名，例如 `pidan-blog`
3. 把 `personal-blog/` 文件夹**里面的所有文件**拖进上传区
   - ⚠️ 拖的是**文件夹里的内容**，不要整个 `personal-blog` 文件夹拖进去，否则首页会变成 `/personal-blog/`
4. 点 **Deploy site**，几秒后你会拿到一个临时网址，形如 `pidan-blog.pages.dev`
5. **先打开这个临时网址检查一遍**：首页的年份分组、搜索栏、文章头图、右侧支持栏、切深浅色，都正常再继续

---

## 第四步：绑定你的域名

1. 进入刚建好的 Pages 项目 → **Custom domains** → **Set up a custom domain**
2. 输入你要用的域名：
   - 想用 `你的域名.com` → 直接填 `你的域名.com`
   - 想用 `blog.你的域名.com` → 填 `blog.你的域名.com`
3. 因为 DNS 已经在 Cloudflare 托管，它会**自动帮你加好解析记录**，点确认即可
4. 等 1–2 分钟，HTTPS 证书自动签发完成

---

## 第五步：验证

浏览器打开你的域名，确认：

- [ ] 页面正常显示，样式正确
- [ ] 点进任意一篇文章，URL 变成 `你的域名.com/post.html?id=xxx`
- [ ] 头图正常显示，文章列表按年份归类
- [ ] 首页搜索框能边打边筛，关键词有高亮
- [ ] 首页右侧栏能看到赞赏码 / 公众号二维码（没放图时是虚线占位框）
- [ ] 点进文章，底部「微博 / 豆瓣 / 微信 / 复制链接」都在；点「微信」能弹出二维码
- [ ] 用手机打开一遍：菜单能展开、搜索框点进去页面不会被放大、底部没有内容被 Home Indicator 挡住
- [ ] 深色模式可用
- [ ] 打开 `你的域名.com/feed.xml`，能看到订阅源（浏览器会显示 XML 源码，这是正常的）
- [ ] 地址栏显示 🔒 小锁（HTTPS 生效）
- [ ] 随便输一个不存在的路径（如 `你的域名.com/abc`），出现你自己的 404 页面

---

## 备选方案：Netlify Drop（最快，10 分钟）

如果不想改 NS，只想**立刻**看到结果：

1. 打开 [app.netlify.com/drop](https://app.netlify.com/drop)
2. 把 `personal-blog/` 里的文件直接拖进网页
3. 立刻拿到一个 `xxx.netlify.app` 网址，可先注册账号保存
4. 绑域名：项目 → Domain management → Add custom domain → 按提示在**腾讯云 DNS 后台**加一条 `CNAME` 记录指向 `xxx.netlify.app`
5. 等 DNS 生效，HTTPS 自动签发

**取舍**：Netlify 不用改 NS、上手更快；Cloudflare 免费带宽不限、国内访问通常更稳。两个都免费，可以先 Netlify 试水再迁到 Cloudflare。

---

## 随时随地更新：把整条流水线搬到云端

仓库推到 GitHub 之后，站点就不绑在这台电脑上了。项目里已经带好
`.github/workflows/publish.yml`，**你每次 push，GitHub 会自动**：

```
取出代码 → 装 Node/Python/Pillow → 由 drafts 重新生成站点 → 自检(51 项) → 头图裁切检查 → 提交结果
```

GitHub Pages 感知到提交，自动重新发布。**整个过程不用你跑任何命令。**

### 在手机上发一篇新文章

1. 打开 GitHub 仓库网页（或 GitHub 手机 App）→ 进入 `drafts/` 目录
2. 点 **Add file → Create new file**，文件名用 `2026-10-18-某某.md`
3. 按现有草稿的格式写 front-matter 和正文 → 底部 **Commit changes**
4. 等约 1–2 分钟，Actions 跑完，文章就上线了

> 配图：在 GitHub 网页上进入 `images/<同名目录>/`，用 **Add file → Upload files** 上传，
> 再在草稿里用 `![](images/<目录>/xxx.jpg)` 引用。手机上操作略繁琐，图片多的文章建议还是用电脑。

### 两种方式对比

| | 本地跑命令 | 云端自动构建（推荐） |
|---|---|---|
| 换电脑/手机 | 要装 Node + Python + Pillow | 什么都不用装，有浏览器就行 |
| 发新文章 | 改 `js/data.js` 再手动部署 | 往 `drafts/` 丢一个 `.md`，push 即可 |
| 出错风险 | 命令敲错、环境不一致 | 每次都是干净的云端环境，结果可复现 |

### ⚠️ 启用云端构建后的一条重要变化

**`drafts/` 是唯一的内容源头**。CI 每次都会执行 `import-posts.js --replace`，
意思是「drafts 里有什么，站点就是什么」。所以：

- ✅ 正确做法：改 `drafts/*.md` → push
- ❌ 会被覆盖：直接编辑 `js/data.js`（下次构建时会被 drafts 重新生成的内容冲掉）

唯一的例外是 `js/data.js` 顶部的 `SITE` 配置（站名、作者、`SITE.url` 等）——
它在 `SITE` 区块里，不受 drafts 覆盖。改完 push，CI 会用新的 `SITE.url` 重新生成订阅源。

### 本地仍然要做的（跑不了云端的事）

- **批量导入旧文章**（`tools/import-wechat.js`）——需要本地处理原始素材
- **图片压缩 / 批量修图**（`tools/compress-images.py` 等）——107M 图片在仓库里，本地处理再 push 更省事
- **头图裁切修复**（`guard-cover-crop.py --fix`）——CI 里只告警不自动改，避免误伤

### 想让「头图裁切检查」变成硬闸门？

编辑 `.github/workflows/publish.yml`，删掉这两行即可（发现问题会让构建失败、阻止发布）：

```yaml
      - name: 头图裁切检查（告警）
        continue-on-error: true      # ← 删掉这一行
```

---

## 以后怎么更新文章（本地方式）

不走云端构建时，在本机跑：

```bash
node tools/import-posts.js --replace    # drafts → 站点数据
python tools/add-image-sizes.py --apply # 补图片尺寸
node tools/mark-reposts.js --apply      # 标转发
node tools/build-feed.js                # 刷新 feed.xml / sitemap.xml / robots.txt
node tools/verify.js                    # 自检
```

**第一次绑定域名后**，把 `js/data.js` 里的 `SITE.url` 改成你的域名，再跑一遍上面的命令——
否则订阅源里的文章链接还指向旧地址。

**Cloudflare Pages 更新方式**（二选一）：
- 手动：项目 → **Create new deployment** → 重新拖入文件
- 自动（推荐长期用）：把项目连到 GitHub 仓库，以后每次提交代码自动重新部署

---

## 上线后如何更新：三种改动，三条路

先记住一条：**`drafts/` 是内容源头，其余目录是产物**。CI 每次推送都会重新生成产物。

| 你想改什么 | 改哪个文件 | 会被 CI 覆盖吗 |
|---|---|---|
| 发布 / 修改文章 | `drafts/*.md` | 不会 —— 它就是源头 |
| 站名、副标题、简介、邮箱 | `js/data.js` 顶部 `SITE` 块 | 不会 —— SITE 块原样保留 |
| 站点地址 `url`、赞赏码 `donate`、公众号 `wechat` | 同上（SITE 块内） | 不会 |
| 样式、布局、交互 | `css/style.css`、`js/app.js`、`index.html`、`post.html`、`404.html` | 不会 |
| 构建工具本身 | `tools/*.js`、`tools/*.py`、`.github/workflows/publish.yml` | 不会 |
| ⚠️ **`js/data.js` 里的 `POSTS` 数组** | —— | **会** —— 下次构建被 drafts 重建 |
| ⚠️ `js/index-data.js`、`js/posts/*.js`、`js/search-text.js` | —— | **会** —— 由 `build-split.js` 生成 |
| ⚠️ `feed.xml`、`sitemap.xml`、`robots.txt` | —— | **会** —— 由 `build-feed.js` 生成 |

> 想改文章正文，请改 `drafts/` 里对应的 `.md`，**不要**直接改 `js/posts/*.js`，
> 否则下次推送就被冲掉了。

### 本机更新（命令行）

```bash
git add -A
git commit -m "一句话说明改了什么"
git pull --rebase     # 拉回 GitHub 自动生成过的提交，避免冲突
git push
```

`git pull --rebase` 建议每次都带上：CI 跑完有可能在远程多出一个
`chore: 重新生成站点 [skip ci]` 的提交。

### 网页端更新（不用命令行）

GitHub 仓库 → 找到要改的文件 → 右上角铅笔 **Edit** → 改完拉到最底 → **Commit changes**。
适合改一行配置、改一处样式，手机上也能操作。

### 多久生效

| 改的东西 | 生效时间 |
|---|---|
| HTML / CSS / JS | push 后**立刻**（Pages 直接读 main 分支根目录） |
| `drafts/*.md` 文章 | 等 Actions 跑完，**约 1–2 分钟** |

两个同时改的话，中间有一两分钟「新代码 + 旧数据」的过渡窗口，属正常。

### 看不到变化？

先 **Ctrl + F5** 硬刷新——浏览器会缓存 CSS/JS，普通刷新看不到改动。

### 改坏了怎么回滚

GitHub 仓库 → 文件右上 **History** 或仓库首页的提交记录 → 找到出事那次提交 → **Revert**。
站点是纯静态文件，回滚即恢复，不会留后遗症。

### 流水线是怎么串起来的（排查用）

```
import-posts.js --replace   ← 读 drafts/，重写 data.js 的 POSTS（保留 SITE）
   └─ 自动调用 build-all.js
        ├─ build-split.js → js/index-data.js、js/posts/*.js、js/search-text.js
        └─ build-feed.js  → feed.xml、sitemap.xml、robots.txt
add-image-sizes.py --apply   ← 补图片宽高
mark-reposts.js --apply      ← 标转发
verify.js                    ← 51 项自检
guard-cover-crop.py          ← 头图裁切检查（当前只告警）
```

---

## 常见问题

**Q：需要备案吗？**
不需要。域名解析到境外（Cloudflare/Netlify）不属于境内网站，无需 ICP 备案。只有解析到中国大陆境内服务器时才必须备案。

**Q：域名实名认证和 ICP 备案是一回事吗？**
不是。**实名认证**是域名层面的要求（境内注册商都要做，1–2 天）；**ICP 备案**是网站层面的（只在境内服务器时需要，1–3 周）。
走境内注册商买域名，你需要的是前者；**直接在 Cloudflare 注册则两个都不需要**。

**Q：Cloudflare 注册的域名，还需要实名或备案吗？**
都不需要。Cloudflare 是境外注册商，不要求实名认证；站点托管在 Cloudflare Pages（境外），也不触发 ICP 备案。
整条路唯一要等的就是 DNS 生效，通常几分钟。

**Q：Cloudflare 能注册 `.cn` 域名吗？**
不能。Cloudflare Registrar 只卖国际后缀（`.com` `.net` `.org` `.io` `.me` 等）。
想要 `.cn` 只能去境内注册商，那也就意味着必须实名认证。

**Q：国内访问快吗？**
Cloudflare 在中国大陆没有节点，访问会经过境外，速度一般但通常可用。若以后对国内速度有要求，再考虑迁回境内 + 备案。这也是为什么建议**先免备案快速上线，跑起来再说**。

**Q：要花多少钱？**
只有域名年费（约 30–90 元/年）。托管、HTTPS 证书、CDN 都是免费的。

**Q：这个域名以后能换吗？**
能。在 Cloudflare 里删掉旧的自定义域名、加上新的即可，站内文件不用动——
只需改一次 `js/data.js` 里的 `SITE.url` 并重跑 `node tools/build-feed.js`。

---

## 已经配好的东西

下面这些**站点里已经带上了**，不用额外做什么：

- `feed.xml` — RSS 2.0 订阅源（输出全文），首页与页脚都有可见入口
- `sitemap.xml` — 站点地图，自动列出全部文章
- `robots.txt` — 允许收录并指向站点地图
- 每个页面的 `<link rel="alternate" type="application/rss+xml">` — 让阅读器自动发现订阅源

另外，各页面的 `<link rel="canonical">`、分享用的 Open Graph / Twitter Card 地址，
都由 `js/app.js` 在打开页面时按 `SITE.url` 自动写好——**只要 `SITE.url` 改对了，这些就都对**，不用手动改。
