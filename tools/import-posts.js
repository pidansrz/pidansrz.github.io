#!/usr/bin/env node
/* ===========================================================
 * tools/import-posts.js — 把 drafts/ 里的 Markdown 批量导入 data.js
 *
 * 用法（在 personal-blog 目录下执行）：
 *     node tools/import-posts.js              # 导入（安全检查后写入）
 *     node tools/import-posts.js --dry-run    # 只预览，不写文件
 *     node tools/import-posts.js --replace    # drafts 即全部，清掉不在 drafts 里的旧文章
 *     node tools/import-posts.js --keep-existing  # 保留 data.js 中 drafts 里没有的文章
 *
 * 目录约定：drafts/*.md
 *   文件名建议：  2024-05-12-楼下那家修鞋摊.md   （日期在前，自动识别）
 *   也可用 front-matter 写日期：
 *       ---
 *       title: 楼下那家修鞋摊
 *       date: 2024-05-12
 *       excerpt: 一句话摘要（不写则自动取正文开头）
 *       cover: images/xxx.jpg        （不写则自动找 images/ 里的同名图片）
 *       coverAlt: 图片说明
 *       id: shoe-repair-stall        （不写则按文件名生成）
 *       draft: true                  （true 则跳过，不导入）
 *       ---
 *
 * 忽略规则：以 _ 开头的文件、README.md 不导入。
 * 图片自动关联：images/ 里若存在与文件名同名的图片，自动填为头图。
 *
 * 零依赖，只用 Node 内置模块。
 * =========================================================== */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DRAFTS = path.join(ROOT, "drafts");
const IMAGES = path.join(ROOT, "images");
const DATA = path.join(ROOT, "js", "data.js");

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const REPLACE = argv.includes("--replace");
const KEEP = argv.includes("--keep-existing");

/* ---------- 工具 ---------- */
/* Markdown 转换与转义已抽到 tools/md.js（荐读 links/ 复用同一套实现） */
const { esc, escAttr, pad, splitFrontMatter, inline, mdToHtml, makeExcerpt } = require("./md.js");

/* ---------- 生成 id ---------- */
function slugFromName(base) {
  // 去掉开头的日期前缀 2024-05-12- / 20240512-
  let s = base.replace(/^\d{4}-\d{2}-\d{2}[-_\s]*/, "")
              .replace(/^\d{8}[-_\s]*/, "");
  s = s.trim().replace(/\s+/g, "-")
       .replace(/[\\/:*?"<>|#\[\]]/g, "")
       .replace(/-{2,}/g, "-")
       .replace(/^-|-$/g, "");
  return s;
}

/* ---------- 自动找同名图片 ---------- */
function findCover(base, fileBase) {
  const exts = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
  const candidates = [base, fileBase].filter(Boolean);
  for (const c of candidates) {
    for (const e of exts) {
      if (fs.existsSync(path.join(IMAGES, c + e))) return "images/" + c + e;
      if (fs.existsSync(path.join(IMAGES, c + e.toUpperCase()))) return "images/" + c + e.toUpperCase();
    }
  }
  return "";
}

/* ---------- 读取现有 data.js ---------- */
function readData() {
  const src = fs.readFileSync(DATA, "utf8");
  const api = new Function(src + "\n;return { SITE: SITE, POSTS: POSTS };")();
  return { src: src, SITE: api.SITE, POSTS: api.POSTS || [] };
}

/* ---------- 主流程 ---------- */
if (!fs.existsSync(DRAFTS)) {
  console.error("✗ 找不到 drafts/ 目录。请在 personal-blog 下新建 drafts 文件夹，把 .md 文章放进去。");
  process.exit(1);
}

const files = fs.readdirSync(DRAFTS).filter(function (f) {
  return /\.md$/i.test(f) && !/^_/.test(f) && f.toLowerCase() !== "readme.md";
});

if (!files.length) {
  const anyMd = fs.existsSync(DRAFTS) && fs.readdirSync(DRAFTS).some(function (f) { return /\.md$/i.test(f); });
  console.error("✗ drafts/ 里没有可导入的 .md 文件。");
  if (anyMd) {
    console.error("  （目录里有 .md，但都是被忽略的：README.md，以及以 _ 开头的文件）");
    console.error("  复制 _模板.md 改成正式文件名，例如 2024-05-12-文章标题.md");
  } else {
    console.error("  把你的文章放进 drafts/，一篇一个 .md，文件名建议日期开头：2024-05-12-文章标题.md");
  }
  process.exit(1);
}

const parsed = [];
const problems = [];
const guessedDates = [];
const cnIds = [];

files.forEach(function (f) {
  const full = path.join(DRAFTS, f);
  const src = fs.readFileSync(full, "utf8");
  const { meta, body } = splitFrontMatter(src);
  const base = path.basename(f, path.extname(f));

  if (meta.draft === true) {
    problems.push("跳过（draft: true）  " + f);
    return;
  }

  // 日期：front-matter 优先，其次文件名前缀，最后用文件修改时间
  let date = String(meta.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(base) || /^(\d{4})(\d{2})(\d{2})/.exec(base);
    if (m) date = m[1] + "-" + m[2] + "-" + m[3];
  }
  let dateFromMtime = false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const st = fs.statSync(full);
    date = st.mtime.getFullYear() + "-" + pad(st.mtime.getMonth() + 1) + "-" + pad(st.mtime.getDate());
    dateFromMtime = true;
    guessedDates.push({ file: f, date: date });
  }

  const slug = slugFromName(base);
  const id = String(meta.id || "").trim() || slug || base;
  const title = String(meta.title || "").trim() || slug || base;
  const html = mdToHtml(body).trim();

  // 公众号的「图片消息」本身只有一张图，没有文字正文。
  // 这类稿件的图已经作为头图呈现，正文为空是正常形态，不能因此丢弃。
  const hasCover = !!String(meta.cover || "").trim();
  if (!html && !hasCover) {
    problems.push("正文为空且无头图，跳过  " + f);
    return;
  }

  if (!/^[A-Za-z0-9_-]+$/.test(id)) cnIds.push(f + "  →  " + id);

  const cover = String(meta.cover || "").trim() || findCover(slug, base);

  parsed.push({
    id: id,
    title: title,
    date: date,
    excerpt: String(meta.excerpt || "").trim() || makeExcerpt(html),
    cover: cover,
    coverAlt: String(meta.coverAlt || "").trim() || title,
    content: html
  });
});

if (!parsed.length) {
  console.error("✗ 没有解析出任何文章。");
  process.exit(1);
}

// 按日期倒序；同一天按标题稳定排序
parsed.sort(function (a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.title.localeCompare(b.title, "zh");
});

// id 去重
const seen = {};
parsed.forEach(function (p) {
  if (seen[p.id]) {
    const n = (seen[p.id] += 1);
    problems.push("id 重复，自动加后缀  " + p.id + " → " + p.id + "-" + n);
    p.id = p.id + "-" + n;
  } else seen[p.id] = 1;
});

/* ---------- 与现有 data.js 的差异检查 ---------- */
let existing = [];
let dataSrc = "";
try {
  const cur = readData();
  existing = cur.POSTS;
  dataSrc = cur.src;
} catch (err) {
  console.error("✗ 读取 js/data.js 失败：" + err.message);
  process.exit(1);
}

const draftIds = {};
parsed.forEach(function (p) { draftIds[p.id] = 1; });
const orphans = existing.filter(function (p) { return !draftIds[p.id]; });

if (orphans.length && !REPLACE && !KEEP) {
  console.log("⚠ js/data.js 里有 " + orphans.length + " 篇文章不在 drafts/ 中：");
  orphans.forEach(function (p) { console.log("    - " + p.date + "  " + p.title + "  (id: " + p.id + ")"); });
  console.log("");
  console.log("请选择一种方式重跑：");
  console.log("   node tools/import-posts.js --replace         用 drafts 覆盖（上面这些会被删除，示例文章就是这么清掉的）");
  console.log("   node tools/import-posts.js --keep-existing   保留它们，与 drafts 里的合并");
  process.exit(1);
}

let finalPosts = parsed;
if (KEEP && orphans.length) {
  finalPosts = parsed.concat(orphans).sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return String(a.title).localeCompare(String(b.title), "zh");
  });
}

/* ---------- 生成 POSTS 区块 ---------- */
function jsQuote(s) {
  return JSON.stringify(String(s == null ? "" : s));
}
function postBlock(p) {
  return [
    "  {",
    "    id: " + jsQuote(p.id) + ",",
    "    title: " + jsQuote(p.title) + ",",
    "    date: " + jsQuote(p.date) + ",",
    "    excerpt: " + jsQuote(p.excerpt) + ",",
    "    cover: " + jsQuote(p.cover || "") + ",",
    "    coverAlt: " + jsQuote(p.coverAlt || "") + ",",
    "    content: `",
    p.content
      .replace(/`/g, "\\`")
      .replace(/\$\{/g, "\\${")
      .split("\n")
      .map(function (l) { return l ? "      " + l : ""; })
      .join("\n"),
    "    `",
    "  }"
  ].join("\n");
}

const block = "const POSTS = [\n" + finalPosts.map(postBlock).join(",\n") + "\n];";

/* ---------- 汇报 ---------- */
console.log("=== 导入预览 ===");
console.log("drafts/ 解析出 " + parsed.length + " 篇" + (KEEP && orphans.length ? "，保留旧文 " + orphans.length + " 篇" : "") + "，合计 " + finalPosts.length + " 篇");
console.log("");

const byYear = {};
finalPosts.forEach(function (p) {
  const y = p.date.slice(0, 4);
  byYear[y] = (byYear[y] || 0) + 1;
});
Object.keys(byYear).sort().reverse().forEach(function (y) {
  console.log("  " + y + " 年   " + byYear[y] + " 篇");
});
console.log("");
console.log("最近 5 篇：");
finalPosts.slice(0, 5).forEach(function (p) {
  console.log("  " + p.date + "  " + p.title + "   [" + p.id + "]" + (p.cover ? "  图: " + p.cover : ""));
});

if (problems.length) {
  console.log("");
  console.log("=== 提示 ===");
  problems.forEach(function (m) { console.log("  · " + m); });
}

if (guessedDates.length) {
  console.log("");
  console.log("=== ⚠ 有 " + guessedDates.length + " 篇没有可靠日期，用了「文件修改时间」===");
  console.log("  整理旧文章时文件的修改时间通常都是今天，年份分组会不准。");
  console.log("  建议：把日期写进文件名开头（2024-05-12-xxx.md），或在文件头写 date: 2024-05-12");
  guessedDates.slice(0, 10).forEach(function (g) { console.log("    " + g.file + "  →  " + g.date); });
  if (guessedDates.length > 10) console.log("    …… 其余 " + (guessedDates.length - 10) + " 篇略");
}

if (cnIds.length) {
  console.log("");
  console.log("=== 提示：有 " + cnIds.length + " 篇用了中文 id ===");
  console.log("  能用，但分享出去的链接会很长（中文被编码成一串 %）。");
  console.log("  想让链接更短，在文件头加一行 id: your-english-id");
  cnIds.slice(0, 10).forEach(function (m) { console.log("    " + m); });
  if (cnIds.length > 10) console.log("    …… 其余 " + (cnIds.length - 10) + " 篇略");
}

if (DRY) {
  console.log("");
  console.log("--dry-run：未写入任何文件。");
  process.exit(0);
}

/* ---------- 写入 ---------- */
const re = /const POSTS = \[[\s\S]*?\n\];/;
if (!re.test(dataSrc)) {
  console.error("✗ 没在 js/data.js 里找到 `const POSTS = [ ... ];` 区块，为安全起见未做修改。");
  process.exit(1);
}

const backup = path.join(ROOT, "js", "data.backup.js");
fs.writeFileSync(backup, dataSrc, "utf8");

const next = dataSrc.replace(re, block);
fs.writeFileSync(DATA, next, "utf8");

// 回读校验
try {
  const check = new Function(next + "\n;return { POSTS: POSTS };")();
  if (!Array.isArray(check.POSTS) || check.POSTS.length !== finalPosts.length) {
    throw new Error("回读数量不符");
  }
} catch (err) {
  fs.writeFileSync(DATA, dataSrc, "utf8");
  console.error("✗ 写入后校验失败，已还原原文件：" + err.message);
  process.exit(1);
}

console.log("");
console.log("✓ js/data.js  已更新（" + finalPosts.length + " 篇，按日期倒序）");
console.log("✓ 原文件已备份到 js/data.backup.js");
console.log("");
console.log("下一步：重新生成订阅源与站点地图");
console.log("   node tools/build-feed.js");

// 数据变了，自动重建派生文件（index-data.js / posts / search-text / feed）
try {
  require('child_process').execFileSync(process.execPath,
    [require('path').join(__dirname, 'build-all.js')], { stdio: 'inherit' });
} catch (e) {
  console.warn('⚠ 自动重建失败，请手动执行：node tools/build-all.js');
}
