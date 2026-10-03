# 送药机器人 · 3D 模型（robot-3d）

按用户给的一张实拍照片（白色立柜式送药机器人）重建的**可编辑参数化模型**。
坐标系：**Y 轴向上，+Z 是机器人正面**，原点在底盘中心的地面上（y=0 就是地面），单位**米**。

## 交付物

| 文件 | 用途 |
| --- | --- |
| `preview.html` | **双击即开**的单文件 Three.js 查看器（几何内联，离线可用） |
| `robot.glb` | 标准 glTF 2.0 二进制，拖进 **SketchUp 2022 / Rhino 8 / Blender / Windows「3D 查看器」**都能开 |
| `robot.gltf` + `robot.bin` | 同一模型的分离版，个别只认 `.gltf` 的老软件用 |
| `scene.json` | 几何 / 材质 / 节点树（查看器就是读它渲染的，改了它两边一起变） |
| `shots/` | 13 张核对用渲染图（正面/侧面/背面/俯视/低角度/屏幕特写/分解/绿屏…） |
| `build_model.py` | **唯一的模型源文件**：改这里的参数，重跑就同时刷新 glb / gltf / html |
| `viewer_template.html` | 查看器模板，`/*__SCENE_JSON__*/null` 是场景注入点 |
| `check_glb.py` | glTF 结构自检（accessor 长度、索引越界、min/max、层级可达性） |
| `serve_robot.mjs` / `shot_robot.mjs` / `diag_robot.mjs` / `iso_head.mjs` | 本地静态服务器 / 无头 Edge 批量截图 / 部件坐标诊断 / 逐部件隔离出图 |

> 三个 `.mjs` 是**复核工具**，不是交付物。无头 Edge 在本机受沙箱限制，跑它们需要
> `sandbox_permissions: danger-full-access`（历史已多次验证）。

## 整机尺寸

| 项目 | 尺寸 |
| --- | --- |
| 整机高度（含顶部摄像头） | 1.112 m |
| 柜体（机身） | 0.460 W × 0.420 D × 0.470 H m |
| 底盘 | 0.468 × 0.428 × 0.145 m |
| 正面屏幕（黑色玻璃） | 0.314 × 0.316 m，中心高 0.492 m |
| 不锈钢立柱 | ⌀0.038 m，y 0.705→0.985 |
| 顶部摄像头 | ⌀0.130 × 0.260 m（轴向 +Z，镜头朝前） |
| 万向轮 | ⌀0.072 m，3 个，位于 r=0.148 m 的圆上 |

改尺寸只动 `PARAMS` 字典（`screen_w/h/yc`、`body_w/d`、`mast_*`、`head_*`…），
然后 `python build_model.py`。

## 照片里读到的特征 → 模型里的对应件

| 照片特征 | 模型节点 |
| --- | --- |
| 白色方立柱机身、竖棱圆角 | `柜体`（圆角长方体，竖棱 r=36 mm） |
| 正面内凹的大块黑色玻璃屏 | `屏幕玻璃` + `屏幕画面`（贴图）+ `前脸围边*` |
| 屏上三条短竖杠 | 屏幕默认状态 `logo`（另有 `eyes` / `green` / `off` 三套贴图） |
| 顶部两根木色圆棒拉手 | `木拉手/木棒1`、`木棒2` + 四个支架 |
| 屏右上角小琥珀色块 / 屏下方细线 | `画面外框上`、`屏幕压条` |
| 机身右侧伸出的深色件 | `侧推杆/推杆`、`推杆头`、`推杆轴` |
| 顶部不锈钢细立柱 + 圆柱摄像头 | `立柱`、`立柱底座`、`摄像头外壳`、`镜头筒`、`镜头玻璃`、`状态灯` |
| 下部略宽的白色底座 + 深灰腰线 | `底盘外壳`、`底盘腰线`、`底盘下缘` |
| 底盘下的隐藏式万向轮 | `万向轮组/轮组1..3`（轮架板、立柱、叉架、轮轴、轮毂、轮胎、轮辋） |
| 背面（照片看不到，按同类机型补的） | `背板格栅` + 5 条 `格栅条` + `充电口` |

## 查看器能做什么

- **视角**：正面 3/4、正视图、侧视图、背视图、俯视、低角度；左键旋转、滚轮缩放、右键/Shift 平移、双击复位
- **屏幕画面**：待机（三竖杠）/ 注视（圆眼）/ 完成（绿眼微笑）/ 熄屏 —— 对应 `SCREENS` 四套贴图
- **分解视图**：滑杆 0–100%，按各件相对机身中心的方向向外散开（讲结构用）
- **线框 / 自动旋转 / 尺寸标注 / 环境曝光**；右下角有 1 m 比例尺
- 控制台可编程：`ROBOT.setView('front')`、`ROBOT.screen('green')`、`ROBOT.explode(0.6)`、
  `ROBOT.dims(true)`、`ROBOT.hide('木拉手', false)`、`ROBOT.reset()`

## 重新构建 / 自检

```powershell
$py = "C:\Users\Lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
cd "D:\桌面\机器人\robot-3d"
& $py build_model.py      # 出 robot.glb / robot.gltf+bin / scene.json / preview.html
& $py check_glb.py        # 结构自检，末尾必须是 "OK  robot.glb 结构自检全部通过"

# 想重新出图：（先起服务器，再跑截图；两者都要 danger-full-access）
& D:\node\node.exe serve_robot.mjs "D:\桌面\机器人\robot-3d" 8788
& D:\node\node.exe shot_robot.mjs "http://127.0.0.1:8788/preview.html" "D:\桌面\机器人\robot-3d\shots"
```

## 踩过的坑（改模型时注意）

1. **圆柱基元的轴向是本地 +Y，底面在 y=0**。要把轴转到 +Z 用 `rx: +90`，转到 ±X 用 `rz: ∓90`
   （`+Y --rx=+90--> +Z`、`+Y --rz=-90--> +X`）。搞反过一次，结果立柱横躺、摄像头飞在半空。
2. **glTF 的 `accessor.count` 是元素个数（顶点数），不是 float 个数**；写成 float 数会让
   整个 glb 在查看器里只有 1/3 的顶点。`check_glb.py` 会挡住这种错。
3. **`min`/`max` 是逐分量的最值**，`np.frombuffer(...).reshape(-1,3)` 之后再取 axis=0，
   直接对三个一组取最值会得到看似合理其实错位的包围盒。
4. **圆角长方体必须把 `cy` 加到 z 上**（倒角环那两处），漏加会让零件掉到地面以下。
5. 屏幕玻璃与白色围边**别做成共面**，否则渲染出现细密条纹（z-fighting）。
6. Python 里**别用 `name` 当循环变量**：会覆盖 `export_gltf(..., name="robot")` 的文件名参数，
   写出一个叫「格栅暗槽.glb」的文件。
