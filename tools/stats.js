/* ===========================================================
 * 访问统计脚本注入（共享模块）
 * 供 build-posts.js（407 篇静态页 + 站点级页面）和
 * build-links.js（荐读详情页）共用，避免两处各写一套。
 *
 * 配置在 js/data.js 的 SITE 块里：
 *     stats: { provider: "goatcounter", code: "站点名" }
 *   provider 支持 goatcounter / plausible / umami；
 *   code 留空 = 不注入任何脚本（默认状态，站点零影响、零请求）。
 *
 * 接入方式（用户自行注册后把 code 填进 SITE.stats 即可）：
 *   goatcounter → https://www.goatcounter.com 注册，填站点名（如 pidanz），
 *                个人非商业免费、无 cookie、国内可直接访问
 *   plausible   → 填站点域名；云版 $9/月起，自托管免费
 *   umami       → 填 website-id；云版有免费额度，自托管免费
 *
 * 注入幂等：脚本包裹在 <!-- stats:start/end --> 标记里，
 * 每次构建先摘旧再插新，重复构建不叠加，保证生成物可复现。
 * 全部用函数式 replace：code 里万一出现 $ 不会被当成特殊 pattern。
 * =========================================================== */

const STATS_START = "<!-- stats:start -->";
const STATS_END = "<!-- stats:end -->";

/* 按 SITE.stats 配置生成统计脚本 HTML；没配置就返回空串 */
function statsScriptHTML(site) {
  const st = site && site.stats;
  if (!st) return "";
  const code = String(st.code == null ? "" : st.code).trim();
  if (!code) return "";
  let inner = "";
  if (st.provider === "goatcounter") {
    inner =
      '<script data-goatcounter="https://' + code + '.goatcounter.com/count"' +
      ' async src="//gc.zgo.at/count.js"></script>';
  } else if (st.provider === "plausible") {
    inner =
      '<script defer data-domain="' + code + '"' +
      ' src="https://plausible.io/js/script.js"></script>';
  } else if (st.provider === "umami") {
    inner =
      '<script defer data-website-id="' + code + '"' +
      ' src="https://cloud.umami.is/script.js"></script>';
  } else {
    return "";
  }
  return STATS_START + "\n" + inner + "\n" + STATS_END;
}

/* 幂等注入：先摘掉旧标记段，再插到 theme.js 之后（没有则 </head> 前）。
   统一把 CRLF 归一为 LF，保证与 CI（Linux）产出逐字节一致。 */
function injectStats(html, site) {
  const h = String(html == null ? "" : html).replace(/\r\n/g, "\n");
  const cleaned = h.replace(
    new RegExp(STATS_START + "[\\s\\S]*?" + STATS_END + "\\n?", "g"),
    ""
  );
  const script = statsScriptHTML(site);
  if (!script) return cleaned;
  if (/<script src="js\/theme\.js"><\/script>/.test(cleaned)) {
    return cleaned.replace(/<script src="js\/theme\.js"><\/script>/, function (m) {
      return m + "\n" + script;
    });
  }
  return cleaned.replace("</head>", function () {
    return script + "\n</head>";
  });
}

module.exports = { STATS_START, STATS_END, statsScriptHTML, injectStats };
