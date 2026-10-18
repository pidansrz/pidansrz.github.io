#!/usr/bin/env node
/* 把 js/index-data.js 里的文章索引导出成 tools/_posts.json，
   供 Python 脚本（图片去重、占位图检查等）消费。
   之所以绕这一道，是因为 index-data.js 是紧凑 JSON、字段顺序不固定，
   用正则去啃容易出错，交给真正的 JS 引擎解析最稳。 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const root = path.dirname(__dirname);
process.chdir(root);

const ctx = { window: {}, document: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("js/index-data.js", "utf8"), ctx);

const posts = ctx.POSTS.map((p) => ({
  id: p.id,
  n: p.n,
  title: p.title,
  date: p.date || "",
  cover: p.cover || "",
  coverAlt: p.coverAlt || "",
  minutes: p.minutes || 0,
}));

fs.writeFileSync("tools/_posts.json", JSON.stringify(posts, null, 1));
console.log("已导出 " + posts.length + " 篇 → tools/_posts.json");
