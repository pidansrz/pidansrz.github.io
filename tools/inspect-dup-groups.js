/* 看清「同标题」分组的性质：是同一篇的重复抓取，还是真正的重推旧文。 */
const fs = require("fs");
const path = require("path");
const dir = path.resolve(__dirname, "../../_incoming/md_posts");

const TAIL = /(?:[\s|｜▏丨]*(?:旧文新看|旧文|记者节旧文|观见|夜读|荐读|粥读|舟侃|粥爷)\s*)+$/;
function norm(t) {
  let s = String(t || "").replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "").replace(/^[【\[][^】\]]{1,6}[】\]]\s*/, "");
  s = s.replace(TAIL, "");
  return s.replace(/[\s　]+/g, "")
    .replace(/[，。？！：；、,.""''()（）《》<>「」『』\[\]【】!?:\-—…·~～|｜]/g, "")
    .toLowerCase();
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
const rows = [];
for (const f of files) {
  const t = fs.readFileSync(path.join(dir, f), "utf8");
  const title = ((t.match(/^title:\s*(.+)$/m) || [])[1] || "").replace(/"/g, "").trim();
  const date = ((t.match(/^date:\s*(.+)$/m) || [])[1] || "").trim();
  const url = ((t.match(/^original_url:\s*(.+)$/m) || [])[1] || "").trim();
  const body = t.replace(/^---[\s\S]*?\n---/, "");
  const len = body.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/[*`#>]/g, "").replace(/\s+/g, "").length;
  const dead = /疑似违规删除|已下线|无永久链接/.test(t);
  rows.push({ f, title, date, url, len, dead });
}

const g = {};
rows.forEach((r) => (g[norm(r.title)] = g[norm(r.title)] || []).push(r));
const dups = Object.values(g).filter((a) => a.length > 1);
console.log("同标题组 " + dups.length + " 组\n");
for (const a of dups) {
  const dates = new Set(a.map((x) => x.date.slice(0, 10)));
  const urls = new Set(a.map((x) => x.url));
  console.log("《" + a[0].title.slice(0, 30) + "》  日期" + (dates.size > 1 ? "不同" : "相同") +
    "  链接" + (urls.size > 1 ? "不同" : "相同"));
  a.sort((x, y) => y.len - x.len);
  a.forEach((x) => console.log("     " + x.f + "  " + x.date.slice(0, 16).padEnd(17) +
    " 正文" + String(x.len).padStart(5) + (x.dead ? "  [失效]" : "") + "  " + (x.url ? x.url.slice(-14) : "无链接")));
  console.log("");
}
