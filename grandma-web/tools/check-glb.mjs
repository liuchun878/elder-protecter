/* =============================================================================
 * check-glb.mjs — 独立校验 GLB（不依赖页面，只读文件）
 *
 *   node tools/check-glb.mjs assets/grandma.glb [更多文件...]
 *
 * 检查项：容器头/版本/块对齐、JSON 合法性、accessor 与 bufferView 越界、
 *        索引范围、以及从二进制里真解出一遍三角形数/包围盒。
 * 末尾必须打印「OK <文件> 结构自检全部通过」。
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';

const MAGIC = 0x46546C67, JSON_CHUNK = 0x4E4F534A, BIN_CHUNK = 0x004E4942;
let failures = 0;
function fail(f, msg) { failures++; console.error('  [FAIL] ' + f + ' : ' + msg); }

const COMP = {
  5120: { size: 1, read: (dv, o) => dv.getInt8(o), name: 'BYTE' },
  5121: { size: 1, read: (dv, o) => dv.getUint8(o), name: 'UNSIGNED_BYTE' },
  5122: { size: 2, read: (dv, o) => dv.getInt16(o, true), name: 'SHORT' },
  5123: { size: 2, read: (dv, o) => dv.getUint16(o, true), name: 'UNSIGNED_SHORT' },
  5125: { size: 4, read: (dv, o) => dv.getUint32(o, true), name: 'UNSIGNED_INT' },
  5126: { size: 4, read: (dv, o) => dv.getFloat32(o, true), name: 'FLOAT' }
};
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function check(file) {
  console.log('== ' + file);
  const buf = fs.readFileSync(file);
  if (buf.length < 20) { fail(file, '文件太小'); return; }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) fail(file, 'magic 不是 glTF');
  const version = dv.getUint32(4, true);
  const total = dv.getUint32(8, true);
  if (version !== 2) fail(file, '版本不是 2');
  if (total !== buf.length) fail(file, `头部长度 ${total} != 实际 ${buf.length}`);

  let off = 12, json = null, bin = null, binStart = 0;
  while (off + 8 <= buf.length) {
    const clen = dv.getUint32(off, true);
    const ctype = dv.getUint32(off + 4, true);
    const cstart = off + 8;
    if (cstart + clen > buf.length) { fail(file, 'chunk 越界'); break; }
    if (ctype === JSON_CHUNK) json = buf.subarray(cstart, cstart + clen).toString('utf8');
    else if (ctype === BIN_CHUNK) { bin = buf.subarray(cstart, cstart + clen); binStart = cstart; }
    if (clen % 4 !== 0) fail(file, 'chunk 未按 4 字节对齐');
    off = cstart + clen;
  }
  if (!json) { fail(file, '缺少 JSON 块'); return; }
  if (!bin) { fail(file, '缺少 BIN 块'); return; }

  let g;
  try { g = JSON.parse(json); } catch (e) { fail(file, 'JSON 解析失败: ' + e.message); return; }
  if (!g.asset || g.asset.version !== '2.0') fail(file, 'asset.version 不是 2.0');

  const buffers = g.buffers || [];
  const views = g.bufferViews || [];
  const accessors = g.accessors || [];

  if (!buffers.length) fail(file, '没有 buffers');
  if (buffers.length && buffers[0].byteLength > bin.length) fail(file, 'buffer 声明长度超过 BIN 块');

  views.forEach((v, i) => {
    if (v.byteOffset === undefined) v.byteOffset = 0;
    if (v.byteOffset + v.byteLength > bin.length) fail(file, `bufferView[${i}] 越界`);
    if (v.byteOffset % 4 !== 0) fail(file, `bufferView[${i}] byteOffset 未对齐`);
  });

  accessors.forEach((a, i) => {
    const c = COMP[a.componentType];
    const n = NCOMP[a.type];
    if (!c || !n) { fail(file, `accessor[${i}] 类型未知`); return; }
    const v = views[a.bufferView];
    if (!v) { fail(file, `accessor[${i}] 引用不存在的 bufferView`); return; }
    const need = a.count * n * c.size;
    if (need > v.byteLength) fail(file, `accessor[${i}] 需要 ${need} 字节，bufferView 只有 ${v.byteLength}`);
  });

  // 真解一遍
  let tris = 0, verts = 0, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const meshes = g.meshes || [];
  meshes.forEach((m, mi) => {
    (m.primitives || []).forEach((p, pi) => {
      const pa = accessors[p.attributes.POSITION];
      if (!pa) { fail(file, `mesh[${mi}].prim[${pi}] 没有 POSITION`); return; }
      const pv = views[pa.bufferView], pc = COMP[pa.componentType];
      if (pa.type !== 'VEC3') fail(file, `POSITION 的 type 是 ${pa.type}，应为 VEC3`);
      // byteStride 未声明时是"紧密排列"，步长 = 分量数 × 分量字节
      const stride = pv.byteStride || (pc.size * NCOMP[pa.type]);
      let bad = 0;
      for (let i = 0; i < pa.count; i++) {
        const base = binStart + pv.byteOffset + (pa.byteOffset || 0) + i * stride;
        for (let c = 0; c < 3; c++) {
          const val = pc.read(dv, base + c * pc.size);
          if (!isFinite(val)) { fail(file, `mesh[${mi}] 顶点 ${i} 存在非法数值`); return; }
          if (val < min[c]) min[c] = val;
          if (val > max[c]) max[c] = val;
        }
      }
      verts += pa.count;
      if (p.indices !== undefined) {
        const ia = accessors[p.indices];
        const iv = views[ia.bufferView], ic = COMP[ia.componentType];
        if (ia.count % 3 !== 0) fail(file, `mesh[${mi}].prim[${pi}] 索引数不是 3 的倍数`);
        for (let i = 0; i < ia.count; i++) {
          const ix = ic.read(dv, binStart + iv.byteOffset + (ia.byteOffset || 0) + i * ic.size);
          if (ix >= pa.count) bad++;
        }
        if (bad) fail(file, `mesh[${mi}].prim[${pi}] 有 ${bad} 个索引越界`);
        tris += ia.count / 3;
      } else {
        tris += pa.count / 3;
      }
    });
  });

  console.log(`   网格 ${meshes.length} · 三角面 ${tris} · 顶点 ${verts} · 材质 ${(g.materials || []).length}`);
  console.log(`   包围盒 min=[${min.map(v => v.toFixed(3))}] max=[${max.map(v => v.toFixed(3))}]`);
  console.log(`   尺寸 ${(max[0] - min[0]).toFixed(3)} × ${(max[1] - min[1]).toFixed(3)} × ${(max[2] - min[2]).toFixed(3)} m`);
  if (tris === 0) fail(file, '没有任何三角面');
}

const files = process.argv.slice(2);
if (!files.length) { console.error('用法: node tools/check-glb.mjs <file.glb> [...]'); process.exit(2); }
for (const f of files) check(path.resolve(f));

if (failures) {
  console.error('\n共 ' + failures + ' 项未通过');
  process.exit(1);
}
files.forEach(f => console.log('OK ' + path.basename(f) + ' 结构自检全部通过'));
