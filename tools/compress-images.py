# -*- coding: utf-8 -*-
"""
compress-images.py —— 批量压缩博客图片（保持目录结构，原地替换）

策略：
  · jpg / jpeg ：重新编码（quality=82、渐进式、去 EXIF）；长边超过 max-edge 则等比缩放
  · png        ：若实际没有用到透明像素，转为 jpg（体积通常可降 5～10 倍），
                 原 .png 删除，并把改名清单写入 images/_renamed.json，供同步引用使用；
                 若确实有透明，保留 png 并做无损重压缩（optimize）
  · gif / webp ：跳过（动图重编码易损坏，单独处理）

用法：
  python tools/compress-images.py            # 预览，不写文件
  python tools/compress-images.py --apply    # 实际压缩（原图请用 wechat-archive 源目录留底）
  python tools/compress-images.py --apply --quality 80 --max-edge 1400
"""
import argparse
import datetime
import io
import json
import os
import shutil
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit('缺少 Pillow，请先安装：pip install Pillow')

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
IMG_DIR = os.path.join(ROOT, 'images')
# png 转 jpg 后，原 png 移出博客目录（而不是删除），保证可回退、且部署包不带上它们
ORIG_DIR = os.path.join(ROOT, '..',
                        '_png-original-' + datetime.datetime.now().strftime('%Y%m%d'))
SKIP_EXT = {'.gif', '.webp', '.svg', '.md', '.json'}


def move_out(path):
    """把文件移出博客目录，保留相对子路径"""
    rel = os.path.relpath(path, IMG_DIR)
    dst = os.path.join(ORIG_DIR, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.move(path, dst)


def human(n):
    return f'{n / 1048576:.2f} MB' if n >= 1048576 else f'{n / 1024:.1f} KB'


def has_real_alpha(im):
    """是否真的用到了透明（alpha 通道存在且最小值 < 255）"""
    if im.mode not in ('RGBA', 'LA', 'PA'):
        return False
    alpha = im.getchannel('A')
    return alpha.getextrema()[0] < 255


LANCZOS = getattr(getattr(Image, 'Resampling', Image), 'LANCZOS', Image.BICUBIC)


def shrink(im, max_edge):
    w, h = im.size
    long_edge = max(w, h)
    if long_edge <= max_edge:
        return im, False
    ratio = max_edge / float(long_edge)
    return im.resize((int(round(w * ratio)), int(round(h * ratio))), LANCZOS), True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true', help='实际写入（默认仅预览）')
    ap.add_argument('--quality', type=int, default=82, help='jpg 质量，默认 82')
    ap.add_argument('--max-edge', type=int, default=1600, help='长边上限，默认 1600')
    args = ap.parse_args()

    files = []
    for dirpath, _, names in os.walk(IMG_DIR):
        for name in names:
            ext = os.path.splitext(name)[1].lower()
            if ext in SKIP_EXT or name.startswith('_'):
                continue
            files.append(os.path.join(dirpath, name))
    files.sort()

    total_before = sum(os.path.getsize(f) for f in files)
    total_after = 0
    renamed = []      # [(old_rel, new_rel)]
    skipped = []      # [(rel, reason)]
    errors = []

    for idx, path in enumerate(files, 1):
        rel = os.path.relpath(path, ROOT).replace('\\', '/')
        ext = os.path.splitext(path)[1].lower()
        before = os.path.getsize(path)
        try:
            with Image.open(path) as im:
                im.load()
                fmt = (im.format or '').upper()

                # 只有「真 PNG 且确实用到透明」才保留 png，其余一律输出 jpg
                keep_png = (fmt == 'PNG') and has_real_alpha(im)
                base = os.path.splitext(path)[0]
                new_path = base + ('.png' if keep_png else '.jpg')
                new_rel = os.path.splitext(rel)[0] + ('.png' if keep_png else '.jpg')
                is_rename = os.path.abspath(new_path) != os.path.abspath(path)

                if is_rename and os.path.exists(new_path):
                    skipped.append((rel, f'目标 {os.path.basename(new_path)} 已存在，保留原文件'))
                    total_after += before
                    continue

                if keep_png:
                    im2, _ = shrink(im, args.max_edge)
                    buf = io.BytesIO()
                    im2.save(buf, 'PNG', optimize=True)
                else:
                    im2, _ = shrink(im.convert('RGB'), args.max_edge)
                    buf = io.BytesIO()
                    im2.save(buf, 'JPEG', quality=args.quality, optimize=True,
                             progressive=True)
                data = buf.getvalue()
                after = len(data)

                # 改名的情况必须写入；同类覆盖时只在确实变小才写
                should_write = is_rename or (after < before)
                if args.apply and should_write:
                    with open(new_path, 'wb') as f:
                        f.write(data)
                    if is_rename:
                        move_out(path)
                if not should_write:
                    after = before
                if is_rename:
                    renamed.append((rel, new_rel))
                total_after += after
        except Exception as e:  # noqa: BLE001
            errors.append((rel, str(e)))
            total_after += before

        if idx % 100 == 0:
            print(f'  ...已处理 {idx}/{len(files)}', flush=True)

    print('\n========== 汇总 ==========')
    print(f'图片数量：{len(files)}')
    print(f'压缩前：{human(total_before)}')
    print(f'压缩后：{human(total_after)}   （省下 {human(total_before - total_after)}，'
          f'降至 {total_after / total_before * 100:.0f}%）')
    if renamed:
        print(f'\n格式转换（png -> jpg）：{len(renamed)} 张，需同步更新正文引用')
        for old, new in renamed[:10]:
            print(f'  {old}\n    -> {new}')
        if len(renamed) > 10:
            print(f'  ...其余 {len(renamed) - 10} 条见 images/_renamed.json')
    if skipped:
        print(f'\n跳过 {len(skipped)} 张：')
        for rel, why in skipped[:20]:
            print(f'  {rel}  （{why}）')
    if errors:
        print(f'\n失败 {len(errors)} 张：')
        for rel, err in errors[:20]:
            print(f'  {rel}  {err}')

    if args.apply:
        with open(os.path.join(IMG_DIR, '_renamed.json'), 'w', encoding='utf-8') as f:
            json.dump(renamed, f, ensure_ascii=False, indent=2)
        print('\n已写入 images/_renamed.json（用于同步 data.js 里的图片引用）')
        if renamed:
            print(f'原 png 已移出博客目录，保存在：{os.path.abspath(ORIG_DIR)}')
            print('（确认站点显示无误后，可自行删除该目录）')
    else:
        print('\n（预览模式，未写入任何文件。确认无误后加 --apply）')


if __name__ == '__main__':
    main()
