#!/usr/bin/env python3
"""
把 JSX 里的 `<xxxGeometry args={[...]} />` 换成共享图元。

为什么可以这么做（已核对）：
  - 208 个几何体元素全部是自闭合、只有 args、args 里没有嵌套括号
  - 全项目没有任何一处修改 geometry 的 attributes / 调用 computeVertexNormals /
    bakeWorldUVs 作用在 JSX 声明的几何体上 —— 烘世界坐标 UV 的都在 useMemo 里，
    那些不在这批里（签名带 +worlduv）
  - 实测走廊场景 735 个 geometry 只对应 73 个不同签名，662 个是纯浪费

为什么用 `<primitive object={...} attach="geometry" />` 而不是改成
`<mesh geometry={...}>`：后者要**改父元素的开始标签**，得解析 JSX 嵌套；
前者只是把子元素原地换掉，位置、缩进、父元素全都不动，改动面小一个数量级，
而且出错了也一眼能看出来。

用法:
  python3 dedupe-geometries.py --dry     # 只看会改什么
  python3 dedupe-geometries.py           # 真改
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'src')

# 只转 sharedGeometry 支持的图元。shape 排除 —— ShapeGeometry 收的是 Shape
# 对象而不是数字，不是一个签名。
TYPES = ['plane', 'box', 'sphere', 'cylinder', 'cone', 'circle', 'ring', 'torus',
         'capsule']

PAT = re.compile(
    r'<(' + '|'.join(TYPES) + r')Geometry\s+args=\{(\[[^\]]*\])\}\s*/>'
)

# ⚠️ 这里踩过两次坑，都记下来：
#
# 1. 别按行匹配 `^import .*?;?$` —— 遇到跨多行的
#        import {
#            a,
#            b
#        } from 'x';
#    只会匹配到第一行 `import {`，插在中间 → `Unexpected keyword 'import'`。
#
# 2. 也别写成 `^import\b[\s\S]*?;`（吃到第一个分号）—— ContentRoom.jsx 这类
#    **导入语句不写分号**的文件里，第一个分号在几百行之后的函数体里，
#    结果 import 被插进了 `for (i < chars.length; i++)` 的中间。
#
# 所以只能老老实实扫：括号配平 + 无分号风格下遇到换行即结束。
def find_import_block_end(src):
    """返回文件顶部 import 区最后一条语句的结束下标；没有 import 则返回 None。"""
    i = 0
    n = len(src)
    last_end = None
    while i < n:
        # 跳过前导空白与注释
        m = re.compile(r'\s*(?://[^\n]*\n|/\*[\s\S]*?\*/)?\s*').match(src, i)
        j = m.end()
        if not re.match(r'import\b', src[j:]):
            break
        # 从 `import` 扫到语句结束
        depth = 0
        k = j
        while k < n:
            c = src[k]
            if c in '([{':
                depth += 1
            elif c in ')]}':
                depth -= 1
            elif c == ';' and depth == 0:
                k += 1
                break
            elif c == '\n' and depth == 0:
                # 无分号风格：括号已闭合就说明语句完了
                break
            k += 1
        last_end = k
        i = k
    return last_end


def engine_import_path(file_path):
    """算出到 src/engine/resources 的相对路径。"""
    rel = os.path.relpath(os.path.join(SRC, 'engine', 'resources'), os.path.dirname(file_path))
    if not rel.startswith('.'):
        rel = './' + rel
    return rel


def ensure_import(src, file_path, dry):
    if re.search(r"from '[^']*engine/resources'", src):
        return src, False
    path = engine_import_path(file_path)
    line = "import { sharedGeometry } from '%s';" % path
    end = find_import_block_end(src)
    if not end:
        return src, False
    # 后置断言：插入点必须落在 import 区里。判据是「插入点之前只有
    # 空白/注释/import」—— 用行数做个便宜的近似：插入点之前的行，
    # 去掉空行和注释行之后，必须都是 import 语句的一部分。
    head = src[:end]
    if re.search(r'^\s*(export|const|let|var|function|class|for|if)\b', head, re.M):
        raise AssertionError('插入点跑到代码里了: ' + file_path)
    return src[:end] + '\n' + line + src[end:], True


def main():
    dry = '--dry' in sys.argv
    total = 0
    files = 0
    for dp, _, fns in os.walk(SRC):
        if '__artold' in dp:
            continue
        # engine/ 里没有 JSX，但 resources.js 的文档注释里**写着**示例代码，
        # 不改的话 codemod 会把自己的说明书一起重写掉。
        if os.sep + 'engine' in dp:
            continue
        for fn in sorted(fns):
            if not fn.endswith(('.jsx', '.js')):
                continue
            p = os.path.join(dp, fn)
            src = io.open(p, encoding='utf-8').read()
            if not PAT.search(src):
                continue

            n = [0]

            def repl(m):
                n[0] += 1
                typ = m.group(1)
                args = m.group(2)[1:-1].strip()   # 去掉外层 [ ]
                return ("<primitive object={sharedGeometry('%s', %s)} attach=\"geometry\" />"
                        % (typ, args))

            new = PAT.sub(repl, src)
            new, added = ensure_import(new, p, dry)
            # 后置断言：用了 sharedGeometry 就必须真的 import 到它。
            # 漏掉 import 的文件能过打包（tree-shaking 前）但在浏览器里
            # ReferenceError，而那种错只有跑到那一步才暴露。
            if 'sharedGeometry(' in new:
                assert re.search(r"import \{[^}]*\bsharedGeometry\b[^}]*\} from '[^']*engine/resources'", new), \
                    '没插进 import: ' + p
            rel = p.replace(SRC + '/', '')
            print('  %-58s %d 处%s' % (rel, n[0], '  + import' if added else ''))
            total += n[0]
            files += 1
            if not dry:
                io.open(p, 'w', encoding='utf-8').write(new)

    print()
    print('%s：%d 个文件，%d 处几何体' % ('会改' if dry else '已改', files, total))


if __name__ == '__main__':
    main()
