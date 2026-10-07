#!/usr/bin/env python3
"""
imgdiff.py — 比两张截图「差多少」。

为什么不只看 sha1：sha1 只会说「不一样」。而这类重构（把重复的 geometry 换成
共享的、把抄了十遍的 PRNG 换成同一份）**期望**的结果是逐像素相同；一旦不同，
需要知道的是「差多少、差在哪」，才能判断是渲染路径真的变了，还是只差一个
抗锯齿的边。

输出：
  mean  — 平均每通道差值（0..255）。< 0.5 基本可以认为是同一张图
  max   — 最大差值。个别像素差很多（比如文字抗锯齿）但 mean 很小是正常的
  frac  — 差值 > 8 的像素占比
  bbox  — 差异区域的包围盒，方便直接裁出来看

用法:
  python3 imgdiff.py <a.png> <b.png> [--crop out.png]
"""
import sys
from PIL import Image, ImageChops


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    a = Image.open(sys.argv[1]).convert('RGB')
    b = Image.open(sys.argv[2]).convert('RGB')
    if a.size != b.size:
        print('尺寸不同: %s vs %s' % (a.size, b.size))
        return 1

    d = ImageChops.difference(a, b)
    # 单通道灰度差，用来统计
    g = d.convert('L')
    px = list(g.getdata())
    n = len(px)
    total = sum(px)
    mean = total / n
    mx = max(px)
    big = sum(1 for v in px if v > 8)
    frac = big / n

    print('%-34s vs %-34s' % (sys.argv[1].split('/')[-1], sys.argv[2].split('/')[-1]))
    print('  mean = %.3f   max = %d   差异>8 的像素 = %d (%.4f%%)' % (mean, mx, big, frac * 100))

    if mx > 0:
        bbox = g.point(lambda v: 255 if v > 8 else 0).getbbox()
        print('  差异区域 bbox = %s' % (bbox,))
        if '--crop' in sys.argv:
            out = sys.argv[sys.argv.index('--crop') + 1]
            if bbox:
                pad = 12
                box = (max(0, bbox[0] - pad), max(0, bbox[1] - pad),
                       min(a.width, bbox[2] + pad), min(a.height, bbox[3] + pad))
                w, h = box[2] - box[0], box[3] - box[1]
                sheet = Image.new('RGB', (w * 2 + 8, h), (20, 20, 20))
                sheet.paste(a.crop(box), (0, 0))
                sheet.paste(b.crop(box), (w + 8, 0))
                if w * 2 < 700:
                    sheet = sheet.resize((sheet.width * 2, sheet.height * 2), Image.NEAREST)
                sheet.save(out)
                print('  左=改前  右=改后  → %s' % out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
