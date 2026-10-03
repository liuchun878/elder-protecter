# -*- coding: utf-8 -*-
"""
送药机器人 · 立柜式（参考用户照片重建）—— 参数化建模 + GLB / glTF 导出 + 预览 HTML 生成

坐标系：Y 向上，+Z 为机器人正面，原点在底面中心（y=0 即地面）。
单位：米。整机尺寸约 0.48 x 0.44 x 1.32 m。

产物：
  robot.glb        标准 glTF 2.0 二进制（SketchUp / Rhino / Blender / Windows 3D 查看器可开）
  robot.gltf       同一模型的 .gltf + .bin 分离版（个别老软件只认这个）
  scene.json       几何/材质/节点表（供 HTML 查看器复用，保证两边一模一样）
  preview.html     单文件 Three.js 交互查看器（双击即开）
"""
import base64
import hashlib
import io
import json
import math
import os
import struct

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))

# ----------------------------------------------------------------------------
# 材质
# ----------------------------------------------------------------------------
# name, baseColor, roughness, metallic, emissive, alpha, double_sided, unlit
MATERIALS = [
    ("白色哑光外壳", (0.925, 0.929, 0.933), 0.34, 0.02, None, 1.0),   # 0
    ("白色亮面面板", (0.960, 0.962, 0.966), 0.18, 0.03, None, 1.0),   # 1
    ("黑色玻璃屏",   (0.035, 0.038, 0.045), 0.09, 0.35, None, 1.0),   # 2
    ("屏幕画面",     (1.000, 1.000, 1.000), 0.30, 0.00, (0.30, 0.36, 0.44), 1.0),  # 3
    ("木纹拉手",     (0.720, 0.500, 0.280), 0.48, 0.00, None, 1.0),   # 4
    ("不锈钢立柱",   (0.660, 0.680, 0.700), 0.24, 0.92, None, 1.0),   # 5
    ("镜头玻璃",     (0.020, 0.022, 0.028), 0.05, 0.55, None, 1.0),   # 6
    ("琥珀色细节",   (0.900, 0.400, 0.100), 0.42, 0.00, None, 1.0),   # 7
    ("深灰结构件",   (0.155, 0.165, 0.180), 0.62, 0.15, None, 1.0),   # 8
    ("轮子橡胶",     (0.075, 0.078, 0.085), 0.85, 0.00, None, 1.0),   # 9
    ("格栅暗槽",     (0.105, 0.110, 0.120), 0.75, 0.05, None, 1.0),   # 10
]

# 屏幕状态（写入贴图，GLB 与 HTML 共用）
SCREENS = {
    "logo":  "三条短竖杠（正面等待状态）",
    "eyes":  "两只圆眼，蓝白呼吸光",
    "green": "两只绿眼 + 微笑（服药完成）",
    "off":   "熄屏",
}
DEFAULT_SCREEN = "logo"


# ----------------------------------------------------------------------------
# 几何基元
# ----------------------------------------------------------------------------
def _hashed(m):
    h = hashlib.sha1()
    h.update(struct.pack("<3I", len(m["p"]) // 3, len(m["n"]) // 3, len(m["i"])))
    h.update(np.asarray(m["p"], dtype="<f4").tobytes())
    h.update(np.asarray(m["n"], dtype="<f4").tobytes())
    h.update(np.asarray(m["i"], dtype="<u4").tobytes())
    if m.get("uv"):
        h.update(np.asarray(m["uv"], dtype="<f4").tobytes())
    return h.hexdigest()


class Builder(object):
    def __init__(self):
        self.geoms = {}
        self._cache = {}
        self.nodes = []
        self.textures = {}
        self.root_children = []

    def mesh(self, p, n, i, uv=None):
        m = {"p": [round(float(v), 6) for v in p],
             "n": [round(float(v), 4) for v in n],
             "i": [int(v) for v in i]}
        if uv is not None and len(uv):
            # 摊平为 [u0,v0,u1,v1,...]
            flat = []
            for item in uv:
                if isinstance(item, (tuple, list)):
                    flat.extend([round(float(item[0]), 5), round(float(item[1]), 5)])
                else:
                    flat.append(round(float(item), 5))
            m["uv"] = flat
        key = _hashed(m)
        if key not in self.geoms:
            self.geoms[key] = m
        return key


def rounded_box(b, w, d, h, r=0.0, seg=4, smooth=True, cx=0.0, cy=0.0, cz=0.0):
    """圆角长方体；r 为竖棱倒角半径，seg 控制每个四分之一圆的分段数。"""
    hw, hd, hh = w / 2.0, d / 2.0, h / 2.0
    r = max(0.0, min(r, hw * 0.98, hd * 0.98))
    if r < 1e-5:
        r, seg = 1e-5, 1
    pts = []
    corners = [(hw - r, hd - r, 0.0), (-hw + r, hd - r, math.pi / 2),
               (-hw + r, -hd + r, math.pi), (hw - r, -hd + r, 3 * math.pi / 2)]
    for cxx, cyy, a0 in corners:
        for k in range(seg + 1):
            a = a0 + (math.pi / 2) * k / seg
            pts.append((cxx + r * math.cos(a), cyy + r * math.sin(a)))
    N = len(pts)

    def P(t, s, z):
        # z 是相对中心的高度偏移，必须加上 cy，否则会偏离盒体
        x, y = pts[t]
        return (cx + x * s, cy + z, cz + y * s)

    V, Tri, UV = [], [], []

    def push(ps, uvs):
        base = len(V)
        V.extend(ps)
        UV.extend(uvs)
        return base

    def quad(a, bb, c, dd, uvs):
        base = push([a, bb, c, dd], uvs)
        Tri.extend([base, base + 1, base + 2, base, base + 2, base + 3])

    def ring(s, z):
        base = push([P(t, s, z) for t in range(N)], [(0.0, 0.0)] * N)
        return base

    top, bot = ring(1.0, hh), ring(1.0, -hh)
    # glTF 正面朝外：顶面逆序、底面顺序
    for t in range(N):
        t2 = (t + 1) % N
        Tri.extend([top + t, top + t2, bot + t])
        Tri.extend([top + t2, bot + t2, bot + t])
    # 顶/底盖
    ct = push([(cx, cy + hh, cz)], [(0.5, 0.5)])
    cb = push([(cx, cy - hh, cz)], [(0.5, 0.5)])
    for t in range(N):
        t2 = (t + 1) % N
        Tri.extend([ct, top + t2, top + t])
        Tri.extend([cb, bot + t, bot + t2])
    # 上下倒角环
    bevel = min(r * 0.6, hh * 0.5, 0.012)
    if bevel > 1e-5:
        for sgn, zz, zr, ro in ((1, hh, hh - bevel, True), (-1, -hh, -hh + bevel, False)):
            a = ring(1.0, zr)
            c = ring(1.0 - bevel / max(hw, 1e-6), sgn * hh)
            for t in range(N):
                t2 = (t + 1) % N
                if ro:
                    Tri.extend([c + t, c + t2, a + t2, c + t, a + t2, a + t])
                else:
                    Tri.extend([a + t, a + t2, c + t2, a + t, c + t2, c + t])
    _uv_from_positions(V, UV, Tri)
    nrm = _face_normals(V, Tri, smooth)
    return b.mesh([v for p in V for v in p], nrm, Tri, UV)


def box(b, w, d, h, **kw):
    return rounded_box(b, w, d, h, 0.0, 1, False, **kw)


def cylinder(b, r, h, seg=48, smooth=True, cx=0.0, cy=0.0, cz=0.0, taper=1.0):
    """圆柱/圆台：轴向 = 本地 +Y，底面在本地 y=0（原点在底面圆心），便于直接竖着摆。"""
    V, Tri, UV = [], [], []

    def push(p, uv):
        V.append(p)
        UV.append(uv)
        return len(V) - 1

    bot = [push((cx + r * math.cos(2 * math.pi * k / seg), cy,
                 cz + r * math.sin(2 * math.pi * k / seg)), (k / seg, 1.0)) for k in range(seg)]
    top = [push((cx + r * taper * math.cos(2 * math.pi * k / seg), cy + h,
                 cz + r * taper * math.sin(2 * math.pi * k / seg)), (k / seg, 0.0)) for k in range(seg)]
    for k in range(seg):
        k2 = (k + 1) % seg
        Tri.extend([bot[k], bot[k2], top[k2], bot[k], top[k2], top[k]])
    cb = push((cx, cy, cz), (0.5, 1.0))
    ct = push((cx, cy + h, cz), (0.5, 0.0))
    for k in range(seg):
        k2 = (k + 1) % seg
        Tri.extend([cb, bot[k2], bot[k]])
        Tri.extend([ct, top[k], top[k2]])
    nrm = _face_normals(V, Tri, smooth)
    return b.mesh([v for p in V for v in p], nrm, Tri, UV)


def revolve(b, profile, seg=48, smooth=True, cx=0.0, cy=0.0, cz=0.0, a0=0.0, a1=360.0):
    """把 (半径, 轴向高度) 折线绕 Z 轴旋成回转体。"""
    full = abs(a1 - a0) >= 359.999
    cols = seg if full else seg + 1
    V, Tri, UV = [], [], []
    for j in range(cols):
        a = math.radians(a0 + (a1 - a0) * j / seg)
        ca, sa = math.cos(a), math.sin(a)
        for (rr, zz) in profile:
            V.append((cx + rr * ca, cy + rr * sa, cz + zz))
            UV.append((j / seg, 0.0))
    m = len(profile)
    span = seg if full else seg
    for j in range(span):
        j2 = (j + 1) % cols if full else j + 1
        for k in range(m - 1):
            a = j * m + k
            bb = j * m + k + 1
            c = j2 * m + k
            dd = j2 * m + k + 1
            Tri.extend([a, bb, dd, a, dd, c])
    nrm = _face_normals(V, Tri, smooth)
    return b.mesh([v for p in V for v in p], nrm, Tri, UV)


def torus(b, R, r, seg=48, ring=16, smooth=True, cx=0.0, cy=0.0, cz=0.0):
    profile = [(R + r * math.cos(2 * math.pi * k / ring), r * math.sin(2 * math.pi * k / ring))
               for k in range(ring)] + [(R + r, 0.0)]
    return revolve(b, profile, seg=seg, smooth=smooth, cx=cx, cy=cy, cz=cz)


def plane(b, w, h, cx=0.0, cy=0.0, cz=0.0):
    V = [(cx - w / 2, cy - h / 2, cz), (cx + w / 2, cy - h / 2, cz),
         (cx + w / 2, cy + h / 2, cz), (cx - w / 2, cy + h / 2, cz)]
    UV = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
    N = [(0.0, 0.0, 1.0)] * 4
    return b.mesh([v for p in V for v in p], [v for p in N for v in p], [0, 1, 2, 0, 2, 3], UV)


def _uv_from_positions(V, UV, Tri):
    """简单三平面 UV（金属/塑料不需要精确 UV）。"""
    for k, p in enumerate(V):
        ax, ay, az = abs(p[0]), abs(p[1]), abs(p[2])
        if ay >= ax and ay >= az:
            UV[k] = (p[0] * 1.5 + 0.5, p[2] * 1.5 + 0.5)
        elif ax >= az:
            UV[k] = (p[2] * 1.5 + 0.5, p[1] * 1.5)
        else:
            UV[k] = (p[0] * 1.5 + 0.5, p[1] * 1.5)


def _face_normals(V, Tri, smooth):
    A = np.asarray(V, dtype=np.float64)
    T = np.asarray(Tri, dtype=np.int64).reshape(-1, 3)
    e1 = A[T[:, 1]] - A[T[:, 0]]
    e2 = A[T[:, 2]] - A[T[:, 0]]
    fn = np.cross(e1, e2)
    ln = np.linalg.norm(fn, axis=1)
    ln[ln < 1e-12] = 1.0
    fn = fn / ln[:, None]
    out = np.zeros_like(A)
    for c in range(3):
        np.add.at(out, T[:, c], fn)
    if not smooth:
        ln2 = np.linalg.norm(out, axis=1)
        ln2[ln2 < 1e-12] = 1.0
        out = out / ln2[:, None]
        return [round(float(v), 4) for v in out.reshape(-1)]
    key = [tuple(np.round(a, 5)) for a in A]
    acc = {}
    for k, key_ in enumerate(key):
        acc.setdefault(key_, np.zeros(3))
        acc[key_] += out[k]
    for k, key_ in enumerate(key):
        v = acc[key_]
        nv = np.linalg.norm(v)
        out[k] = v / nv if nv > 1e-9 else np.array([0.0, 1.0, 0.0])
    return [round(float(v), 4) for v in out.reshape(-1)]


# ----------------------------------------------------------------------------
# 屏幕贴图
# ----------------------------------------------------------------------------
def _screen_canvas(screen):
    W, H = 640, 660
    img = Image.new("RGB", (W, H), (6, 7, 10))
    d = ImageDraw.Draw(img)
    # 玻璃反光
    g = Image.new("L", (W, H), 0)
    gd = ImageDraw.Draw(g)
    gd.polygon([(0, 0), (W * 0.72, 0), (0, H * 0.78)], fill=26)
    gd.polygon([(W, H), (W * 0.45, H), (W, H * 0.42)], fill=14)
    g = g.filter(ImageFilter.GaussianBlur(28))
    img = Image.composite(Image.new("RGB", (W, H), (150, 168, 190)), img, g)
    d = ImageDraw.Draw(img)

    def rr(box, r, **kw):
        d.rounded_rectangle(box, radius=r, **kw)

    if screen == "off":
        pass
    elif screen == "logo":
        bar_w, bar_h = 54, 208
        gap = 42
        total = bar_w * 3 + gap * 2
        x0 = (W - total) / 2
        y0 = (H - bar_h) / 2 - 20
        for k in range(3):
            rr([x0 + k * (bar_w + gap), y0, x0 + k * (bar_w + gap) + bar_w, y0 + bar_h],
               16, fill=(226, 232, 240))
        rr([W * 0.34, y0 + bar_h + 92, W * 0.66, y0 + bar_h + 100], 4, fill=(70, 80, 96))
    elif screen == "eyes":
        for sx in (-1, 1):
            cx = W / 2 + sx * 132
            cy = H * 0.44
            for k in range(16, 0, -1):
                a = int(90 * (1 - k / 16.0) ** 1.6)
                r = 60 + k * 5
                d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(10 + a, 20 + a, 34 + a))
            d.ellipse([cx - 54, cy - 54, cx + 54, cy + 54], fill=(150, 214, 255))
        rr([W * 0.38, H * 0.70, W * 0.62, H * 0.70 + 9], 4, fill=(90, 160, 210))
    elif screen == "green":
        for sx in (-1, 1):
            cx = W / 2 + sx * 132
            cy = H * 0.42
            d.arc([cx - 62, cy - 34, cx + 62, cy + 62], start=200, end=340, fill=(80, 236, 160), width=18)
        d.arc([W * 0.34, H * 0.52, W * 0.66, H * 0.74], start=15, end=165, fill=(80, 236, 160), width=20)
    return img


def _png_b64(img):
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


# ----------------------------------------------------------------------------
# 装配
# ----------------------------------------------------------------------------
PARAMS = {
    "body_w": 0.460, "body_d": 0.420,
    "body_y0": 0.235, "body_y1": 0.705,
    "base_w": 0.468, "base_d": 0.428, "base_y0": 0.095, "base_y1": 0.240,
    "screen_w": 0.300, "screen_h": 0.302, "screen_yc": 0.492, "screen_z": 0.1665,
    "screen_depth": 0.024,
    "mast_r": 0.019, "mast_y0": 0.705, "mast_y1": 0.985,
    "head_w": 0.180, "head_d": 0.260, "head_h": 0.130, "head_z": -0.030, "head_yc": 1.047,
}


def build_scene():
    b = Builder()
    front = PARAMS["body_d"] / 2.0          # 0.21
    bw = PARAMS["body_w"]
    bd = PARAMS["body_d"]
    by0, by1 = PARAMS["body_y0"], PARAMS["body_y1"]
    parts = []

    def node(name, mat, geo, t=(0.0, 0.0, 0.0), parent=None):
        idx = len(b.nodes)
        b.nodes.append({"name": name, "mat": mat, "geo": geo, "t": [round(v, 6) for v in t],
                        "ch": [], "grp": parent is not None})
        if parent is None:
            b.root_children.append(idx)
        else:
            b.nodes[parent]["ch"].append(idx)
        parts.append((name, idx))
        return idx

    def grp(name, parent=None, t=(0.0, 0.0, 0.0)):
        idx = node(name, -1, None, t, parent)
        return idx

    # ---- 底盘 + 隐藏式万向轮 ------------------------------------------------
    node("底盘外壳", 0, rounded_box(b, PARAMS["base_w"], PARAMS["base_d"],
                                 PARAMS["base_y1"] - PARAMS["base_y0"], 0.03, 5, True,
                                 cz=0), (0, (PARAMS["base_y0"] + PARAMS["base_y1"]) / 2, 0))
    node("底盘下缘", 8, rounded_box(b, PARAMS["base_w"] - 0.014, PARAMS["base_d"] - 0.014, 0.016, 0.02, 4,
                                 True), (0, PARAMS["base_y0"] + 0.012, 0))
    node("底盘腰线", 8, rounded_box(b, PARAMS["base_w"] + 0.004, PARAMS["base_d"] + 0.004, 0.008, 0.024, 4,
                                 True), (0, PARAMS["base_y1"] - 0.012, 0))
    # 三个隐藏式万向轮（局部 +X 指向外侧；圆柱基元轴向为 +Y，绕 Z 转 -90° 得到 +X）
    RIM = [(0.0, -0.0105), (0.030, -0.0105), (0.030, 0.0105), (0.024, 0.0105),
           (0.024, 0.0125), (0.030, 0.0125), (0.030, 0.021), (0.034, 0.021),
           (0.034, -0.021), (0.030, -0.021), (0.030, -0.0185), (0.024, -0.0185),
           (0.024, -0.0165), (0.030, -0.0165)]
    wheels = grp("万向轮组")
    for k in range(3):
        a_deg = 90.0 + k * 120.0
        a = math.radians(a_deg)
        cxx, cyy = 0.148 * math.cos(a), 0.148 * math.sin(a)
        w = grp("轮组%d" % (k + 1), wheels, (cxx, 0.0, cyy))
        b.nodes[w]["ry"] = -a_deg
        node("轮架板", 8, rounded_box(b, 0.062, 0.052, 0.010, 0.008, 3, True), (0, 0.089, 0), w)
        node("立柱", 5, cylinder(b, 0.013, 0.036, 20, True), (0, 0.054, 0), w)
        node("叉架", 8, rounded_box(b, 0.078, 0.020, 0.046, 0.008, 3, True), (0, 0.040, 0), w)
        node("轮轴", 5, cylinder(b, 0.0075, 0.058, 18, True), (0.029, 0.036, 0), w)
        b.nodes[-1]["rz"] = -90.0
        node("轮毂", 8, cylinder(b, 0.027, 0.014, 26, True), (-0.007, 0.036, 0), w)
        b.nodes[-1]["rz"] = -90.0
        for sx in (-1, 1):
            node("轮胎%d" % (sx + 2), 9, cylinder(b, 0.036, 0.021, 30, True),
                 (sx * 0.020 - 0.0105, 0.036, 0), w)
            b.nodes[-1]["rz"] = -90.0
        node("轮辋", 5, revolve(b, RIM, 30, True, cz=0), (0, 0.036, 0), w)
        b.nodes[-1]["rx"] = 90.0

    # ---- 主体：白色立柜 ----------------------------------------------------
    body = grp("机身")
    node("柜体", 0, rounded_box(b, bw, bd, by1 - by0, 0.036, 6, True), (0, (by0 + by1) / 2, 0), body)
    # 上部前脸掏出的浅凹（屏幕四周的白色围边）
    node("前脸围边", 1, rounded_box(b, bw - 0.020, 0.016, 0.052, 0.018, 4, True),
         (0, by1 - 0.030, front + 0.002), body)
    node("前脸围边下", 1, rounded_box(b, bw - 0.020, 0.016, 0.052, 0.018, 4, True),
         (0, PARAMS["screen_yc"] - PARAMS["screen_h"] / 2 - 0.028, front + 0.002), body)
    node("前脸围边左", 1, rounded_box(b, 0.062, 0.016, PARAMS["screen_h"] + 0.104, 0.02, 4, True),
         (-(bw - 0.020) / 2 + 0.031, PARAMS["screen_yc"], front + 0.002), body)
    node("前脸围边右", 1, rounded_box(b, 0.062, 0.016, PARAMS["screen_h"] + 0.104, 0.02, 4, True),
         ((bw - 0.020) / 2 - 0.031, PARAMS["screen_yc"], front + 0.002), body)

    # 屏幕（黑色玻璃 + 画面）
    sw, sh = PARAMS["screen_w"], PARAMS["screen_h"]
    syc = PARAMS["screen_yc"]
    sz = front + PARAMS["screen_depth"] / 2
    node("屏幕玻璃", 2, rounded_box(b, sw + 0.014, PARAMS["screen_depth"], sh + 0.014, 0.024, 5, True),
         (0, syc, sz), body)
    scr = grp("屏幕画面", body, (0, syc, front + PARAMS["screen_depth"] + 0.0005))
    node("画面", 3, plane(b, sw, sh), (0, 0, 0), scr)
    node("画面外框上", 7, box(b, 0.030, 0.010, 0.030), (0.128, syc - sh / 2 - 0.020, front + 0.006), body)
    node("屏幕压条", 10, box(b, sw - 0.02, 0.004, 0.010), (0, syc - sh / 2 - 0.012, front + 0.008), body)

    # 顶部木拉手（两根圆棒 + 支架）：圆柱轴向 +Y，绕 Z 转 -90° 后沿 ±X 居中展开
    handle = grp("木拉手", body)
    for k, (yy, zz) in enumerate(((by1 - 0.020, front - 0.058), (by1 - 0.062, front - 0.042))):
        node("木棒%d" % (k + 1), 4, cylinder(b, 0.0125, 0.300, 28, True),
             (0.150, yy, zz), handle)
        b.nodes[-1]["rz"] = -90.0
        for sx in (-1, 1):
            node("支架%d_%d" % (k + 1, sx + 2), 4, cylinder(b, 0.009, 0.060, 20, True),
                 (sx * 0.108, yy - 0.030, zz - 0.030), handle)
    node("拉手底座", 1, rounded_box(b, 0.250, 0.020, 0.090, 0.012, 4, True),
         (0, by1 - 0.045, front - 0.012), body)

    # 右侧深色推杆（照片里机身右侧伸出的深色件）
    arm = grp("侧推杆", body)
    node("推杆", 8, rounded_box(b, 0.036, 0.150, 0.052, 0.016, 4, True, cz=0),
         (bw / 2 + 0.006, 0.300, -0.062), arm)
    node("推杆头", 2, rounded_box(b, 0.030, 0.040, 0.044, 0.014, 4, True, cz=0),
         (bw / 2 + 0.020, 0.300, -0.128), arm)
    node("推杆轴", 5, cylinder(b, 0.011, 0.052, 20, True), (bw / 2 - 0.036, 0.300, 0.030), arm)
    b.nodes[-1]["rz"] = -90.0

    # 背面：散热格栅 + 充电口
    node("背板格栅", 10, rounded_box(b, 0.220, 0.010, 0.240, 0.02, 4, True),
         (0, 0.520, -front - 0.002), body)
    for k in range(5):
        node("格栅条%d" % k, 8, box(b, 0.196, 0.008, 0.012), (0, 0.430 + k * 0.045, -front - 0.010), body)
    node("充电口", 10, rounded_box(b, 0.066, 0.012, 0.032, 0.01, 4, True),
         (0, 0.170, -front - 0.004), body)

    # ---- 立柱 + 顶部圆柱摄像头 ---------------------------------------------
    top = grp("顶部感知")
    node("立柱", 5, cylinder(b, PARAMS["mast_r"], PARAMS["mast_y1"] - PARAMS["mast_y0"], 40, True),
         (0, PARAMS["mast_y0"], 0), top)
    node("立柱底座", 5, revolve(b, [(0.030, 0.0), (0.030, 0.004), (0.021, 0.006), (0.021, 0.012)], 40, False),
         (0, PARAMS["mast_y0"] - 0.002, 0), top)
    # 摄像头 = 横放的圆柱（轴向 +Z）：外壳 + 后端盖 + 镜头筒 + 玻璃
    # 圆柱基元轴向为本地 +Y；绕 X 转 +90° 把 +Y 送到 +Z（镜头朝前），转 -90° 送到 -Z
    hw, hd, hh = PARAMS["head_w"], PARAMS["head_d"], PARAMS["head_h"]
    hyc, hz = PARAMS["head_yc"], PARAMS["head_z"]
    node("摄像头外壳", 1, cylinder(b, hh / 2, hd, 36, True), (0, hyc, hz - hd / 2), top)
    b.nodes[-1]["rx"] = 90.0
    node("外壳后端盖", 0, cylinder(b, hh / 2 - 0.010, 0.012, 36, True), (0, hyc, hz - hd / 2 - 0.006), top)
    b.nodes[-1]["rx"] = -90.0
    lens_z = hz + hd / 2
    node("镜头筒", 8, cylinder(b, 0.036, 0.026, 32, True), (0, hyc, lens_z - 0.006), top)
    b.nodes[-1]["rx"] = 90.0
    node("镜头玻璃", 6, cylinder(b, 0.030, 0.006, 32, True), (0, hyc, lens_z + 0.017), top)
    b.nodes[-1]["rx"] = 90.0
    node("镜头高光", 6, revolve(b, [(0.0, 0.0), (0.010, 0.0016), (0.013, 0.0)], 24, True),
         (0.010, hyc + 0.011, lens_z + 0.024), top)
    node("状态灯", 7, revolve(b, [(0.004, 0.0), (0.007, 0.003), (0.0, 0.006)], 20, True),
         (-0.044, hyc - 0.048, lens_z - 0.002), top)
    b.nodes[-1]["rx"] = 90.0

    b.params = PARAMS
    b.parts = parts
    return b


# ----------------------------------------------------------------------------
# 贴图
# ----------------------------------------------------------------------------
def make_textures(b):
    for name in SCREENS:
        png = _png_b64(_screen_canvas(name))
        key = "tex_screen_" + name
        b.textures[key] = {
            "mime": "image/png",
            "data": png,
            "dataurl": "data:image/png;base64," + base64.b64encode(png).decode("ascii"),
        }
        # 屏幕画面节点改名，供查看器按状态切换
    for n in b.nodes:
        if n["name"] == "画面":
            n["tex"] = "tex_screen_" + DEFAULT_SCREEN
            n["screen"] = DEFAULT_SCREEN
    return b


# ----------------------------------------------------------------------------
# 写出 scene.json
# ----------------------------------------------------------------------------
def write_scene(b, path):
    order = sorted(b.geoms.keys())
    gidx = {k: i for i, k in enumerate(order)}
    geoms = []
    for k in order:
        g = b.geoms[k]
        geoms.append({"p": g["p"], "n": g["n"], "i": g["i"], "uv": g.get("uv")})
    mats = []
    for (name, col, rough, metal, emis, alpha) in MATERIALS:
        mats.append({"name": name, "color": list(col), "roughness": rough, "metalness": metal,
                     "emissive": list(emis) if emis else [0.0, 0.0, 0.0], "alpha": alpha,
                     "doubleSided": name in ("屏幕画面",)})
    nodes = []
    for n in b.nodes:
        o = {"name": n["name"], "mat": n["mat"], "geo": gidx.get(n["geo"]) if n["geo"] else None,
             "t": n["t"], "ch": n["ch"]}
        for k in ("rx", "ry", "rz"):
            if k in n:
                o[k] = n[k]
        if "tex" in n:
            o["tex"] = n["tex"]
            o["screen"] = n["screen"]
        nodes.append(o)
    scene = {"unit": "m", "up": "Y", "forward": "+Z",
             "params": PARAMS, "materials": mats,
             "textures": {k: {"dataurl": v["dataurl"], "mime": v["mime"]}
                          for k, v in b.textures.items()},
             "geoms": geoms, "nodes": nodes, "root": b.root_children,
             "screens": SCREENS, "defaultScreen": DEFAULT_SCREEN,
             "parts": [{"name": nm, "node": i} for (nm, i) in b.parts]}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(scene, f, ensure_ascii=False, separators=(",", ":"))
    return scene


# ----------------------------------------------------------------------------
# glTF / GLB
# ----------------------------------------------------------------------------
def _quat_from_deg(rx, ry, rz):
    def axis(ax, deg):
        a = math.radians(deg) / 2.0
        s, c = math.sin(a), math.cos(a)
        return [ax[0] * s, ax[1] * s, ax[2] * s, c]

    def mul(q, r):
        x1, y1, z1, w1 = q
        x2, y2, z2, w2 = r
        return [w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
                w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
                w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
                w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2]

    q = [0.0, 0.0, 0.0, 1.0]
    if rz:
        q = mul(q, axis((0, 0, 1), rz))
    if ry:
        q = mul(q, axis((0, 1, 0), ry))
    if rx:
        q = mul(q, axis((1, 0, 0), rx))
    return q


def export_gltf(b, scene, out_dir, name="robot", binary=True):
    geoms = scene["geoms"]
    blobs = []          # (bytes, mime, kind)
    views = []
    accessors = []
    offset = 0

    def add_blob(data, mime, kind, target=None, minmax=False, comp=5126, typ="VEC3", count=0):
        """把字节写进缓冲区；kind='image' 只登记 bufferView，不产生 accessor。"""
        nonlocal offset
        while offset % 4:
            blobs.append((b"\x00", None, "pad"))
            offset += 1
        blobs.append((data, mime, kind))
        v = {"buffer": 0, "byteOffset": offset, "byteLength": len(data)}
        if target:
            v["target"] = target
        views.append(v)
        offset += len(data)
        idx = len(views) - 1
        if kind == "image":
            return idx
        a = {"bufferView": idx, "componentType": comp, "count": count, "type": typ}
        if minmax:
            # 注意：min/max 是"分量各自的最值"，必须先 reshape 成 (N,3) 再按轴取
            flat = np.frombuffer(data, dtype="<f4")
            assert flat.size % 3 == 0, "POSITION 字节数不是 3 的倍数"
            arr = flat.reshape(-1, 3)
            a["min"] = [float(x) for x in arr.min(axis=0)]
            a["max"] = [float(x) for x in arr.max(axis=0)]
        accessors.append(a)
        return len(accessors) - 1

    all_keys = sorted(b.textures.keys())
    for k in all_keys:
        add_blob(b.textures[k]["data"], "image/png", "image")

    tex_index = {k: i for i, k in enumerate(all_keys)}
    images = [{"name": k, "mimeType": b.textures[k]["mime"], "bufferView": i} for i, k in enumerate(all_keys)]
    textures_gl = [{"name": k, "sampler": 0, "source": i} for i, k in enumerate(all_keys)]

    # 几何池：先把属性写进缓冲区，得到 34 条"裸 primitive"
    prim_pool = []
    for g in geoms:
        pos = np.asarray(g["p"], dtype="<f4")
        nrm = np.asarray(g["n"], dtype="<f4")
        idx = np.asarray(g["i"], dtype="<u4")
        uv = np.asarray(g.get("uv") or [], dtype="<f4")
        # 注意：accessor.count 是"元素个数"（顶点数/索引数），不是 float 个数
        prim = {"attributes": {}}
        prim["attributes"]["POSITION"] = add_blob(pos.tobytes(), None, "pos", 34962, True, 5126, "VEC3", len(pos) // 3)
        prim["attributes"]["NORMAL"] = add_blob(nrm.tobytes(), None, "nrm", 34962, False, 5126, "VEC3", len(nrm) // 3)
        if len(uv):
            prim["attributes"]["TEXCOORD_0"] = add_blob(uv.tobytes(), None, "uv", 34962, False, 5126, "VEC2", len(uv) // 2)
        prim["indices"] = add_blob(idx.tobytes(), None, "idx", 34963, False, 5125, "SCALAR", len(idx))
        prim["mode"] = 4
        prim_pool.append(prim)

    # 材质（注意：不要用 name 做循环变量，会覆盖文件名参数）
    materials = []
    for i, (mname, col, rough, metal, emis, alpha) in enumerate(MATERIALS):
        m = {"name": mname,
             "pbrMetallicRoughness": {"baseColorFactor": [col[0], col[1], col[2], alpha],
                                      "metallicFactor": metal, "roughnessFactor": rough},
             "doubleSided": mname in ("屏幕画面",)}
        if emis:
            m["emissiveFactor"] = list(emis)
        materials.append(m)
    for mi, mm in enumerate(materials):
        if MATERIALS[mi][0] == "屏幕画面":
            mm["pbrMetallicRoughness"]["baseColorTexture"] = {"index": tex_index["tex_screen_" + DEFAULT_SCREEN]}
            mm["emissiveTexture"] = {"index": tex_index["tex_screen_" + DEFAULT_SCREEN]}
            mm["emissiveFactor"] = [0.55, 0.60, 0.66]
            mm["extensions"] = {"KHR_materials_unlit": {}}
            mm["doubleSided"] = True

    # 按 (几何, 材质) 组合复用 mesh，避免出现没人引用的池对象
    screen_mat_i = {}
    for k in all_keys:
        screen_mat_i[k] = len(materials)
        materials.append({"name": "屏幕画面(" + k + ")",
                          "pbrMetallicRoughness": {"baseColorTexture": {"index": tex_index[k]},
                                                   "metallicFactor": 0.0, "roughnessFactor": 0.3},
                          "emissiveTexture": {"index": tex_index[k]},
                          "emissiveFactor": [0.55, 0.60, 0.66],
                          "doubleSided": True,
                          "extensions": {"KHR_materials_unlit": {}}})

    meshes = []
    mesh_lookup = {}
    gltf_nodes = []
    for n in scene["nodes"]:
        gn = {"name": n["name"]}
        if n.get("t"):
            gn["translation"] = list(n["t"])
        q = _quat_from_deg(n.get("rx", 0.0), n.get("ry", 0.0), n.get("rz", 0.0))
        if q != [0.0, 0.0, 0.0, 1.0]:
            gn["rotation"] = q
        if n.get("geo") is not None:
            key = n.get("tex")
            if key:
                mat_i = screen_mat_i[key]
            elif n["mat"] >= 0:
                mat_i = n["mat"]
            else:
                mat_i = None
            ck = (n["geo"], mat_i)
            if ck not in mesh_lookup:
                prim = dict(prim_pool[n["geo"]])
                if mat_i is not None:
                    prim["material"] = mat_i
                mesh_lookup[ck] = len(meshes)
                meshes.append({"primitives": [prim]})
            gn["mesh"] = mesh_lookup[ck]
        if n["ch"]:
            gn["children"] = list(n["ch"])
        gltf_nodes.append(gn)

    buf = b"".join(x[0] for x in blobs)
    gltf = {
        "asset": {"version": "2.0", "generator": "DSH 送药机器人参数化建模 v1"},
        "scene": 0,
        "scenes": [{"name": "送药机器人", "nodes": list(scene["root"])}],
        "nodes": gltf_nodes,
        "meshes": meshes,
        "materials": materials,
        "accessors": accessors,
        "bufferViews": views,
        "images": images,
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}],
        "textures": textures_gl,
        "extensionsUsed": ["KHR_materials_unlit"],
    }
    if binary:
        gltf["buffers"] = [{"byteLength": len(buf)}]
        js = json.dumps(gltf, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        while len(js) % 4:
            js += b" "
        bin_pad = b"\x00" * ((4 - len(buf) % 4) % 4)
        total = 12 + 8 + len(js) + 8 + len(buf) + len(bin_pad)
        out = io.BytesIO()
        out.write(struct.pack("<III", 0x46546C67, 2, total))
        out.write(struct.pack("<II", len(js), 0x4E4F534A))
        out.write(js)
        out.write(struct.pack("<II", len(buf) + len(bin_pad), 0x004E4942))
        out.write(buf + bin_pad)
        path = os.path.join(out_dir, name + ".glb")
        with open(path, "wb") as f:
            f.write(out.getvalue())
    else:
        bin_name = name + ".bin"
        with open(os.path.join(out_dir, bin_name), "wb") as f:
            f.write(buf)
        gltf["buffers"] = [{"byteLength": len(buf), "uri": bin_name}]
        path = os.path.join(out_dir, name + ".gltf")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(gltf, f, ensure_ascii=False, separators=(",", ":"))
    return path, len(buf)


def write_viewer(scene, out_dir, name="preview.html"):
    """把 scene.json 内联进 viewer_template.html，产出单文件查看器（双击即开）。"""
    tpl_path = os.path.join(HERE, "viewer_template.html")
    with open(tpl_path, "r", encoding="utf-8") as f:
        tpl = f.read()
    payload = json.dumps(scene, ensure_ascii=False, separators=(",", ":"))
    if "/*__SCENE_JSON__*/null" not in tpl:
        raise SystemExit("viewer_template.html 缺少 /*__SCENE_JSON__*/null 注入点")
    out = tpl.replace("/*__SCENE_JSON__*/null", payload)
    path = os.path.join(out_dir, name)
    with open(path, "w", encoding="utf-8") as f:
        f.write(out)
    return path


def main():
    b = build_scene()
    make_textures(b)
    scene = write_scene(b, os.path.join(HERE, "scene.json"))
    glb, n1 = export_gltf(b, scene, HERE, "robot", binary=True)
    gt, n2 = export_gltf(b, scene, HERE, "robot", binary=False)
    html = write_viewer(scene, HERE)
    tri = sum(len(g["i"]) // 3 for g in scene["geoms"])
    print("几何体 %d 个，节点 %d 个，三角面 %d" % (len(scene["geoms"]), len(scene["nodes"]), tri))
    print("GLB  %s  (%.1f KB, 二进制缓冲 %.1f KB)" % (glb, os.path.getsize(glb) / 1024.0, n1 / 1024.0))
    print("glTF %s  (%.1f KB)" % (gt, os.path.getsize(gt) / 1024.0))
    print("HTML %s  (%.1f KB)" % (html, os.path.getsize(html) / 1024.0))
    print("scene.json %.1f KB" % (os.path.getsize(os.path.join(HERE, "scene.json")) / 1024.0))


if __name__ == "__main__":
    main()
