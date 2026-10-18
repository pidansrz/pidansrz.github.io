/* 比对新包 md_posts（416 篇）与博客现有草稿（182 篇） */
const fs = require("fs");
const path = require("path");
const BLOG = path.resolve(__dirname, "..");

const inc = JSON.parse(fs.readFileSync(path.join(__dirname, "_incoming.json"), "utf8"));

const TAIL = /(?:[\s|｜▏丨]*(?:旧文新看|旧文|记者节旧文|观见|夜读|荐读|粥读|舟侃|粥爷)\s*)+$/;
function norm(t) {
  let s = String(t || "")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
    .replace(/^[【\[][^】\]]{1,6}[】\]]\s*/, "");
  s = s.replace(TAIL, "");
  return s.replace(/[\s　]+/g, "")
    .replace(/[，。？！：；、,.""''()（）《》<>「」『』\[\]【】!?:\-—…·~～|｜]/g, "")
    .replace(/[A-Za-z0-9]/g, (c) => c.toLowerCase());
}

const draftsDir = path.join(BLOG, "drafts");
const ex = [];
for (const f of fs.readdirSync(draftsDir).filter((x) => x.endsWith(".md"))) {
  const raw = fs.readFileSync(path.join(draftsDir, f), "utf8");
  const body = raw.split(/^---\s*$/m).slice(2).join("\n---\n");
  ex.push({
    file: f,
    title: ((raw.match(/^title:\s*(.+)$/m) || [])[1] || "").trim(),
    date: ((raw.match(/^date:\s*(.+)$/m) || [])[1] || "").trim(),
    len: body.replace(/\s+/g, "").length,
    imgs: (body.match(/!\[[^\]]*\]\([^)]*\)/g) || []).length,
  });
}
const exByTitle = new Map();
ex.forEach((x) => {
  const k = norm(x.title);
  if (!exByTitle.has(k)) exByTitle.set(k, []);
  exByTitle.get(k).push(x);
});

const incByTitle = new Map();
inc.forEach((r) => {
  const k = norm(r.title);
  if (!incByTitle.has(k)) incByTitle.set(k, []);
  incByTitle.get(k).push(r);
});

console.log("博客现有草稿 " + ex.length + " 篇　|　新包 " + inc.length + " 篇\n");

const covered = [];
const brandNew = [];
for (const r of inc) {
  if (exByTitle.has(norm(r.title))) covered.push(r);
  else brandNew.push(r);
}
const orphan = ex.filter((x) => !incByTitle.has(norm(x.title)));

console.log("✓ 新包中博客已有      : " + covered.length + " 篇");
console.log("＋ 新包中博客还没有    : " + brandNew.length + " 篇");
console.log("－ 博客有但新包没有    : " + orphan.length + " 篇");
console.log("\n--- 博客有、新包没有（若整体替换，这些要靠旧草稿兜底或删除）---");
orphan.forEach((x) => console.log("   " + x.date + "  " + x.title.slice(0, 44) + "  (正文" + x.len + "字/图" + x.imgs + ")"));

console.log("\n--- 新篇章年份分布 ---");
const y = {};
brandNew.forEach((r) => { const k = (r.date || "?").slice(0, 4); y[k] = (y[k] || 0) + 1; });
console.log("  " + Object.entries(y).sort().map(([a, b]) => a + ":" + b).join("  "));
console.log("  其中无图 " + brandNew.filter((r) => r.imgs.length === 0).length + " 篇，有图 " +
  brandNew.filter((r) => r.imgs.length > 0).length + " 篇");

// 已存在的篇章：新包是否更完整
console.log("\n--- 已有篇章：正文长度对比（新包纯文字 vs 博客草稿纯文字）---");
function textLenMd(md) {
  return String(md || "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/[*`#>]/g, "")
    .replace(/\s+/g, "").length;
}
let incBigger = 0, blogBigger = 0, same = 0;
const rows = [];
for (const r of covered) {
  const hits = exByTitle.get(norm(r.title));
  const exx = hits[0];
  const a = textLenMd(fs.readFileSync(path.join(process.env.INCOMING, r.file), "utf8").replace(/^---[\s\S]*?\n---/, ""));
  const b = exx.len;
  rows.push({ a, b, r, exx });
  if (a > b * 1.08) incBigger++;
  else if (b > a * 1.08) blogBigger++;
  else same++;
}
console.log("  新包更长 " + incBigger + " 篇 | 博客更长 " + blogBigger + " 篇 | 差不多 " + same + " 篇");
rows.sort((x, y2) => (y2.a - y2.b) - (x.a - x.b));
console.log("  新包明显更完整（前 6）:");
rows.slice(0, 6).forEach((x) => console.log("    +" + (x.a - x.b) + "  新=" + x.a + " 旧=" + x.b + "  " + x.r.title.slice(0, 30)));
console.log("  博客明显更完整（前 6）:");
rows.slice(-6).forEach((x) => console.log("    " + (x.a - x.b) + "  新=" + x.a + " 旧=" + x.b + "  " + x.r.title.slice(0, 30)));

fs.writeFileSync(path.join(__dirname, "_incoming-new.json"), JSON.stringify(brandNew, null, 1), "utf8");
console.log("\n新篇章清单已写 tools/_incoming-new.json");
