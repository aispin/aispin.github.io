#!/usr/bin/env python3
"""
把 10 个 utils/*Art.js 里各自抄了一份的 PRNG / canvas 辅助函数删掉，改成
从 src/engine/art.js 导入。

为什么可以这么做（已逐字核对过，见 .workbuddy-ai/memory 当日日志）：
  - hashString  : 9 份逐字相同，photoPlaceholder 那份只差缩进 —— 语义相同
  - mulberry32  : 9 份逐字相同；photoPlaceholder 那份写成 (a+K)>>>0 而其余写成
                  (a+K)|0。两者都只取低 32 位，且后续 >>> / ^ / | 都会做
                  ToInt32/ToUint32，所以输出序列完全相同。
  - makeCanvas  : 两个变体，差别只在有没有 Math.max(1, Math.round())。所有调用点
                  传的都是整数字面量或整数常量，所以行为相同，而带 round 的那份
                  对 0/负数更安全。

删掉函数体之外，还顺带删掉紧贴在上面的注释块。调用点一个都不动。
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UTILS = os.path.join(ROOT, 'src', 'utils')

FILES = ['cloudArt', 'entranceArt', 'gateArt', 'corridorArt', 'galleryArt',
         'doorArt', 'contactArt', 'proceduralTextures', 'techLogosArt',
         'photoPlaceholder']

TARGETS = ['hashString', 'mulberry32', 'makeCanvas', 'alphaBBox']

IMPORT_PATH = "'../engine/art'"


def find_decl(src, name):
    """返回 (start, end) —— 覆盖 `function NAME(...) {...}` 整段的字符区间。

    只认行首的 function 声明，避免误伤 `function makeCanvas` 之外的同名引用。
    """
    m = re.search(r'^[ \t]*function\s+' + name + r'\s*\(', src, re.M)
    if not m:
        return None
    i = m.start()
    # 从参数表的左括号做括号配平，找到 body 的左花括号
    p = src.index('(', m.end() - 1)
    depth = 0
    body = -1
    for k in range(p, len(src)):
        if src[k] == '(':
            depth += 1
        elif src[k] == ')':
            depth -= 1
            if depth == 0:
                body = src.index('{', k)
                break
    if body < 0:
        return None
    depth = 0
    for k in range(body, len(src)):
        if src[k] == '{':
            depth += 1
        elif src[k] == '}':
            depth -= 1
            if depth == 0:
                end = k + 1
                # 吃掉行尾换行
                while end < len(src) and src[end] in ' \t':
                    end += 1
                if end < len(src) and src[end] == '\n':
                    end += 1
                return (i, end)
    return None


def strip_leading_comment(src, start):
    """把紧贴声明上方、中间不隔空行的注释块一起删掉。"""
    lines = src[:start].split('\n')
    if len(lines) < 2:
        return start
    # lines[-1] 是声明所在行之前的内容（通常是空串）
    cut = len(lines) - 1
    if lines[cut].strip():
        return start
    j = cut - 1
    saw = False
    while j >= 0:
        s = lines[j].strip()
        if s.startswith('*') or s.startswith('/*') or s.startswith('//') or s.endswith('*/'):
            saw = True
            j -= 1
            continue
        break
    if not saw:
        return start
    # 只吃连续注释块，且要求块尾就是声明上方
    return len('\n'.join(lines[:j + 1])) + 1


def needed(src, removed, name):
    """删掉声明后，文件里是否还引用这个名字。"""
    rest = src
    for (a, b) in sorted(removed, reverse=True):
        rest = rest[:a] + rest[b:]
    # 排除 import 行本身
    rest = re.sub(r'^\s*import[^;]*;?\s*$', '', rest, flags=re.M)
    return bool(re.search(r'\b' + name + r'\b', rest))


def process(name):
    path = os.path.join(UTILS, name + '.js')
    src = io.open(path, encoding='utf-8').read()
    orig = src

    spans = []
    for t in TARGETS:
        s = find_decl(src, t)
        if s:
            spans.append((t, strip_leading_comment(src, s[0]), s[1]))

    if not spans:
        print('  %-20s 无可删声明，跳过' % name)
        return 0

    removed = [(a, b) for (_, a, b) in spans]
    for (a, b) in sorted(removed, reverse=True):
        src = src[:a] + src[b:]

    # 折叠可能产生的连续空行
    src = re.sub(r'\n{3,}', '\n\n', src)

    keep = [t for (t, _, _) in spans if needed(orig, removed, t)]
    if not keep:
        print('  %-20s 删了 %d 个，但都无引用（奇怪）' % (name, len(spans)))
        return 0

    imp = 'import { %s } from %s;' % (', '.join(sorted(keep)), IMPORT_PATH)
    # 插在 `import * as THREE from 'three'` 之后；没有就插在首个 import 之后
    m = re.search(r"^import \* as THREE from 'three';?[ \t]*\n", src, re.M)
    if m:
        src = src[:m.end()] + imp + '\n' + src[m.end():]
    else:
        m = re.search(r'^import .*\n', src, re.M)
        src = src[:m.end()] + imp + '\n' + src[m.end():]

    io.open(path, 'w', encoding='utf-8').write(src)
    print('  %-20s 删除 %d 个声明 (%s) → import %s'
          % (name, len(spans), ','.join(t for (t, _, _) in spans), ', '.join(sorted(keep))))
    return len(spans)


def main():
    total = 0
    for f in FILES:
        total += process(f)
    print('\n共删除 %d 个重复函数声明' % total)


if __name__ == '__main__':
    main()
