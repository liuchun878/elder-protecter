#!/usr/bin/env python3
"""
make-test-glb.py —— 生成自测用的 .glb 夹具（本地开发工具，不属于交付物）

为什么要自己造夹具：用户从 Tripo 拿到的模型还没到，但**归一化逻辑（接地/朝向/缩放）
完全可以先用已知尺寸的模型验证**。夹具刻意覆盖 Tripo 导出最常见的三个坑：

  ① `test-elder.glb`  —— 以**包围盒中心**为原点（导出默认），面朝 −z，高 1.56 m
  ② `test-robot.glb`  —— 以**中心**为原点，面朝 +x，占地 0.42 m，高 0.78 m
  ③ `test-tiny-unit.glb` —— 尺寸只有真值的 1/100（单位当成了米/厘米），用于验证按高度缩放

生成物只含盒子与球，**几何简单到可以手算校验**：脚本会把每个夹具的
"期望归一化结果"写进 assets/manifest.json 的注释性字段里，供 Node 自测断言。

用法：python3 scripts/make-test-glb.py
"""
import json
import math
import os
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "prototype", "assets")


# ── 极简 glTF/GLB 写出 ────────────────────────────────────────────────

class Builder:
    """把若干"盒子/球"拼成一个 glTF，再打包成 GLB。"""

    def __init__(self):
        self.positions = []
        self.normals = []
        self.indices = []
        self.primitives = []   # (node_name, start_index, index_count, material_idx)
        self.materials = []

    def _material(self, name, rgba, rough, metal):
        self.materials.append({
            "name": name,
            "pbrMetallicRoughness": {
                "baseColorFactor": list(rgba),
                "metallicFactor": metal,
                "roughnessFactor": rough,
            },
        })
        return len(self.materials) - 1

    def box(self, name, center, size, rgba=(0.8, 0.8, 0.8, 1.0)):
        """轴对齐盒子；法线按面给。返回该 primitive 的三角形数与包围盒。"""
        mat = self._material(f"{name}-mat", rgba, 0.62, 0.0)
        cx, cy, cz = center
        hx, hy, hz = (s / 2.0 for s in size)
        start = len(self.indices)
        faces = [
            ((+1, 0, 0), [(hx, -hy, -hz), (hx, +hy, -hz), (hx, +hy, +hz), (hx, -hy, +hz)]),
            ((-1, 0, 0), [(-hx, -hy, +hz), (-hx, +hy, +hz), (-hx, +hy, -hz), (-hx, -hy, -hz)]),
            ((0, +1, 0), [(-hx, hy, -hz), (-hx, hy, +hz), (hx, hy, +hz), (hx, hy, -hz)]),
            ((0, -1, 0), [(-hx, -hy, +hz), (-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, +hz)]),
            ((0, 0, +1), [(-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]),
            ((0, 0, -1), [(hx, -hy, -hz), (-hx, -hy, -hz), (-hx, hy, -hz), (hx, hy, -hz)]),
        ]
        for normal, quad in faces:
            base = len(self.positions)
            for (x, y, z) in quad:
                self.positions.append((x + cx, y + cy, z + cz))
                self.normals.append(normal)
            self.indices += [base, base + 1, base + 2, base, base + 2, base + 3]
        self.primitives.append((name, start, len(self.indices) - start, mat))
        return len(self.indices) // 3

    def write(self, path, root_name):
        pos = b"".join(struct.pack("<3f", *p) for p in self.positions)
        nrm = b"".join(struct.pack("<3f", *n) for n in self.normals)
        idx = b"".join(struct.pack("<H", i) for i in self.indices)

        def pad(b, fill=b"\x00"):
            while len(b) % 4:
                b += fill
            return b

        pos, nrm, idx = pad(pos), pad(nrm), pad(idx)
        blob = pos + nrm + idx
        views = [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(pos), "target": 34962},
            {"buffer": 0, "byteOffset": len(pos), "byteLength": len(nrm), "target": 34962},
            {"buffer": 0, "byteOffset": len(pos) + len(nrm), "byteLength": len(idx), "target": 34963},
        ]
        xs = [p[0] for p in self.positions]
        ys = [p[1] for p in self.positions]
        zs = [p[2] for p in self.positions]
        accessors = [
            {"bufferView": 0, "componentType": 5126, "count": len(self.positions), "type": "VEC3",
             "min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]},
            {"bufferView": 1, "componentType": 5126, "count": len(self.normals), "type": "VEC3"},
            {"bufferView": 2, "componentType": 5123, "count": len(self.indices), "type": "SCALAR"},
        ]
        meshes = [
            {"name": name, "primitives": [
                {"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2, "material": mat}]}
            for (name, _start, _count, mat) in self.primitives
        ]
        nodes = [{"mesh": i, "name": name} for i, (name, _s, _c, _m) in enumerate(self.primitives)]
        gltf = {
            "asset": {"version": "2.0", "generator": "elder-protecter fixture maker"},
            "scene": 0,
            "scenes": [{"name": root_name, "nodes": list(range(len(nodes)))}],
            "nodes": nodes,
            "meshes": meshes,
            "materials": self.materials,
            "accessors": accessors,
            "bufferViews": views,
            "buffers": [{"byteLength": len(blob)}],
        }
        jb = pad(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), b" ")
        bb = pad(blob)
        total = 12 + (8 + len(jb)) + (8 + len(bb))
        out = (b"glTF" + struct.pack("<II", 2, total)
               + struct.pack("<I", len(jb)) + b"JSON" + jb
               + struct.pack("<I", len(bb)) + b"BIN\x00" + bb)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(out)
        size = (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
        return {"bytes": len(out), "bbox_min": [min(xs), min(ys), min(zs)],
                "bbox_max": [max(xs), max(ys), max(zs)],
                "size": [round(v, 5) for v in size], "triangles": len(self.indices) // 3}


def build_elder():
    """王阿姨：总高 1.56 m，**以包围盒中心为原点**（y 从 −0.78 到 +0.78），面朝 −z。"""
    b = Builder()
    # 所有盒子的 y 都相对"脚底"给，最后整体下移半个身高，让原点落在中心
    parts = [
        ("legs", (0, 0.38, 0), (0.34, 0.76, 0.22), (0.56, 0.60, 0.66, 1.0)),
        ("torso", (0, 1.06, 0), (0.40, 0.60, 0.26), (0.75, 0.56, 0.57, 1.0)),
        ("head", (0, 1.44, 0), (0.22, 0.24, 0.24), (0.94, 0.80, 0.67, 1.0)),
    ]
    for name, c, s, col in parts:
        b.box(name, (c[0], c[1] - 0.78, c[2]), s, col)
    return b


def build_robot():
    """送药机器人：高 0.78 m、最大宽 0.42 m，**中心原点**，面朝 +x（药盘在 +x 侧）。"""
    b = Builder()
    parts = [
        ("base", (0, 0.03, 0), (0.34, 0.06, 0.34), (0.91, 0.91, 0.90, 1.0)),
        ("body", (0, 0.42, 0), (0.40, 0.72, 0.40), (0.97, 0.97, 0.96, 1.0)),
        ("screen", (0.16, 0.72, 0), (0.10, 0.16, 0.22), (0.08, 0.10, 0.11, 1.0)),
        ("tray", (0.20, 0.30, 0), (0.14, 0.04, 0.20), (0.94, 0.93, 0.91, 1.0)),
    ]
    for name, c, s, col in parts:
        b.box(name, (c[0], c[1] - 0.39, c[2]), s, col)
    return b


def build_tiny():
    """单位踩坑：真值 1.56 m 但导出成了 0.0156 m（厘米当米写错了量级），面朝 +z。"""
    b = Builder()
    k = 0.01
    parts = [
        ("legs", (0, 0.38, 0), (0.34, 0.76, 0.22)),
        ("torso", (0, 1.06, 0), (0.40, 0.60, 0.26)),
        ("head", (0, 1.44, 0), (0.22, 0.24, 0.24)),
    ]
    for name, c, s in parts:
        b.box(name, (c[0] * k, (c[1] - 0.78) * k, c[2] * k),
              (s[0] * k, s[1] * k, s[2] * k), (0.80, 0.72, 0.68, 1.0))
    return b


def main():
    jobs = [
        ("test-elder.glb", build_elder(), "TestElder",
         {"realHeight": 1.56, "forward": [0, 0, -1], "note": "中心原点 + 面朝 -z"}),
        ("test-robot.glb", build_robot(), "TestRobot",
         {"realHeight": 0.78, "forward": [1, 0, 0], "note": "中心原点 + 面朝 +x"}),
        ("test-tiny-unit.glb", build_tiny(), "TestTiny",
         {"realHeight": 1.56, "forward": [0, 0, 1], "note": "尺寸小 100 倍，验证按高度缩放"}),
    ]
    facts = {}
    for fname, builder, root, spec in jobs:
        path = os.path.join(ASSETS, fname)
        info = builder.write(path, root)
        facts[fname] = {**info, "target": spec}
        print(f"✓ {fname:24s} {info['bytes']:7d} B  size={info['size']}  tris={info['triangles']}  ({spec['note']})")
    with open(os.path.join(ASSETS, "fixtures.json"), "w", encoding="utf-8") as fh:
        json.dump(facts, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"\n期望值写入 prototype/assets/fixtures.json，供 .preview/assettest.mjs 断言")
    return 0


if __name__ == "__main__":
    sys.exit(main())
