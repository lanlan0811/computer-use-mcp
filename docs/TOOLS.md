# 工具参考 / Tool Reference

> 22 个工具的完整参数。坐标固定为 `pixels` 模式（启动冻结）：模型直接从最近一次**全屏**截图读像素坐标，服务器负责全部缩放。
> 错误返回形如 `"<错误码>: <说明>"` 且 `isError: true`；错误码语义见 [SAFETY.md](SAFETY.md)。

## screenshot

全屏截图。返回图像即后续点击坐标的基准。

| 参数           | 类型    | 必需 | 说明                                      |
| -------------- | ------- | ---- | ----------------------------------------- |
| `save_to_disk` | boolean | 否   | 存盘到 `COMPUTER_USE_SHOT_DIR` 并返回路径 |

补充文本：多显示器时附当前显示器名 + 其他显示器名 + `switch_display` 提示（仅首次截图或显示器变化时输出）。

## zoom

对最近一次全屏截图的指定区域取高清截图。**只读**：不更新坐标基准，后续点击坐标永远相对全屏截图。

| 参数           | 类型                       | 必需 | 说明                                                 |
| -------------- | -------------------------- | ---- | ---------------------------------------------------- |
| `region`       | `[x0,y0,x1,y1]`（integer） | 是   | 全屏截图坐标系中的矩形，x0<x1、y0<y1，不超出截图边界 |
| `save_to_disk` | boolean                    | 否   | 存盘并返回路径                                       |

## click / double_click / triple_click / right_click / middle_click

在坐标处点击。`double_click`/`triple_click` 分别在多数编辑器中选中单词/整行。

| 参数         | 类型              | 必需 | 说明                                                                                                           |
| ------------ | ----------------- | ---- | -------------------------------------------------------------------------------------------------------------- |
| `coordinate` | `[x,y]`（number） | 是   | 全屏截图像素坐标                                                                                               |
| `text`       | string            | 否   | 点击期间按住的修饰键（如 `"shift"`、`"ctrl+shift"`）。系统快捷键黑名单命中且未授权时返回 `grant_flag_required` |

## type_text

向当前焦点输入文本。

| 参数   | 类型   | 必需 | 说明                   |
| ------ | ------ | ---- | ---------------------- |
| `text` | string | 是   | 要输入的文本，支持换行 |

多行文本走「写剪贴板 → `ctrl+v`」快路并保存/恢复用户原剪贴板；单行逐字符输入（每字符前 25ms，规避 RichEdit 乱序）。`\r\n` 只发一个回车，`\t` 发真实 Tab。

## press_key

按一个键或组合键。

| 参数     | 类型    | 必需 | 说明                                                                        |
| -------- | ------- | ---- | --------------------------------------------------------------------------- |
| `text`   | string  | 是   | 修饰键用 `+` 连接，如 `"return"`、`"escape"`、`"cmd+a"`、`"ctrl+shift+tab"` |
| `repeat` | integer | 否   | 重复次数，1–100，默认 1                                                     |

`ctrl+alt+delete`、`alt+f4`、`alt+tab`、`win+l`、`win+d` 为系统快捷键：命中且 `COMPUTER_USE_ALLOW_SYSTEM_KEYS=0` 时返回 `grant_flag_required`。匹配是**修饰键子集**（`shift+alt+tab` 同样命中 `alt+tab`）且**逐键检查**（`ctrl+alt+delete+a` 命中 SAS）。

## scroll

在坐标处滚动。

| 参数               | 类型                            | 必需 | 说明            |
| ------------------ | ------------------------------- | ---- | --------------- |
| `coordinate`       | `[x,y]`                         | 是   | 滚动位置        |
| `scroll_direction` | `"up"｜"down"｜"left"｜"right"` | 是   | 方向            |
| `scroll_amount`    | integer                         | 是   | 滚动格数，0–100 |

## drag

按下、移动到目标、释放。

| 参数               | 类型    | 必需 | 说明                           |
| ------------------ | ------- | ---- | ------------------------------ |
| `coordinate`       | `[x,y]` | 是   | 终点                           |
| `start_coordinate` | `[x,y]` | 否   | 起点；省略则从当前光标位置拖起 |

## move_mouse

移动鼠标（弹簧动画，不点击）。可用于触发 hover 状态。

| 参数         | 类型    | 必需 | 说明     |
| ------------ | ------- | ---- | -------- |
| `coordinate` | `[x,y]` | 是   | 目标位置 |

## open_app

把已安装应用带到前台，必要时启动。应用名在已安装清单（注册表三个 Uninstall hive + 可见 GUI 窗口枚举，TTL 缓存）中解析；解析不到返回 `bad_args`。

| 参数  | 类型   | 必需 | 说明                                                                |
| ----- | ------ | ---- | ------------------------------------------------------------------- |
| `app` | string | 是   | 显示名（如 `"Notepad"`）或 exe 主干（如 `"notepad"`），大小写不敏感 |

## switch_display

切换后续截图捕获的显示器。

| 参数      | 类型   | 必需 | 说明                                                                  |
| --------- | ------ | ---- | --------------------------------------------------------------------- |
| `display` | string | 是   | 截图提示中的显示器名（如 `"\\.\DISPLAY1"`），或 `"auto"` 恢复自动选择 |

## read_clipboard / write_clipboard

读写剪贴板文本（CF_UNICODETEXT）。分别受 `COMPUTER_USE_ALLOW_CLIPBOARD_READ` / `_WRITE` 授权位控制，未授权返回 `grant_flag_required`。

| 参数                   | 类型   | 必需 | 说明                  |
| ---------------------- | ------ | ---- | --------------------- |
| `read_clipboard`       | —      | —    | 无参数，返回 `{text}` |
| `write_clipboard.text` | string | 是   | 要写入的文本          |

## wait

等待指定时长。无输入、无门禁（除总开关）， safest 的批内占位动作。

| 参数       | 类型   | 必需 | 说明      |
| ---------- | ------ | ---- | --------- |
| `duration` | number | 是   | 秒，0–100 |

## cursor_position

查询光标位置。返回 JSON：`{x, y, coordinateSpace: "image_pixels"｜"logical_points", note?}`。有基准截图时返回图像像素坐标；光标在别的显示器上时返回逻辑坐标并附提示。

## hold_key

按住一个键或组合键指定时长后释放（逆序）。系统快捷键黑名单同样适用。

| 参数       | 类型   | 必需 | 说明                                   |
| ---------- | ------ | ---- | -------------------------------------- |
| `text`     | string | 是   | 键或和弦，如 `"space"`、`"shift+down"` |
| `duration` | number | 是   | 秒，0–100                              |

## mouse_down / mouse_up

在当前光标位置按下/释放左键。`mouse_down` 前若已有未配对的按下返回 `state_conflict`；`mouse_up` 幂等（未按住也安全）。取消时若持有按键会自动补释放（先校验锁归属）。

## batch

一次工具调用执行一串动作，省去 N 次模型往返。逐动作跑前台门禁（不是整批跑一次）；遇错即停并返回已完成步骤 + 失败步骤 + 剩余数量；中继 `screenshot` 允许用于检视但**不更新**坐标基准——批次内坐标始终相对批次开始前的截图。

| 参数      | 类型  | 必需 | 说明                            |
| --------- | ----- | ---- | ------------------------------- |
| `actions` | array | 是   | 至少 1 项，每项 `{action, ...}` |

`actions` 项可用动作（按 cc-haha `BATCH_ACTION_ITEM_SCHEMA` 重映射）：

| action                                                                     | 额外参数                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------- |
| `click` / `double_click` / `triple_click` / `right_click` / `middle_click` | `coordinate`、`text`（修饰键）                    |
| `type_text`                                                                | `text`                                            |
| `press_key`                                                                | `text`、`repeat`                                  |
| `hold_key`                                                                 | `text`、`duration`                                |
| `scroll`                                                                   | `coordinate`、`scroll_direction`、`scroll_amount` |
| `drag`                                                                     | `coordinate`、`start_coordinate`                  |
| `move_mouse`                                                               | `coordinate`                                      |
| `mouse_down` / `mouse_up`                                                  | —                                                 |
| `screenshot`                                                               | —                                                 |
| `cursor_position`                                                          | —                                                 |
| `wait`                                                                     | `duration`                                        |

不允许入批：`open_app`、`read_clipboard`、`write_clipboard`（无延迟收益，且复杂化安全模型）。

## 不实现的工具

| cc-haha 工具                                          | 原因                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| `request_access` / `list_granted_applications`        | 宿主审批兼容残留，Windows 上本就不在广告的 22 个工具内        |
| `request_teach_access` / `teach_step` / `teach_batch` | 依赖宿主「隐藏主窗口 + 全屏 tooltip 浮层」UI，独立 MCP 无宿主 |
