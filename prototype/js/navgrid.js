/**
 * navgrid.js —— 可通行网格 + A* 寻路（S 线）
 *
 * 为什么需要它：套房是**有墙的多房间户型**。机器人（与人）如果还是"两点一线"地走，
 * 会直接穿墙——这不是观感问题，是可信度问题。契约 §3.1 因此新增 `scene.findPath(a, b)`。
 *
 * 做法（自动、不手写路点）：
 *   ① 把每一段墙（含厚度）按**可通行开口**（门 / 敞口，且开口下沿在机器人高度以下）光栅化成格；
 *      窗户（下沿 0.45 m 以上）不算通行口 —— 机器人不会从窗户爬出去；
 *   ② 家具占位盒（各方向外扩一个机身半径）同样标成不可走；
 *   ③ 8 邻域 A*，禁止贴着两个墙角的对角穿越；
 *   ④ 拉直（string pulling）：能直连就直连，输出折线。
 *
 * 这一层只算数学，不 import three —— 调试图由 scene3d 按需生成。
 */

/** 网格坐标 → 世界坐标 */
const EPS = 1e-6;

/**
 * @param {{
 *   bounds: {x0:number, z0:number, x1:number, z1:number},
 *   walls: Array<{x1:number, z1:number, x2:number, z2:number, t:number, pass?: Array<[number,number]>}>,
 *   boxes: Array<{x0:number, x1:number, z0:number, z1:number}>,
 *   cell?: number, radius?: number
 * }} spec
 */
export function createNavGrid({ bounds, walls = [], boxes = [], cell = 0.1, radius = 0.28 }) {
  const cols = Math.max(1, Math.round((bounds.x1 - bounds.x0) / cell));
  const rows = Math.max(1, Math.round((bounds.z1 - bounds.z0) / cell));
  const walkable = new Uint8Array(cols * rows);

  const cx = (c) => bounds.x0 + (c + 0.5) * cell;
  const cz = (r) => bounds.z0 + (r + 0.5) * cell;

  /** 点到线段的最短距离 + 投影参数（0..1） */
  function segDist(px, pz, x1, z1, x2, z2) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len2 = dx * dx + dz * dz;
    let t = len2 > EPS ? ((px - x1) * dx + (pz - z1) * dz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = x1 + dx * t;
    const qz = z1 + dz * t;
    return { d: Math.hypot(px - qx, pz - qz), t };
  }

  /** 该点是否被墙挡住（开口区间内可通行） */
  function blockedByWall(px, pz, w) {
    const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1) || EPS;
    const { d, t } = segDist(px, pz, w.x1, w.z1, w.x2, w.z2);
    if (d > w.t / 2 + radius) return false;
    const along = t * len;
    for (const [a, b] of w.pass || []) {
      if (along >= a - radius * 0.5 && along <= b + radius * 0.5) return false;
    }
    return true;
  }

  function blockedByBox(px, pz, b) {
    return px > b.x0 - radius && px < b.x1 + radius && pz > b.z0 - radius && pz < b.z1 + radius;
  }

  /** 任意世界点是否可走（不做边界取整） */
  function isWalkable(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    if (x < bounds.x0 + cell * 0.5 || x > bounds.x1 - cell * 0.5) return false;
    if (z < bounds.z0 + cell * 0.5 || z > bounds.z1 - cell * 0.5) return false;
    for (const w of walls) if (blockedByWall(x, z, w)) return false;
    for (const b of boxes) if (blockedByBox(x, z, b)) return false;
    return true;
  }

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      walkable[r * cols + c] = isWalkable(cx(c), cz(r)) ? 1 : 0;
    }
  }

  const idx = (c, r) => r * cols + c;
  const inGrid = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows;
  const cellOf = (x, z) => [
    Math.max(0, Math.min(cols - 1, Math.floor((x - bounds.x0) / cell))),
    Math.max(0, Math.min(rows - 1, Math.floor((z - bounds.z0) / cell))),
  ];

  /** 找离 (x,z) 最近的可行格中心（半径 maxR 内） */
  function nearestWalkable(x, z, maxR = 1.2) {
    const [c0, r0] = cellOf(x, z);
    if (walkable[idx(c0, r0)]) return { x: cx(c0), z: cz(r0) };
    const rmax = Math.ceil(maxR / cell);
    for (let rad = 1; rad <= rmax; rad += 1) {
      for (let dr = -rad; dr <= rad; dr += 1) {
        for (let dc = -rad; dc <= rad; dc += 1) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
          const c = c0 + dc;
          const r = r0 + dr;
          if (!inGrid(c, r) || !walkable[idx(c, r)]) continue;
          return { x: cx(c), z: cz(r) };
        }
      }
    }
    return null;
  }

  /* ── A*（8 邻域 + 禁止切角）──────────────────────────────────────── */
  function astar(start, goal) {
    const [sc, sr] = cellOf(start.x, start.z);
    const [gc, gr] = cellOf(goal.x, goal.z);
    if (!walkable[idx(sc, sr)] || !walkable[idx(gc, gr)]) return null;

    const total = cols * rows;
    const gScore = new Float32Array(total).fill(Infinity);
    const fScore = new Float32Array(total).fill(Infinity);
    const came = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const open = [];

    const h = (c, r) => {
      const dx = Math.abs(c - gc);
      const dz = Math.abs(r - gr);
      return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };

    const s = idx(sc, sr);
    gScore[s] = 0;
    fScore[s] = h(sc, sr);
    open.push(s);

    const DIRS = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
    ];

    while (open.length) {
      // 小顶堆其实更稳，但格子只有一万多、路径也不长，线性取最小足够且更好读
      let bi = 0;
      for (let i = 1; i < open.length; i += 1) if (fScore[open[i]] < fScore[open[bi]]) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (cur === idx(gc, gr)) {
        const path = [];
        for (let n = cur; n !== -1; n = came[n]) path.push({ c: n % cols, r: Math.floor(n / cols) });
        path.reverse();
        return path.map((p) => ({ x: cx(p.c), z: cz(p.r) }));
      }
      closed[cur] = 1;
      const cc = cur % cols;
      const cr = Math.floor(cur / cols);
      for (const [dc, dr, cost] of DIRS) {
        const nc = cc + dc;
        const nr = cr + dr;
        if (!inGrid(nc, nr)) continue;
        const ni = idx(nc, nr);
        if (!walkable[ni] || closed[ni]) continue;
        // 对角不许从两个墙角之间穿过去
        if (dc && dr && (!walkable[idx(cc + dc, cr)] || !walkable[idx(cc, cr + dr)])) continue;
        const tentative = gScore[cur] + cost;
        if (tentative >= gScore[ni]) continue;
        came[ni] = cur;
        gScore[ni] = tentative;
        fScore[ni] = tentative + h(nc, nr);
        if (!open.includes(ni)) open.push(ni);
      }
    }
    return null;
  }

  /** 两点之间是否一条直线都走得通（用来把折线拉直） */
  function lineOfSight(a, b) {
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(2, Math.ceil(dist / (cell * 0.5)));
    for (let i = 1; i < steps; i += 1) {
      const k = i / steps;
      if (!isWalkable(a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k)) return false;
    }
    return true;
  }

  /** 拉直：贪心地用最远的可见点替换中间点 */
  function smooth(points) {
    if (points.length <= 2) return points;
    const out = [points[0]];
    let i = 0;
    while (i < points.length - 1) {
      let j = points.length - 1;
      while (j > i + 1 && !lineOfSight(points[i], points[j])) j -= 1;
      out.push(points[j]);
      i = j;
    }
    return out;
  }

  /**
   * 寻路（世界坐标）。终点不可走时会吸附到附近最近的可走点。
   * @returns {Array<{x:number,z:number}>|null} 含起点与终点；寻不到返回 null
   */
  function findPath(from, to) {
    if (!from || !to) return null;
    const start = nearestWalkable(from.x, from.z, 0.9);
    const goal = nearestWalkable(to.x, to.z, 1.2);
    if (!start || !goal) return null;
    if (lineOfSight(start, goal)) return [start, goal];
    const raw = astar(start, goal);
    if (!raw) return null;
    return smooth([start, ...raw.slice(1, -1), goal]);
  }

  /** 统计（自测用）：可走格数、占比、以及给定点是否连通 */
  function stats() {
    let free = 0;
    for (let i = 0; i < walkable.length; i += 1) free += walkable[i];
    return { cols, rows, cell, free, total: walkable.length, ratio: free / walkable.length };
  }

  /** 两个世界点是否在同一连通块（自测用） */
  function connected(a, b) {
    const p = findPath(a, b);
    return Boolean(p);
  }

  return {
    cols, rows, cell, bounds, radius,
    walkable, isWalkable, nearestWalkable, findPath, lineOfSight, stats, connected,
    cellCenter: (c, r) => ({ x: cx(c), z: cz(r) }),
  };
}

export const navgrid = { createNavGrid };
