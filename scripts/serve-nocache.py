#!/usr/bin/env python3
"""serve-nocache.py —— 演示用静态服务器（**显式禁用缓存**）

为什么需要它：`python3 -m http.server` 只发 `Last-Modified`，Chrome 对 ES module
会走*启发式缓存*（没有 Cache-Control 时按 10% 文件年龄缓存）。于是"改完代码 → 刷新"
经常还是旧 `main.js`，表现为"新按钮不出现 / 还是旧行为"（2026-10-04 实际踩到过）。

用法：
    python3 scripts/serve-nocache.py [目录=prototype] [端口=8000]

等价于 `python3 -m http.server`，只是每个响应都带：
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


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
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
    root = sys.argv[1] if len(sys.argv) > 1 else 'prototype'
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8000
    if not os.path.isdir(root):
        sys.exit(f'目录不存在：{root}')
    handler = functools.partial(NoCacheHandler, directory=root)
    with Server(('', port), handler) as httpd:
        print(f'serving {os.path.abspath(root)} → http://localhost:{port}/  (no-store)')
        httpd.serve_forever()


if __name__ == '__main__':
    main()
