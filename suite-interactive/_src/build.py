# -*- coding: utf-8 -*-
"""
suite-interactive 构建脚本
--------------------------------------------------------------------------
index.html = 头部界面（_src/head.html）
           + suite-3d 场景内核（从 ../suite-3d/index.html 抽取，逐字复制）
           + 交互层（_src/scene.js：王阿姨 / 送药机器人 / 导航 / 面板逻辑）
           + 收尾

改界面 → _src/head.html；改交互 → _src/scene.js；改户型家具灯光 → 回 suite-3d/index.html
（改完两处都在，然后重跑本脚本）。

    python build.py
"""
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.dirname(HERE)
CORE = os.path.normpath(os.path.join(OUT_DIR, '..', 'suite-3d', 'index.html'))
OUT = os.path.join(OUT_DIR, 'index.html')


def read(path):
    with io.open(path, encoding='utf-8') as f:
        return f.read()


def main():
    lines = read(CORE).split('\n')

    def seg(a, b):
        assert 1 <= a <= b <= len(lines), 'suite-3d/index.html 行号越界：%d..%d（共 %d 行）' % (a, b, len(lines))
        return '\n'.join(lines[a - 1:b])

    head = read(os.path.join(HERE, 'head.html')).rstrip('\n')
    core = seg(115, 895)      # 参数 / 程序化贴图 / 材质 / 墙体 / 家具 / 家具布置
    mid_a = seg(1108, 1126)   # 窗帘 · 挂画 · 踢脚
    mid_b = seg(1162, 1230)   # 光照 · 吊灯 · 地面 · 参考网格
    layer = read(os.path.join(HERE, 'scene.js')).rstrip('\n')

    # 校验内核两端确实是预期的那几行，防止 suite-3d/index.html 变动后静默拼错
    assert core.lstrip().startswith('/* ====='), '内核起点不对：' + core[:60]
    assert 'curtain(0.92, 0.32, 0, 1.05)' in core[-200:], '内核终点不对：' + core[-120:]
    assert 'const hemi' in mid_b and 'gridG.add(gh)' in mid_b, '光照段抽取不对'

    parts = [head, '', core, '', mid_a, '', mid_b, '', layer, '', '})();', '', '</script>', '</body>', '</html>', '']
    text = '\n'.join(parts)
    with io.open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    print('OK  %s  (%.1f KB, %d 行)' % (OUT, len(text.encode('utf-8')) / 1024.0, text.count('\n') + 1))


if __name__ == '__main__':
    main()
