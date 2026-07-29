---
status: accepted
---

# 嵌入 Pi SDK 作为 Helix Agent Runtime

Helix 0.1.0 通过公开 SDK 嵌入精确锁定版本的 `@earendil-works/pi-coding-agent`，并以 `AgentSessionRuntime` 和 `InteractiveMode` 取代自研聊天、Provider、模型、Thinking 与 Session 栈。Helix 不 fork Pi，也不调用或修改用户安装的全局 Pi；认证、设置、会话、Skills、Prompts 和运行资源全部位于独立的 `.helix` 命名空间。

## Considered Options

- 保留 Helix TUI、只把 `AgentSession` 当后端：品牌控制更强，但继续重复维护 Pi 已提供的交互和模型基础设施。
- 同时保留新旧聊天栈：便于回滚，但产生两套配置、会话和行为真相源。
- Fork Pi：可以完全重写品牌和核心行为，但上游 0.x 更新的合并成本最高。

## Consequences

Helix 只使用 Pi 根包公开导出，并把 Pi 组合集中在 Runtime 边界；升级 Pi 必须通过独立 PR、契约测试、真实交互烟测和单二进制构建。最终用户只安装 `helix`，但运行时可以在 `~/.helix` 中物化 Pi 所需的私有品牌、主题和导出资源，并在系统缺失时由 Pi 获取隔离的 `fd`/`rg`。Helix 的 Settings 存储会持续清除外部资源包和遥测开关，并禁用 Pi 自身的更新提示；旧 `~/.helix/config.toml` 保留但不迁移、不再读取。
