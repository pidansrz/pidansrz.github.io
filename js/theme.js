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

  function syncIcon(t) {
    var btn = document.getElementById("themeToggle");
    if (btn) {
      btn.textContent = t === "dark" ? "☀" : "☾";
      btn.setAttribute("aria-label", t === "dark" ? "切换到浅色模式" : "切换到深色模式");
      btn.setAttribute("title", t === "dark" ? "浅色模式" : "深色模式");
    }
  }

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
