# 变更记录 / Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，遵循语义化版本。

## [0.1.0] - 2026-09-22

首个版本。Windows computer use MCP 服务器（stdio），完整复刻 cc-haha 的 Windows 像素面自动化能力。

### 新增 / Added

- 22 个 MCP 工具：`screenshot`、`zoom`、`click`、`double_click`、`triple_click`、`right_click`、`middle_click`、`type_text`、`press_key`、`scroll`、`drag`、`move_mouse`、`open_app`、`switch_display`、`read_clipboard`、`write_clipboard`、`wait`、`cursor_position`、`hold_key`、`mouse_down`、`mouse_up`、`batch`
- Win32 FFI 层（koffi）：GDI BitBlt 截图（CAPTUREBLT 捕获分层窗口）、带 32 位 tag 的原子 `SendInput` 注入、弹簧光标动画（k=196、阻尼比 0.85、60Hz）、逐字符 Unicode 输入（每字符前 25ms）、Win32 剪贴板直调（CF_UNICODETEXT）
- 物理输入干扰检测：`WH_KEYBOARD_LL` / `WH_MOUSE_LL` 低级钩子 + `PostThreadMessageW` 同步屏障，区分「自己发的输入」与「用户的物理输入」；长阻塞操作期间 25ms 分段泵活消息队列
- 前台租约（非对称失败语义）：动作前检测到物理输入 → 可安全重试；动作中检测到 → 结果未知，禁止重试
- 投递前置校验：`point_outside_display`、`target_window_offscreen`、`SendInput` 部分/完全拒绝的错误码区分，均 fails-open
- 键盘黑名单与修饰键子集匹配（`ctrl+alt+delete`、`alt+f4`、`alt+tab`、`win+l`、`win+d`）：别名规范化、子集匹配、逐键检查
- 图像预算：28px/token、长边 ≤1568、token ≤1568 的二分搜索，截图预缩放到目标尺寸（与模型读数空间一致）
- 多屏支持：自动解析目标显示器 + `switch_display`，显示器标签按 displayId 排序去重
- DPI：per-monitor-v2 感知三级回退，全程物理像素，0..65535 虚拟桌面映射
- 应用发现：三个 Uninstall 注册表 hive + 可见 GUI 窗口枚举 + UWP `ApplicationFrameHost` 解析 + TTL 缓存
- 跨进程文件锁（pid 活性探测，支持陈旧锁窃取）、完整取消语义（含持键自动释放与锁归属校验）、batch 五条不变式
- worker 子进程生命周期：懒加载、常驻、空闲超时（300s）、崩溃重启（60s 三次预算，结果未知不静默重试）
- MCP `instructions` 指导文案：工作循环、共享输入流规则、安全边界清单
- Phase 0 硬门禁通过：koffi 低级钩子 POC（`tools/poc/hook-poc.mjs`），四项验收标准全部验证
- 工程基座：ESM only + tsup 构建（无 sourcemap）、vitest 153 个单测/契约测试、ESLint + Prettier、CI（windows-latest 全量 + ubuntu-latest 静态检查）、postinstall 原生模块自检（中文排查提示）
- 测试体系：快照式工具 schema 契约测试（对 cc-haha 权威定义）、worker 协议/错误码契约测试、live 冒烟（`npm run smoke:worker` / `smoke:mcp`）、真实桌面测试（`COMPUTER_USE_DESKTOP_TESTS=1` 手动触发）
- 文档：双语 README、`docs/ARCHITECTURE.md`、`docs/TOOLS.md`、`docs/SAFETY.md`、`docs/PARITY.md`（中英双语逐项对应）

[0.1.0]: https://github.com/lanlan0811/computer-use-mcp/releases/tag/v0.1.0
