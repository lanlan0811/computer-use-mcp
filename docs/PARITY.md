# 与 cc-haha 的逐项对应 / cc-haha Parity

> 本文档逐条列出本项目对 cc-haha（`D:\Trae项目\cc-haha`）Windows computer use 的复刻关系。除第 9 节「显式偏差」外，一律 1:1。每条都指向双方的源码位置。
> This document maps this project to cc-haha's Windows computer use item by item. Everything is 1:1 except the explicit deviations in section 9. Every entry points at concrete source locations on both sides.

## 1. 文件对应 / File map

| cc-haha 文件                                            | 本项目文件                                                                   | 内容                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `src/vendor/computer-use-mcp/windowsLegacyTools.ts`     | `src/core/toolSchema.ts` + `tests/contract/__snapshots__/cc-haha-tools.json` | 22 个工具 schema（唯一变换：工具名映射，见第 2 节）            |
| `src/vendor/computer-use-mcp/windowsLegacyToolCalls.ts` | `src/mcp/dispatcher.ts`                                                      | 分发、门禁顺序、坐标换算、持键台账、batch、取消                |
| `src/vendor/computer-use-mcp/keyBlocklist.ts`           | `src/core/keyBlocklist.ts`                                                   | 修饰键规范化 + 黑名单（win32 条目，darwin 条目随平台策略移除） |
| `src/vendor/computer-use-mcp/imageResize.ts`            | `src/core/imageBudget.ts`                                                    | 图像预算二分搜索                                               |
| `src/vendor/computer-use-mcp/pixelCompare.ts`           | `src/core/pixelCompare.ts`                                                   | 9×9 陈旧性校验（crop 改为异步 sharp 注入）                     |
| `src/skills/bundled/computerUse.ts`                     | `src/core/instructions.ts`                                                   | 面向模型的指导文案（工具名重写）                               |
| `src/utils/computerUse/helperBridge.ts`                 | `src/mcp/workerClient.ts`                                                    | 平台路由 → worker 生命周期                                     |
| `src/utils/computerUse/pythonBridge.ts`                 | `src/mcp/workerClient.ts`                                                    | venv 引导 → Node worker 管理                                   |
| `runtime/win_helper.py`                                 | `src/worker/`（分模块）                                                      | Windows 引擎本体                                               |
| `runtime/win_cursor_badge.py`                           | —                                                                            | 虚拟光标浮层，**不复刻**（见偏差 4）                           |
| `runtime/requirements-win.txt`                          | —                                                                            | Python 依赖，**本项目零 Python**                               |

## 2. 工具名映射 / Tool-name mapping

唯一允许的变换（`src/core/toolNames.ts`）。schema 结构、参数名、类型、枚举、取值范围全部保持 1:1，由快照契约测试自动验证。
The only allowed transformation. Schema structure, parameter names, types, enums and ranges are 1:1, enforced by the snapshot contract test.

| cc-haha        | 本项目         | cc-haha                                                                                          | 本项目                                                                        |
| -------------- | -------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `screenshot`   | `screenshot`   | `key`                                                                                            | `press_key`                                                                   |
| `zoom`         | `zoom`         | `scroll`                                                                                         | `scroll`                                                                      |
| `left_click`   | `click`        | `left_click_drag`                                                                                | `drag`                                                                        |
| `double_click` | `double_click` | `mouse_move`                                                                                     | `move_mouse`                                                                  |
| `triple_click` | `triple_click` | `open_application`                                                                               | `open_app`                                                                    |
| `right_click`  | `right_click`  | `switch_display`                                                                                 | `switch_display`                                                              |
| `middle_click` | `middle_click` | `read_clipboard`                                                                                 | `read_clipboard`                                                              |
| `type`         | `type_text`    | `write_clipboard`                                                                                | `write_clipboard`                                                             |
|                |                | `wait` / `cursor_position` / `hold_key` / `left_mouse_down` / `left_mouse_up` / `computer_batch` | `wait` / `cursor_position` / `hold_key` / `mouse_down` / `mouse_up` / `batch` |

batch actions 枚举同步重映射（`BATCH_ACTION_ITEM_SCHEMA` → `src/core/toolSchema.ts` 的 `BATCHABLE_ACTIONS` 与 batch 项 schema）。

## 3. 核心机制逐条对应 / Mechanism-by-mechanism parity

### 3.1 坐标换算（截图时快照比值）

- cc-haha: `windowsLegacyToolCalls.ts:203-247`
- 本项目: `src/core/coordinates.ts` `scaleCoordPixels`
- 语义：`x = round(rawX × displayWidth/width) + originX`，用**截图时快照**的 `displayWidth/originX`，不是 `1/scaleFactor`（1568 降采样后二者不相等）。冷启动退化 `/scaleFactor` 并警告。pixelCompare 百分比换算 `coordToPercentageForPixelCompare` 同源。

### 3.2 图像预算

- cc-haha: `imageResize.ts:60-108`（匹配 api `resize.rs:91-155`）
- 本项目: `src/core/imageBudget.ts` `targetImageSize`
- 语义：28px/token、长边 ≤1568、token ≤1568 二分搜索；测试向量 1568×1014 → 1372×887 一致（`tests/unit/imageBudget.test.ts`）。截图由 worker 预缩放到该尺寸（`src/worker/actions.ts` `budgetTarget` + `src/worker/capture/screen.ts`）。

### 3.3 物理输入干扰检测

- cc-haha: `win_helper.py:946-1124`（daemon 线程 + GetMessage 泵）
- 本项目: `src/worker/lease/monitor.ts`
- 语义：`LLKHF_INJECTED|LLKHF_LOWER_IL_INJECTED` / `LLMHF_INJECTED|LLMHF_LOWER_IL_INJECTED` + 32 位 tag 区分注入与物理；`agent_count < expected` 时判定「自己发的输入没被观测到」。**架构变形**：koffi 要求 JS 回调在主线程运行（Phase 0 实测），泵改主线程 `PeekMessageW` + 同步屏障，长阻塞 25ms 分段泵活（见 `ARCHITECTURE.md`「消息泵」）。检测语义 1:1。

### 3.4 前台租约（非对称失败）

- cc-haha: `win_helper.py:1362-1473`
- 本项目: `src/worker/lease/lease.ts`
- 语义：前干扰 → `user_interference`（可重试）；中干扰 → `user_interference_result_unknown`（禁止重试）；`type`/`paste_clipboard` 期间前台变化（pid 变化）同为 UNKNOWN；`_finish` 先 `finalize` 后回执的排序（`win_helper.py:1792-1805` → `src/worker/actions.ts` `finish`）。

### 3.5 投递前置校验

- cc-haha: `win_helper.py:1508-1654`
- 本项目: `src/worker/guards/delivery.ts`
- 语义：`ensure_point_on_screen`（虚拟桌面矩形外 → `point_outside_display`，指标不可读 fails-open）；`ensure_target_window_reachable`（全部窗口最小化/隐藏/零面积 → `target_window_offscreen`，无窗口 fails-open）。

### 3.6 SendInput 原子批次与 tag

- cc-haha: `win_helper.py:1153-1174`
- 本项目: `src/worker/input/inject.ts` `sendInputs`
- 语义：全不接受 → `input_injection_failed`（提示提权/安全桌面）；部分接受 → `input_injection_result_unknown`；每个事件带随机 32 位 `dwExtraInfo`。

### 3.7 绝对移动 0..65535 映射

- cc-haha: `win_helper.py:1177-1196`
- 本项目: `src/worker/input/inject.ts` `absoluteMouseMove`
- 语义：`dx = round((x-left)×65535/(width-1))`，标志 `MOVE|MOVE_NOCOALESCE|VIRTUALDESK|ABSOLUTE`。

### 3.8 弹簧光标

- cc-haha: `win_helper.py:1199-1262`（与 macOS `CursorMotionState.swift` 同参数）
- 本项目: `src/worker/input/inject.ts` `springCursorPath` / `moveCursorTo`
- 语义：k=196、阻尼比 0.85、60Hz 定步长、水平垂直独立积分、`max_duration = min(0.45, max(0.20, distance/3000))`、终止条件 `剩余距离 < 0.5 且速度 < 6.0`、每帧一次绝对移动 + sleep 到帧截止。

### 3.9 键位词表与虚拟键

- cc-haha: `win_helper.py:98-152`（KEY_MAP）、`:1265-1316`（虚拟键 + VkKeyScanW）
- 本项目: `src/core/keyMap.ts` + `src/worker/input/inject.ts` `virtualKey` / `namedKeyInput`
- 语义：别名映射 1:1（`cmd`/`command`/`meta`/`super` → win）；`fn` 不可合成；单字符走 `VkKeyScanW`，-1 时报布局不支持。

### 3.10 键盘黑名单

- cc-haha: `keyBlocklist.ts`（win32 集合 + 子集匹配 + 逐键检查）
- 本项目: `src/core/keyBlocklist.ts`
- 语义：规范化（别名折叠、`ctrl<alt<shift<meta` 排序、去重）、子集匹配、每个非修饰键单独检查、`splitChords` 的 `"cmd + q"` vs `"a b+c"` 二义性处理；darwin 条目随「仅 Windows」策略移除（产品决策，非保真度损失）。

### 3.11 逐字符 Unicode 输入

- cc-haha: `win_helper.py:1733-1753`
- 本项目: `src/worker/input/inject.ts` `typeText`
- 语义：每字符前 25ms；`\r\n` 一个回车；`\n`/`\t` 走真实按键；其余 `KEYEVENTF_UNICODE`（UTF-16LE 逐码元）。多行走剪贴板粘贴 + 保存/恢复（`windowsLegacyToolCalls.ts:2101-2122` → `src/mcp/dispatcher.ts` `handleType`，恢复失败保留暂存）。

### 3.12 点击 / 滚动 / 拖拽 / 持键

- cc-haha: `win_helper.py:1661-1751`
- 本项目: `src/worker/input/actions.ts`
- 语义：修饰键先按后放（逆序）；点击 count 循环；滚动 `MOUSEEVENTF_WHEEL/HWHEEL` × 120；拖拽先移动起点（省略则读当前光标）→ 按下 → 移动终点 → 释放；`key` 每次 repeat 间隔 10ms；`hold_key` 先按下、sleep、逆序释放。

### 3.13 门禁顺序

- cc-haha: `windowsLegacyToolCalls.ts:1-19`（注释）+ `:2976-3146`（handleToolCall 三门禁）
- 本项目: `src/mcp/dispatcher.ts` `handleToolCall`
- 语义：总开关 → 参数校验 → 文件锁 → 前台识别 → 投递校验（worker）→ pixelCompare → 执行；门禁异常绝不让执行器运行（fail-closed）；锁延迟获取集合、持键台账 reset（`windowsLegacyToolCalls.ts:467-530` → `src/mcp/session.ts`）。

### 3.14 截图 / 放大 / monitor note

- cc-haha: `windowsLegacyToolCalls.ts:385-407`（1024 字节重试）、`:1701-1906`（标签去重、提示文本、handleScreenshot、handleZoom 坐标不变式）
- 本项目: `src/mcp/dispatcher.ts` `handleScreenshot` / `handleZoom` + `src/core/displayLabels.ts`
- 语义：小图重试阈值 1024 字节；仅在显示器数 ≥2 且（首次或变化）时输出 monitor note；标签按 displayId 排序去重（`(N)` 后缀）；zoom 不 piggyback `.screenshot`（结构上保证基准不被更新）；截图几何 cherry-pick 不透传 resolver 字段。

### 3.15 显示器枚举与 DPI

- cc-haha: `win_helper.py:47-74`（三级回退）、`:180-245`（枚举与缩放）
- 本项目: `src/worker/win32/dpi.ts` + `structs.ts`
- 语义：`SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)` → `shcore.SetProcessDpiAwareness(2)` → `SetProcessDPIAware()`；`MonitorFromPoint(中心点)` + `GetDpiForMonitor`，`max(1.0, dpi/96)`。

### 3.16 应用发现

- cc-haha: `win_helper.py:297-720`
- 本项目: `src/worker/windows/apps.ts`
- 语义：三个 Uninstall hive + 可见 GUI 窗口（`EnumWindows` + 有标题 + 有面积）；`ApplicationFrameHost` 托管窗口枚举子窗口找 `Windows.UI.Core.CoreWindow`（priority 0）；`bundleId` = exe 主干，注册表项从 `DisplayIcon`/`InstallLocation` 推导；`open_app` 先找前台已有窗口 `SetForegroundWindow`（最小化先 `SW_RESTORE`），否则注册表 exe，最后 shell 回退；TTL 缓存（偏差 6）。

### 3.17 分字与截图字节数

- cc-haha: `windowsLegacyToolCalls.ts:415-436`、`:387-391`
- 本项目: `src/core/graphemes.ts`
- 语义：`Intl.Segmenter` grapheme 迭代（ZWJ emoji 不拆）；base64 解码字节数估算（3/4 − padding）。

### 3.18 协议

- cc-haha: `win_helper.py` main() 一次性 CLI（每条命令一个进程）
- 本项目: `src/worker/protocol.ts` NDJSON v1 常驻（偏差 5）

## 4. 显式偏差（7 处）/ Explicit deviations

| #   | 偏差                                                  | 理由                                     | 影响                                         | 本项目位置                   |
| --- | ----------------------------------------------------- | ---------------------------------------- | -------------------------------------------- | ---------------------------- |
| 1   | 工具改名（语义化）                                    | 第 3/4 轮决策                            | 仅名称；schema/参数/语义 1:1（契约测试保证） | `src/core/toolNames.ts`      |
| 2   | 不实现 `request_access` / `list_granted_applications` | 宿主审批残留，Windows 本就不在 22 工具内 | 无                                           | —                            |
| 3   | 不实现 3 个 teach 工具                                | 依赖宿主 tooltip 浮层 UI                 | 失去引导式教学                               | —                            |
| 4   | 不实现虚拟光标浮层                                    | 纯观感层；cc-haha 明写其失败只记日志     | 无可视反馈                                   | —                            |
| 5   | worker 协议重新设计（NDJSON v1）                      | 第 13 轮决策                             | 失去逐行等价对照，用行为级契约测试补偿       | `src/worker/protocol.ts`     |
| 6   | 应用清单 TTL 缓存                                     | 第 11 轮决策                             | 首次调用后更快；最坏滞后 TTL                 | `src/worker/windows/apps.ts` |
| 7   | 授权位改环境变量                                      | 独立 MCP 无宿主设置页/GrowthBook         | 用户经环境变量调整                           | `src/core/config.ts`         |

## 5. 等价性如何被自动验证 / How equivalence is verified

1. **快照契约测试**（`tests/contract/tool-schema.test.ts`）：从 cc-haha `windowsLegacyTools.ts` 提取权威定义 → 施加唯一允许的名字映射 → 入库 → CI 断言实际工具列表结构一致（数量/参数名/类型/枚举/范围）。差异即红灯。
2. **错误码映射契约**（`tests/contract/error-codes.test.ts`）：worker 可发出的每个错误码都落入核心错误表；不可重试集合 = UNKNOWN 家族。
3. **协议编解码契约**（`tests/contract/worker-protocol.test.ts`）：NDJSON 帧、版本门禁、响应形状。
4. **行为级覆盖**（`tests/unit/` 153 个测试）：坐标换算冷启动退化、别名/子集/后缀绕过、极端宽高比、批内坐标不变式、取消语义、持键清理、崩溃重启。
5. **live 冒烟 + 桌面测试**：真实截图/租约/应用清单/干扰检测（`tools/smoke/`、`tests/desktop/`）。

## 6. 附：cc-haha 关键源码位置速查 / Source-location cheat sheet

| 行为                           | cc-haha                               | 本项目                                              |
| ------------------------------ | ------------------------------------- | --------------------------------------------------- |
| 22 工具 schema / 坐标文案      | `windowsLegacyTools.ts:118-516`       | `src/core/toolSchema.ts`                            |
| batch actions schema           | `windowsLegacyTools.ts:40-103`        | `src/core/toolSchema.ts`                            |
| 坐标换算                       | `windowsLegacyToolCalls.ts:203-247`   | `src/core/coordinates.ts`                           |
| pixelCompare 百分比            | `windowsLegacyToolCalls.ts:261-282`   | `src/core/coordinates.ts`                           |
| 前台门禁                       | `windowsLegacyToolCalls.ts:339-375`   | `src/mcp/dispatcher.ts` `ensureFrontmostIdentified` |
| 持键台账与释放                 | `windowsLegacyToolCalls.ts:467-530`   | `src/mcp/session.ts`                                |
| 截图小图重试                   | `windowsLegacyToolCalls.ts:385-407`   | `src/mcp/dispatcher.ts` `handleScreenshot`          |
| 分字                           | `windowsLegacyToolCalls.ts:415-436`   | `src/core/graphemes.ts`                             |
| 显示器标签去重                 | `windowsLegacyToolCalls.ts:1701-1718` | `src/core/displayLabels.ts`                         |
| monitor note                   | `windowsLegacyToolCalls.ts:1729-1776` | `src/core/displayLabels.ts`                         |
| handleZoom 不变式              | `windowsLegacyToolCalls.ts:1917-1980` | `src/mcp/dispatcher.ts` `handleZoom`                |
| handleClickVariant             | `windowsLegacyToolCalls.ts:1983-2083` | `src/mcp/dispatcher.ts` `handleClickVariant`        |
| handleComputerBatch            | `windowsLegacyToolCalls.ts:2779-2882` | `src/mcp/dispatcher.ts` `handleBatch`               |
| dispatchAction                 | `windowsLegacyToolCalls.ts:2894-2970` | `src/mcp/dispatcher.ts` `dispatch`                  |
| handleToolCall 门禁            | `windowsLegacyToolCalls.ts:2976-3146` | `src/mcp/dispatcher.ts` `handleToolCall`            |
| 键位别名规范化                 | `keyBlocklist.ts:22-74`               | `src/core/keyBlocklist.ts`                          |
| win32 黑名单                   | `keyBlocklist.ts:93-99`               | `src/core/keyBlocklist.ts`                          |
| 子集匹配                       | `keyBlocklist.ts:205-222`             | `src/core/keyBlocklist.ts`                          |
| 图像预算                       | `imageResize.ts:60-108`               | `src/core/imageBudget.ts`                           |
| pixelCompare                   | `pixelCompare.ts:53-171`              | `src/core/pixelCompare.ts`                          |
| instructions                   | `computerUse.ts:159-201`              | `src/core/instructions.ts`                          |
| DPI 三级回退                   | `win_helper.py:47-74`                 | `src/worker/win32/dpi.ts`                           |
| 显示器枚举与缩放               | `win_helper.py:180-245`               | `src/worker/win32/dpi.ts`                           |
| 截图                           | `win_helper.py:252-290`               | `src/worker/capture/screen.ts`                      |
| 窗口枚举                       | `win_helper.py:297-324`               | `src/worker/windows/apps.ts`                        |
| UWP 解析                       | `win_helper.py:347-383`               | `src/worker/windows/apps.ts` `windowProcess`        |
| 注册表清单                     | `win_helper.py:427-499`               | `src/worker/windows/apps.ts` `registryApps`         |
| open_app                       | `win_helper.py:531-720`               | `src/worker/windows/apps.ts` `openApp`              |
| 剪贴板                         | `win_helper.py:727-746`               | `src/worker/clipboard/clipboard.ts`                 |
| 干扰监控                       | `win_helper.py:946-1124`              | `src/worker/lease/monitor.ts`                       |
| _send_inputs                   | `win_helper.py:1153-1174`             | `src/worker/input/inject.ts`                        |
| 0..65535 映射                  | `win_helper.py:1177-1196`             | `src/worker/input/inject.ts`                        |
| 弹簧光标                       | `win_helper.py:1199-1262`             | `src/worker/input/inject.ts`                        |
| 虚拟键表                       | `win_helper.py:1265-1316`             | `src/worker/input/inject.ts`                        |
| Unicode 输入                   | `win_helper.py:1319-1328`             | `src/worker/input/inject.ts`                        |
| ForegroundLease                | `win_helper.py:1362-1473`             | `src/worker/lease/lease.ts`                         |
| ensure_point_on_screen         | `win_helper.py:1525-1543`             | `src/worker/guards/delivery.ts`                     |
| ensure_target_window_reachable | `win_helper.py:1622-1654`             | `src/worker/guards/delivery.ts`                     |
| click/scroll/key/hold/type     | `win_helper.py:1661-1753`             | `src/worker/input/actions.ts`                       |
| 命令集合                       | `win_helper.py:1766-1789`             | `src/worker/actions.ts`                             |
| _finish 排序                   | `win_helper.py:1792-1805`             | `src/worker/actions.ts` `finish`                    |
