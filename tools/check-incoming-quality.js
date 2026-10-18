/* 体检新包：找出正文异常短（抓取失败/空壳）的文章 */
const fs = require("fs");
const path = require("path");
const dir = path.resolve(__dirname, "../../_incoming/md_posts");

const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
const rows = [];
for (const f of files) {
  const t = fs.readFileSync(path.join(dir, f), "utf8");
  const raw = t.replace(/^---[\s\S]*?\n---/, "");
  const text = raw.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/[*`#>]/g, "").replace(/\s+/g, "");
  const title = ((t.match(/^title:\s*(.+)$/m) || [])[1] || "").replace(/"/g, "");
  const date = ((t.match(/^date:\s*(.+)$/m) || [])[1] || "").trim();
  const imgCount = (raw.match(/!\[[^\]]*\]\([^)]*\)/g) || []).length;
  rows.push({ f, len: text.length, title, date, imgCount });
}

const tiny = rows.filter((r) => r.len < 300).sort((a, b) => a.len - b.len);
console.log("新包共 " + rows.length + " 篇；正文 < 300 字的有 " + tiny.length + " 篇\n");
tiny.forEach((x) => console.log("  " + String(x.len).padStart(4) + "  " + x.f + "  " + x.title.slice(0, 34)));

console.log("\n=== 长度分布 ===");
const b = { "<100": 0, "100-300": 0, "300-800": 0, "800-2000": 0, "2000-5000": 0, ">5000": 0 };
rows.forEach((r) => {
  if (r.len < 100) b["<100"]++;
  else if (r.len < 300) b["100-300"]++;
  else if (r.len < 800) b["300-800"]++;
  else if (r.len < 2000) b["800-2000"]++;
  else if (r.len < 5000) b["2000-5000"]++;
  else b[">5000"]++;
});
console.log("  " + JSON.stringify(b));

// 看看最短的三篇到底写了什么
console.log("\n=== 最短三篇的正文原文 ===");
for (const x of tiny.slice(0, 3)) {
  const t = fs.readFileSync(path.join(dir, x.f), "utf8").replace(/^---[\s\S]*?\n---/, "").trim();
  console.log("\n--- " + x.f + " 《" + x.title + "》 ---");
  console.log(t.slice(0, 300));
}

fs.writeFileSync(path.join(__dirname, "_incoming-sizes.json"), JSON.stringify(rows, null, 1), "utf8");
console.log("\n明细已写 tools/_incoming-sizes.json");
