/**
 * verify.js —— 不改动任何文件，用一套最小 DOM 桩把页面真实跑一遍，做回归自检。
 *
 * 覆盖：首页列表与年份分组、懒加载搜索索引与全文命中、文章页正文按需加载、
 *       分享信息卡（OG）、相关文章、阅读进度条、归档页、右下角浮动工具条。
 *
 * 用法：node tools/verify.js
 * 桩会真实地读取并执行 js/posts/<n>.js 与 js/search-text.js，
 * 等价于浏览器里动态插入 <script> 的行为。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;

function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  PASS  ' + msg); }
  else { fail++; console.log('  FAIL  ' + msg + (extra ? '   → ' + extra : '')); }
}
function section(t) { console.log('\n【' + t + '】'); }

/* ---------- 最小 DOM 桩 ---------- */
function makeEl(tag, id) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    id: id || '',
    className: '',
    innerHTML: '',
    textContent: '',
    hidden: false,
    src: '',
    style: {},
    dataset: {},
    attrs: {},
    children: [],
    _ev: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) {
        if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); return this._s.has(c); }
        on ? this._s.add(c) : this._s.delete(c);
        return on;
      },
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] !== undefined ? this.attrs[k] : null; },
    appendChild(c) {
      this.children.push(c);
      // 真实浏览器里 appendChild 之后 getElementById 就能按 id 取到，
      // 桩也照做，这样 app.js 动态插入的浮动工具按钮能被断言访问到。
      if (c && c.id && !ids[c.id]) ids[c.id] = c;
      return c;
    },
    insertBefore(c) { this.children.unshift(c); return c; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(t, f) { (this._ev[t] = this._ev[t] || []).push(f); },
    fire(t, e) { (this._ev[t] || []).forEach((f) => f(e || {})); },
    focus() { this.focused = true; this._focused = true; },
    blur() {},
    scrollIntoView() {},
    remove() {},
    matches() { return false; },
    // 供「返回首页定位回原文」使用：_rectTop 可单独设置来模拟该卡片在文档中的位置
    getBoundingClientRect() {
      return { top: this._rectTop || 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
    },
    offsetHeight: 0,
  };
  return el;
}

const ctx = {};
const docReady = [];
const docEvents = {};   // document 上的事件监听（主题切换用的是事件委托）
const ids = {};
// 'toTop' / 'toHome' 是 app.js 在 initFloatTools() 里动态生成的，
// 靠上面 appendChild 注册进来，这里不要预先占位，否则断言拿到的是空壳。
['site-header', 'site-footer', 'postHost', 'postList', 'postCount',
 'searchInput', 'searchStatus', 'searchClear', 'archiveHost', 'arcYears',
 'arcCount'].forEach((id) => { ids[id] = makeEl('div', id); });
ids.searchInput.value = '';

const metas = {};           // selector → meta 桩
const head = makeEl('head');
const body = makeEl('body');
const documentElement = makeEl('html');
documentElement.attrs['data-theme'] = 'light';
documentElement.scrollHeight = 6000;
documentElement.scrollTop = 0;

const loadedScripts = [];
head.appendChild = function (node) {
  head.children.push(node);
  if (node.tagName === 'SCRIPT' && node.src) {
    loadedScripts.push(node.src);
    const file = path.join(ROOT, node.src.replace(/^\.?\//, ''));
    try {
      vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
      if (node.onload) node.onload();
    } catch (e) {
      if (node.onerror) node.onerror(e);
      else throw e;
    }
  } else if (node.tagName === 'META') {
    const sel = node.attrs.property
      ? 'meta[property="' + node.attrs.property + '"]'
      : 'meta[name="' + node.attrs.name + '"]';
    metas[sel] = node;
  }
  return node;
};

const document = {
  documentElement,
  head,
  body,
  activeElement: null,
  // 惰性创建：真实浏览器里 innerHTML 赋值后就能按 id 取到节点，桩用同一套语义
  getElementById: (id) => ids[id] || (ids[id] = makeEl('div', id)),
  querySelector: (sel) => metas[sel] || null,
  querySelectorAll: () => [],
  createElement: (t) => makeEl(t),
  addEventListener: (t, f) => {
    if (t === 'DOMContentLoaded') docReady.push(f);
    (docEvents[t] = docEvents[t] || []).push(f);
  },
  fire: (t, e) => (docEvents[t] || []).forEach((f) => f(e || {})),
};
body.dataset = {};

const win = {
  pageYOffset: 0,
  innerHeight: 800,
  _ev: {},
  addEventListener(t, f) { (win._ev[t] = win._ev[t] || []).push(f); },
  fireEvent(t, e) { (win._ev[t] || []).forEach((f) => f(e || {})); },
  requestAnimationFrame(cb) { cb(); return 1; },
  matchMedia: () => ({ matches: false }),
  // 两种调用形态都要记：对象式 scrollTo({top}) 与数值式 scrollTo(x, y)
  scrollTo(a, b) { win._scrolled = (typeof b === 'number') ? { top: b } : a; },
};

const location = { search: '', pathname: '/index.html', protocol: 'http:', origin: 'http://localhost:8800', host: 'localhost:8800' };

ctx.document = document;
ctx.window = win;
ctx.location = location;
ctx.history = { replaceState() {} };
ctx.globalThis = ctx;
vm.createContext(ctx);

/* 加载页面真实依赖：theme.js（<head> 同步引入）→ index-data.js（首屏索引）→ app.js */
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'theme.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'index-data.js'), 'utf8'), ctx);
// 荐读（好文收藏）的列表数据；还没构建过时跳过，不影响其它断言
const linksDataFile = path.join(ROOT, 'js', 'links-data.js');
if (fs.existsSync(linksDataFile)) {
  vm.runInContext(fs.readFileSync(linksDataFile, 'utf8'), ctx);
}
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8'), ctx);
ctx.__POSTS = vm.runInContext('POSTS', ctx);

function bootPage(pageName, search) {
  document.body.dataset.page = pageName;
  location.pathname = pageName === 'home' ? '/index.html' : '/' + pageName + '.html';
  location.search = search || '';
  // 浮动工具条是 JS 动态插入的。真实浏览器只插一次，但这里反复触发
  // DOMContentLoaded 会越插越多，所以每次重开页面先把上一轮的节点清掉。
  delete ids.toTop;
  delete ids.toHome;
  if (ids.floatTools) ids.floatTools.children = [];
  docReady.forEach((f) => f());
}

/* ================= 1. 首页 ================= */
section('首页渲染');
bootPage('home');
const listHTML = ids.postList.innerHTML;
const itemCount = (listHTML.match(/class="post-item (reveal|no-thumb reveal)"/g) || []).length;
ok(itemCount === ctx.__POSTS.length, '首页列出全部 ' + ctx.__POSTS.length + ' 篇（实际 ' + itemCount + '）');
// 年份组数由数据自身决定，写死会在文章增删后误报
const yearCount = new Set(ctx.__POSTS.map((p) => String(p.date).slice(0, 4))).size;
const groups = (listHTML.match(/class="year-group"/g) || []).length;
ok(groups === yearCount, '按年份分成 ' + yearCount + ' 组（实际 ' + groups + '）');
ok(/loading="lazy"/.test(listHTML), '列表图片使用懒加载');
ok(/约 \d+ 分钟/.test(listHTML), '列表显示阅读时长（来自索引，无需加载正文）');
ok(!/js\/posts\//.test(listHTML), '首页不会加载任何正文文件');
// 每张卡片要有 id="post-<id>"，返回首页时才能按 id 定位回来
const anchorId = 'id="post-' + ctx.__POSTS[0].id + '"';
ok(listHTML.indexOf(anchorId) !== -1, '列表卡片带 ' + anchorId + '，供返回时定位');

/* ================= 2. 搜索（懒加载全文索引） ================= */
section('站内搜索');
ok(loadedScripts.length === 0, '打开首页时不加载全文搜索索引');
ids.searchInput.value = '张雪峰';
ids.searchInput.fire('input');
ok(loadedScripts.some((s) => /search-text\.js/.test(s)), '首次搜索才去加载全文索引');
const quickFound = (ids.postList.innerHTML.match(/class="search-results"/g) || []).length;
const hits = (ids.postList.innerHTML.match(/class="post-item no-thumb reveal"/g) || []).length;
ok(hits > 0, '搜「张雪峰」有命中（实际 ' + hits + ' 篇）', ids.searchStatus.textContent);
ok(ids.searchStatus.textContent.indexOf('找到 ' + hits + ' 篇') === 0,
  '状态栏显示命中数量：' + ids.searchStatus.textContent);
ids.searchInput.value = '外卖';
ids.searchInput.fire('input');
const hits2 = (ids.postList.innerHTML.match(/class="post-item no-thumb reveal"/g) || []).length;
ok(hits2 > 0, '搜「外卖」有命中（正文搜索生效，实际 ' + hits2 + ' 篇）');
ids.searchInput.value = '舆论';
ids.searchInput.fire('input');
const hits3 = (ids.postList.innerHTML.match(/class="post-item no-thumb reveal"/g) || []).length;
ok(hits3 > 0, '搜「舆论」有命中（实际 ' + hits3 + ' 篇）');
ids.searchInput.value = '';
ids.searchInput.fire('input');
ok(/year-group/.test(ids.postList.innerHTML), '清空搜索后回到年份列表');

/* ================= 3. 文章页（正文按需加载） ================= */
section('文章页');
const target = ctx.__POSTS.find((p) => p.id === '2024-10-22-cong-nan-nv-dui-li-kan-yan-lun-de-bian-jie');
ok(!!target, '找到测试文章，序号 n=' + (target && target.n));
const postsBefore = loadedScripts.filter((s) => /js\/posts\//.test(s)).length;
bootPage('post', '?id=' + target.id);
const postHTML = ids.postHost.innerHTML;
ok(postsBefore === 0, '文章页之前未加载过任何正文');
ok(loadedScripts.some((s) => new RegExp('js/posts/' + target.n + '\\.js').test(s)), '只请求了当前这一篇正文（' + target.n + '.js）');
ok(/class="share-bar"/.test(postHTML), '含分享栏');
ok(/class="related"/.test(postHTML), '含文末相关文章');
ok(/class="prevnext"/.test(postHTML), '含上一篇/下一篇');
// 「← 返回首页」这个链接本身要带上本篇 id，首页才能定位回来
ok(postHTML.indexOf('href="index.html#post-' + encodeURIComponent(target.id) + '"') !== -1,
  '「← 返回首页」链接带上本篇 id，点回去能定位回这篇文章');
const bodyHTML = ids.articleBody.innerHTML;
ok(!/正在载入正文/.test(bodyHTML), '正文占位提示已被真实内容替换');
// 与 js/data.js 源数据逐字比对，确认按需加载的正文完整无截断
const srcCtx = {};
vm.createContext(srcCtx);
vm.runInContext(
  fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8') + '\n;globalThis.__P = POSTS;', srcCtx);
const truth = (srcCtx.__P.find((p) => p.id === target.id) || {}).content || '';
ok(bodyHTML === truth, '正文与源数据完全一致（' + truth.length + ' 字符）', '实际 ' + bodyHTML.length);
// 全站正文里的每张 <img> 都该带 width/height，避免图片到位时布局抖动。
// （早先只抽查了一篇，但那一篇的正文图恰好属于"与头图重复"被清理掉的情况，
//   所以这里改成扫全部正文，覆盖更全、也不依赖某一篇的具体内容。）
{
  let imgTotal = 0;
  let imgBad = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'js', 'posts'))) {
    if (!/\.js$/.test(f)) continue;
    const s = fs.readFileSync(path.join(ROOT, 'js', 'posts', f), 'utf8');
    for (const tag of s.match(/<img[^>]*>/g) || []) {
      imgTotal++;
      // js/posts/*.js 里的正文是经过转义的字符串，属性可能写成 width=\"550\"，
      // 也可能写成 width="550"（取决于是否又被 stringify 了一层），两种都认。
      if (!(/width=\\*"\d+\\*"/.test(tag) && /height=\\*"\d+\\*"/.test(tag))) {
        imgBad.push(f + ' :: ' + tag.slice(0, 60));
      }
    }
  }
  ok(imgTotal > 0 && imgBad.length === 0,
    '正文共 ' + imgTotal + ' 张配图，全部带 width/height（防抖动生效）',
    '缺尺寸 ' + imgBad.length + ' 张：' + imgBad.slice(0, 3).join(' | '));
}

/* ================= 3b. 文章静态页：正文静态化 + JSON-LD =================
 * 只读 <meta> 的爬虫（百度 / 微信内搜索 / 多数 AI 抓取）不执行 JS，
 * 所以正文必须直接写在 post/<id>.html 里，不能只靠 app.js 渲染。 */
section('文章静态页');
const staticFile = path.join(ROOT, 'post', target.id + '.html');
ok(fs.existsSync(staticFile), '生成文章静态页 post/<id>.html');
const staticSrc = fs.existsSync(staticFile) ? fs.readFileSync(staticFile, 'utf8') : '';
ok(/class="article-body"/.test(staticSrc), '正文写进静态 HTML，爬虫不跑 JS 也能读到');
ok(staticSrc.indexOf(truth) !== -1,
  '静态正文与 js/data.js 源数据逐字一致（' + truth.length + ' 字符）');
ok(!/正在载入正文/.test(staticSrc), '静态页不含「正在载入正文」占位');
ok(/application\/ld\+json/.test(staticSrc), '带 JSON-LD 结构化数据');
ok(/"@type"\s*:\s*"BlogPosting"/.test(staticSrc), 'JSON-LD 类型为 BlogPosting');
ok(new RegExp('"datePublished"\\s*:\\s*"' + target.date + '"').test(staticSrc),
  'JSON-LD 含发布日期 ' + target.date);
ok(/"headline"\s*:\s*"/.test(staticSrc), 'JSON-LD 含标题 headline');
// 静态正文里的图片也走站点根路径（<base href="/">），不能写成 ../ 或绝对域名
ok(!/src="\.\.\//.test(staticSrc), '静态页资源不含 ../ 相对路径');

/* hydrate：真实浏览器打开 post/<id>.html 时，页面里已经有静态正文，
 * app.js 应该直接取用（不闪烁、不再请求 js/posts/<n>.js）。 */
{
  win.__POST_ID__ = target.id;                 // 模拟 build-posts.js 注入的 id
  ids.articleBody = makeEl('div', 'articleBody');
  ids.articleBody.innerHTML = '<p>静态正文水合标记</p>';
  const postsBefore = loadedScripts.filter((s) => /js\/posts\//.test(s)).length;
  bootPage('post', '');                        // 无 ?id=，id 来自 __POST_ID__
  const hydroHTML = ids.postHost.innerHTML;
  ok(hydroHTML.indexOf('静态正文水合标记') !== -1,
    'hydrate：直接取用页面里已有的静态正文');
  ok(!/正在载入正文/.test(hydroHTML), 'hydrate：不出现「正在载入正文」占位');
  ok(loadedScripts.filter((s) => /js\/posts\//.test(s)).length === postsBefore,
    'hydrate：不再额外请求 js/posts/<n>.js');
  // 还原现场，避免影响后面的用例
  delete win.__POST_ID__;
  delete ids.articleBody;
  // OG 段落读的是「最后一次 applyShareMeta 写进去的 meta」，而 hydrate 这次
  // 走的是无 ?id= 的静态页地址；按老入口再开一次，把 og:url 等恢复原状。
  bootPage('post', '?id=' + target.id);
}

// 回归：头图与正文配图重复的问题已清除。
// 依据 tools/_dup-confirmed.json（扫描 + 人工目视确认的清单），
// 这些正文图应当已经从对应的 js/posts/<n>.js 里消失。
{
  const confPath = path.join(ROOT, 'tools', '_dup-confirmed.json');
  if (fs.existsSync(confPath)) {
    const items = JSON.parse(fs.readFileSync(confPath, 'utf8')).items || [];
    const left = [];
    for (const it of items) {
      const f = path.join(ROOT, 'js', 'posts', it.n + '.js');
      if (!fs.existsSync(f)) continue;
      const s = fs.readFileSync(f, 'utf8');
      if (s.indexOf(it.dup) !== -1) left.push(it.id + ' -> ' + it.dup);
    }
    ok(items.length > 0 && left.length === 0,
      '头图与正文重复的配图已清理（清单 ' + items.length + ' 篇）',
      '仍有 ' + left.length + ' 篇残留：' + left.slice(0, 3).join(' | '));
  }
}

section('分享信息卡（OG）');
const ogTitle = metas['meta[property="og:title"]'];
const ogDesc = metas['meta[property="og:description"]'];
const ogImg = metas['meta[property="og:image"]'];
const ogUrl = metas['meta[property="og:url"]'];
const twCard = metas['meta[name="twitter:card"]'];
ok(ogTitle && /旧文/.test(ogTitle.attrs.content), 'og:title = ' + (ogTitle && ogTitle.attrs.content));
ok(ogDesc && ogDesc.attrs.content.length > 4, 'og:description 取自文章摘要');
ok(ogImg && /^https?:\/\//.test(ogImg.attrs.content), 'og:image 是绝对地址：' + (ogImg && ogImg.attrs.content));
ok(ogUrl && /post\.html\?id=/.test(ogUrl.attrs.content), 'og:url 指向当前文章');
ok(twCard && twCard.attrs.content === 'summary_large_image', 'twitter:card 已设置');

section('无头图文章的分享图回退');
const noCover = ctx.__POSTS.find((p) => !p.cover || /shoe-repair-stall/.test(p.cover));
bootPage('post', '?id=' + noCover.id);
const ogImg2 = metas['meta[property="og:image"]'];
ok(ogImg2 && /og-default\.jpg/.test(ogImg2.attrs.content), '无头图时回退到站点默认分享图');

ok(body.children.some((c) => c.className === 'read-progress'), '进度条元素已插入页面');
const bar = body.children.find((c) => c.className === 'read-progress');
// 先滚一段再断言，否则 pageYOffset 还是 0，宽度恒为 0.00%，等于没验证到东西
win.pageYOffset = 2600;
win.fireEvent('scroll');
ok(bar && parseFloat(bar.style.width) > 0,
  '滚到中段后进度条有宽度：' + (bar && bar.style.width),
  '实际 ' + (bar && bar.style.width));
win.pageYOffset = 0;
win.fireEvent('scroll');

/* ================= 4. 归档页 ================= */
section('归档页');
bootPage('archive');
const arcHTML = ids.archiveHost.innerHTML;
const arcYears = (arcHTML.match(/class="archive-year reveal"/g) || []).length;
ok(arcYears === yearCount, '归档页按年份分组 ' + yearCount + ' 段（实际 ' + arcYears + '）');
ok((arcHTML.match(/class="arc-item"/g) || []).length === ctx.__POSTS.length, '归档页列出 ' + ctx.__POSTS.length + ' 篇');
ok(String(ids.arcCount.textContent) === String(ctx.__POSTS.length), '归档页统计篇数正确');

/* ================= 5. 右下角浮动工具条（回首页 / 回顶部） ================= */
section('浮动工具条');
bootPage('post', '?id=' + target.id);
ok(!!ids.toTop, '文章页也有浮动工具条（以前只有首页和归档页有）');
ok(String(ids.toTop.className).indexOf('ft-top') !== -1, '主按钮是「回到顶部」');
ok(String(ids.toTop.innerHTML).indexOf('ring-fill') !== -1, '主按钮带阅读进度环');
ok(!!ids.toHome, '文章页出现「返回首页」按钮');

win.pageYOffset = 900;
win.fireEvent('scroll');
ok(!ids.toTop.classList.contains('is-idle'), '滚动后可点');
win.pageYOffset = 0;
win.fireEvent('scroll');
ok(ids.toTop.classList.contains('is-idle'), '已在页面最顶端时置灰（位置不变）');
// 回到中部：环应该跟着进度走，提示语同步给出已读百分比
win.pageYOffset = 2600;
win.fireEvent('scroll');
ok(/回到顶部 · 已读 \d+%/.test(ids.toTop.title || ''),
  '提示语跟着阅读进度走：' + ids.toTop.title,
  '实际 ' + ids.toTop.title);
ids.toTop.fire('click');
ok(win._scrolled && win._scrolled.top === 0, '点击后回到顶部');

ids.toHome.fire('click');
// 带上当前文章 id，首页据此定位回这篇文章，而不是跳到列表最前面
const backHash = 'index.html#post-' + encodeURIComponent(target.id);
ok(location.href === backHash, '「返回首页」跳回 index.html 并定位到当前文章',
  '实际 ' + location.href);

// 首页不必要再挂一个指向自己的「返回首页」
bootPage('home');
ok(!ids.toHome, '首页不出现「返回首页」按钮（避免指向自己）');
ok(!!ids.toTop, '首页仍有「回到顶部」按钮');
win.pageYOffset = 600; win.fireEvent('scroll');
ok(!ids.toTop.classList.contains('is-idle'), '首页滚动后可用');

/* ================= 6. 从文章页返回首页，定位回该文章 ================= */
section('返回首页定位回原文');

// 文章页的「返回首页」会把当前文章 id 带在 hash 里跳回 index.html，
// 首页渲染完整列表后应当滚动到那篇文章，而不是停在页首。
const HOME_HEADER_H = 56;     // 顶栏是 sticky，定位时要让出这段高度
const RECT_TOP = 1234;        // 模拟目标卡片在文档中的位置

function bootHomeWithHash(hash) {
  win.pageYOffset = 0;
  win._scrolled = null;
  location.hash = hash || '';
  bootPage('home');
}

// 先渲染一次完整列表，拿到带 id="post-<id>" 的卡片节点
bootHomeWithHash('');
const cardEl = ids['post-' + target.id] || makeEl('article', 'post-' + target.id);
ids['post-' + target.id] = cardEl;
cardEl._rectTop = RECT_TOP;
ids['site-header'].offsetHeight = HOME_HEADER_H;

bootHomeWithHash('#post-' + encodeURIComponent(target.id));
ok(win._scrolled && win._scrolled.top === RECT_TOP - HOME_HEADER_H - 12,
  '带 #post-<id> 时滚动到该文章（' + (RECT_TOP - HOME_HEADER_H - 12) + 'px）',
  '实际 ' + JSON.stringify(win._scrolled));
ok(body.classList.contains('reveal-instant'),
  '跳过累积的入场动画，避免定位处卡片还是透明的');

// 正常打开首页（不带 hash）不该被干预，也不该跳过入场动画
body.classList.remove('reveal-instant');
bootHomeWithHash('');
ok(!win._scrolled, '不带 hash 时不做定位滚动（正常停在页首）',
  '实际 ' + JSON.stringify(win._scrolled));
ok(!body.classList.contains('reveal-instant'), '正常打开首页时保留入场动画');

location.hash = '';

/* ================= 7. 荐读（好文收藏） ================= */
section('荐读（好文收藏）');
const linksDir = path.join(ROOT, 'links');
const linkFiles = fs.existsSync(linksDir)
  ? fs.readdirSync(linksDir).filter((f) => /\.md$/i.test(f) && !/^_/.test(f) && f !== 'README.md')
  : [];
ok(linkFiles.length > 0, 'links/ 下有收录条目（实际 ' + linkFiles.length + ' 条）');

bootPage('links');
const linkListHTML = ids.linkList.innerHTML;
const linkCards = (linkListHTML.match(/class="post-item no-thumb reveal link-item"/g) || []).length;
ok(linkCards === linkFiles.length, '荐读页列出全部 ' + linkFiles.length + ' 条（实际 ' + linkCards + '）');
ok(/class="link-badge"/.test(linkListHTML), '条目带「荐读」标签');
ok(ids.linkCount.textContent.indexOf('共 ' + linkFiles.length + ' 篇') === 0,
  '显示收录数量：' + ids.linkCount.textContent);
ok(/href="links\.html"/.test(ids['site-header'].innerHTML), '顶栏/页脚导航含「荐读」入口');

// logo：深浅两版 PNG + 按主题切换（.brand 用 img，不用文字）
const headerSrc = ids['site-header'].innerHTML;
ok(/class="brand" href="index\.html"><img class="brand-logo logo-ink" src="images\/logo-pidan\.png"/.test(headerSrc),
  '顶栏 brand 用 logo 图（深色字版）');
ok(/src="images\/logo-pidan-light\.png"/.test(headerSrc), '顶栏同时带浅色字版（深色主题用）');
ok(/alt="皮蛋瘦肉舟"/.test(headerSrc), 'logo img 带 alt（无障碍 + 图片挂了也有站名）');
ok(fs.existsSync(path.join(ROOT, 'images/logo-pidan.png')) &&
   fs.existsSync(path.join(ROOT, 'images/logo-pidan-light.png')), '两版 logo 文件都已生成');
const cssSrc = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
ok(/\[data-theme="dark"\] \.logo-ink \{ display: none; \}/.test(cssSrc) &&
   /\[data-theme="dark"\] \.logo-ink-inv \{ display: block; \}/.test(cssSrc),
  'CSS 按 data-theme 切换深浅两版 logo');

// 静态详情页：全文 + 原文链接 + 绝对 og（微信分享要能读到）
const firstLink = linkFiles[0].replace(/\.md$/i, '');
const detailFile = path.join(linksDir, firstLink + '.html');
ok(fs.existsSync(detailFile), '生成静态详情页 links/<id>.html');
const detailSrc = fs.existsSync(detailFile) ? fs.readFileSync(detailFile, 'utf8') : '';
ok(/阅读原文/.test(detailSrc), '详情页带「阅读原文」外链（指向原站）');
ok(/og:image" content="https:\/\//.test(detailSrc), '详情页 og:image 是绝对地址');
ok(/class="article-body"/.test(detailSrc), '全文写进静态 HTML，不依赖 JS 渲染');
ok(!/<script>\s*window\.__POST_ID__/.test(detailSrc), '详情页不会误注入文章 id');

// 荐读页自身的分享图也必须是绝对地址（相对路径微信抓不到）
const linksPageSrc = fs.readFileSync(path.join(ROOT, 'links.html'), 'utf8');
ok(/og:image" content="https:\/\//.test(linksPageSrc), 'links.html 的 og:image 是绝对地址');

// 并入站内搜索
bootPage('home');
// 用条目标题的前几个字当关键词（不写死具体词，免得换了收录内容就误报）
const linkTerm = ((ctx.LINKS && ctx.LINKS[0] && ctx.LINKS[0].title) || '').slice(0, 4);
ids.searchInput.value = linkTerm;
ids.searchInput.fire('input');
ok(/class="link-badge"/.test(ids.postList.innerHTML), '站内搜索能搜到荐读条目');
ids.searchInput.value = '';
ids.searchInput.fire('input');

/* ================= 8. 主题切换（回归） ================= */
section('主题切换');
// 主题按钮不在静态 HTML 里，是 app.js 的 renderShell() 动态渲染的；
// theme.js 在 <head> 中、DOMContentLoaded 比 app.js 先触发，那时按钮还不存在，
// 直接 getElementById().addEventListener 根本绑不上（点了没反应）——
// 必须用 document 上的事件委托。这里模拟真实点击来验证。
docEvents.click = [];                 // 清掉前面多次 bootPage 累积的同名监听
bootPage('home');
const themeBtn = ids.themeToggle || makeEl('button', 'themeToggle');
ids.themeToggle = themeBtn;
themeBtn.closest = (sel) => (sel === '#themeToggle' ? themeBtn : null);

ok(documentElement.attrs['data-theme'] === 'light', '初始为浅色主题');
document.fire('click', { target: themeBtn });
ok(documentElement.attrs['data-theme'] === 'dark', '点击主题按钮切到深色');
document.fire('click', { target: themeBtn });
ok(documentElement.attrs['data-theme'] === 'light', '再点一次切回浅色');
document.fire('click', { target: { closest: () => null } });
ok(documentElement.attrs['data-theme'] === 'light', '点击页面其它地方不会切换主题');

/* ================= 9. 访问统计 + 相关阅读精排 ================= */
section('访问统计');
// stats.js 是纯函数模块，直接 require 测三种 provider 的输出、幂等性与 $ 安全
const stats = require('./stats.js');
ok(stats.statsScriptHTML({ stats: { provider: '', code: '' } }) === '',
  'SITE.stats 未配置时不注入任何脚本（站点零影响）');
ok(stats.statsScriptHTML({ stats: { provider: 'goatcounter', code: 'pidanz' } }).indexOf('gc.zgo.at/count.js') !== -1,
  'goatcounter：注入 count.js');
ok(stats.statsScriptHTML({ stats: { provider: 'goatcounter', code: 'pidanz' } }).indexOf('pidanz.goatcounter.com') !== -1,
  'goatcounter：data-goatcounter 指向自己的站点');
ok(stats.statsScriptHTML({ stats: { provider: 'plausible', code: 'pidanz.org' } }).indexOf('plausible.io/js/script.js') !== -1,
  'plausible：注入 script.js');
ok(stats.statsScriptHTML({ stats: { provider: 'umami', code: 'abc' } }).indexOf('cloud.umami.is/script.js') !== -1,
  'umami：注入 script.js');
ok(stats.statsScriptHTML({ stats: { provider: 'unknown', code: 'x' } }) === '',
  '未知 provider 按未配置处理（不乱注入）');
{
  const raw = '<html><head><script src="js/theme.js"></script>\n</head></html>';
  const cfg = { stats: { provider: 'goatcounter', code: 'a$&b' } };
  const once = stats.injectStats(raw, cfg);
  ok(once === stats.injectStats(once, cfg), '注入幂等：重复构建不叠加');
  ok(once.indexOf('a$&b.goatcounter.com') !== -1, 'code 含 $ 时按字面处理（函数式 replace）');
  ok(once.indexOf('<!-- stats:start -->') !== -1, '注入带起止标记，可被干净摘除');
  ok(stats.injectStats(raw, { stats: { provider: '', code: '' } }) === raw.replace(/\r\n/g, '\n'),
    '未配置时原样返回（不动页面）');
}
const VM_SITE = vm.runInContext('SITE', ctx) || {};
ok(VM_SITE.stats && typeof VM_SITE.stats === 'object', 'SITE.stats 配置块存在');
ok(!VM_SITE.stats.provider && !VM_SITE.stats.code,
  'SITE.stats 当前为空（注册统计服务后再填 code）');
ok(/injectStats/.test(fs.readFileSync(path.join(ROOT, 'tools', 'build-posts.js'), 'utf8')),
  'build-posts.js 已接入统计注入（文章页 + 站点级页面 + post.html）');
ok(/statsScriptHTML/.test(fs.readFileSync(path.join(ROOT, 'tools', 'build-links.js'), 'utf8')),
  'build-links.js 已接入统计注入（荐读详情页）');

section('相关阅读（正文纳入相似度）');
{
  const rp = vm.runInContext('relatedPosts', ctx);
  const list = rp(target, 3);
  ok(list.length === 3, '返回 3 篇相关文章');
  ok(list.every(function (q) { return q.id !== target.id; }), '相关阅读不含自己');
  // 缓存（bodyGramCache）不能破坏确定性：同一 target 跑两次结果必须一致
  const list2 = rp(target, 3);
  ok(JSON.stringify(list.map(function (q) { return q.id; })) ===
     JSON.stringify(list2.map(function (q) { return q.id; })),
    '结果确定（正文 gram 缓存不影响排序稳定性）');
  // 精排生效的硬证据：注入一对「标题/摘要完全不同、正文完全相同」的假文章。
  // 只有正文信号（精排）能把对方捞进 top3；若精排没生效，粗排分只有时间邻近
  // 一项（≈1.7），进不了前三。
  const FAKE_BODY = '<p>这是一段用于测试的正文，甲乙丙丁戊己庚辛，完全相同的两篇文章。</p>';
  vm.runInContext(
    'POSTS.push(' +
      JSON.stringify({ id: '__t_a', title: '甲乙丙丁', date: '2026-01-01', excerpt: '摘要甲', content: FAKE_BODY }) + ',' +
      JSON.stringify({ id: '__t_b', title: '戊己庚辛', date: '2026-01-02', excerpt: '摘要乙', content: FAKE_BODY }) +
    ')', ctx);
  const rpA = rp({ id: '__t_a', title: '甲乙丙丁', date: '2026-01-01', excerpt: '摘要甲', content: FAKE_BODY }, 3);
  ok(rpA.some(function (q) { return q.id === '__t_b'; }),
    '正文相似但标题摘要不同的文章，能被精排捞进相关阅读');
  vm.runInContext('POSTS.splice(POSTS.length - 2, 2)', ctx);  // 清理，不污染后续
}

/* ================= 汇总 ================= */
console.log('\n────────────────────────');
console.log((fail === 0 ? '✓ 全部通过' : '✗ 有失败项') + '：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
