/* ===========================================================
 * theme.js — 主题（明/暗）初始化与切换 + 移动端菜单
 * 需在 <head> 中同步引入，避免刷新时主题闪烁
 * =========================================================== */

(function () {
  var KEY = "tingfeng-theme";
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}

  // 按访客本地时间排程：19:00–次日 07:00 为暗色，其余为浅色
  var DARK_START = 19;
  var DARK_END = 7;
  function themeByTime(h) {
    return (h >= DARK_START || h < DARK_END) ? "dark" : "light";
  }

  // 有手动保存的偏好 → 尊重它；否则按访客本地时间定明暗（不写 localStorage）
  var theme = (saved === "dark" || saved === "light")
    ? saved
    : themeByTime(new Date().getHours());
  root.setAttribute("data-theme", theme);

  var flipTimer = null;
  function clearFlip() {
    if (flipTimer) { clearTimeout(flipTimer); flipTimer = null; }
  }
  // 未手动选过的人：在下一个明暗边界自动翻转（仅按本地时间，不持久化）
  function scheduleFlip() {
    clearFlip();
    if (saved) return; // 手动选过 → 时间规则不再打扰
    var now = new Date();
    var h = now.getHours();
    var next = new Date(now);
    if (h < DARK_END) {            // 暗色区间尾段，下个边界变亮
      next.setHours(DARK_END, 0, 0, 0);
    } else if (h >= DARK_START) {  // 暗色区间首段，下个边界是次日变亮
      next.setDate(next.getDate() + 1);
      next.setHours(DARK_END, 0, 0, 0);
    } else {                       // 浅色区间，下个边界变暗
      next.setHours(DARK_START, 0, 0, 0);
    }
    var ms = next - now;
    if (typeof setTimeout === "function") {
      flipTimer = setTimeout(function () {
        if (saved) return;
        var t = themeByTime(new Date().getHours());
        root.setAttribute("data-theme", t);
        syncIcon(t);
        scheduleFlip();
      }, ms);
    }
  }

  function apply(next) {
    root.setAttribute("data-theme", next);
    try { localStorage.setItem(KEY, next); saved = next; } catch (e) {}
    syncIcon(next);
    clearFlip(); // 一旦手动选择，时间规则即失效
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
    scheduleFlip();

    /* 顶栏是 app.js 的 renderShell() 动态渲染的，而本脚本在 <head> 里、
       DOMContentLoaded 先于 app.js 触发 —— 那时 #themeToggle 还没生成，
       直接 getElementById 绑不到事件（点了没反应）。改用事件委托：
       不管按钮什么时候被插进 DOM、点在按钮还是里面的 SVG 上都生效。 */
    document.addEventListener("click", function (e) {
      var el = e.target;
      if (!el || !el.closest) return;
      if (!el.closest("#themeToggle")) return;
      apply(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
    });

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
