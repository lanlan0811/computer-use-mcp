# 变更记录 / Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，遵循语义化版本。

## [未发布 / Unreleased]

### 新增 / Added

- 工程基座：`@lotteai/computer-use` 包骨架（ESM only，tsup 构建，vitest 测试，ESLint + Prettier）
- Phase 0 硬门禁通过：`tools/poc/hook-poc.mjs` 验证 koffi 低级钩子四项验收标准
  （钩子安装、回调计数、tag 区分、`PostThreadMessageW` 同步屏障与干净卸载）
- CI 工作流：windows-latest 全量检查 + ubuntu-latest 静态检查
- `scripts/postinstall.mjs`：原生模块（koffi / sharp）加载自检，失败时给出中文排查提示
- 许可文件：MIT `LICENSE` + `NOTICE`（逐项列出依赖许可）
- 图标：`assets/icon.svg`（SVG 源）+ `assets/icon-256.png`（256px 导出）

[未发布 / Unreleased]: https://github.com/lanlan0811/computer-use-mcp/compare/main...HEAD
