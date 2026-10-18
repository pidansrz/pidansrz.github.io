/**
 * build-split.js —— 把 js/data.js（单一数据源）拆成「首屏轻量索引 + 按需加载的正文」
 *
 * 为什么要拆：data.js 里装了 180 篇全文，近 1MB。
 * 只是打开首页列表，也要把全部文章正文下载一遍，手机上很吃亏。
 * 拆开之后：
 *   · js/index-data.js   —— 首屏用：站点信息 + 文章列表（标题/日期/摘要/封面/阅读时长），约几十 KB
 *   · js/posts/<n>.js    —— 每篇正文单独一个文件，点开哪篇才加载哪篇
 *   · js/search-text.js  —— 全文搜索用的纯文本索引，用户真的搜索时才懒加载
 *
 * 用 <script> 动态插入的方式加载（而不是 fetch），这样本地双击打开（file://）也能正常工作。
 *
 * 用法：node tools/build-split.js
 * 注意：任何改动 js/data.js 的操作之后都要重跑本脚本（其它工具已自动调用）。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'js', 'data.js');
const OUT_INDEX = path.join(ROOT, 'js', 'index-data.js');
const OUT_SEARCH = path.join(ROOT, 'js', 'search-text.js');
const POSTS_DIR = path.join(ROOT, 'js', 'posts');
const TRASH = path.join(ROOT, '..', '_split-trash');

function kb(n) { return (n / 1024).toFixed(1) + ' KB'; }

/* ---------- 1. 读取源数据 ---------- */
const src = fs.readFileSync(DATA, 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src + '\n;globalThis.__SITE = SITE; globalThis.__POSTS = POSTS;', ctx);
const SITE = ctx.__SITE;
const POSTS = ctx.__POSTS;

/* ---------- 2. 文本工具 ---------- */
function plainText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function minutesOf(html) {
  const text = plainText(html);
  return Math.max(1, Math.round(text.length / 320));
}

/* ---------- 3. 生成 index-data.js ---------- */
const index = POSTS.map((p, i) => ({
  n: i,                                  // 正文文件名（js/posts/<n>.js）
  id: p.id,
  title: p.title,
  date: p.date,
  excerpt: p.excerpt || '',
  cover: p.cover || '',
  coverAlt: p.coverAlt || '',
  minutes: minutesOf(p.content),
}));

const indexSrc =
  '/* 由 tools/build-split.js 自动生成（源自 js/data.js），请勿手改。\n' +
  '   首屏只需要这份索引；文章正文在 js/posts/ 下按需加载。 */\n' +
  'var SITE = ' + JSON.stringify(SITE, null, 2) + ';\n\n' +
  'var POSTS = ' + JSON.stringify(index, null, 0) + ';\n';
fs.writeFileSync(OUT_INDEX, indexSrc, 'utf8');

/* ---------- 4. 生成 js/posts/<n>.js ---------- */
fs.mkdirSync(POSTS_DIR, { recursive: true });
const existing = new Set(fs.readdirSync(POSTS_DIR).filter((f) => /^\d+\.js$/.test(f)));
const written = new Set();

POSTS.forEach((p, i) => {
  const file = i + '.js';
  written.add(file);
  const payload = JSON.stringify(String(p.content || ''))
    .replace(/<\/(script)/gi, '<\\/$1');   // 防止正文里出现 </script> 提前闭合
  const body = 'window.__POST_HTML__=window.__POST_HTML__||{};' +
               'window.__POST_HTML__[' + i + ']=' + payload + ';\n';
  const full = path.join(POSTS_DIR, file);
  const prev = existing.has(file) ? fs.readFileSync(full, 'utf8') : null;
  if (prev !== body) fs.writeFileSync(full, body, 'utf8');   // 内容没变就不重写
});

// 文章变少时，多出来的正文文件移走（不删除，便于回退）
const stale = [...existing].filter((f) => !written.has(f));
if (stale.length) {
  fs.mkdirSync(TRASH, { recursive: true });
  stale.forEach((f) => {
    const from = path.join(POSTS_DIR, f);
    const to = path.join(TRASH, f);
    if (fs.existsSync(to)) fs.rmSync(to, { force: true });
    fs.renameSync(from, to);
  });
}

/* ---------- 5. 生成 search-text.js ---------- */
const searchMap = {};
POSTS.forEach((p) => { searchMap[p.id] = plainText(p.content); });
const searchSrc =
  '/* 由 tools/build-split.js 自动生成：全文搜索用的纯文本索引（懒加载） */\n' +
  'window.SEARCH_TEXT = ' + JSON.stringify(searchMap) + ';\n';
fs.writeFileSync(OUT_SEARCH, searchSrc, 'utf8');

/* ---------- 6. 汇报 ---------- */
const sizeIndex = fs.statSync(OUT_INDEX).size;
const sizeSearch = fs.statSync(OUT_SEARCH).size;
const sizePosts = fs.readdirSync(POSTS_DIR)
  .filter((f) => /^\d+\.js$/.test(f))
  .reduce((t, f) => t + fs.statSync(path.join(POSTS_DIR, f)).size, 0);

console.log('✓ 拆分完成');
console.log('  js/index-data.js     ' + kb(sizeIndex) + '   ← 首屏只需要这个（原 data.js ' + kb(Buffer.byteLength(src)) + '）');
console.log('  js/posts/*.js        ' + kb(sizePosts) + '   共 ' + POSTS.length + ' 篇，打开哪篇载哪篇');
console.log('  js/search-text.js    ' + kb(sizeSearch) + '   ← 全文搜索索引，用户搜索时才加载');
console.log('  首屏体积变化：' + kb(Buffer.byteLength(src)) + ' → ' + kb(sizeIndex) +
            '（降到 ' + Math.round((sizeIndex / Buffer.byteLength(src)) * 100) + '%）');
if (stale.length) console.log('  另移出 ' + stale.length + ' 个不再需要的正文文件到 ' + path.relative(ROOT, TRASH));
