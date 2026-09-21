# computer-use

**Windows computer use MCP 服务器** —— 让任意支持 MCP 的 Agent 应用（Trae、Claude Code、Cursor、Cline、Cherry Studio 等）获得完整的桌面自动化能力：截图、鼠标、键盘、剪贴板、应用控制。

纯 TypeScript 实现，零 Python 依赖、零外部解释器，通过标准 MCP stdio 协议通信。

> **开发状态**：首个版本 0.1.0 正在开发中，尚未发布到 npm。本文档随实现进度同步更新。

## 为什么做这个项目

TraeWork 自带的 computer use 体验不佳。本项目完整复刻 [cc-haha](https://github.com/lanlan0811/cc-haha) 的 Windows 像素面实现，并针对「Agent 与用户共享同一套系统输入流」这一 Windows 独有难题，保留了两个关键机制：

- **物理输入干扰检测**：`WH_KEYBOARD_LL` / `WH_MOUSE_LL` 低级钩子区分「Agent 自己发的输入」与「用户的物理输入」，动作期间检测到物理输入立即中止，并明确区分「没发，可重试」与「已发，结果未知」——后者禁止重试，防止模型对同一个开关反复施加动作。
- **投递前置校验**：`SendInput` 永远返回「成功」，哪怕点在了屏幕外或另一个窗口上。本工具在投递前校验坐标是否在显示器内、目标窗口是否可达，宁可拒绝也不谎报成功。

## 功能特性

- 22 个工具：截图 / 局部放大 / 五种点击 / 文本输入 / 按键 / 滚动 / 拖拽 / 移动鼠标 / 打开应用 / 切换显示器 / 剪贴板读写 / 等待 / 光标位置 / 持键 / 鼠标按下释放 / 批量动作
- GDI BitBlt 截图 + LANCZOS 预缩放（28px/token、长边 1568、token 1568 预算，与模型侧读数空间一致）
- 阻尼弹簧光标动画（k=196、阻尼比 0.85、60Hz），逐字符 Unicode 输入（每字符前 25ms 间隔，规避新版 Notepad 的 RichEdit 乱序问题）
- 多显示器支持：自动解析目标显示器、标签去重、`switch_display`
- DPI：per-monitor-v2 感知三级回退，全程物理像素，`SendInput` 绝对坐标 0..65535 虚拟桌面映射
- 应用发现：注册表三个 Uninstall hive + 可见窗口枚举 + UWP `ApplicationFrameHost` 解析 + TTL 缓存
- 跨进程文件锁（同一时刻只允许一个会话操作电脑）、完整取消语义（含持键自动释放）、batch 逐动作门禁
- worker 子进程崩溃隔离：崩溃后重启并告知「结果未知，请先截图」，绝不静默重试

## 环境要求

- Windows 10 1607 及以上（仅 Windows，不支持 macOS / Linux）
- Node.js >= 20

## 使用方式

通过 npx 直接启动（stdio MCP 服务器）：

```bash
npx @lotteai/computer-use
```

或全局安装：

```bash
npm install -g @lotteai/computer-use
computer-use
```

在 MCP 客户端中配置（以 stdio 为例）：

```json
{
  "mcpServers": {
    "computer-use": {
      "command": "npx",
      "args": ["-y", "@lotteai/computer-use"]
    }
  }
}
```

## 配置（环境变量）

全部配置在启动时读取并冻结，`COMPUTER_USE_` 前缀统一：

| 环境变量                             | 默认                      | 说明                          |
| ------------------------------------ | ------------------------- | ----------------------------- |
| `COMPUTER_USE_DISABLED`              | 未设置                    | 设为 `1` 总开关关闭           |
| `COMPUTER_USE_ALLOW_SYSTEM_KEYS`     | `1`                       | 系统快捷键黑名单授权位        |
| `COMPUTER_USE_ALLOW_CLIPBOARD_READ`  | `1`                       | 剪贴板读授权位                |
| `COMPUTER_USE_ALLOW_CLIPBOARD_WRITE` | `1`                       | 剪贴板写授权位                |
| `COMPUTER_USE_PIXEL_VALIDATION`      | `0`                       | 点击目标陈旧性校验开关        |
| `COMPUTER_USE_PIXEL_VALIDATION_GRID` | `9`                       | 校验网格尺寸                  |
| `COMPUTER_USE_MOUSE_ANIMATION`       | `1`                       | 弹簧光标动画                  |
| `COMPUTER_USE_SETTLE_MS`             | `0`                       | 观测前额外等待（默认不加）    |
| `COMPUTER_USE_ACTION_TIMEOUT_MS`     | 实测确定                  | 单动作硬超时                  |
| `COMPUTER_USE_APP_CACHE_TTL_MS`      | `60000`                   | 应用清单 TTL 缓存             |
| `COMPUTER_USE_WORKER_IDLE_MS`        | `300000`                  | worker 空闲退出时间           |
| `COMPUTER_USE_SHOT_DIR`              | `%TEMP%\computer-use-mcp` | `save_to_disk` 目录           |
| `COMPUTER_USE_SERVER_NAME`           | `computer-use`            | MCP server 名（决定工具前缀） |
| `COMPUTER_USE_LOG_LEVEL`             | `info`                    | stderr 日志级别               |

## 工具清单

| #   | 工具                                                                       | 说明                                                     |
| --- | -------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | `screenshot`                                                               | 全屏截图（可存盘）                                       |
| 2   | `zoom`                                                                     | 局部放大（仅用于读细节，动作坐标始终相对全屏截图）       |
| 3   | `click` / `double_click` / `triple_click` / `right_click` / `middle_click` | 五种点击，可按住修饰键                                   |
| 8   | `type_text`                                                                | 逐字符文本输入（多行走剪贴板粘贴，保存并恢复原剪贴板）   |
| 9   | `press_key`                                                                | 按键，支持重复（1–100 次）                               |
| 10  | `scroll`                                                                   | 滚动（方向 + 数量）                                      |
| 11  | `drag`                                                                     | 拖拽                                                     |
| 12  | `move_mouse`                                                               | 移动鼠标（弹簧动画）                                     |
| 13  | `open_app`                                                                 | 打开应用（优先复用前台已有窗口）                         |
| 14  | `switch_display`                                                           | 切换显示器（名称或 `auto`）                              |
| 15  | `read_clipboard` / `write_clipboard`                                       | 剪贴板读写                                               |
| 17  | `wait`                                                                     | 等待（0–100 秒）                                         |
| 18  | `cursor_position`                                                          | 查询光标位置                                             |
| 19  | `hold_key`                                                                 | 按住键指定时长                                           |
| 20  | `mouse_down` / `mouse_up`                                                  | 左键按下 / 释放                                          |
| 22  | `batch`                                                                    | 批量动作（逐动作门禁、遇错即停、坐标相对批次开始前截图） |

## 安全模型

工具调用按固定顺序过门禁：总开关 → 参数校验 → 跨进程文件锁 → 前台应用识别（取不到即拒绝）→ 投递前置校验 → 执行。任一门禁异常，执行器绝不被调用（fail-closed）。

错误码区分两类语义，这是防止模型重复施加动作的唯一手段：`user_interference`（没发，可重试）与 `user_interference_result_unknown`（已发，结果未知，先截图）。

安全边界（已写入 MCP `instructions`）：密码变更、证书警告、转账、就业/住房/信贷决定 → 交回用户；CAPTCHA、不可恢复删除、法律协议、陌生来源安装、API key/OAuth、VPN/网络/系统安全设置 → 动作前当场询问。

## 开发

```bash
npm install
npm run check      # typecheck + lint + format:check + test + build
npm test           # 仅测试
npm run test:desktop  # 真实桌面测试（默认不跑，需 COMPUTER_USE_DESKTOP_TESTS=1）
```

## 许可

MIT，详见 [LICENSE](./LICENSE) 与 [NOTICE](./NOTICE)（逐项列出依赖许可）。
