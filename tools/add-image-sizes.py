# -*- coding: utf-8 -*-
"""
add-image-sizes.py —— 给 js/data.js 正文里的 <img> 补上 width / height

为什么：图片没有尺寸时，浏览器在图片加载完成前不知道要占多高，
图片一到位就把下面的内容整体往下顶——也就是「页面跳动」的根源。
写上真实宽高后，浏览器可以提前预留位置（CSS 里配 height:auto 保证缩放不变形）。

用法：
  python tools/add-image-sizes.py          # 预览
  python tools/add-image-sizes.py --apply  # 写入（自动备份 js/data.js）
"""
import argparse
import datetime
import os
import re
import shutil
import subprocess
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit('缺少 Pillow，请先安装：pip install Pillow')

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'js', 'data.js')
IMG_TAG = re.compile(r'<img\b[^>]*>')
SRC_ATTR = re.compile(r'src="([^"]+)"')

size_cache = {}


def size_of(rel):
    """返回 (宽, 高)；取不到时返回 None"""
    if rel in size_cache:
        return size_cache[rel]
    path = os.path.join(ROOT, rel)
    try:
        with Image.open(path) as im:
            size_cache[rel] = im.size
    except Exception:
        size_cache[rel] = None
    return size_cache[rel]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true', help='实际写入（默认仅预览）')
    args = ap.parse_args()

    src = open(DATA, encoding='utf-8').read()
    stats = {'tag': 0, 'added': 0, 'has': 0, 'missing': 0}
    missing_files = []

    def fix(m):
        tag = m.group(0)
        if tag.endswith('/>'):
            return tag
        stats['tag'] += 1
        if re.search(r'\bwidth=', tag):
            stats['has'] += 1
            return tag
        sm = SRC_ATTR.search(tag)
        if not sm:
            return tag
        rel = sm.group(1)
        wh = size_of(rel)
        if not wh:
            stats['missing'] += 1
            missing_files.append(rel)
            return tag
        stats['added'] += 1
        return tag[:-1].rstrip() + ' width="%d" height="%d">' % wh

    out = IMG_TAG.sub(fix, src)

    print('正文图片标签：%d 个' % stats['tag'])
    print('  已带尺寸：%d' % stats['has'])
    print('  本次补上：%d' % stats['added'])
    print('  文件缺失无法读取：%d' % stats['missing'])
    if missing_files:
        for m in sorted(set(missing_files))[:10]:
            print('    ·', m)

    if not args.apply:
        print('\n（预览模式，未写入。加 --apply 执行）')
        return

    stamp = datetime.datetime.now().strftime('%Y%m%d%H%M')
    backup = os.path.join(ROOT, 'js', 'data.backup-%s.js' % stamp)
    shutil.copyfile(DATA, backup)
    open(DATA, 'w', encoding='utf-8').write(out)
    print('\n已备份：js/%s' % os.path.basename(backup))
    print('已写入：js/data.js')

    # 数据变了，重建派生文件（index-data.js / posts / search-text / feed）
    node = shutil.which('node')
    if node:
        print('\n重建派生文件…')
        try:
            subprocess.run([node, os.path.join(ROOT, 'tools', 'build-all.js')], check=True)
        except Exception as e:
            print('⚠ 自动重建失败，请手动执行：node tools/build-all.js（%s）' % e)
    else:
        print('⚠ 未找到 node，请手动执行：node tools/build-all.js')


if __name__ == '__main__':
    main()
