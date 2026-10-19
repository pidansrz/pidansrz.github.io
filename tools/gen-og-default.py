#!/usr/bin/env python3
# tools/gen-og-default.py — 重新生成站点默认分享图 images/og-default.jpg
# 1200x630（Open Graph 推荐比例）。纯本地资源，不进 CI（生成一次提交即可）。
# 用法：python tools/gen-og-default.py
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "images", "og-default.jpg")
FONT_DIR = r"C:/Windows/Fonts"

W, H = 1200, 630
TOP = (22, 50, 58)      # 深墨蓝绿
BOT = (12, 28, 33)      # 更深的底
ACCENT = (217, 164, 65) # 暖金（与站点点缀色呼应）
TEXT = (244, 247, 246)
SUB = (178, 194, 191)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def font(path, size, index=0):
    return ImageFont.truetype(path, size, index=index)


# 1) 竖向渐变底
grad = Image.new("RGB", (1, H))
for y in range(H):
    grad.putpixel((0, y), lerp(TOP, BOT, y / (H - 1)))
base = grad.resize((W, H)).convert("RGBA")

# 2) 顶部柔光（暖金径向）
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
# 顶中央的柔和暖光（对称、克制）
gd.ellipse([W / 2 - 620, -520, W / 2 + 620, 380], fill=ACCENT + (22,))
base = Image.alpha_composite(base, glow)

d = ImageDraw.Draw(base)

# 3) 印章：圆 + 「舟」
cx, cy = W // 2, 158
r = 48
gd = d
gd.ellipse([cx - r, cy - r, cx + r, cy + r], outline=ACCENT + (220,), width=3)
seal_font = font(os.path.join(FONT_DIR, "msyh.ttc"), 56)
tb = d.textbbox((0, 0), "舟", font=seal_font)
d.text((cx - (tb[2] - tb[0]) / 2, cy - (tb[3] - tb[1]) / 2 - 4), "舟", font=seal_font, fill=TEXT)

# 4) 站名
brand_font = font(os.path.join(FONT_DIR, "msyhbd.ttc"), 122)
bb = d.textbbox((0, 0), "皮蛋瘦肉舟", font=brand_font)
bx = cx - (bb[2] - bb[0]) / 2
by = 280
d.text((bx, by), "皮蛋瘦肉舟", font=brand_font, fill=TEXT)

# 5) 暖金短分割线
lw = 132
d.rectangle([cx - lw / 2, by + (bb[3] - bb[1]) + 26, cx + lw / 2, by + (bb[3] - bb[1]) + 29], fill=ACCENT)

# 6) 副标语
sub_font = font(os.path.join(FONT_DIR, "msyh.ttc"), 34)
sub_text = "面向公共写作 · 关怀真正善良的个体"
sb = d.textbbox((0, 0), sub_text, font=sub_font)
d.text((cx - (sb[2] - sb[0]) / 2, by + (bb[3] - bb[1]) + 56), sub_text, font=sub_font, fill=SUB)

base.convert("RGB").save(OUT, "JPEG", quality=92)
print("✓ 已生成", OUT, base.size)
