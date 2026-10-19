<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
<xsl:output method="html" encoding="UTF-8" indent="yes" doctype-system="about:legacy-compat"/>

<xsl:template match="/">
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title><xsl:value-of select="rss/channel/title"/> · RSS 订阅</title>
    <style>
      :root { --maxw: 720px; --accent:#8c3a3a; --text:#222; --text-2:#555; --text-3:#8a8a8a; --rule:#e7e7e7; --bg:#fff; }
      * { box-sizing: border-box; }
      body { margin:0; background:var(--bg); color:var(--text);
        font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
      .wrap { max-width:var(--maxw); margin:0 auto; padding:52px 20px 72px; }
      h1 { font-size:1.6rem; margin:0 0 8px; letter-spacing:.02em; }
      .bio { color:var(--text-2); margin:0 0 10px; }
      .hint { color:var(--text-3); font-size:.9rem; margin:0 0 30px; line-height:1.6; }
      .hint code { background:#f3f3f3; padding:2px 6px; border-radius:4px; font-size:.85em; }
      ol { list-style:none; margin:0; padding:0; border-top:1px solid var(--rule); }
      li { border-bottom:1px solid var(--rule); padding:18px 0; }
      .date { color:var(--text-3); font-size:.8rem; letter-spacing:.05em; }
      a { color:var(--accent); text-decoration:none; }
      a:hover { text-decoration:underline; }
      .t { font-size:1.1rem; font-weight:600; display:block; margin:3px 0 5px; }
      .ex { color:var(--text-2); font-size:.92rem; }
      .ex p { margin:0; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1><xsl:value-of select="rss/channel/title"/></h1>
      <p class="bio"><xsl:value-of select="rss/channel/description"/></p>
      <p class="hint">这是一个 RSS 2.0 订阅源。复制地址 <code><xsl:value-of select="rss/channel/link"/>feed.xml</code>
        到 RSS 阅读器（Feedly / Inoreader / NetNewsWire / Reeder 等）即可订阅，新文章会自动送达。
        下方是站内全部文章列表（最新在前）。</p>
      <ol>
        <xsl:for-each select="rss/channel/item">
          <li>
            <span class="date"><xsl:value-of select="pubDate"/></span>
            <a class="t"><xsl:attribute name="href"><xsl:value-of select="link"/></xsl:attribute><xsl:value-of select="title"/></a>
            <span class="ex"><xsl:value-of select="description" disable-output-escaping="yes"/></span>
          </li>
        </xsl:for-each>
      </ol>
    </div>
  </body>
  </html>
</xsl:template>
</xsl:stylesheet>
