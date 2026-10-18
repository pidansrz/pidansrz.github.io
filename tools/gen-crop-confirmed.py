#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
依据 _crop-dup-report.json 生成 _crop-confirmed.json（最终执行清单）。

决策规则（保守、可解释）：
  1) 排除 a==b 的自匹配（不是裁切重复）。
  2) 排除「两边都是正文图」的配对（本次任务只处理 头图封面 是正文某图的裁切；
     正文内部的完全重复属于另一类清理，暂不处理）。
  3) 排除 nc<0 的无效配对（纯色块 / 无法判定，如 bei-gong-she-ying）。
  4) 涉及封面(cover)的配对：
       - 若 coarse dir 与 fineDir 不一致（a-in-b / b-in-a 矛盾）→ 边界模糊，排除。
       - 若裁切窗口宽高比异常（wh 中某一维远大于另一维，如 1:15）→ 排除。
       - nc >= 0.90 → 纳入（真实裁切，强信号；已知真裁切可低至 0.878）。
       - 用户明确截图的文章 2026-09-29（已知真裁切，nc=0.878）→ 强制纳入。
       - 其余 nc<0.90 且无可信额外证据的 → 排除（边界，先交用户确认）。
  keep / drop：
       eff_dir = fineDir(若有效) 否则 dir
       a-in-b => keep=b(完整图), drop=a(裁切封面)
       b-in-a => keep=a,         drop=b
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
REPORT = "tools/_crop-dup-report.json"
OUT = "tools/_crop-confirmed.json"
KNOWN_TRUE = {"2026-09-29-yue-liang-yu-ye-he-na-la"}  # 用户截图所指，已知真裁切


def is_cover(p):
    return os.path.basename(p) == "cover.jpg"


def eff_dir(r):
    d = r.get("fineDir")
    if d in ("a-in-b", "b-in-a"):
        return d
    return r.get("dir")


def main():
    rows = json.load(open(REPORT, encoding="utf-8"))
    inc, exc = [], []
    for r in rows:
        a, b = r["a"], r["b"]
        pid = r["id"]
        nc = r.get("nc")
        reason = []
        if a == b:
            reason.append("自匹配 a==b")
            exc.append((pid, a, b, nc, "; ".join(reason)))
            continue
        ac, bc = is_cover(a), is_cover(b)
        if not (ac or bc):
            reason.append("正文-正文重复(非头图裁切)")
            exc.append((pid, a, b, nc, "; ".join(reason)))
            continue
        if nc is None or nc < 0:
            reason.append("nc无效(<0)")
            exc.append((pid, a, b, nc, "; ".join(reason)))
            continue
        d, fd = r.get("dir"), r.get("fineDir")
        if d in ("a-in-b", "b-in-a") and fd in ("a-in-b", "b-in-a") and d != fd:
            reason.append("dir矛盾(%s vs %s)" % (d, fd))
            exc.append((pid, a, b, nc, "; ".join(reason)))
            continue
        wh = r.get("wh") or [0, 0]
        if wh[0] and wh[1]:
            ar = max(wh) / min(wh)
            if ar > 6:
                reason.append("裁切窗口宽高比异常(%d:%d)" % (wh[0], wh[1]))
                exc.append((pid, a, b, nc, "; ".join(reason)))
                continue
        ed = eff_dir(r)
        if nc >= 0.90:
            reason.append("nc>=0.90 强信号")
            keep, drop = (b, a) if ed == "a-in-b" else (a, b)
            inc.append({"id": pid, "keep": keep, "drop": drop, "nc": nc,
                        "dir": ed, "note": "; ".join(reason)})
            continue
        if pid in KNOWN_TRUE:
            reason.append("用户截图所指·已知真裁切(强制)")
            keep, drop = (b, a) if ed == "a-in-b" else (a, b)
            inc.append({"id": pid, "keep": keep, "drop": drop, "nc": nc,
                        "dir": ed, "note": "; ".join(reason)})
            continue
        reason.append("nc<0.95 且无可信额外证据(边界)")
        exc.append((pid, a, b, nc, "; ".join(reason)))

    # 写最终清单（只保留 fix 脚本需要的字段）
    confirmed = [{"id": x["id"], "keep": x["keep"], "drop": x["drop"]} for x in inc]
    json.dump(confirmed, open(OUT, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)

    print("=== 纳入执行 %d 条 ===" % len(inc))
    for x in sorted(inc, key=lambda z: -(z["nc"] or -1)):
        print("  %-46s nc=%-7s %-5s 留%-12s 删%-12s" % (
            x["id"][:46], str(x["nc"]), x["dir"],
            os.path.basename(x["keep"]), os.path.basename(x["drop"])))
    print("\n=== 排除 %d 条 ===" % len(exc))
    for pid, a, b, nc, why in sorted(exc, key=lambda z: -(z[3] or -1)):
        print("  %-46s nc=%-7s %s" % (pid[:46], str(nc), why))
    print("\n已写入 %s (%d 条)" % (OUT, len(confirmed)))


if __name__ == "__main__":
    main()
