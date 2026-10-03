# 套房 3D 交互预览（suite-interactive）

**双击 `index.html` 就能玩**（Edge / Chrome，`file://` 直接打开，不需要起服务器、不需要联网）。

参考截图（"套房 3D 交互预览"面板那一版）复刻的**可点击 3D 场景**：
- **王阿姨**（虚构人物，程序化建模的骨骼角色，能站、能走、能坐下）
- **送药机器人**：蛋形机身 + 顶部平板屏（**发光条＝通道指示，屏上不写一个字**）
  ＋ 前下方对开门 ＋ 可推出的药盘（药、水杯、棉片）＋ 客厅充电桩
- **点画面任意位置 → 王阿姨走过去坐下，机器人随后感应到位置并移动过去**：到身边 → 开门 → 出药盘 → **屏幕转琥珀** → 收回复位 → 回充电桩待命

## 文件

```
suite-interactive/
├─ index.html            交付物：单文件页面（双击即开；只有 three.js 是外部文件）
├─ vendor/three.min.js   three.js r160（UMD，本地内置，断网可用）
├─ _src/                 ★ 源文件（改这里，再跑 build.py 重新拼 index.html）
│   ├─ head.html             界面骨架 + CSS（左侧控制台、底部免责条）
│   ├─ scene.js              交互层：王阿姨 / 机器人 / 充电桩 / 导航 / 机位 / 面板逻辑
│   └─ build.py              拼装脚本：把 suite-3d 场景内核 + 上面两个文件合成 index.html
├─ tools/
│   ├─ shot.mjs          无头 Edge 出核对截图（含一次真实鼠标点击验证）
│   └─ probe.mjs         无头 Edge 跑表达式做诊断（导航网格自检等）
└─ shots/                核对截图（01~18）
```

## 怎么改

| 想改什么 | 改哪里 |
| --- | --- |
| 王阿姨的身材 / 配色 / 走路姿态 | `_src/scene.js` 的 `buildGranny()`、`walkPose()`、`sitPose()` |
| 机器人造型（蛋形轮廓、平板屏、药盘、开门） | `_src/scene.js` 的 `buildRobot()`、`RB` 缩放系数 |
| 屏幕上的发光条（颜色 / 条数 / 节奏） | `_src/scene.js` 的 `drawScreen()`（**不加文字**是有意为之） |
| 充电桩位置 | `_src/scene.js` 的 `DOCK`（平面米坐标） |
| 座位（沙发 / 餐椅 / 床边 / 扶手椅）与"站过去"的落脚点 | `_src/scene.js` 的 `SEATS` |
| 房间划分、墙体、家具、光照、程序化贴图 | `../suite-3d/index.html`（内核逐字取自它，改完两边都在） |
| 面板按钮与文案 | `_src/head.html` |

改完重新生成：

```powershell
$py = "C:\Users\Lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
cd "D:\桌面\机器人\suite-interactive"
& $py _src\build.py                      # 重新拼 index.html
# 出图核对（要 danger-full-access，本机沙箱会挡掉 GUI 程序）：
& D:\node\node.exe tools\shot.mjs "D:\桌面\机器人\suite-interactive\index.html" "D:\桌面\机器人\suite-interactive\shots"
& D:\node\node.exe tools\probe.mjs "D:\桌面\机器人\suite-interactive\index.html" "window.SUITE.navStat()"
```

## 操作

| 操作 | 作用 |
| --- | --- |
| **点画面任意位置** | 王阿姨走过去；点到沙发/椅子/床边则坐下；机器人随后跟过去送药 |
| 左键拖动 / 滚轮 / 右键拖动 | 旋转 / 缩放 / 平移 |
| 王阿姨的位置（模拟输入） | 客厅 · 卧室 · 餐区·餐桌 · 出门（"位置为点击/开关模拟，不是传感器"） |
| 机位 | 整户 / 客厅·电视墙 / 卧室 / 餐区 / 充电桩（跟拍）/ 药盘特写（跟拍） |
| 场景 | 光照（日光→黄昏→夜晚）/ 软阴影开关 / 导航网格（把可走格显示出来）/ 复位 |

## 实现要点（踩过的坑，别再犯）

1. **导航网格一律用"平面坐标"**（原点在户型西北角，米），世界坐标 = 平面 + `(OX, OZ)`。
   一开始世界坐标和平面坐标混用，路径是"错的但对得上"——机器人会直着穿过茶几。
2. **`Box3.setFromObject` 之前必须 `scene.updateMatrixWorld(true)`**。
   脚本刚跑完还没渲染过，世界矩阵全是单位阵，家具包围盒会全落在原点附近，
   结果整张导航网格是错的（茶几不挡路、机器人贴脸走）。
3. `freeEye()` 的避让表里**必须包含墙体**，否则室内机位会被"挪"进墙里（已踩一次）。
4. 沙发与茶几之间只有约 0.37 m，**导航外扩 `PAD` 取 0.09 m、格子 `CELL` 取 0.15 m** 才能
   留出机器人"站到王阿姨面前"的那一格；再大就挤没了。
5. 机器人的"药盘特写"机位不能放在它正前方或侧面——沙发、她的腿、茶几把空间堵死，
   只能**斜上方俯看**（见 `updateFollow()`）。
6. 机器人到位后要**继续转正朝向**（`goalRot` 的对齐放在 `if (moving)` 之外），否则它停下的
   姿势是路径末段的方向，送药时会侧着身子对着王阿姨。

## 自检口径

- `tools/shot.mjs` 最后会做一次**真实鼠标点击**（`Input.dispatchMouseEvent`）并打印
  `CLICK TEST before/after`：`after.state` 必须是 `walk` 或 `sit`，才算"点哪走哪"没坏。
- `tools/probe.mjs` 的 `window.SUITE.navStat()` 会给出障碍数 / 可走格数；
  `window.SUITE.navProbe(x,z)` 可以查某个平面坐标有没有被挡（`moved` 是吸附距离）。
- 页面里所有数字都是实算的：`window.SUITE.info()` 返回王阿姨与机器人的实时位置、状态、屏幕模式。

## 已知取舍

- 王阿姨与机器人是**程序化几何**（不是骨骼动画资产），走路是正弦摆腿＋摆臂，坐下是姿态插值；
  近看能看出"积木感"，远看（本页默认机位）成立。
- 靠近墙体时人物会有轻微穿模（导航外扩只有 9 cm）。
- 场景为"无顶剖切"表现（房间没有天花板），与 `suite-3d` 一致。
- 药盘推出后与王阿姨膝盖有轻微重叠（沙发前沿到茶几只剩 0.37 m，机器人只能停在 0.6 m 外）。
