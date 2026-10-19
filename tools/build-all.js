/**
 * build-all.js —— 改完 js/data.js 之后统一重建派生文件
 *
 *   build-split.js  → js/index-data.js、js/posts/*.js、js/search-text.js（页面实际加载的数据）
 *   build-feed.js   → feed.xml、sitemap.xml、robots.txt
 *   build-posts.js  → post/<id>.html（每篇文章的静态页，供微信/社交分享读取头图）
 *
 * 其它工具（导入、批量改名、图片尺寸等）在写入 data.js 后会自动调用本脚本。
 * 手动用法：node tools/build-all.js
 */
const path = require('path');
const { execFileSync } = require('child_process');

const steps = ['build-split.js', 'build-feed.js', 'build-posts.js'];

for (const step of steps) {
  console.log('→ ' + step);
  execFileSync(process.execPath, [path.join(__dirname, step)], { stdio: 'inherit' });
}
console.log('\n全部重建完成。');
