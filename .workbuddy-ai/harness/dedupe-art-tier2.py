#!/usr/bin/env python3
"""
第二轮去重：`rgba` / `roundRectPath`。

逐字核对结果（见 .workbuddy-ai/memory 当日日志）：
  - rgba        : 5 个文件共用 `547ffb4a`，与 engine/art.js 的 rgba **逐字相同**。
                  galleryArt 的变体只是用 `+` 拼串、逗号后没空格 —— CSS 里等价。
                  photoPlaceholder 的 `rgba(hex, alpha)` 是**另一个函数**
                  （签名是 (hex, alpha) 而不是 (r,g,b,a)），它在 engine 里叫
                  `withAlpha`。同名不同义，这是个真的命名 bug，一并改掉。
  - roundRectPath: gateArt / corridorArt / doorArt 三份逐字相同，32 个调用点。

调用点一个都不动（photoPlaceholder 的改名除外 —— 那是修命名 bug）。
"""
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UTILS = os.path.join(ROOT, 'src', 'utils')
IMPORT_PATH = "'../engine/art'"

RGBA_FILES = ['gateArt', 'corridorArt', 'doorArt', 'contactArt',
              'proceduralTextures', 'galleryArt']
ROUNDRECT_FILES = ['gateArt', 'corridorArt', 'doorArt']


def find_decl(src, name):
    m = re.search(r'^[ \t]*function\s+' + name + r'\s*\(', src, re.M)
    if not m:
        return None
    i = m.start()
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
                while end < len(src) and src[end] in ' \t':
                    end += 1
                if end < len(src) and src[end] == '\n':
                    end += 1
                return (i, end)
    return None


def strip_leading_comment(src, start):
    lines = src[:start].split('\n')
    if len(lines) < 2 or lines[len(lines) - 1].strip():
        return start
    j = len(lines) - 2
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
    return len('\n'.join(lines[:j + 1])) + 1


def ensure_import(src, names):
    """把 names 合并进已有的 engine/art 导入行，没有就新建一行。"""
    m = re.search(r"^import \{([^}]*)\} from '\.\./engine/art';?[ \t]*$", src, re.M)
    if m:
        have = [x.strip() for x in m.group(1).split(',') if x.strip()]
        merged = sorted(set(have) | set(names))
        src = src[:m.start()] + 'import { %s } from %s;' % (', '.join(merged), IMPORT_PATH) + src[m.end():]
    else:
        line = 'import { %s } from %s;' % (', '.join(sorted(names)), IMPORT_PATH)
        m2 = re.search(r"^import \* as THREE from 'three';?[ \t]*\n", src, re.M)
        src = src[:m2.end()] + line + '\n' + src[m2.end():]
    return src


def drop(src, name):
    """删掉一个函数声明（含紧贴的注释），返回 (新源码, 是否删掉了)。"""
    s = find_decl(src, name)
    if not s:
        return src, False
    a = strip_leading_comment(src, s[0])
    return src[:a] + src[s[1]:], True


def rename_calls_photo(src):
    """photoPlaceholder: rgba(hex, alpha) -> withAlpha(hex, alpha)。

    只改**代码里**的 rgba 调用。文件里有大量 CSS 字面量
    （`rgba(255,255,255,${a})` 之类），它们都在引号 / 反引号里面，
    所以先把字符串内容挖空再找位置。
    """
    out = []
    changed = 0
    for line in src.split('\n'):
        # 声明那一行不碰 —— 它要被 drop() 整段删掉，改名会让 drop 找不到
        if re.match(r'\s*function\s+rgba\s*\(', line):
            out.append(line)
            continue
        # 把字符串 / 模板串内容换成同长度的占位符，保持索引不变
        masked = list(line)
        i = 0
        while i < len(line):
            c = line[i]
            if c in '\'"`':
                j = i + 1
                while j < len(line):
                    if line[j] == '\\':
                        j += 2
                        continue
                    if line[j] == c:
                        break
                    j += 1
                for k in range(i + 1, min(j, len(line))):
                    masked[k] = ' '
                i = j + 1
            else:
                i += 1
        masked = ''.join(masked)
        for m in reversed(list(re.finditer(r'\brgba\s*\(', masked))):
            line = line[:m.start()] + 'withAlpha(' + line[m.end():]
            changed += 1
        out.append(line)
    return '\n'.join(out), changed


def process(name, drop_rgba, drop_rr, rename_rgba=False):
    path = os.path.join(UTILS, name + '.js')
    src = io.open(path, encoding='utf-8').read()
    need = []
    did = []

    if rename_rgba:
        src, n = rename_calls_photo(src)
        src, ok = drop(src, 'rgba')
        if ok:
            need.append('withAlpha')
            did.append('rgba->withAlpha (%d 处)' % n)
    elif drop_rgba:
        src, ok = drop(src, 'rgba')
        if ok:
            need.append('rgba')
            did.append('rgba')

    if drop_rr:
        src, ok = drop(src, 'roundRectPath')
        if ok:
            need.append('roundRectPath')
            did.append('roundRectPath')

    if not need:
        print('  %-20s 无改动' % name)
        return
    src = re.sub(r'\n{3,}', '\n\n', src)
    src = ensure_import(src, need)
    io.open(path, 'w', encoding='utf-8').write(src)
    print('  %-20s 删除 %s' % (name, ', '.join(did)))


def main():
    print('rgba:')
    for f in RGBA_FILES:
        process(f, True, f in ROUNDRECT_FILES)
    print('roundRectPath 补充:')
    for f in ROUNDRECT_FILES:
        if f in RGBA_FILES:
            continue
        process(f, False, True)
    print('photoPlaceholder:')
    process('photoPlaceholder', False, False, rename_rgba=True)


if __name__ == '__main__':
    main()
