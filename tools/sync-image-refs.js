/**
 * sync-image-refs.js —— 图片改名（如 png -> jpg）后，同步 js/data.js 里的引用并做完整性校验。
 *
 * 依赖 images/_renamed.json（由 compress-images.py --apply 生成），格式为 [[oldRel, newRel], ...]
 *
 * 用法：
 *   node tools/sync-image-refs.js          # 预览改动并校验引用
 *   node tools/sync-image-refs.js --apply  # 写入（自动备份 js/data.js）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'js', 'data.js');
const MAP_FILE = path.join(ROOT, 'images', '_renamed.json');
const APPLY = process.argv.includes('--apply');

if (!fs.existsSync(MAP_FILE)) {
  console.log('没有 images/_renamed.json，说明没有发生图片改名，无需同步。');
  process.exit(0);
}

const pairs = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
let src = fs.readFileSync(DATA, 'utf8');

let hits = 0;
const missed = [];
for (const [oldRel, newRel] of pairs) {
  const needle = oldRel;
  const count = src.split(needle).length - 1;
  if (count === 0) {
    missed.push(oldRel); // 图片存在但正文没引用（可能是多余资源），不算错误
    continue;
  }
  hits += count;
  src = src.split(needle).join(newRel);
}

console.log(`改名条目 ${pairs.length} 条，命中并替换引用 ${hits} 处`);
if (missed.length) {
  console.log(`另有 ${missed.length} 张图在正文里没有引用（属正常，可能是冗余资源）`);
}

// 这些是故意留空的槽位（占位封面、捐赠二维码、公众号二维码），不算缺失
const PLACEHOLDER = new Set([
  'images/shoe-repair-stall.jpg',
  'images/donate-qr.jpg',
  'images/qrcode-wechat.jpg',
]);

// 完整性校验：data.js 里每一个 images/... 引用都必须对应真实文件
const refs = [...new Set(src.match(/images\/[^"')\s]+?\.(?:jpg|jpeg|png|gif|webp)/g) || [])];
const absent = refs.filter((r) => !fs.existsSync(path.join(ROOT, r)));
const missing = absent.filter((r) => !PLACEHOLDER.has(r));
const placeholders = absent.filter((r) => PLACEHOLDER.has(r));
console.log(`\n引用总数 ${refs.length} 个（去重后），真实缺失 ${missing.length} 个`);
if (missing.length) {
  missing.slice(0, 20).forEach((m) => console.log('  缺失:', m));
}
if (placeholders.length) {
  console.log(`另有 ${placeholders.length} 个是预留槽位（等待你提供图片），不计为缺失：`);
  placeholders.forEach((p) => console.log('  ·', p));
}

if (!APPLY) {
  console.log('\n（预览模式，未写入。加 --apply 执行）');
  process.exit(0);
}
if (missing.length) {
  console.log('\n存在缺失引用，已中止写入，请先检查上面列出的文件。');
  process.exit(1);
}

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const backup = path.join(ROOT, 'js', `data.backup-${stamp}.js`);
fs.copyFileSync(DATA, backup);
fs.writeFileSync(DATA, src, 'utf8');
console.log(`\n已备份：js/${path.basename(backup)}`);
console.log('已写入 js/data.js');

// 数据变了，自动重建派生文件（index-data.js / posts / search-text / feed）
try {
  require('child_process').execFileSync(process.execPath,
    [require('path').join(__dirname, 'build-all.js')], { stdio: 'inherit' });
} catch (e) {
  console.warn('⚠ 自动重建失败，请手动执行：node tools/build-all.js');
}
