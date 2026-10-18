/**
 * mark-reposts.js —— 给同名（重复标题）文章中「较新的那几篇」补上「| 旧文」标识。
 *
 * 规则：
 *   1. 先剥离标题结尾的旧文标记（如「| 旧文」「｜旧文」「| 旧文新看」），得到「基础标题」；
 *   2. 基础标题相同的文章归为一组，按日期升序排列；
 *   3. 组内最早的一篇视为首发，标题不动；
 *   4. 其余较新的篇目中，凡是标题已经自带旧文类标记的（如「| 旧文」「| 旧文新看」），
 *      保持原样不动；完全没有任何标记的，在标题后追加 "| 旧文"；
 *   5. coverAlt 若与旧标题完全一致，同步更新，保持一致。
 *
 * 用法：
 *   node tools/mark-reposts.js          # 预览，不写文件
 *   node tools/mark-reposts.js --apply  # 实际写入（自动备份 js/data.js）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DATA_FILE = path.join(__dirname, '..', 'js', 'data.js');
const SUFFIX = '| 旧文';
const APPLY = process.argv.includes('--apply');

// 匹配结尾的旧文类标记（含分隔符与后面的补充词，如「旧文新看」「旧文重发」）
const MARK_RE = /[\s|｜]+旧文[\s\S]*$/;

function baseTitle(title) {
  return String(title).replace(MARK_RE, '').trim();
}
function hasMark(title) {
  return MARK_RE.test(String(title));
}

let src = fs.readFileSync(DATA_FILE, 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src + '\n;globalThis.__P = POSTS;', ctx);
const posts = ctx.__P;

// 分组
const groups = new Map();
for (const p of posts) {
  const k = baseTitle(p.title);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(p);
}

const plan = [];
for (const [base, arr] of groups) {
  if (arr.length < 2) continue;
  arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  arr.forEach((p, i) => {
    if (i === 0) return; // 首发篇不动
    if (hasMark(p.title)) return; // 已自带旧文标识的不动
    const target = base + SUFFIX;
    if (p.title === target) return;
    plan.push({
      id: p.id,
      date: p.date,
      from: p.title,
      to: target,
      alreadyMarked: false,
    });
  });
}

if (!plan.length) {
  console.log('没有需要修改的标题，数据已经是规范状态。');
  process.exit(0);
}

console.log(`计划修改 ${plan.length} 处标题：\n`);
for (const it of plan) {
  console.log(`  ${it.date}  ${it.from}`);
  console.log(`        ->  ${it.to}\n`);
}

if (!APPLY) {
  console.log('（预览模式，未写入文件。加 --apply 执行修改）');
  process.exit(0);
}

// 按 id 定位所在条目块，再改块内的字段，避免误伤同名标题的其他条目
function replaceField(src, id, field, newValue) {
  const idPos = src.indexOf(`id: "${id}"`);
  if (idPos < 0) throw new Error(`找不到 id: ${id}`);
  let end = src.indexOf('\n  {', idPos);
  if (end < 0) end = src.length;
  const seg = src.slice(idPos, end);
  const m = new RegExp(field + ': "((?:[^"\\\\]|\\\\.)*)"').exec(seg);
  if (!m) return src; // 无该字段则跳过（如部分文章没有 coverAlt）
  const start = idPos + m.index;
  return src.slice(0, start) + field + ': "' + newValue + '"' + src.slice(start + m[0].length);
}

for (const it of plan) {
  src = replaceField(src, it.id, 'title', it.to);
  src = replaceField(src, it.id, 'coverAlt', it.to);
}

// 备份
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const backup = path.join(__dirname, '..', 'js', `data.backup-${stamp}.js`);
fs.copyFileSync(DATA_FILE, backup);
fs.writeFileSync(DATA_FILE, src, 'utf8');

console.log(`已备份：${path.relative(process.cwd(), backup)}`);
console.log(`已写入：js/data.js（修改 ${plan.length} 处）`);

// 数据变了，自动重建派生文件（index-data.js / posts / search-text / feed）
try {
  require('child_process').execFileSync(process.execPath,
    [require('path').join(__dirname, 'build-all.js')], { stdio: 'inherit' });
} catch (e) {
  console.warn('⚠ 自动重建失败，请手动执行：node tools/build-all.js');
}
