/* ===========================================================
 * app.js — 页面渲染（首页 / 文章详情 / 归档 / 关于）
 * 依赖：index-data.js（SITE、POSTS 列表）
 *   · 文章正文在 js/posts/<n>.js 里按需加载（点开哪篇载哪篇）
 *   · 全文搜索用的正文文本在 js/search-text.js，用户搜索时才懒加载
 *   两者都由 tools/build-split.js 从 js/data.js 生成
 *
 * 结构取向：
 *   · 首页与归档均「按年份归类」
 *   · 每篇文章都有头图位；有图显示图，无图显示占位封面
 *   · 不使用标签系统
 * =========================================================== */

/* ---------- 工具 ---------- */
function byDateDesc(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }

function fmtDate(iso) {
  var p = iso.split("-");
  return p[0] + "年" + parseInt(p[1], 10) + "月" + parseInt(p[2], 10) + "日";
}
function fmtMonthDay(iso) {
  var p = iso.split("-");
  return parseInt(p[1], 10) + "月" + parseInt(p[2], 10) + "日";
}
function fmtShort(iso) {
  var p = iso.split("-");
  return p[1] + " / " + p[2];
}
function readingTime(html) {
  var text = String(html || "").replace(/<[^>]+>/g, "");
  var mins = Math.max(1, Math.round(text.length / 320));
  return "约 " + mins + " 分钟";
}
/* 列表用的阅读时长：索引里已经算好了，避免为了算时长去加载正文 */
function postMinutes(p) {
  if (p && typeof p.minutes === "number") return "约 " + p.minutes + " 分钟";
  return readingTime(p && p.content);
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}
function query(name) {
  // 静态文章页 post/<id>.html 没有 ?id=，由构建时注入的 window.__POST_ID__ 提供
  if (name === "id" && window.__POST_ID__ && !/[?&]id=/.test(location.search)) {
    return window.__POST_ID__;
  }
  var m = new RegExp("[?&]" + name + "=([^&]*)").exec(location.search);
  return m ? decodeURIComponent(m[1]) : "";
}

/* 文章页静态化后，站内文章链接统一指向 post/<id>.html（规范地址），
   这样分享出去微信/社交平台才能读到该篇自己的头图。
   带 <base> 的静态页即使位于子目录也能正确解析这个相对地址。 */
function articleHref(id) {
  return "post/" + encodeURIComponent(id) + ".html";
}
function dot() { return '<span class="dot">·</span>'; }

/* 用 id 生成一个稳定的配色序号，让每篇的占位封面颜色不同 */
function tone(p) {
  var h = 0, s = String(p.id || p.title || "");
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return "tone-" + ((h % 5) + 1);
}
function firstChar(t) {
  var s = String(t || "").trim();
  return s ? s.charAt(0) : "·";
}

/* 头图内部结构：底层是占位字，上层是真实图片（加载失败会自动移除，露出占位） */
function coverInner(p, charCls, alt) {
  var out = '<span class="' + charCls + '" aria-hidden="true">' + esc(firstChar(p.title)) + "</span>";
  if (p.cover) {
    out += '<img src="' + esc(p.cover) + '" alt="' + esc(alt === null ? "" : (p.coverAlt || p.title)) + '" loading="lazy" decoding="async">';
  }
  return out;
}

/* 头图下方的图注：只有真的配了图、且写了 coverAlt 才出现；
   占位封面（cover 为空）时不显示，免得在色块下面挂一行没来由的小字 */
function coverCaptionHTML(p) {
  if (!p.cover || !p.coverAlt) return "";
  return '<p class="cover-caption">' + esc(p.coverAlt) + "</p>";
}

/* 图片加载失败时移除自身，露出下面的占位封面，避免出现破图 */
function bindImgFallback(root) {
  Array.prototype.forEach.call(root.querySelectorAll("img"), function (img) {
    img.addEventListener("error", function () { if (img.parentNode) img.remove(); });
  });
}

/* ---------- 支持 / 赞赏 / 公众号 ---------- */
/* 只要 SITE 里还有 donate 或 wechat 对象，相关区块就会显示；
   想彻底隐藏，把对应那一段从 data.js 里删掉即可 */
function hasSupport() { return !!(SITE.donate || SITE.wechat); }

/* 二维码槽位：有图显示图（白底，保证可扫），没图显示虚线占位框 */
function qrBox(src, alt, waitText) {
  var inner = '<span class="qr-fallback" aria-hidden="true">' + waitText + "</span>";
  if (src) inner += '<img src="' + esc(src) + '" alt="' + esc(alt) + '" loading="lazy" decoding="async">';
  return '<div class="qr-box' + (src ? " has-img" : "") + '">' + inner + "</div>";
}

/* 「支持这个博客」整段（关于页与首页共用）
   headingId：给标题挂个锚点 id（关于页用 "support"）；
   首页把 id 挂在整段的外层 section 上，所以传空字符串 */
function supportSectionHTML(headingId) {
  var d = SITE.donate, w = SITE.wechat;
  if (!d && !w) return "";

  var cells = "";
  if (d) {
    cells +=
      '<div class="support-item">' +
        qrBox(d.image, "赞赏码", "赞赏码<br>待上传") +
        '<span class="qr-label">微信　扫码赞赏</span>' +
      "</div>";
  }
  if (w) {
    cells +=
      '<div class="support-item" id="wechat">' +
        qrBox(w.qr, "微信公众号二维码", "公众号二维码<br>待上传") +
        '<span class="qr-label">' +
          (w.name ? "扫码关注公众号「" + esc(w.name) + "」" : "扫码关注微信公众号") +
        "</span>" +
      "</div>";
  }

  var btn = (d && d.url)
    ? '<p class="support-alt"><a class="donate-btn" href="' + esc(d.url) + '" target="_blank" rel="noopener">通过链接支持 →</a></p>'
    : "";

  return (
    '<div class="support-panel">' +
      "<h2" + (headingId ? ' id="' + headingId + '"' : "") + ">支持这个博客</h2>" +
      '<p class="support-note">' + esc((d && d.note) || "如果这里的内容对你有过帮助，可以考虑请我喝一杯咖啡。") + "</p>" +
      '<div class="support-grid">' + cells + "</div>" +
      btn +
    "</div>"
  );
}

/* 文章末尾的小支持条 */
function supportStripHTML() {
  var d = SITE.donate, w = SITE.wechat;
  if (!d && !w) return "";
  var parts = ['<a class="donate-btn" href="index.html#support">赞赏</a>'];
  if (w) parts.push('<a class="ss-link" href="index.html#support">关注公众号</a>');
  return '<div class="support-strip">' + parts.join('<span class="dot">·</span>') + "</div>";
}

/* ---------- 分享 ---------- */
/* 分享出去的地址：线上用浏览器地址栏里的真实地址；
   本地双击打开（file://）时退回 SITE.url，免得分享出一个本地文件路径 */
function currentUrl() {
  var path = location.pathname || "/";
  var file = path.split("/").pop() || "index.html";
  if (/^https?:$/.test(location.protocol)) {
    // 用 origin + path 拼，比直接取 location.href 稳（且不会带上 hash）
    var origin = location.origin || (location.protocol + "//" + location.host);
    return origin + path + (location.search || "");
  }
  // 本地双击打开（file://）时退回 SITE.url，免得分享出一个本地文件路径
  var base = String(SITE.url || "").replace(/\/+$/, "");
  return base ? base + "/" + file + (location.search || "") : path + (location.search || "");
}

/* ---------- 分享信息卡（Open Graph / Twitter Card） ---------- */
/* 没有头图的文章（或占位封面）统一用这张站点图，避免分享出去是空白 */
var OG_DEFAULT = "images/og-default.jpg";

function isPlaceholderCover(cover) {
  return !cover || /shoe-repair-stall/.test(String(cover));
}

/* 相对路径转绝对地址：抓取方（社交平台）只认绝对 URL */
function absUrl(p) {
  var s = String(p || "");
  if (!s) return "";
  if (/^https?:/i.test(s)) return s;
  var base = String(SITE.url || "").replace(/\/+$/, "");
  var rel = s.replace(/^\.?\//, "");
  return base ? base + "/" + rel : rel;
}

/* 有则改写、无则新建 meta 标签 */
function upsertMeta(key, value, byName) {
  if (!document.head) return;
  var sel = (byName ? 'meta[name="' : 'meta[property="') + key + '"]';
  var el = document.querySelector(sel);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(byName ? "name" : "property", key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", value);
}

function applyShareMeta(o) {
  var title = o.title || SITE.title;
  var desc = o.desc || SITE.subtitle || SITE.bio || "";
  var image = absUrl(o.image || OG_DEFAULT);
  var url = o.url || currentUrl();

  document.title = title;

  upsertMeta("description", desc, true);
  upsertMeta("og:type", o.type || "article");
  upsertMeta("og:site_name", SITE.title);
  upsertMeta("og:locale", "zh_CN");
  upsertMeta("og:title", title);
  upsertMeta("og:description", desc);
  upsertMeta("og:url", url);
  upsertMeta("og:image", image);
  upsertMeta("twitter:card", "summary_large_image", true);
  upsertMeta("twitter:title", title, true);
  upsertMeta("twitter:description", desc, true);
  upsertMeta("twitter:image", image, true);

  var link = document.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    document.head.appendChild(link);
  }
  link.setAttribute("href", url);
}

function weiboUrl(u, title) {
  return "https://service.weibo.com/share/share.php?url=" +
         encodeURIComponent(u) + "&title=" + encodeURIComponent(title);
}
function doubanUrl(u, title, text) {
  return "https://www.douban.com/share/service?href=" + encodeURIComponent(u) +
         "&name=" + encodeURIComponent(title) +
         "&text=" + encodeURIComponent(String(text || "").slice(0, 120));
}

function shareBarHTML(p, url, title) {
  return (
    '<div class="share-bar">' +
      '<span class="share-label">分享</span>' +
      '<a class="share-chip s-weibo" href="' + esc(weiboUrl(url, title)) +
        '" target="_blank" rel="noopener" title="分享到微博">微博</a>' +
      '<a class="share-chip s-douban" href="' + esc(doubanUrl(url, p.title, p.excerpt)) +
        '" target="_blank" rel="noopener" title="分享到豆瓣">豆瓣</a>' +
      '<button class="share-chip s-wechat" type="button" data-share="wechat">微信</button>' +
      '<button class="share-chip s-copy" type="button" data-share="copy">复制链接</button>' +
      '<span class="share-toast" role="status" aria-live="polite"></span>' +
    "</div>"
  );
}

/* 复制：优先异步剪贴板 API；老浏览器 / 非 HTTPS 环境回退到 execCommand */
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise(function (resolve, reject) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { /* 忽略 */ }
    if (ta.parentNode) ta.parentNode.removeChild(ta);
    ok ? resolve() : reject(new Error("copy failed"));
  });
}

function flash(el, msg, ms) {
  if (!el) return;
  el.textContent = msg;
  clearTimeout(el._t);
  el._t = setTimeout(function () { el.textContent = ""; }, ms || 1800);
}

/* 首次点「微信」时才加载二维码库（js/vendor/qrcode.js），不拖慢文章页首屏 */
function loadQRLib(cb) {
  if (typeof window.qrcode === "function") return cb(null);
  var s = document.createElement("script");
  s.src = "js/vendor/qrcode.js";
  s.onload = function () {
    cb(typeof window.qrcode === "function" ? null : new Error("qrcode 未就绪"));
  };
  s.onerror = function () { cb(new Error("二维码库加载失败")); };
  document.head.appendChild(s);
}

var shareModal = null;
function onModalKey(e) { if (e.key === "Escape") closeShareModal(); }

function closeShareModal() {
  if (shareModal && shareModal.parentNode) shareModal.parentNode.removeChild(shareModal);
  shareModal = null;
  document.removeEventListener("keydown", onModalKey);
}

/* 微信没有网页端分享接口，标准做法是给一张当前页的二维码让用户扫 */
function openWechatModal(url) {
  closeShareModal();

  var wrap = document.createElement("div");
  wrap.className = "share-modal";
  wrap.innerHTML =
    '<div class="sm-card" role="dialog" aria-modal="true" aria-label="分享到微信">' +
      '<button class="sm-close" type="button" aria-label="关闭">×</button>' +
      "<h3>分享到微信</h3>" +
      '<div class="sm-qr"><span class="sm-qr-hint">正在生成二维码…</span></div>' +
      '<p class="sm-tip">用微信「扫一扫」打开本页，再点右上角 <b>···</b><br>即可分享给好友或朋友圈。</p>' +
      '<button class="sm-copy" type="button">复制链接</button>' +
      '<p class="sm-url">' + esc(url) + "</p>" +
    "</div>";
  document.body.appendChild(wrap);
  shareModal = wrap;

  wrap.addEventListener("click", function (e) {
    if (e.target === wrap || e.target.className === "sm-close") closeShareModal();
  });
  document.addEventListener("keydown", onModalKey);

  var qrBox = wrap.querySelector(".sm-qr");
  loadQRLib(function (err) {
    if (err || typeof window.qrcode !== "function") {
      qrBox.innerHTML = '<span class="sm-qr-hint">二维码加载失败<br>可直接复制下方链接</span>';
      return;
    }
    try {
      var qr = window.qrcode(0, "M");
      qr.addData(url);
      qr.make();
      qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch (e) {
      qrBox.innerHTML = '<span class="sm-qr-hint">二维码生成失败<br>可直接复制下方链接</span>';
    }
  });

  var copyBtn = wrap.querySelector(".sm-copy");
  copyBtn.addEventListener("click", function () {
    copyText(url).then(
      function () { flash(copyBtn, "已复制 ✓", 2000); },
      function () { flash(copyBtn, "复制失败，请长按选中下方链接", 2600); }
    );
  });
}

/* 复用分享弹层的暗色遮罩，展示一张现成的二维码图片（公众号 / 赞赏码） */
function openQrModal(title, src, caption) {
  closeShareModal();
  var wrap = document.createElement("div");
  wrap.className = "share-modal";
  wrap.innerHTML =
    '<div class="sm-card qr-modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<button class="sm-close" type="button" aria-label="关闭">×</button>' +
      "<h3>" + esc(title) + "</h3>" +
      '<div class="qr-modal-img"><img src="' + esc(src) + '" alt="' + esc(title) + '"></div>' +
      '<p class="qr-modal-cap">' + esc(caption) + "</p>" +
    "</div>";
  document.body.appendChild(wrap);
  shareModal = wrap;
  wrap.addEventListener("click", function (e) {
    if (e.target === wrap || e.target.className === "sm-close") closeShareModal();
  });
  document.addEventListener("keydown", onModalKey);
}

/* 底部固定导航栏（仅手机显示，桌面由顶栏导航承担） */
var ICON_BN_HOME =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.6 12 4l9 6.6"/><path d="M5 9.4V20h14V9.4"/><path d="M10 20v-5h4v5"/></svg>';
var ICON_BN_ARCHIVE =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h16v12.5H4z"/><path d="M3 7.5l1.6-3h14.8L21 7.5"/><path d="M9.5 11.5h5"/></svg>';
var ICON_BN_ABOUT =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11.2v5"/><path d="M12 7.7v.1"/></svg>';
var ICON_BN_SUPPORT =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-9.2A3.9 3.9 0 0 1 12 8.1a3.9 3.9 0 0 1 7 2.7C19 15.6 12 20 12 20Z"/></svg>';

var ICON_BN_LINK =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 4h11v16l-5.5-4-5.5 4V4z"/></svg>';

function initBottomNav() {
  if (document.getElementById("bottomNav")) return;
  var page = document.body.dataset.page || "home";
  function cls(href) {
    if (href === "index.html" && page === "home") return ' class="bn-item active"';
    if (href === "archive.html" && page === "archive") return ' class="bn-item active"';
    if (href === "links.html" && (page === "links" || page === "link")) return ' class="bn-item active"';
    if (href === "about.html" && page === "about") return ' class="bn-item active"';
    return ' class="bn-item"';
  }
  var nav = document.createElement("nav");
  nav.id = "bottomNav";
  nav.className = "bottom-nav";
  nav.setAttribute("aria-label", "底部导航");
  nav.innerHTML =
    '<a' + cls("index.html") + ' href="index.html">' + ICON_BN_HOME + "<span>首页</span></a>" +
    '<a' + cls("archive.html") + ' href="archive.html">' + ICON_BN_ARCHIVE + "<span>归档</span></a>" +
    '<a' + cls("links.html") + ' href="links.html">' + ICON_BN_LINK + "<span>荐读</span></a>" +
    '<a' + cls("about.html") + ' href="about.html">' + ICON_BN_ABOUT + "<span>关于</span></a>" +
    '<button class="bn-item bn-support" type="button" aria-haspopup="true" aria-expanded="false">' +
      ICON_BN_SUPPORT + "<span>支持</span></button>" +
    '<div class="bn-pop" hidden>' +
      (SITE.wechat ? '<button class="bn-pop-item" type="button" data-qr="wechat">关注公众号</button>' : "") +
      (SITE.donate ? '<button class="bn-pop-item" type="button" data-qr="donate">赞赏</button>' : "") +
    "</div>";
  document.body.appendChild(nav);

  var supportBtn = nav.querySelector(".bn-support");
  var pop = nav.querySelector(".bn-pop");

  function closePop() {
    pop.hidden = true;
    supportBtn.setAttribute("aria-expanded", "false");
  }
  supportBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    var open = pop.hidden;
    pop.hidden = !open;
    supportBtn.setAttribute("aria-expanded", String(open));
  });
  pop.addEventListener("click", function (e) {
    var btn = e.target.closest(".bn-pop-item");
    if (!btn) return;
    closePop();
    if (btn.dataset.qr === "wechat" && SITE.wechat) {
      openQrModal("扫码关注公众号", SITE.wechat.qr,
        SITE.wechat.name ? "微信扫一扫，关注「" + SITE.wechat.name + "」" : "微信扫一扫，关注微信公众号");
    } else if (btn.dataset.qr === "donate" && SITE.donate) {
      openQrModal("微信扫码赞赏", SITE.donate.image,
        SITE.donate.note || "如果这里的内容对你有过帮助，请我喝一杯咖啡");
    }
  });
  document.addEventListener("click", function (e) {
    if (!nav.contains(e.target)) closePop();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePop(); });
}

/* 给文章页的分享条绑事件 */
function bindShareBar(host, url) {
  if (!host) return;
  var bar = host.querySelector(".share-bar");
  if (!bar) return;
  var wx = bar.querySelector('[data-share="wechat"]');
  var cp = bar.querySelector('[data-share="copy"]');
  var toast = bar.querySelector(".share-toast");
  if (wx) wx.addEventListener("click", function () { openWechatModal(url); });
  if (cp) {
    cp.addEventListener("click", function () {
      copyText(url).then(
        function () { flash(toast, "链接已复制"); },
        function () { flash(toast, "复制失败，请长按地址栏选中"); }
      );
    });
  }
}

/* 按年份归类：[{ year: "2026", posts: [...] }, ...]，年份倒序 */
/* ---------- 正文图片点击放大 ---------- */
function initLightbox(host) {
  var imgs = [].slice.call(host.querySelectorAll(".article-body img"));
  if (!imgs.length) return;

  var box = document.createElement("div");
  box.className = "lightbox";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", "图片查看");
  box.innerHTML =
    '<button class="lb-btn lb-close" type="button" aria-label="关闭">✕</button>' +
    '<button class="lb-btn lb-prev" type="button" aria-label="上一张">‹</button>' +
    '<button class="lb-btn lb-next" type="button" aria-label="下一张">›</button>' +
    '<img class="lb-img" alt="">' +
    '<div class="lb-count" aria-live="polite"></div>';
  document.body.appendChild(box);

  var lbImg = box.querySelector(".lb-img");
  var countEl = box.querySelector(".lb-count");
  var prevBtn = box.querySelector(".lb-prev");
  var nextBtn = box.querySelector(".lb-next");
  var cur = 0;
  var lastFocus = null;
  var many = imgs.length > 1;

  function show(i) {
    cur = (i + imgs.length) % imgs.length;
    var img = imgs[cur];
    lbImg.setAttribute("src", img.getAttribute("src"));
    lbImg.setAttribute("alt", img.getAttribute("alt") || "");
    countEl.textContent = (cur + 1) + " / " + imgs.length;
    if (many) { countEl.style.display = ""; }
  }

  function isOpen() { return box.classList.contains("open"); }

  function open(i) {
    lastFocus = document.activeElement;
    show(i);
    box.classList.add("open");
    document.documentElement.style.overflow = "hidden";
    box.querySelector(".lb-close").focus();
  }

  function close() {
    box.classList.remove("open");
    document.documentElement.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  imgs.forEach(function (img, i) {
    img.classList.add("zoomable");
    img.setAttribute("tabindex", "0");
    img.setAttribute("role", "button");
    img.setAttribute("aria-label", "查看大图：" + (img.getAttribute("alt") || "文章配图"));
    img.addEventListener("click", function () { open(i); });
    img.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(i); }
    });
  });

  if (!many) { prevBtn.hidden = true; nextBtn.hidden = true; countEl.hidden = true; }

  box.querySelector(".lb-close").addEventListener("click", close);
  prevBtn.addEventListener("click", function (e) { e.stopPropagation(); show(cur - 1); });
  nextBtn.addEventListener("click", function (e) { e.stopPropagation(); show(cur + 1); });
  // 点图片以外的空白区域关闭
  box.addEventListener("click", function (e) {
    if (e.target === box) close();
  });

  document.addEventListener("keydown", function (e) {
    if (!isOpen()) return;
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowLeft" && many) { e.preventDefault(); show(cur - 1); }
    else if (e.key === "ArrowRight" && many) { e.preventDefault(); show(cur + 1); }
  });

  // 手机上左右滑动切图
  var startX = null;
  box.addEventListener("touchstart", function (e) {
    startX = e.touches[0].clientX;
  }, { passive: true });
  box.addEventListener("touchend", function (e) {
    if (startX === null || !many) { startX = null; return; }
    var dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 45) show(cur + (dx < 0 ? 1 : -1));
    startX = null;
  });
}

/* ---------- 阅读进度条 ---------- */
/* ---------- 滚动订阅 ----------
   页面上有好几处要跟着滚动更新（阅读进度条、右下角浮动工具条）。
   这里收成一个订阅点、共用一次 requestAnimationFrame 节流，
   避免每个模块各挂一个 scroll 监听、各算一遍滚动比例。 */
var _scrollSubs = [];
function onScroll(fn) {
  _scrollSubs.push(fn);
  if (_scrollSubs.length === 1) {
    var ticking = false;
    function run() {
      for (var i = 0; i < _scrollSubs.length; i++) _scrollSubs[i]();
      ticking = false;
    }
    function schedule() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(run);
    }
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
  }
  return fn;
}
function currentScrollY() {
  return window.pageYOffset || document.documentElement.scrollTop || 0;
}
/* 页面已滚动的比例 0~1（正文很短、压根滚不动时算 0） */
function scrollProgress() {
  var doc = document.documentElement;
  var max = doc.scrollHeight - window.innerHeight;
  if (max <= 40) return 0;
  return Math.min(1, Math.max(0, currentScrollY() / max));
}

function initReadProgress() {
  var bar = document.createElement("div");
  bar.className = "read-progress";
  bar.setAttribute("aria-hidden", "true");
  document.body.appendChild(bar);

  function paint() {
    bar.style.width = (scrollProgress() * 100).toFixed(2) + "%";
  }
  onScroll(paint);
  paint();
}

/* ---------- 长文目录（仅当正文确实有小标题时出现） ---------- */
function initTOC(host) {
  var body = host.querySelector(".article-body");
  if (!body) return;

  var heads = [].slice.call(body.querySelectorAll("h2, h3"));
  if (heads.length < 2) return;

  heads.forEach(function (h, i) {
    if (!h.id) h.id = "sec-" + (i + 1);
  });

  var items = heads.map(function (h) {
    return '<li class="toc-item toc-' + h.tagName.toLowerCase() + '">' +
             '<a href="#' + h.id + '">' + esc(h.textContent) + "</a>" +
           "</li>";
  }).join("");

  var nav = document.createElement("nav");
  nav.className = "toc";
  nav.setAttribute("aria-label", "本文目录");
  nav.innerHTML =
    '<button class="toc-toggle" type="button" aria-expanded="false">' +
      '<span>本文目录</span><span class="toc-arrow" aria-hidden="true">▾</span>' +
    "</button>" +
    '<ol class="toc-list">' + items + "</ol>";

  var anchor = body.querySelector("p, img, figure, blockquote, ul, ol");
  if (anchor && anchor.parentNode === body) body.insertBefore(nav, anchor);
  else body.insertBefore(nav, body.firstChild);

  var toggle = nav.querySelector(".toc-toggle");
  toggle.addEventListener("click", function () {
    var open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });

  // 目录项跳转后收起（移动端）
  nav.querySelector(".toc-list").addEventListener("click", function (e) {
    if (e.target.tagName === "A") {
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }
  });

  // 滚动时高亮当前小节
  var links = [].slice.call(nav.querySelectorAll("a"));
  var ticking = false;
  function highlight() {
    var y = (window.pageYOffset || document.documentElement.scrollTop || 0) + 120;
    var active = 0;
    heads.forEach(function (h, i) { if (h.offsetTop <= y) active = i; });
    links.forEach(function (a, i) { a.classList.toggle("active", i === active); });
    ticking = false;
  }
  window.addEventListener("scroll", function () {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(highlight);
  }, { passive: true });
  highlight();
}

/* ---------- 文末相关文章（时间邻近 + 标题相似） ---------- */
function bigrams(s) {
  var t = String(s || "").replace(/[\s\u3000，。、；：？！「」『』（）()《》〈〉“”"'’·—\-…|｜/:：]/g, "");
  var set = {};
  for (var i = 0; i < t.length - 1; i++) set[t.substr(i, 2)] = 1;
  return set;
}
function simScore(a, b) {
  var A = bigrams(a), B = bigrams(b);
  var inter = 0, total = 0, k;
  for (k in A) { total++; if (B[k]) inter++; }
  for (k in B) { total++; if (A[k]) inter++; }
  return total ? (2 * inter) / total : 0;
}
function daysBetween(a, b) {
  var t1 = Date.parse(a), t2 = Date.parse(b);
  if (isNaN(t1) || isNaN(t2)) return 9999;
  return Math.abs(Math.round((t1 - t2) / 86400000));
}

function relatedPosts(p, n) {
  var year = String(p.date).slice(0, 4);
  return POSTS
    .filter(function (q) { return q.id !== p.id; })
    .map(function (q) {
      var days = daysBetween(q.date, p.date);
      var score = 1.4 / (1 + days / 45);                       // 时间邻近
      score += simScore(p.title, q.title) * 2.2;                // 标题相似
      score += simScore(p.excerpt, q.excerpt) * 0.8;            // 摘要相似
      if (String(q.date).slice(0, 4) === year) score += 0.3;    // 同年略加权
      return { post: q, score: score };
    })
    .sort(function (a, b) { return b.score - a.score; })
    .slice(0, n || 3)
    .map(function (r) { return r.post; });
}

function relatedSectionHTML(p) {
  var list = relatedPosts(p, 3);
  if (!list.length) return "";
  return (
    '<section class="related">' +
      '<h2 class="related-head">也许你还想看</h2>' +
      '<ul class="related-list">' +
        list.map(function (q) {
          return (
            '<li>' +
              '<a href="' + articleHref(q.id) + '">' +
                '<span class="rel-date">' + fmtShort(q.date) + "</span>" +
                '<span class="rel-title">' + esc(q.title) + "</span>" +
              "</a>" +
            "</li>"
          );
        }).join("") +
      "</ul>" +
    "</section>"
  );
}

function groupByYear(list) {
  var map = {};
  list.forEach(function (p) {
    var y = String(p.date).slice(0, 4);
    (map[y] = map[y] || []).push(p);
  });
  return Object.keys(map).sort().reverse().map(function (y) {
    return { year: y, posts: map[y] };
  });
}

/* ---------- 站内搜索 ---------- */
/* 把正文 HTML 转成纯文本，用于检索与摘要 */
function plainText(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/* 检索用的正文：优先取懒加载的全文索引；
   索引还没准备好时退回「标题 + 摘要」的快速结果，索引一到就自动升级 */
function postText(p) {
  // 荐读条目的全文在 window.LINK_TEXT 里（文章在 SEARCH_TEXT 里）
  if (p.kind === "link") {
    var lt = window.LINK_TEXT;
    return lt && typeof lt[p.id] === "string" ? lt[p.id] : "";
  }
  var idx = window.SEARCH_TEXT;
  if (idx && typeof idx[p.id] === "string") return idx[p.id];
  return "";
}

/* 全文搜索索引：用户真正开始搜索时才加载，不拖慢首屏 */
var searchIndexState = 0;   // 0 未加载 / 1 加载中 / 2 就绪 / 3 加载失败
var searchIndexWaiters = [];

function ensureSearchIndex(cb) {
  if (searchIndexState === 2 || searchIndexState === 3) { if (cb) cb(); return; }
  if (searchIndexState === 1) { if (cb) searchIndexWaiters.push(cb); return; }
  searchIndexState = 1;
  if (cb) searchIndexWaiters.push(cb);
  var s = document.createElement("script");
  s.src = "js/search-text.js";
  s.onload = function () {
    searchIndexState = 2;
    var list = searchIndexWaiters; searchIndexWaiters = [];
    list.forEach(function (f) { if (f) f(); });
  };
  s.onerror = function () {
    searchIndexState = 3;   // 加载不到就只用标题与摘要搜索，不影响可用性
    var list = searchIndexWaiters; searchIndexWaiters = [];
    list.forEach(function (f) { if (f) f(); });
  };
  document.head.appendChild(s);
}

/* 荐读全文索引：同样只在用户真的搜索时才拉，不拖慢首屏 */
var linkIndexState = 0;   // 0 未加载 / 1 加载中 / 2 就绪 / 3 加载失败

function ensureLinkIndex(cb) {
  if (linkIndexState === 2 || linkIndexState === 3) { if (cb) cb(); return; }
  if (linkIndexState === 1) { if (cb) setTimeout(cb, 0); return; }
  linkIndexState = 1;
  function finish() {
    linkIndexState = (typeof LINKS !== "undefined" && window.LINK_TEXT) ? 2 : 3;
    if (cb) cb();
  }
  function loadText() {
    var s2 = document.createElement("script");
    s2.src = "js/links-text.js";
    s2.onload = finish; s2.onerror = finish;
    document.head.appendChild(s2);
  }
  if (typeof LINKS === "undefined") {
    var s1 = document.createElement("script");
    s1.src = "js/links-data.js";
    s1.onload = loadText; s1.onerror = loadText;
    document.head.appendChild(s1);
  } else {
    loadText();
  }
}

/* 荐读：标题 > 评语 > 全文，同样要求所有关键词都命中 */
function searchLinks(terms) {
  var out = [];
  if (typeof LINKS === "undefined" || !LINKS) return out;
  var texts = window.LINK_TEXT || {};
  LINKS.forEach(function (l) {
    var title = String(l.title || "").toLowerCase();
    var note = String(l.note || "").toLowerCase();
    var body = String(texts[l.id] || "").toLowerCase();
    var score = 0;
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i], s = 0;
      if (title.indexOf(t) !== -1) s += 10;
      if (note.indexOf(t) !== -1) s += 4;
      if (body.indexOf(t) !== -1) s += 1;
      if (!s) return; // 有一个词没命中，这条不算
      score += s;
    }
    out.push({
      post: {
        id: l.id, title: l.title, date: l.date, excerpt: l.note || "",
        minutes: l.minutes || 1, source: l.source,
        href: linkHref(l.id), kind: "link"
      },
      score: score
    });
  });
  return out;
}

function containsAny(text, terms) {
  var l = String(text).toLowerCase();
  for (var i = 0; i < terms.length; i++) if (l.indexOf(terms[i]) !== -1) return true;
  return false;
}

/* 命中片段：摘要里有就用摘要，否则从正文里截一段上下文出来 */
function snippet(p, terms) {
  var ex = p.excerpt || "";
  if (!terms.length || containsAny(ex, terms)) return ex;
  var body = postText(p);
  var lower = body.toLowerCase();
  for (var i = 0; i < terms.length; i++) {
    var at = lower.indexOf(terms[i]);
    if (at !== -1) {
      var start = Math.max(0, at - 40);
      var end = Math.min(body.length, at + 110);
      return (start > 0 ? "…" : "") + body.slice(start, end).trim() + (end < body.length ? "…" : "");
    }
  }
  return ex;
}

/* 相关度：标题 > 摘要 > 正文；所有关键词都要命中才算匹配 */
function searchPosts(terms) {
  var out = [];
  POSTS.forEach(function (p) {
    var title = String(p.title || "").toLowerCase();
    var ex = String(p.excerpt || "").toLowerCase();
    var body = postText(p).toLowerCase();
    var score = 0;
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i], s = 0;
      if (title.indexOf(t) !== -1) s += 10;
      if (ex.indexOf(t) !== -1) s += 4;
      if (body.indexOf(t) !== -1) s += 1;
      if (!s) return; // 有一个词没命中，这篇不算
      score += s;
    }
    out.push({ post: p, score: score });
  });
  return out.sort(function (a, b) {
    return b.score - a.score || byDateDesc(a.post, b.post);
  });
}

/* 安全高亮：先按原始位置切片，再逐段转义，避免注入 */
function highlight(text, terms) {
  var s = String(text == null ? "" : text);
  if (!terms || !terms.length) return esc(s);

  var lower = s.toLowerCase();
  var ranges = [];
  terms.forEach(function (t) {
    if (!t) return;
    var from = 0, at;
    while ((at = lower.indexOf(t, from)) !== -1) {
      ranges.push([at, at + t.length]);
      from = at + t.length;
    }
  });
  if (!ranges.length) return esc(s);

  ranges.sort(function (a, b) { return a[0] - b[0]; });
  var merged = [];
  ranges.forEach(function (r) {
    var last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  });

  var out = "", pos = 0;
  merged.forEach(function (r) {
    out += esc(s.slice(pos, r[0])) + "<mark>" + esc(s.slice(r[0], r[1])) + "</mark>";
    pos = r[1];
  });
  return out + esc(s.slice(pos));
}

function searchItemHTML(p, terms) {
  return (
    '<article class="post-item no-thumb reveal">' +
      '<div class="item-main">' +
        '<h2 class="item-title"><a href="' + (p.href || articleHref(p.id)) + '">' +
          highlight(p.title, terms) + "</a></h2>" +
        '<div class="item-meta">' +
          (p.kind === "link" ? '<span class="link-badge">荐读</span>' : "") +
          (p.kind === "link" && p.source ? "<span>" + esc(p.source) + "</span>" + dot() : "") +
          "<span>" + fmtDate(p.date) + "</span>" + dot() +
          "<span>" + postMinutes(p) + "</span>" +
        "</div>" +
        '<p class="item-excerpt">' + highlight(snippet(p, terms), terms) + "</p>" +
      "</div>" +
    "</article>"
  );
}

/* ---------- 公共外壳：顶栏 + 页脚 ---------- */
var NAV = [
  { href: "index.html", text: "首页" },
  { href: "archive.html", text: "归档" },
  { href: "links.html", text: "荐读" },
  { href: "about.html", text: "关于" }
];
var FEED = "feed.xml";

function renderShell(active) {
  var header = document.getElementById("site-header");
  if (header) {
    var links = NAV.map(function (n) {
      var cls = n.href === active ? ' class="active"' : "";
      return '<a href="' + n.href + '"' + cls + ">" + n.text + "</a>";
    }).join("");
    header.className = "site-header";
    header.innerHTML =
      '<div class="wrap nav">' +
        '<a class="brand" href="index.html">' + esc(SITE.title) + "</a>" +
        '<nav class="nav-links" id="navLinks">' + links +
          '<button class="icon-btn theme-toggle" id="themeToggle" type="button" aria-label="切换主题"></button>' +
        "</nav>" +
        '<button class="icon-btn" id="navToggle" type="button" aria-label="菜单">☰</button>' +
      "</div>";
  }

  var footer = document.getElementById("site-footer");
  if (footer) {
    var y = new Date().getFullYear();
    var mailLink = SITE.email ? '<a href="mailto:' + SITE.email + '">写信给我</a>' : "";
    footer.className = "site-footer";
    footer.innerHTML =
      '<div class="wrap footer-inner">' +
        '<div><div class="f-brand">' + esc(SITE.title) + "</div>" +
        "<div>© " + SITE.startYear + "–" + y + " " + esc(SITE.author) + "　原创内容，转载请先来信</div></div>" +
        '<div class="footer-links">' +
          NAV.map(function (n) { return '<a href="' + n.href + '">' + n.text + "</a>"; }).join("") +
          (hasSupport() ? '<a href="index.html#support">支持</a>' : "") +
          '<a class="rss" href="' + FEED + '">RSS</a>' +
          mailLink +
        "</div>" +
      "</div>";
  }

  var t = document.documentElement.getAttribute("data-theme");
  var btn = document.getElementById("themeToggle");
  if (btn && window.syncThemeIcon) window.syncThemeIcon(t);
}

/* ---------- 列表条目模板 ---------- */
function postItemHTML(p, i) {
  var thumb =
    '<a class="item-thumb ' + tone(p) + '" href="' + articleHref(p.id) + '" tabindex="-1" aria-hidden="true">' +
      coverInner(p, "thumb-char", null) +
    "</a>";
  return (
    '<article class="post-item reveal" id="post-' + p.id + '" style="animation-delay:' + (i * 45) + 'ms">' +
      thumb +
      '<div class="item-main">' +
        '<h2 class="item-title"><a href="' + articleHref(p.id) + '">' + esc(p.title) + "</a></h2>" +
        '<div class="item-meta">' +
          "<span>" + fmtMonthDay(p.date) + "</span>" + dot() +
          "<span>" + postMinutes(p) + "</span>" +
        "</div>" +
        '<p class="item-excerpt">' + esc(p.excerpt) + "</p>" +
      "</div>" +
    "</article>"
  );
}

/* ---------- 首页：搜索框 + 按年份归类 + 支持区块 ---------- */
/* 两种视图共用同一块列表容器：
     无关键词 → 按年份归类的常规列表
     有关键词 → 打平为按相关度排序的搜索结果（标题/摘要高亮） */
function initHome() {
  renderShell("index.html");

  var listEl = document.getElementById("postList");
  var countEl = document.getElementById("postCount");
  var input = document.getElementById("searchInput");
  var statusEl = document.getElementById("searchStatus");
  var clearBtn = document.getElementById("searchClear");
  var sorted = POSTS.slice().sort(byDateDesc);

  if (countEl) countEl.textContent = sorted.length ? "共 " + sorted.length + " 篇" : "还没有文章";

  /* 从文章页「返回首页」时，地址栏带 #post-<id>，
     这里在完整列表渲染好后定位到那篇文章，而不是跳回页首 */
  var scrolledForHash = false;
  function scrollToPostFromHash() {
    if (scrolledForHash) return;
    var m = /^#post-(.+)$/.exec(location.hash || "");
    if (!m) return;
    var pid = decodeURIComponent(m[1]);
    var target = document.getElementById("post-" + pid);
    if (!target) return;
    scrolledForHash = true;
    // 卡片入场动画延迟按全站序号累积，深位置会透明十几秒；
    // 跳过动画让整列立即可见，定位才准确、不露白
    document.body.classList.add("reveal-instant");
    var header = document.getElementById("site-header");
    var off = (header ? header.offsetHeight : 0) + 12;
    function go() {
      var top = target.getBoundingClientRect().top +
                (window.pageYOffset || document.documentElement.scrollTop || 0) - off;
      window.scrollTo(0, Math.max(0, top));
    }
    go();
    // 懒加载图片 / 字体回流可能微调位置，多校正几次
    // （定时器在个别极简环境里可能不存在，做一下存在性判断）
    if (window.addEventListener) {
      window.addEventListener("load", go, { once: true });
    }
    if (typeof setTimeout === "function") {
      setTimeout(go, 120);
      setTimeout(go, 400);
    }
  }

  function byYearHTML() {
    if (!sorted.length) {
      return '<div class="empty">还没有文章。在 <code>js/data.js</code> 里加一篇试试。</div>';
    }
    var idx = 0;
    return groupByYear(sorted).map(function (g) {
      var items = g.posts.map(function (p) { return postItemHTML(p, idx++); }).join("");
      return (
        '<section class="year-group">' +
          '<h2 class="year-head">' +
            '<span class="year-num">' + g.year + "</span>" +
            "<small>" + g.posts.length + " 篇</small>" +
          "</h2>" +
          '<div class="year-items">' + items + "</div>" +
        "</section>"
      );
    }).join("");
  }

  function paint(raw) {
    var q = String(raw || "").trim();
    var terms = q.toLowerCase().split(/\s+/).filter(Boolean);

    if (!terms.length) {
      if (statusEl) { statusEl.hidden = true; statusEl.textContent = ""; }
      listEl.innerHTML = byYearHTML();
      scrollToPostFromHash();   // 首次渲染完整列表后，按需定位回原文位置
    } else {
      // 第一次搜索时才把全文索引拉过来，拿到后自动重搜一遍
      if (searchIndexState === 0) {
        ensureSearchIndex(function () { paint(input ? input.value : q); });
      }
      // 荐读索引同样按需加载，拿到后自动重搜一遍
      if (linkIndexState === 0) {
        ensureLinkIndex(function () { paint(input ? input.value : q); });
      }
      // 文章与荐读的结果合并后统一按相关度排序
      var found = searchPosts(terms).concat(searchLinks(terms)).sort(function (a, b) {
        return b.score - a.score || byDateDesc(a.post, b.post);
      });
      var preparing = searchIndexState === 1 || linkIndexState === 1;
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = found.length
          ? "找到 " + found.length + " 篇" +
            (preparing ? "（先在标题和摘要里找，正在载入全文…）" : "，按相关度排序")
          : (preparing
              ? "标题和摘要里没有，正在载入全文再找一遍…"
              : "没有找到匹配「" + q + "」的文章");
      }
      listEl.innerHTML = found.length
        ? '<div class="search-results">' +
            found.map(function (r) { return searchItemHTML(r.post, terms); }).join("") +
          "</div>"
        : '<div class="empty">换个词试试？可以只搜一个人名、一个地名，<br>或者一句你还记得的话。</div>';
    }

    if (clearBtn) clearBtn.hidden = !q;

    // 同步地址栏，便于分享 / 刷新 / 收藏
    try {
      history.replaceState(null, "", terms.length ? "?q=" + encodeURIComponent(q) : location.pathname);
    } catch (err) { /* file:// 下忽略 */ }

    bindImgFallback(listEl);
  }

  if (input) {
    input.addEventListener("input", function () { paint(input.value); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { input.value = ""; paint(""); }
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      if (input) { input.value = ""; input.focus(); }
      paint("");
    });
  }

  paint(query("q"));
  renderSupportAside();
}

/* 首页右侧栏：赞赏码 / 公众号二维码
   未配置 donate 与 wechat 时整栏不显示，正文自动占满整行 */
function renderSupportAside() {
  var aside = document.getElementById("support"); // 外层 aside，同时是 #support 锚点
  var host = document.getElementById("supportHost");
  var grid = document.getElementById("homeGrid");
  if (!aside || !host) return;

  if (!hasSupport()) {
    aside.hidden = true;
    if (grid) grid.className = "home-grid no-aside";
    return;
  }
  host.innerHTML = supportSectionHTML("");
  aside.hidden = false;
  if (grid) grid.className = "home-grid";
  bindImgFallback(host);
}

/* ---------- 文章详情 ---------- */
/* ---------- 正文按需加载 ----------
   每篇文章的正文单独放在 js/posts/<n>.js 里，用 <script> 注入（而不是 fetch），
   这样本地双击打开（file://）也能用。 */
var postWaiters = {};

/* 当前文章页所打开文章的 id；供「返回首页」时把位置带回去 */
var CURRENT_POST_ID = null;

function loadPostHTML(p, cb) {
  var store = window.__POST_HTML__ || {};
  if (typeof store[p.n] === "string") { cb(store[p.n]); return; }
  if (typeof p.n !== "number") { cb(p.content || ""); return; }  // 兼容旧数据结构

  var key = "n" + p.n;
  if (postWaiters[key]) { postWaiters[key].push(cb); return; }
  postWaiters[key] = [cb];

  function done(html) {
    var list = postWaiters[key] || [];
    delete postWaiters[key];
    list.forEach(function (f) { f(html); });
  }

  var s = document.createElement("script");
  s.src = "js/posts/" + p.n + ".js";
  s.onload = function () { done((window.__POST_HTML__ || {})[p.n] || ""); };
  s.onerror = function () { done(""); };
  document.head.appendChild(s);
}

function initPost() {
  renderShell("");
  var id = query("id");
  var sorted = POSTS.slice().sort(byDateDesc);
  var idx = -1;
  sorted.forEach(function (p, i) { if (p.id === id) idx = i; });

  var host = document.getElementById("postHost");
  if (idx === -1) {
    applyShareMeta({
      title: "找不到这篇文章 · " + SITE.title,
      desc: "这篇文章可能已被移动或删除。",
      type: "website"
    });
    host.innerHTML =
      '<div class="article"><h1>找不到这篇文章</h1>' +
      '<p style="color:var(--text-2)">它可能已经被移动或删除了。</p>' +
      '<p><a class="back-link" href="index.html">← 回到首页</a></p></div>';
    return;
  }

  var p = sorted[idx];
  CURRENT_POST_ID = id;
  // 让文章页上所有「回首页」入口（返回链接 / 顶栏首页 / Logo / 浮动按钮）
  // 都带上本篇 id，点回去时首页会定位到这篇文章，而不是跳到页首
  var backHash = "index.html#post-" + encodeURIComponent(id);
  // 顶栏首页 / Logo / 页脚首页：这些是公共外壳渲染的，这里补上本篇 id，
  // 让所有「回首页」入口的落点一致（正文里的「← 返回首页」已在模板里带上）
  Array.prototype.forEach.call(
    document.querySelectorAll('a[href="index.html"]'),
    function (a) { a.setAttribute("href", backHash); }
  );
  var prev = sorted[idx - 1]; // 更新的一篇
  var next = sorted[idx + 1]; // 更早的一篇

  var pn = "";
  if (prev || next) {
    pn =
      '<div class="prevnext">' +
        (prev
          ? '<a class="pn prev" href="' + articleHref(prev.id) + '"><small>← 更新的一篇</small><span>' + esc(prev.title) + "</span></a>"
          : "<span></span>") +
        (next
          ? '<a class="pn next" href="' + articleHref(next.id) + '"><small>更早的一篇 →</small><span>' + esc(next.title) + "</span></a>"
          : "<span></span>") +
      "</div>";
  }

  var shareUrl = currentUrl();
  var shareTitle = p.title + " · " + SITE.title;

  applyShareMeta({
    title: shareTitle,
    desc: p.excerpt || SITE.subtitle || SITE.bio || "",
    image: isPlaceholderCover(p.cover) ? OG_DEFAULT : p.cover,
    url: shareUrl,
    type: "article"
  });

  // 静态正文 hydrate：post/<id>.html 在构建时已经把正文写进了页面
  // （见 tools/build-posts.js 的 staticArticleHTML）。这里先把已有的正文
  // 取出来，等会儿直接用它，省掉一次 js/posts/<n>.js 请求，
  // 也避免「正在载入正文…」闪一下。
  // 老入口 post.html?id= 没有静态正文，getElementById 返回 null，走原分支。
  var staticBody = "";
  if (window.__POST_ID__ && window.__POST_ID__ === id) {
    var pre = document.getElementById("articleBody");
    if (pre && pre.innerHTML) staticBody = pre.innerHTML;
  }

  host.innerHTML =
    '<article class="article">' +
      // 带上本篇 id：点回去时首页会定位到这篇文章，而不是跳到列表最前面
      '<a class="back-link" href="index.html#post-' + encodeURIComponent(id) + '">← 返回首页</a>' +
      "<h1>" + esc(p.title) + "</h1>" +
      '<div class="article-meta">' +
        "<span>" + fmtDate(p.date) + "</span>" + dot() +
        "<span>" + postMinutes(p) + "</span>" + dot() +
        "<span>" + esc(SITE.author) + "</span>" +
      "</div>" +
      '<figure class="article-cover ' + tone(p) + '">' + coverInner(p, "cover-char", p.coverAlt || p.title) + "</figure>" +
      coverCaptionHTML(p) +
      '<div class="article-body" id="articleBody">' +
        (staticBody || '<p class="body-loading">正在载入正文…</p>') +
      "</div>" +
      shareBarHTML(p, shareUrl, shareTitle) +
      relatedSectionHTML(p) +
      pn +
      supportStripHTML() +
    "</article>";

  bindShareBar(host, shareUrl);
  initReadProgress();

  if (staticBody) {
    // 正文已在页面里：直接绑定图片兜底 / 目录 / 灯箱，不再发请求
    var b0 = document.getElementById("articleBody");
    if (b0) bindImgFallback(b0);
    initTOC(host);       // 目录依赖正文里的 h2/h3
    initLightbox(host);  // 图片同理
  } else {
    // 正文按需加载：打开哪篇才下载哪篇（js/posts/<n>.js）
    loadPostHTML(p, function (html) {
      var body = document.getElementById("articleBody");
      if (!body) return;
      body.innerHTML = html || ("<p>" + esc(p.excerpt) + "</p>");
      bindImgFallback(body);
      initTOC(host);       // 目录依赖正文里的 h2/h3，所以放在正文到位之后
      initLightbox(host);  // 图片同理
    });
  }
}

/* ---------- 归档：按年份归类（仅标题，便于速览） ---------- */
function initArchive() {
  renderShell("archive.html");
  var sorted = POSTS.slice().sort(byDateDesc);
  var cntEl = document.getElementById("arcCount");
  if (cntEl) cntEl.textContent = sorted.length;

  var host = document.getElementById("archiveHost");
  if (!sorted.length) { host.innerHTML = '<div class="empty">还没有文章</div>'; return; }

  var groups = groupByYear(sorted);
  var yEl = document.getElementById("arcYears");
  if (yEl) yEl.textContent = groups.length;

  host.innerHTML = groups.map(function (g) {
    var items = g.posts.map(function (p) {
      return (
        '<a class="arc-item" href="' + articleHref(p.id) + '">' +
          '<span class="arc-date">' + fmtShort(p.date) + "</span>" +
          '<span class="arc-title">' + esc(p.title) + "</span>" +
        "</a>"
      );
    }).join("");
    return (
      '<section class="archive-year reveal">' +
        "<h2>" + g.year + "<small>" + g.posts.length + " 篇</small></h2>" + items +
      "</section>"
    );
  }).join("");
}

/* ---------- 关于 ---------- */
function initAbout() {
  renderShell("about.html");
  var body = document.getElementById("aboutBody");
  if (!body) return;
  var mailRow = SITE.email
    ? '<li><span class="k">邮箱</span><span>' + esc(SITE.email) + "</span></li>"
    : "";
  var wechatRow = SITE.wechat
    ? '<li><span class="k">公众号</span><span>' +
        (SITE.wechat.name
          ? esc(SITE.wechat.name) + "　与本站同步更新"
          : "与本站同步更新，二维码见下方") +
      "</span></li>"
    : "";
  body.innerHTML =
    '<div class="about-head">' +
      '<div class="avatar">舟</div>' +
      "<div><h1>" + esc(SITE.author) + "</h1><p>" + esc(SITE.bio) + "</p></div>" +
    "</div>" +
    '<div class="about-body">' +
      "<h2>写作的最终目标</h2>" +
      "<p>朝着重建生活和世界的目标进发。坏人们懂得团结却不懂得自由，好人们理解了自由却忽视了团结。" +
      "所以，那获得最终胜利的，必然是率先让自由和团结结合在一起的那一方。" +
      "一切朝着真实而努力的尝试，都不会是徒劳和虚妄，因为历史本身最终会证实自己的合理性。</p>" +
      "<h2>关于我</h2>" +
      "<p>一个真实的人，努力成为一个完整意义上的人，一个大写的人</p>" +
      "<h2>找到我</h2>" +
      '<ul class="info-list">' + mailRow +
        wechatRow +
        '<li><span class="k">更新</span><span>不定期，随缘</span></li>' +
        '<li><span class="k">订阅</span><span><a href="' + FEED + '">RSS 订阅</a></span></li>' +
        '<li><span class="k">转载</span><span>注明出处即可</span></li>' +
      "</ul>" +
      supportSectionHTML("support") +
    "</div>";
  bindImgFallback(body);
}

/* ---------- 右下角浮动工具条 ----------
   文章页原本没有这个按钮，读完长文想回去只能一路滚到页面最上面；
   现在四个页面统一在右下角常驻：
     · 回首页 —— 只在非首页出现（首页不会挂一个指向自己的「回首页」）
     · 回顶部 —— 实心主色 + 外圈阅读进度环，跟着阅读进度走，随时可点
                 （页面已在最顶端时置灰，但位置不变，滚一下就激活） */
var ICON_HOME =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M3.2 10.7 12 3.9l8.8 6.8"></path>' +
    '<path d="M5.7 9.7V20h12.6V9.7"></path>' +
    '<path d="M9.8 20v-5.7h4.4V20"></path>' +
  '</svg>';
var ICON_TOP =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M12 19.2V7.4"></path>' +
    '<path d="M5.7 13.5 12 6.7l6.3 6.8"></path>' +
  '</svg>';

var FT_R = 25.5;                     // 进度环半径（按钮直径 56px）
var FT_C = 2 * Math.PI * FT_R;       // 周长，用它换算 dashoffset
var FT_IDLE_AT = 40;                 // 距顶多少像素以内算「已在顶部」

function initFloatTools() {
  var box = document.getElementById("floatTools");
  if (!box) return;
  var isHome = document.body.dataset.page === "home";

  if (!isHome) {
    var homeBtn = document.createElement("button");
    homeBtn.type = "button";
    homeBtn.id = "toHome";
    homeBtn.className = "ft-btn ft-home";
    homeBtn.title = "返回首页";
    homeBtn.setAttribute("aria-label", "返回首页");
    homeBtn.innerHTML = ICON_HOME;
    homeBtn.addEventListener("click", function () {
      // 在文章页点击时，带上当前文章 id，让首页定位回原文位置
      location.href = "index.html" +
        (CURRENT_POST_ID ? "#post-" + encodeURIComponent(CURRENT_POST_ID) : "");
    });
    box.appendChild(homeBtn);
  }

  var topBtn = document.createElement("button");
  topBtn.type = "button";
  topBtn.id = "toTop";
  topBtn.className = "ft-btn ft-top is-idle";
  topBtn.title = "回到顶部";
  topBtn.setAttribute("aria-label", "回到顶部");
  topBtn.innerHTML =
    '<svg class="ft-ring" viewBox="0 0 56 56" aria-hidden="true">' +
      '<circle class="ring-bg" cx="28" cy="28" r="' + FT_R + '"></circle>' +
      '<circle class="ring-fill" cx="28" cy="28" r="' + FT_R + '" ' +
        'stroke-dasharray="' + FT_C.toFixed(2) + '" ' +
        'stroke-dashoffset="' + FT_C.toFixed(2) + '"></circle>' +
    '</svg>' + ICON_TOP;
  box.appendChild(topBtn);

  // DOM 桩里 querySelector 会返回 null，这里做个兜底，进度环拿不到也不影响按钮可用
  var fill = topBtn.querySelector ? topBtn.querySelector(".ring-fill") : null;

  function paint() {
    var y = currentScrollY();
    var idle = y <= FT_IDLE_AT;
    topBtn.classList.toggle("is-idle", idle);
    if (fill) {
      fill.style.strokeDashoffset = (FT_C * (1 - scrollProgress())).toFixed(2);
    }
    var label = idle ? "回到顶部" : "回到顶部 · 已读 " + Math.round(scrollProgress() * 100) + "%";
    topBtn.title = label;
    topBtn.setAttribute("aria-label", label);
  }

  topBtn.addEventListener("click", function () {
    var reduce = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    try {
      window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    } catch (e) {
      window.scrollTo(0, 0);   // 老浏览器不支持对象参数
    }
    topBtn.blur();             // 回到顶部后让焦点回到文档流
  });

  onScroll(paint);
  paint();
}

/* ---------- 启动 ---------- */
/* ---------- 荐读（好文收藏）----------
   数据源是 links/*.md，由 tools/build-links.js 生成 js/links-data.js 与静态详情页。
   和主博客文章完全独立：不进首页列表、不算进文章数、不进归档，
   只在「荐读」页和站内搜索里出现。 */
function linkHref(id) {
  return "links/" + encodeURIComponent(id) + ".html";
}

function linkItemHTML(l, i) {
  var meta = [];
  if (l.source) meta.push("<span>" + esc(l.source) + "</span>");
  if (l.date) meta.push("<span>" + fmtDate(l.date) + "</span>");
  meta.push("<span>" + (l.minutes || 1) + " 分钟</span>");
  return (
    '<article class="post-item no-thumb reveal link-item" id="link-' + l.id + '" style="animation-delay:' + (i * 45) + 'ms">' +
      '<div class="item-main">' +
        '<h2 class="item-title"><a href="' + linkHref(l.id) + '">' + esc(l.title) + "</a></h2>" +
        '<div class="item-meta">' +
          '<span class="link-badge">荐读</span>' + meta.join(dot()) +
        "</div>" +
        (l.note ? '<p class="item-excerpt">' + esc(l.note) + "</p>" : "") +
      "</div>" +
    "</article>"
  );
}

function initLinks() {
  renderShell("links.html");
  var listEl = document.getElementById("linkList");
  var countEl = document.getElementById("linkCount");
  var all = (typeof LINKS !== "undefined" && LINKS)
    ? LINKS.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; })
    : [];
  if (countEl) countEl.textContent = "共 " + all.length + " 篇";
  if (!listEl) return;
  listEl.innerHTML = all.length
    ? all.map(linkItemHTML).join("")
    : '<div class="empty">还没有收录。在 links/ 下新建一个 .md 就能加一条。</div>';
}

/* 荐读详情页：正文由构建时写死在 HTML 里（便于微信/搜索直接读到），
   这里只补顶栏、页脚等外壳，不做二次渲染 */
function initLinkPage() {
  renderShell("links.html");
}

document.addEventListener("DOMContentLoaded", function () {
  var page = document.body.dataset.page;
  if (page === "home") initHome();
  else if (page === "post") initPost();
  else if (page === "archive") initArchive();
  else if (page === "links") initLinks();
  else if (page === "link") initLinkPage();
  else if (page === "about") initAbout();

  // 文章页的元信息由 initPost 按文章改写；其余页面补上站点级分享信息
  if (page !== "post") {
    var d = document.querySelector('meta[name="description"]');
    applyShareMeta({
      title: document.title,
      desc: (d && d.getAttribute("content")) || SITE.subtitle || "",
      image: OG_DEFAULT,
      type: "website"
    });
  }

  // 右下角浮动工具条：所有页面都常驻。
  // 以前只有首页和归档页有，文章页读完想回去只能一路滚到最上面。
  initFloatTools();

  // 手机底部固定导航栏（桌面隐藏，由顶栏导航承担）
  initBottomNav();
});
