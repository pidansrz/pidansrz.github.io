/* 内容体检：段落是否正常拆分、正文是否为空、图片是否都在 */
const fs = require("fs");
const path = require("path");
const BLOG = path.resolve(__dirname, "..");

const vm = require("vm");
const ctx = { window: {}, document: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(BLOG, "js/index-data.js"), "utf8"), ctx);
const POSTS = ctx.POSTS;

let totalP = 0, emptyBody = 0, onlyOneP = 0, endOk = 0;
const worst = [];
for (const p of POSTS) {
  const f = path.join(BLOG, "js/posts", p.n + ".js");
  if (!fs.existsSync(f)) continue;
  const s = fs.readFileSync(f, "utf8");
  const ps = (s.match(/<p>[\s\S]*?<\/p>/g) || []);
  totalP += ps.length;
  if (ps.length === 0) emptyBody++;
  if (ps.length === 1) onlyOneP++;
  for (const x of ps) {
    const t = x.replace(/<[^>]+>/g, "").trim();
    if (!t) continue;
    if (/[。！？」』”…：；!?]$/.test(t)) endOk++;
  }
  // 单段超长 = 疑似粘连
  for (const x of ps) {
    const t = x.replace(/<[^>]+>/g, "").trim();
    if (t.length > 800) worst.push([t.length, p.title.slice(0, 24)]);
  }
}
console.log("文章 " + POSTS.length + " 篇");
console.log("段落总数 " + totalP + "；正文为空（图片贴）" + emptyBody + " 篇；只有 1 段 " + onlyOneP + " 篇");
console.log("以句末标点结尾的段落占比 " + (endOk / totalP * 100).toFixed(1) + "%");
worst.sort((a, b) => b[0] - a[0]);
console.log("超长单段（>800 字，疑似粘连）" + worst.length + " 处");
worst.slice(0, 5).forEach((w) => console.log("   " + w[0] + " 字  " + w[1]));

// 图片可达性
let imgTotal = 0, imgMissing = 0, imgNoSize = 0;
for (const p of POSTS) {
  const f = path.join(BLOG, "js/posts", p.n + ".js");
  if (!fs.existsSync(f)) continue;
  const s = fs.readFileSync(f, "utf8");
  for (const tag of s.match(/<img[^>]*>/g) || []) {
    imgTotal++;
    // js/posts/*.js 里标签的引号是转义过的：width=\"500\"
    const m = tag.match(/src=\\?"([^"\\]+)/);
    if (m && !fs.existsSync(path.join(BLOG, m[1]))) imgMissing++;
    if (!/width=\\?"\d+/.test(tag) || !/height=\\?"\d+/.test(tag)) imgNoSize++;
  }
  if (p.cover && !fs.existsSync(path.join(BLOG, p.cover))) imgMissing++;
}
console.log("\n正文+头图共 " + imgTotal + " 处引用；文件缺失 " + imgMissing + "；缺宽高 " + imgNoSize);
