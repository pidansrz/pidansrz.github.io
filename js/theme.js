/* ===========================================================
 * theme.js — 主题（明/暗）初始化与切换 + 移动端菜单
 * 需在 <head> 中同步引入，避免刷新时主题闪烁
 * =========================================================== */

(function () {
  var KEY = "tingfeng-theme";
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}

  var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  var theme = saved || (prefersDark ? "dark" : "light");
  root.setAttribute("data-theme", theme);

  function apply(next) {
    root.setAttribute("data-theme", next);
    try { localStorage.setItem(KEY, next); } catch (e) {}
    syncIcon(next);
  }

  var ICON_MOON =
    '<svg class="tt-icon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path fill="currentColor" d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.6 6.6 0 0 0 21 12.8Z"/></svg>';
  var ICON_SUN =
    '<svg class="tt-icon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="4.4" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
    '<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">' +
    '<path d="M12 2.6v2.3M12 19.1v2.3M2.6 12h2.3M19.1 12h2.3' +
    'M4.8 4.8l1.6 1.6M17.6 17.6l1.6 1.6M19.2 4.8l-1.6 1.6M6.4 17.6l-1.6 1.6"/>' +
    "</g></svg>";

  function syncIcon(t) {
    var btn = document.getElementById("themeToggle");
    if (btn) {
      // 浅色模式下显示月亮（点它去暗色），暗色模式下显示太阳（点它回浅色）
      btn.innerHTML = t === "dark" ? ICON_SUN : ICON_MOON;
      btn.setAttribute("aria-label", t === "dark" ? "切换到浅色模式" : "切换到深色模式");
      btn.setAttribute("title", t === "dark" ? "浅色模式" : "深色模式");
    }
  }
  // 供 app.js 在渲染完顶栏后调用，填充初始图标
  window.syncThemeIcon = syncIcon;

  document.addEventListener("DOMContentLoaded", function () {
    syncIcon(root.getAttribute("data-theme"));

    var toggle = document.getElementById("themeToggle");
    if (toggle) {
      toggle.addEventListener("click", function () {
        apply(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
      });
    }

    var navToggle = document.getElementById("navToggle");
    var links = document.getElementById("navLinks");
    if (navToggle && links) {
      navToggle.addEventListener("click", function (e) {
        e.stopPropagation();
        links.classList.toggle("open");
      });
      links.addEventListener("click", function (e) {
        if (e.target.tagName === "A") links.classList.remove("open");
      });
    }

    // 快捷键：按 / 直接跳到首页搜索框（内页则先回首页）
    document.addEventListener("keydown", function (e) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      var a = document.activeElement;
      if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
      var box = document.getElementById("searchInput");
      if (!box) { location.href = "index.html"; return; }
      e.preventDefault();
      box.focus();
      box.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  });
})();
