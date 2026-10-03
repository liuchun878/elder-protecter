/* =============================================================================
 * glb.js — 极简 glTF 2.0 / GLB 导出器（零依赖，只吃 THREE 的核心 API）
 *
 *   vendor/three.min.js 是核心 UMD 构建，不含 GLTFExporter，所以这里自己写一个：
 *   把角色按当前姿态烘焙世界坐标，输出标准 GLB —— SketchUp / Rhino / Blender /
 *   Windows「3D 查看器」都能直接打开。
 *
 *   只导出：位置 / 法线 / UV / 索引 / PBR 材质颜色（含自发光、透明），
 *   不导出贴图（角色本体本来就没用贴图）。
 *
 * 用法（页面上下文）：
 *     const b64 = exportGLB(grandma.root);
 *     // 把 b64 交给外部脚本写盘
 * ========================================================================== */
(function (global) {
  'use strict';

  function pad4(n) { return (n + 3) & ~3; }

  function b64FromBytes(bytes) {
    // 浏览器/无头环境都有 btoa；分块避免超长字符串
    let out = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(out);
  }

  function alignTo(arr, n, fill) {
    while (arr.length % n !== 0) arr.push(fill === undefined ? 0 : fill);
    return arr;
  }

  /**
   * @param {THREE.Object3D} root 要导出的根节点
   * @param {object} [opts] { name, scale, flipY }
   * @returns {string} base64 编码的 GLB
   */
  function exportGLB(root, opts) {
    const THREE = global.THREE;
    opts = opts || {};
    const name = opts.name || root.name || 'model';
    const flip = opts.flipY !== false;     // glTF 与 Three 的 UV 习惯差一个 Y 翻转

    root.updateMatrixWorld(true);

    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const prims = [];       // 每个 (mesh, material) 一个 primitive
    const materials = [];
    const matIndex = new Map();

    const normalMat = new THREE.Matrix3();
    const v = new THREE.Vector3();
    const nrm = new THREE.Vector3();

    root.traverse(function (obj) {
      if (!obj.isMesh) return;
      const geo = obj.geometry;
      if (!geo || !geo.attributes || !geo.attributes.position) return;
      if (obj.userData && obj.userData.skipExport) return;

      const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      let mi = 0;
      if (mat) {
        if (!matIndex.has(mat.uuid)) {
          matIndex.set(mat.uuid, materials.length);
          const c = mat.color ? mat.color : { r: 1, g: 1, b: 1 };
          const em = mat.emissive ? mat.emissive : { r: 0, g: 0, b: 0 };
          const alpha = (mat.transparent && mat.opacity !== undefined) ? mat.opacity : 1;
          const m = {
            name: mat.name || ('材质' + materials.length),
            pbrMetallicRoughness: {
              baseColorFactor: [c.r, c.g, c.b, alpha],
              metallicFactor: mat.metalness === undefined ? 0 : mat.metalness,
              roughnessFactor: mat.roughness === undefined ? 1 : mat.roughness
            },
            doubleSided: !!mat.side && mat.side !== THREE.FrontSide
          };
          if (mat.emissive && (em.r + em.g + em.b) > 0.001) {
            m.emissiveFactor = [em.r, em.g, em.b];
          }
          if (alpha < 1) m.alphaMode = 'BLEND';
          materials.push(m);
        }
        mi = matIndex.get(mat.uuid);
      }

      const base = positions.length / 3;
      const pos = geo.attributes.position;
      const nor = geo.attributes.normal;
      const uv = geo.attributes.uv;

      normalMat.getNormalMatrix(obj.matrixWorld);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
        positions.push(+v.x.toFixed(5), +v.y.toFixed(5), +v.z.toFixed(5));
        if (nor) {
          nrm.fromBufferAttribute(nor, i).applyMatrix3(normalMat).normalize();
          normals.push(+nrm.x.toFixed(4), +nrm.y.toFixed(4), +nrm.z.toFixed(4));
        }
        if (uv) uvs.push(+uv.getX(i).toFixed(5), +(flip ? 1 - uv.getY(i) : uv.getY(i)).toFixed(5));
      }

      const idx = geo.index;
      if (idx) {
        for (let i = 0; i < idx.count; i++) indices.push(base + idx.getX(i));
      } else {
        for (let i = 0; i < pos.count; i++) indices.push(base + i);
      }

      prims.push({
        count: idx ? idx.count : pos.count,
        first: (idx ? idx.count : pos.count) === 0 ? 0 : 0,
        mat: mi,
        start: 0
      });
      // 记录这个 primitive 在全局索引数组里的偏移
      prims[prims.length - 1].idxOffset = indices.length - (idx ? idx.count : pos.count);
    });

    if (!positions.length) throw new Error('exportGLB: 没找到可导出的网格');

    /* ---------------- 压缩：丢弃未使用的法线/UV ---------------- */
    const hasNormals = normals.length === positions.length;
    const hasUV = uvs.length === (positions.length / 3) * 2;

    const posArr = new Float32Array(positions);
    const nrmArr = hasNormals ? new Float32Array(normals) : null;
    const uvArr = hasUV ? new Float32Array(uvs) : null;
    const idxArr = new Uint32Array(indices);

    const bin = [];
    let offset = 0;
    const bufferViews = [];
    const accessors = [];

    function addView(typedArr, target) {
      const bytes = new Uint8Array(typedArr.buffer, typedArr.byteOffset, typedArr.byteLength);
      const start = offset;
      for (let i = 0; i < bytes.length; i++) bin.push(bytes[i]);
      while (bin.length % 4 !== 0) bin.push(0);
      offset = bin.length;
      bufferViews.push({ buffer: 0, byteOffset: start, byteLength: bytes.length, target: target });
      return bufferViews.length - 1;
    }

    function minMax(arr, comps) {
      const mn = new Array(comps).fill(Infinity);
      const mx = new Array(comps).fill(-Infinity);
      for (let i = 0; i < arr.length; i += comps) {
        for (let c = 0; c < comps; c++) {
          const val = arr[i + c];
          if (val < mn[c]) mn[c] = val;
          if (val > mx[c]) mx[c] = val;
        }
      }
      return { mn: mn, mx: mx };
    }

    // 位置
    let view = addView(posArr, 34962);
    let mm = minMax(posArr, 3);
    accessors.push({ bufferView: view, componentType: 5126, count: posArr.length / 3, type: 'VEC3', min: mm.mn, max: mm.mx });
    const accPos = accessors.length - 1;

    // 法线
    let accNrm = null;
    if (nrmArr) {
      view = addView(nrmArr, 34962);
      accessors.push({ bufferView: view, componentType: 5126, count: nrmArr.length / 3, type: 'VEC3' });
      accNrm = accessors.length - 1;
    }

    // UV
    let accUV = null;
    if (uvArr) {
      view = addView(uvArr, 34962);
      accessors.push({ bufferView: view, componentType: 5126, count: uvArr.length / 2, type: 'VEC2' });
      accUV = accessors.length - 1;
    }

    // 索引（全局一份，只用于 accessor 之外；下面按材质重新切分写入）
    view = addView(idxArr, 34963);
    accessors.push({ bufferView: view, componentType: 5125, count: idxArr.length, type: 'SCALAR' });
    const accIdxAll = accessors.length - 1;

    /* ---------------- 组装 glTF ---------------- */
    // 顶点属性共用一份 accessor，但索引按材质分组各存一份，
    // 每个 (mesh, material) 对应一个 primitive —— 这是最省事又完全合法的写法。
    const byMat = new Map();
    prims.forEach(function (p) {
      if (!byMat.has(p.mat)) byMat.set(p.mat, []);
      byMat.get(p.mat).push(p);
    });

    const gltfPrims = [];
    byMat.forEach(function (list, mi) {
      const group = [];
      list.forEach(function (p) {
        for (let i = 0; i < p.count; i++) group.push(indices[p.idxOffset + i]);
      });
      const gArr = new Uint32Array(group);
      const gv = addView(gArr, 34963);
      accessors.push({ bufferView: gv, componentType: 5125, count: gArr.length, type: 'SCALAR' });
      const gAcc = accessors.length - 1;
      const attributes = { POSITION: accPos };
      if (accNrm !== null) attributes.NORMAL = accNrm;
      if (accUV !== null) attributes.TEXCOORD_0 = accUV;
      gltfPrims.push({
        attributes: attributes,
        indices: gAcc,
        material: mi,
        mode: 4
      });
    });

    const mn = minMax(posArr, 3);
    const gltf = {
      asset: { version: '2.0', generator: 'grandma-web / mini GLB exporter' },
      scene: 0,
      scenes: [{ name: name, nodes: [0] }],
      nodes: [{ name: name, mesh: 0 }],
      meshes: [{ name: name, primitives: gltfPrims }],
      materials: materials.length ? materials : undefined,
      accessors: accessors,
      bufferViews: bufferViews,
      buffers: [{ byteLength: bin.length }],
      extras: { bounds: { min: mn.mn, max: mn.mx } }
    };

    /* ---------------- 打包 GLB ---------------- */
    const jsonStr = JSON.stringify(gltf);
    const jsonBytes = new TextEncoder().encode(jsonStr);
    const jsonPad = pad4(jsonBytes.length);
    const binPad = pad4(bin.length);
    const total = 12 + 8 + jsonPad + 8 + binPad;

    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    let o = 0;
    dv.setUint32(o, 0x46546C67, true); o += 4;     // 'glTF'
    dv.setUint32(o, 2, true); o += 4;
    dv.setUint32(o, total, true); o += 4;
    dv.setUint32(o, jsonPad, true); o += 4;
    dv.setUint32(o, 0x4E4F534A, true); o += 4;     // 'JSON'
    out.set(jsonBytes, o); o += jsonBytes.length;
    for (let i = jsonBytes.length; i < jsonPad; i++) out[o++] = 0x20;
    dv.setUint32(o, binPad, true); o += 4;
    dv.setUint32(o, 0x004E4942, true); o += 4;     // 'BIN'
    for (let i = 0; i < bin.length; i++) out[o + i] = bin[i];

    return b64FromBytes(out);
  }

  global.exportGLB = exportGLB;
})(window);
