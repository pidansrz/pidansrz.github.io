/* 句子级比对：确认「新合集更长」到底是不是真内容差，还是只是微信页脚套话。 */
const fs = require("fs");
const path = require("path");

const ART_PATH = "D:/Program Files (x86)/workbuddy/2026-10-08-18-44-10/wechat-archive/word_build/articles.json";
const BLOG = path.resolve(__dirname, "..");
const ART = JSON.parse(fs.readFileSync(ART_PATH, "utf8"));
const ok = Object.values(ART).filter((v) => v.ok);

const TAIL_MARK = /(?:[\s|｜▏丨]*(?:旧文新看|旧文|记者节旧文|观见|夜读|荐读|粥读|舟侃|粥爷)\s*)+$/;
function norm(t) {
  let s = String(t || "").replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "").replace(/^[【\[][^】\]]{1,6}[】\]]\s*/, "");
  s = s.replace(TAIL_MARK, "");
  return s.replace(/[\s　]+/g, "")
    .replace(/[，。？！：；、,.""''()（）《》<>「」『』\[\]【】!?:\-—…·~～|｜]/g, "")
    .replace(/[A-Za-z0-9]/g, (c) => c.toLowerCase());
}

/* --- 微信模板套话（句子级整句剔除）--- */
const JUNK_SENT = [
  /全世界只有不到[\d.]+%的人关注/,
  /^你真是个特别的人?$/,
  /^记得点[“"]?在看[”"]?/,
  /别忘了把公号加星标/,
  /欢迎关注留言参与讨论/,
  /所有留言[，,]?我都会一一回复/,
  /^往期文章$/,
  /^阅读原文$/,
  /轻点两下取消/,
  /微信扫一扫/,
  /长按识别二维码/,
  /点击上方.*关注/,
  /^预览时标签不可点$/,
  /^内容来自/,
  /^—\s*[Ee]nd\s*—$/,
  /^文\s*[／/]\s*\S{1,8}$/,
  /^\(?图片来源/,
  /^\(?本文为/,
  /^声明[:：]/,
  /^版权归/,
  /^编辑\s*[｜|]/,
  /^排版\s*[｜|]/,
  /^责编\s*[｜|]/,
  /^审校\s*[｜|]/,
  /^投稿邮箱/,
];

function toText(htmlOrMd) {
  let s = String(htmlOrMd || "");
  s = s.replace(/<[^>]+>/g, "\n");
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(/[*`#>]/g, "");
  return s;
}

function sentences(text) {
  const raw = toText(text)
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .split(/[\n。！？；!?;]+/)
    .map((x) => x.replace(/[\s　]+/g, "").trim())
    .filter((x) => x.length >= 6);
  return raw.filter((s) => !JUNK_SENT.some((re) => re.test(s)));
}

/* 现有草稿 */
const draftsDir = path.join(BLOG, "drafts");
const existing = [];
for (const f of fs.readdirSync(draftsDir).filter((x) => x.endsWith(".md"))) {
  const raw = fs.readFileSync(path.join(draftsDir, f), "utf8");
  existing.push({
    file: f,
    title: ((raw.match(/^title:\s*(.+)$/m) || [])[1] || "").trim(),
    date: ((raw.match(/^date:\s*(.+)$/m) || [])[1] || "").trim(),
    body: raw.split(/^---\s*$/m).slice(2).join("\n---\n"),
  });
}
const exTitles = new Set(existing.map((x) => norm(x.title)));

let totalMissing = 0;
const cases = [];
for (const v of ok) {
  if (!exTitles.has(norm(v.title))) continue;             // 只看已存在的
  const hits = existing.filter((x) => norm(x.title) === norm(v.title));
  const ex = hits[0];
  const newS = new Set(sentences(v.body));
  const oldS = new Set(sentences(ex.body));
  const missing = [...newS].filter((s) => !oldS.has(s));   // 新版有、旧版没
  const extra = [...oldS].filter((s) => !newS.has(s));     // 旧版有、新版没
  if (missing.length) {
    cases.push({ v, ex, missing, extra });
    totalMissing += missing.length;
  }
}

console.log("已存在的篇章中，" + cases.length + " 篇存在「新版有而博客没有」的句子（共 " + totalMissing + " 句）\n");
cases.sort((a, b) => b.missing.length - a.missing.length);
console.log("=== 缺失句子最多的 6 篇，看缺失内容是什么 ===");
for (const c of cases.slice(0, 6)) {
  console.log("\n--- 《" + c.v.title.slice(0, 30) + "》 缺 " + c.missing.length + " 句 ---");
  c.missing.slice(0, 6).forEach((s) => console.log("    " + s.slice(0, 74)));
}

// 统计：这些缺失句子里，有多少看起来是「正文实句」（长句）
const allMissing = cases.flatMap((c) => c.missing);
const buckets = { "<=10字": 0, "11-20字": 0, "21-50字": 0, ">50字": 0 };
allMissing.forEach((s) => {
  if (s.length <= 10) buckets["<=10字"]++;
  else if (s.length <= 20) buckets["11-20字"]++;
  else if (s.length <= 50) buckets["21-50字"]++;
  else buckets[">50字"]++;
});
console.log("\n=== 缺失句子长度分布 ===");
console.log(JSON.stringify(buckets));
console.log("（长句越多，越像真漏了正文；短句多为按钮/图注/套话）");
