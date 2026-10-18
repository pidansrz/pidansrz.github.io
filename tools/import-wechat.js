#!/usr/bin/env node
/* ===========================================================
 * tools/import-wechat.js — 把公众号归档（Hugo 格式）转成 drafts/
 *
 * 用法：
 *   node tools/import-wechat.js <归档目录>
 *   例：node tools/import-wechat.js "D:/.../wechat-archive/blog-output"
 *
 * 归档目录需要包含：
 *   content/posts/*.md      文章（Hugo front-matter）
 *   static/images/<slug>/   配图
 *
 * 做什么：
 *   1. 把配图复制到 images/<slug>/（本博客用相对路径）
 *   2. 把每篇文章转成 drafts/ 里的干净 Markdown：
 *      - Hugo front-matter → 本站 front-matter（date 取日期部分、description → excerpt）
 *      - 提取头图（cover.jpg，没有就用正文第一张图）
 *      - 删掉开头的公众号引导语「全世界只有不到…你真是个特别的人」
 *      - 删掉文末的「往期文章」微信链接区、入群引导、二维码、原文注释
 *      - 正文里的图片路径 /images/ → images/
 *      - 空 alt 的图片补上文章标题
 *   3. 报告每篇的清理情况，供人工抽查
 *
 * 跑完之后再执行：
 *   node tools/import-posts.js --replace
 *   node tools/build-feed.js
 *
 * 零依赖，只用 Node 内置模块。原始归档不会被修改。
 * =========================================================== */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DRAFTS = path.join(ROOT, "drafts");
const IMAGES = path.join(ROOT, "images");

const SRC = process.argv[2];
if (!SRC) {
  console.error("用法：node tools/import-wechat.js <归档目录>");
  console.error('例：node tools/import-wechat.js "../wechat-archive/blog-output"');
  process.exit(1);
}
const POSTS_DIR = path.join(SRC, "content", "posts");
const SRC_IMAGES = path.join(SRC, "static", "images");
if (!fs.existsSync(POSTS_DIR)) { console.error("✗ 找不到 " + POSTS_DIR); process.exit(1); }

/* ---------- front-matter（Hugo）---------- */
function splitFM(src) {
  src = String(src).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!/^---\s*\n/.test(src)) return { meta: {}, body: src };
  const end = src.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: src };
  const head = src.slice(3, end);
  const body = src.slice(src.indexOf("\n", end + 1) + 1);
  const meta = {};
  head.split("\n").forEach(function (line) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!m) return;
    let v = m[2].trim().replace(/^["']|["']$/g, "");
    if (v === "true") v = true; else if (v === "false") v = false;
    meta[m[1]] = v;
  });
  return { meta: meta, body: body };
}

/* ---------- 尾部噪声判定 ---------- */
const TAIL_KEYWORDS = [
  "往期文章", "往期推荐", "往期精彩", "推荐阅读", "相关阅读", "延伸阅读",
  "阅读原文", "原文链接", "扫码", "长按", "二维码", "识别图中", "识别二维码",
  "关注我", "关注我们", "点击上方", "点击蓝字", "点击关注", "星标", "置顶",
  "加入我们", "入群", "备注", "戳这里", "戳上方", "投稿", "商务合作",
  "加微信", "个人微信", "朋友圈", "分享到", "点赞", "在看",
  // 以下为公众号文末常见的运营话术
  "公号", "公众号", "失联", "走失", "互动群", "读者群", "交流群", "被封",
  "正式成立", "欢迎加入", "一起了解", "转载请", "版权", "著作权", "侵权",
  "联系我", "联系方式", "防失联", "防走失", "新世界", "声明", "免责",
  // 注意：不要加单字「关注」「群」等，会误伤正文（作者常写「关注弱势群体」这类句子）
  "欢迎关注", "更多文章", "更多精彩", "精彩推荐", "推荐关注", "长按关注",
  "扫码关注", "点击关注", "记得点", "记得星标", "设为星标", "设为置顶",
  "你还可以看", "还可以看", "回复关键词", "获取文章", "已被404", "已404",
  "查看历史", "历史文章", "全部文章", "文章列表"
];
function isNoiseLine(line) {
  const t = line.trim();
  if (!t) return true;                                   // 空行
  if (/^<!--/.test(t) || /-->$/.test(t) || /<!--/.test(t)) return true;  // HTML 注释
  if (/^!\[[^\]]*\]\([^)]*\)\s*$/.test(t)) return true;  // 纯图片行
  if (/mp\.weixin\.qq\.com/.test(t)) return true;        // 微信链接
  if (/^#\s/.test(t) && /\[.*\]\(/.test(t)) return true; // "# [标题](链接)" 形如往期文章
  if (/^\[.*\]\(<https?:\/\//.test(t)) return true;      // 纯链接行
  if (/^[#*_•·=~\s\-]+$/.test(t)) return true;           // 纯符号行（**、****、#、--- 等）
  if (TAIL_KEYWORDS.some(function (k) { return t.indexOf(k) !== -1; })) return true;
  return false;
}

/* ---------- 正文清理 ---------- */
function cleanBody(raw, title) {
  let lines = String(raw).replace(/\r\n/g, "\n").split("\n");
  const notes = [];

  // 1) 删除头图行（cover 已单独提取为 cover 字段，正文里不再重复）
  const before = lines.length;
  lines = lines.filter(function (l) {
    return !/^!\[cover\]\(/i.test(l.trim());
  });
  if (lines.length !== before) notes.push("移除正文头图行");

  // 2) 删除开头引导语（公众号头部关注提示），只在前 14 行内找
  const headScan = Math.min(14, lines.length);
  let cut = -1;
  for (let i = 0; i < headScan; i++) {
    const t = lines[i].trim();
    if (/你真是个特别的人/.test(t) || /关注了皮蛋瘦肉舟/.test(t) || /^全世界只有不到/.test(t)) {
      cut = i;
    }
  }
  if (cut !== -1) {
    // 引导语后面可能还跟着一张装饰图，一并去掉
    let end = cut + 1;
    while (end < lines.length && end < cut + 4 &&
           (lines[end].trim() === "" || /^!\[[^\]]*\]\([^)]*\)\s*$/.test(lines[end].trim()))) end++;
    lines = lines.slice(end);
    notes.push("移除开头引导语");
  }

  // 3) 先做「区块截断」：找到推荐阅读类区块的标题行，从那里一刀切到末尾
  //     （比逐行判断可靠——区块里的条目说明文字没有固定关键词）
  const BLOCK_RE = /^[#*\s]*(往期文章|往期推荐|往期精彩|你还可以看|还可以看|推荐阅读|推荐文章|相关阅读|延伸阅读|更多文章|更多精彩|精彩推荐|历史文章|全部文章|文章列表|推荐关注|往期回顾)\s*[：:!！]?\s*[#*\s]*$/;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t && BLOCK_RE.test(t)) {
      lines = lines.slice(0, i);
      notes.push("截断「" + t + "」区块");
      break;
    }
  }

  // 4) 删除文末噪声：从后往前，遇到噪声行就删，遇到正文行就停
  let tailRemoved = 0;
  while (lines.length) {
    const last = lines[lines.length - 1];
    if (!isNoiseLine(last)) break;
    lines.pop();
    tailRemoved++;
  }
  // 尾部可能残留若干空行
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  if (tailRemoved) notes.push("移除文末噪声 " + tailRemoved + " 行");

  // 4) 图片路径：Hugo 的 /images/ → 本站相对路径 images/
  let body = lines.join("\n");
  body = body.replace(/\]\(\/images\//g, "](images/");
  // 5) 空 alt 补上标题
  body = body.replace(/!\[\]\((images\/[^)]+)\)/g, function (_, p) {
    return "![" + title.replace(/[[\]]/g, "") + "](" + p + ")";
  });
  // 6) 行尾两个空格（Markdown 硬换行）无意义，清掉
  body = body.replace(/ {2,}$/gm, "");
  // 7) 连续 3 个以上空行压成 2 个
  body = body.replace(/\n{3,}/g, "\n\n");

  return { body: body.trim(), notes: notes };
}

/* ---------- 找头图 ----------
 * 返回 { cover, dup }：dup 是正文里需要删掉的重复图片（原文整行）
 * 只在「没有 cover.jpg、改用正文首图」时才需要删，避免详情页头图和正文首图重复。
 */
function pickCover(body, slug) {
  const exts = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
  for (const e of exts) {
    for (const base of [path.join(SRC_IMAGES, slug, "cover" + e),
                        path.join(IMAGES, slug, "cover" + e)]) {
      if (fs.existsSync(base)) return { cover: "images/" + slug + "/cover" + e, dup: null };
    }
  }
  const m = /!\[[^\]]*\]\((images\/[^)]+)\)/.exec(body);
  if (m) return { cover: m[1], dup: m[0] };
  return { cover: "", dup: null };
}

/* ---------- 主流程 ---------- */
if (!fs.existsSync(DRAFTS)) fs.mkdirSync(DRAFTS, { recursive: true });
if (!fs.existsSync(IMAGES)) fs.mkdirSync(IMAGES, { recursive: true });

// 1) 复制配图
let imgCount = 0, imgBytes = 0;
if (fs.existsSync(SRC_IMAGES)) {
  fs.readdirSync(SRC_IMAGES).forEach(function (slug) {
    const from = path.join(SRC_IMAGES, slug);
    if (!fs.statSync(from).isDirectory()) return;
    const to = path.join(IMAGES, slug);
    if (!fs.existsSync(to)) fs.mkdirSync(to, { recursive: true });
    fs.readdirSync(from).forEach(function (f) {
      const sf = path.join(from, f), tf = path.join(to, f);
      if (fs.existsSync(tf)) return;           // 已存在就跳过，避免重复拷贝
      fs.copyFileSync(sf, tf);
      imgCount++; imgBytes += fs.statSync(sf).size;
    });
  });
}

// 2) 转换文章
const files = fs.readdirSync(POSTS_DIR).filter(function (f) { return /\.md$/i.test(f); });
const report = [];
let warn = 0;

files.forEach(function (f) {
  const raw = fs.readFileSync(path.join(POSTS_DIR, f), "utf8");
  const { meta, body: rawBody } = splitFM(raw);
  const id = f.replace(/\.md$/i, "");
  const slug = id;

  const date = String(meta.date || "").slice(0, 10);
  const title = String(meta.title || "").trim() || slug;
  const excerpt = String(meta.description || "").trim();

  const cleaned = cleanBody(rawBody, title);
  const notes = cleaned.notes;
  let body = cleaned.body;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    notes.push("⚠ 日期缺失：" + (meta.date || "(空)"));
    warn++;
  }
  if (!body) { notes.push("⚠ 正文为空"); warn++; }

  // 头图：没有 cover.jpg 时取正文首图，并把正文里那张删掉，避免重复
  const picked = pickCover(body, slug);
  let cover = picked.cover;
  if (picked.dup) {
    let b = body;
    b = b.split("\n").filter(function (l) { return l.trim() !== picked.dup.trim(); }).join("\n");
    b = b.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").trim();
    if (b !== body) { notes.push("正文首图已提为头图（去重）"); body = b; }
  }

  const fm = [
    "---",
    "title: " + title,
    "date: " + date,
    "excerpt: " + excerpt,
    "cover: " + cover,
    "coverAlt: " + title,
    "id: " + id,
    "---"
  ].join("\n");

  fs.writeFileSync(path.join(DRAFTS, f), fm + "\n\n" + body + "\n", "utf8");
  report.push({ id: id, date: date, title: title, cover: cover,
                len: body.length, notes: notes });
});

/* ---------- 报告 ---------- */
report.sort(function (a, b) { return a.date < b.date ? 1 : -1; });

console.log("=== 转换完成 ===");
console.log("文章 " + report.length + " 篇  →  drafts/");
console.log("配图 " + imgCount + " 张  →  images/（" + (imgBytes / 1048576).toFixed(1) + " MB，已存在的会跳过）");
console.log("");

const byYear = {};
report.forEach(function (r) { const y = r.date.slice(0, 4); byYear[y] = (byYear[y] || 0) + 1; });
Object.keys(byYear).sort().reverse().forEach(function (y) {
  console.log("  " + y + " 年   " + byYear[y] + " 篇");
});

const noCover = report.filter(function (r) { return !r.cover; });
console.log("");
console.log("无头图 " + noCover.length + " 篇（将显示占位封面）");
const short = report.filter(function (r) { return r.len < 200; });
if (short.length) {
  console.log("");
  console.log("⚠ 正文偏短（<200 字）" + short.length + " 篇，建议抽查：");
  short.slice(0, 12).forEach(function (r) { console.log("   " + r.date + "  " + r.title + "  (" + r.len + " 字)"); });
}

if (warn) {
  console.log("");
  console.log("⚠ 有 " + warn + " 处需要人工确认：");
  report.filter(function (r) { return r.notes.some(function (n) { return n.indexOf("⚠") === 0; }); })
    .forEach(function (r) { console.log("   " + r.id + "  →  " + r.notes.join("；")); });
}

/* ---------- 残留扫描：仍带微信链接的，可能是正文引用，也可能是没清干净的区块 ---------- */
const stillLinked = report.filter(function (r) {
  const p = path.join(DRAFTS, r.id + ".md");
  return fs.existsSync(p) && /mp\.weixin\.qq\.com/.test(fs.readFileSync(p, "utf8"));
});
if (stillLinked.length) {
  console.log("");
  console.log("=== 仍含 mp.weixin.qq.com 链接 " + stillLinked.length + " 篇 ===");
  console.log("  多半是正文里引用了原文/他人文章（属正常），也可能是没清干净的尾部区块。建议抽查：");
  stillLinked.slice(0, 15).forEach(function (r) { console.log("   " + r.date + "  " + r.title); });
  if (stillLinked.length > 15) console.log("   …… 其余 " + (stillLinked.length - 15) + " 篇略");
}

console.log("");
console.log("下一步：");
console.log("  node tools/import-posts.js --dry-run     先看年份分组对不对");
console.log("  node tools/import-posts.js --replace     正式导入");
console.log("  node tools/build-feed.js                生成订阅源");
