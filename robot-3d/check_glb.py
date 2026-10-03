# -*- coding: utf-8 -*-
"""快速自检：解析 robot.glb / robot.gltf 的头部与访问器边界，确认结构合法。

判据（glTF 2.0）：
  · accessor.count 是元素个数（顶点数 / 索引数），bufferView 必须正好装下
  · POSITION 必须有 min/max，且 min/max 是"逐分量的最值"
  · 所有 index 必须落在顶点数范围内
  · 材质 / 贴图 / 图片索引不得越界；节点层级无环、根节点与场景一致
"""
import json
import os
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
p = os.path.join(HERE, "robot.glb")
raw = open(p, "rb").read()
magic, ver, total = struct.unpack("<III", raw[:12])
assert magic == 0x46546C67 and ver == 2, "bad glb header"
assert total == len(raw), "length mismatch %d vs %d" % (total, len(raw))
off, js, bin_chunk = 12, None, None
while off < len(raw):
    clen, ctype = struct.unpack("<II", raw[off:off + 8])
    body = raw[off + 8: off + 8 + clen]
    if ctype == 0x4E4F534A:
        js = json.loads(body.decode("utf-8"))
    elif ctype == 0x004E4942:
        bin_chunk = body
    off += 8 + clen
assert js and bin_chunk is not None, "missing chunk"
print("chunk ok | buffer:", js["buffers"][0]["byteLength"], "| bin:", len(bin_chunk))

COMP = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
import numpy as np


def acc(i):
    a = js["accessors"][i]
    bv = js["bufferViews"][a["bufferView"]]
    comp, nc = COMP[a["componentType"]], NCOMP[a["type"]]
    assert comp * nc * a["count"] == bv["byteLength"], \
        "accessor %d 与 bufferView 长度不一致：count=%d type=%s vs byteLength=%d" % (
            i, a["count"], a["type"], bv["byteLength"])
    assert bv["byteOffset"] + bv["byteLength"] <= len(bin_chunk), "bufferView %d 越界" % a["bufferView"]
    return a, bv


def read_vec3(a, bv):
    start = bv["byteOffset"] + a.get("byteOffset", 0)
    n = a["count"] * 3
    return np.frombuffer(bin_chunk, dtype="<f4", count=n, offset=start).reshape(-1, 3)


tri_total = 0
maxvert = 0
for mi, m in enumerate(js["meshes"]):
    for pr in m["primitives"]:
        pa, pb = acc(pr["attributes"]["POSITION"])
        na, _ = acc(pr["attributes"]["NORMAL"])
        ia, ib = acc(pr["indices"])
        assert pa["count"] == na["count"], "POSITION/NORMAL 顶点数不一致"
        if "TEXCOORD_0" in pr["attributes"]:
            assert pa["count"] == acc(pr["attributes"]["TEXCOORD_0"])[0]["count"], "UV 顶点数不一致"
        assert ia["count"] % 3 == 0, "索引数不是 3 的倍数"
        # glTF 允许 mesh 不带材质（走默认材质）；带的话必须越界检查
        if "material" in pr:
            assert pr["material"] < len(js["materials"]), "材质索引越界"
        assert "min" in pa and "max" in pa, "POSITION 缺 min/max"
        verts = read_vec3(pa, pb)
        assert np.allclose(verts.min(axis=0), pa["min"], atol=1e-6), "min 与实际不符"
        assert np.allclose(verts.max(axis=0), pa["max"], atol=1e-6), "max 与实际不符"
        idx = np.frombuffer(bin_chunk, dtype="<u4", count=ia["count"],
                            offset=ib["byteOffset"] + ia.get("byteOffset", 0))
        assert idx.max() < pa["count"], "索引越界（%d >= %d）" % (idx.max(), pa["count"])
        tri_total += ia["count"] // 3
        maxvert = max(maxvert, pa["count"])
print("meshes:", len(js["meshes"]), "| materials:", len(js["materials"]), "| nodes:", len(js["nodes"]),
      "| triangles:", tri_total, "| 最大顶点数:", maxvert)

names = [n.get("name", "") for n in js["nodes"]]
kids = set()
for n in js["nodes"]:
    for c in n.get("children", []):
        assert c < len(js["nodes"]), "children 越界"
        kids.add(c)
roots = [i for i in range(len(js["nodes"])) if i not in kids]
assert set(roots) == set(js["scenes"][0]["nodes"]), "根节点与场景不一致"
print("根节点数:", len(roots), "| 场景根数:", len(js["scenes"][0]["nodes"]))

# 深度优先，确认没有环
seen = set()


def walk(i, depth=0):
    assert i not in seen, "节点层级出现环 @%d" % i
    seen.add(i)
    for c in js["nodes"][i].get("children", []):
        walk(c, depth + 1)


for r in roots:
    walk(r)
assert len(seen) == len(js["nodes"]), "有节点不可达"
print("层级可达节点:", len(seen), "/", len(js["nodes"]))

for im in js.get("images", []):
    assert "bufferView" in im and im["bufferView"] < len(js["bufferViews"]), "image bufferView 越界"
for tx in js.get("textures", []):
    assert tx["source"] < len(js.get("images", [])), "texture.source 越界"
print("images:", len(js.get("images", [])), "| textures:", len(js.get("textures", [])),
      "| 扩展:", js.get("extensionsUsed"))
mat_used = set(pr["material"] for m in js["meshes"] for pr in m["primitives"] if "material" in pr)
missing = sum(1 for m in js["meshes"] for pr in m["primitives"] if "material" not in pr)
print("没绑材质的 primitive（仅作为几何池，节点侧才带材质）:", missing)
print("材质被引用:", len(mat_used), "/", len(js["materials"]),
      "| 未被引用:", [js["materials"][i]["name"] for i in range(len(js["materials"])) if i not in mat_used])
print("OK  robot.glb 结构自检全部通过")
