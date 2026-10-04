#!/usr/bin/env python3
"""serve-nocache.py —— 演示用静态服务器（**显式禁用缓存** + **双根目录**）

为什么需要它：
1. `python3 -m http.server` 只发 `Last-Modified`，Chrome 对 ES module 会走*启发式缓存*
   （没有 Cache-Control 时按文件年龄的 10% 缓存）。于是"改完代码 → 刷新"经常还是旧
   `main.js`，表现为"新按钮不出现 / 还是旧行为"（2026-10-04 实际踩到过）。
2. 主演示在 `prototype/`，而队友的家属端 App 在仓库根的 `family-app/`。
   只服务 `prototype/` 时 `../family-app/` 会 404。这里做**双根**：
   先找 `prototype/<path>`，找不到再找 `<仓库根>/<path>`。
   于是：`/` 仍是主演示、`/js/main.js` 仍是主演示的模块、
   而 `/family-app/index.html` 也能开到（队友那份家属端）。

用法：
    python3 scripts/serve-nocache.py [目录=prototype] [端口=8000]

每个响应都带：
    Cache-Control: no-store, must-revalidate
    Pragma: no-cache
    Expires: 0
仍然是**纯本地**静态服务：零外部请求、零依赖。
"""

import functools
import http.server
import os
import socketserver
import sys
import urllib.parse


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """先 prototype/、再仓库根的双根静态服务"""

    # 由 main() 注入：bases = [原型目录, 仓库根目录]
    bases = []

    def translate_path(self, path):  # noqa: D102
        raw = path.split('?', 1)[0].split('#', 1)[0]
        raw = urllib.parse.unquote(raw)
        parts = [p for p in raw.split('/') if p not in ('', '.', '..')]
        rel = os.path.join(*parts) if parts else 'index.html'
        for base in self.bases:
            full = os.path.join(base, rel)
            if os.path.isfile(full):
                return full
            # 目录请求（如 /family-app/）→ 该目录下的 index.html
            if os.path.isdir(full):
                index = os.path.join(full, 'index.html')
                if os.path.isfile(index):
                    return index
        return os.path.join(self.bases[0], rel)

    def end_headers(self):  # noqa: D102
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):  # 演示时别把终端刷满
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else 'prototype'
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8000
    if not os.path.isdir(target):
        sys.exit(f'目录不存在：{target}')
    proto = os.path.abspath(target)
    repo = os.path.dirname(proto)
    NoCacheHandler.bases = [proto, repo]
    handler = functools.partial(NoCacheHandler)  # directory 由 translate_path 决定
    with Server(('', port), handler) as httpd:
        print(f'serving {proto} (+ {repo}) → http://localhost:{port}/  (no-store, 双根)')
        httpd.serve_forever()


if __name__ == '__main__':
    main()
