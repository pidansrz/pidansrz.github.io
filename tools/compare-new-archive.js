/* 比对「新合集 349 篇」与「博客现有草稿」的差异 —— 强化版归一化。
 * 解决 v1 的误判：零宽空格、【壹年侃】等栏目前缀、"旧文 ▏" 前缀，都会让同一篇被算成两篇。
 */
const fs = require("fs");
const path = require("path");

const ART_PATH = "D:/Program Files (x86)/workbuddy/2026-10-08-18-44-10/wechat-archive/word_build/articles.json";
const BLOG = path.resolve(__dirname, "..");

const ART = JSON.parse(fs.readFileSync(ART_PATH, "utf8"));
const ok = Object.values(ART).filter((v) => v.ok);

/* ---- 归一化：抹掉一切「不影响是不是同一篇」的差异 ---- */
/* 只认 Leslie 这些「尾部栏目/状态标记」，绝不砍标题中间的内容
 * （「粥爷|保卫你的记忆」的 | 是标题一部分；「xxx | 旧文」的才是标记）*/
const TAIL_MARK = /(?:[\s|｜▏丨]*(?:旧文新看|旧文|记者节旧文|观见|夜读|荐读|粥读|舟侃|粥爷|一周年|修订版|新版)\s*)+$/;

function norm(t) {
  let s = String(t || "")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")   // 零宽字符
    .replace(/^[【\[][^】\]]{1,6}[】\]]\s*/, "");    // 去掉【壹年侃】【夜读】等短栏目前缀
  s = s.replace(TAIL_MARK, "");                      // 只去掉尾部标记
  return s
    .replace(/[\s　]+/g, "")                         // 空白
    .replace(/[，。？！：；、,.""''()（）《》<>「」『』\[\]【】!?:\-—…·~～|｜]/g, "") // 标点
    .replace(/[A-Za-z0-9]/g, (c) => c.toLowerCase()); // 统一大小写
}

/* ---- 读现有草稿 ---- */
const draftsDir = path.join(BLOG, "drafts");
const existing = [];
for (const f of fs.readdirSync(draftsDir).filter((x) => x.endsWith(".md"))) {
  const raw = fs.readFileSync(path.join(draftsDir, f), "utf8");
  const body = raw.split(/^---\s*$/m).slice(2).join("\n---\n");
  existing.push({
    file: f,
    title: ((raw.match(/^title:\s*(.+)$/m) || [])[1] || "").trim(),
    date: ((raw.match(/^date:\s*(.+)$/m) || [])[1] || "").trim(),
    id: ((raw.match(/^id:\s*(.+)$/m) || [])[1] || "").trim(),
    body: body,
  });
}
const exMap = new Map();
for (const x of existing) {
  const n = norm(x.title);
  if (!exMap.has(n)) exMap.set(n, []);
  exMap.get(n).push(x);
}

console.log("现有草稿 " + existing.length + " 篇  |  合集成功稿件 " + ok.length + " 篇");

const inBoth = [];
const newOnly = [];
for (const v of ok) {
  const hit = exMap.get(norm(v.title));
  if (hit && hit.length) inBoth.push({ v, ex: hit[0] });
  else newOnly.push(v);
}
const matchedFiles = new Set(inBoth.map((x) => x.ex.file));
const notInNew = existing.filter((x) => !matchedFiles.has(x.file));

console.log("✓ 能对上（已存在于博客）  : " + inBoth.length);
console.log("＋ 合集中真正的新篇章      : " + newOnly.length);
console.log("－ 草稿里有但合集没抓到    : " + notInNew.length);

console.log("\n=== 草稿里有、但合集没抓到的（保留原样不动）===");
notInNew.forEach((x) => console.log("  " + x.date + "  " + x.title.slice(0, 42)));

/* ---- 日期是否一致 ---- */
console.log("\n=== 标题对上但日期不一致的 ===");
let dateDiff = 0;
for (const { v, ex } of inBoth) {
  const d1 = (v.date || "").slice(0, 10);
  const d2 = (ex.date || "").slice(0, 10);
  if (d1 && d2 && d1 !== d2) {
    dateDiff++;
    if (dateDiff <= 12) console.log("  合集 " + d1 + "  vs  博客 " + d2 + "  " + String(v.title).slice(0, 30));
  }
}
console.log("  合计 " + dateDiff + " 篇日期不一致");

/* ---- 正文长度对比（公平口径：都转成纯文字、剔除图片语法）---- */
function textLen(mdOrHtml) {
  let s = String(mdOrHtml || "");
  s = s.replace(/<[^>]+>/g, "");          // 去 HTML 标签
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ""); // 去 markdown 图片
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"); // 链接留文字
  s = s.replace(/[*`>#]/g, "");
  return s.replace(/\s+/g, "").length;
}
console.log("\n=== 已存在篇章：正文完整度对比（纯文字口径）===");
let nw = 0, ow = 0, eq = 0;
const diffs = [];
for (const { v, ex } of inBoth) {
  const a = textLen(v.body);
  const b = textLen(ex.body);
  const d = a - b;
  diffs.push({ d, a, b, v, ex });
  if (a > b * 1.08) nw++;
  else if (b > a * 1.08) ow++;
  else eq++;
}
console.log("  合集更长 " + nw + " 篇 | 博客现有更长 " + ow + " 篇 | 基本相当 " + eq + " 篇");
diffs.sort((x, y) => y.d - x.d);
console.log("  -- 合集明显更完整（差额最大前 8）--");
diffs.slice(0, 8).forEach((x) => console.log("    +" + x.d + "  新=" + x.a + " 旧=" + x.b + "  " + String(x.v.title).slice(0, 30)));
console.log("  -- 博客现有更完整（差额最大前 8）--");
diffs.slice(-8).forEach((x) => console.log("    " + x.d + "  新=" + x.a + " 旧=" + x.b + "  " + String(x.v.title).slice(0, 30)));

/* ---- 导出新增清单 ---- */
const list = newOnly.map((v) => ({
  seq: v.seq,
  title: (v.title || "").trim(),
  date: (v.date || "").trim(),
  author: (v.author || "").trim(),
  url: v.url,
  imgCount: v.img_count || 0,
  textLen: textLen(v.body),
  imgFiles: Object.entries(v.img_map || {}).map(([remote, local]) => ({ remote, local })),
}));
list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
fs.writeFileSync(path.join(__dirname, "_new-articles.json"), JSON.stringify(list, null, 1), "utf8");

console.log("\n=== 真正的新篇章 " + list.length + " 篇（按年份）===");
const byYear = {};
list.forEach((x) => { const y = (x.date || "?").slice(0, 4); byYear[y] = (byYear[y] || 0) + 1; });
console.log("  " + Object.entries(byYear).map(([y, c]) => y + ":" + c).join("  "));
console.log("  有图 " + list.filter((x) => x.imgCount > 0).length + " 篇，共 " +
  list.reduce((s, x) => s + x.imgCount, 0) + " 张；无图 " +
  list.filter((x) => x.imgCount === 0).length + " 篇");
console.log("\n清单已写入 tools/_new-articles.json");
