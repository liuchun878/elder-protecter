// 给 robot-3d 起一个最小的本地静态服务器（无依赖，仅本机可访问）
// usage: node serve_robot.mjs <dir> <port>
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const DIR = process.argv[2] || '.'
const PORT = parseInt(process.argv[3] || '8788', 10)
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.md': 'text/plain; charset=utf-8'
}

const server = createServer(async (req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0])
  if (url === '/') url = '/preview.html'
  const p = normalize(join(DIR, url))
  if (!p.startsWith(normalize(DIR))) { res.writeHead(403); res.end('forbidden'); return }
  try {
    const st = await stat(p)
    if (st.isDirectory()) { res.writeHead(404); res.end('dir'); return }
    const body = await readFile(p)
    res.writeHead(200, {
      'Content-Type': MIME[extname(p).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store'
    })
    res.end(body)
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('404 ' + url)
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('ROBOT_3D_URL=http://127.0.0.1:' + PORT + '/')
  console.log('serving', DIR)
})
