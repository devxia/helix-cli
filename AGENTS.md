# AGENTS.md — Helix CLI

Repository-level Agent Guide

## 产品哲学

**终端是科学家的工作环境。** 用户安装一个 `helix` 文件，在当前目录运行它即可对话、检查数据和逐步执行科研分析。

**确定性工具层是可信度的根基。** LLM 只能选择具有明确 Schema 的 Agent Tool；模型不得生成或透传 shell 字符串。外部程序由代码使用 argv 直接启动，每次执行都必须可中断并记录 Provenance。

**领域能力优先于基础设施重造。** Provider、模型、Thinking、Session 和交互式 TUI 由嵌入的 Pi SDK 提供。Helix 的代码集中在生物信息学工具、科研工作流、安全边界和结果解释。

**零感知安装。** 最终用户只下载 `helix`。Pi SDK 编译进 Helix；必要的私有运行资源和 Managed Tool 只能写入 `~/.helix`，不得要求用户安装 Node、Bun、TypeScript 或全局 Pi。

## 技术约束

| 层级 | 技术与约束 |
|---|---|
| 运行时 | Bun 1.2+；开发与测试使用 Bun |
| Agent/TUI | `@earendil-works/pi-coding-agent` SDK；只使用根包公开导出，不 fork、不使用深层 import |
| Agent Tool Schema | Pi 当前公开 Schema 包 `typebox`；领域结果使用 TypeScript 类型 |
| 子进程 | `Bun.spawn()` 直接 argv；禁止 shell 拼接；并发读取 stdout/stderr；支持 AbortSignal |
| 生物信息学工具 | PATH 中经版本验证的程序，或固定 URL/SHA-256 的 Managed Tool |
| 分发 | `bun build --compile` 生成一个 `helix` 二进制 |
| 测试 | `bun:test`；默认测试离线且只使用临时 HOME/目录；真实工具另设集成测试 |

未经 ADR 不引入第二套 Agent loop、LLM Provider 抽象或 TUI。不要引入 Web、MCP Server、数据库服务、容器平台或分布式队列来完成单进程首版能力。

## 架构边界

**Pi Runtime 是宿主。** `AgentSessionRuntime + InteractiveMode` 拥有聊天、模型、认证、Thinking、Session 和交互生命周期。Helix 通过公开 SDK 提供 System Prompt、允许的只读内置工具和自定义 Agent Tool。

**Helix 与 Pi 完全隔离。** Helix 使用 `~/.helix` 和项目 `.helix`，不得读写 `~/.pi` 或项目 `.pi`。可以读取进程已有的 Provider 环境变量和 PATH，但不得修改它们。外部 Pi Extensions 不加载；只允许 `.helix` 中的 Skills 和 Prompt Templates。

**最小权限。** Pi 内置工具仅启用 `read`、`grep`、`find`、`ls`。禁用 `bash`、`edit`、`write`。所有生物数据变换必须经过 Helix Agent Tool。

**外部程序不是领域接口。** `inspect_fastx` 等 Agent Tool 表达科研意图；SeqKit 是实现该意图的外部程序。不要新增 `run_seqkit(args)` 一类透传接口。

**大结果落盘。** 未来生成序列或图片的工具返回 Artifact 和摘要，不把完整大型输出写入模型上下文。输入可以位于任意可读路径；派生 Artifact 只能写入启动工作区，且不得静默覆盖。

## 当前项目地图（0.1.0）

```text
src/
  main.ts                    — 参数解析；在导入 Pi 前准备隔离运行环境
  app.ts                     — System Prompt、资源策略与 Pi runtime/InteractiveMode 组合
  paths.ts                   — ~/.helix、项目 .helix 与 session 路径
  runtime-assets.ts          — 物化内嵌的 Helix 品牌与 Pi 运行资源
  settings-storage.ts        — 清除外部资源包与遥测的隔离 Settings 存储
  assets/pi/                 — 编译进 Helix 的 Pi 主题与 HTML 导出资源
  executor/subprocess.ts     — 可中断、限量捕获的 Bun 子进程执行
  seqkit/
    manifest.ts              — SeqKit 2.13.0 平台资产与 SHA-256
    archive.ts               — 防路径逃逸的单文件 tar.gz 提取
    manager.ts               — PATH 解析、版本策略、确认和托管安装
    parsers.ts               — FASTX/BAM TSV 解析
    tools.ts                 — inspect_fastx / inspect_bam Agent Tool

test/
  fixtures/                  — 小型真实 FASTX/BAM 数据及来源说明
  *.test.ts                  — 离线单元/契约测试
  integration/               — 显式运行的真实 SeqKit 测试

docs/adr/                    — 难以逆转的架构决策
CONTEXT.md                   — 纯领域术语表，不写实现方案
```

## 当前功能边界

0.1.0 只实现：

- `inspect_fastx`：1–32 个 FASTA/FASTQ 文件，调用 `seqkit stats --all --tabular --quiet`；
- `inspect_bam`：单个 BAM，调用 `seqkit bam -s --quiet`；
- SeqKit PATH 版本范围 `>=2.13.0 <2.14.0`；托管回退固定为 2.13.0；
- macOS/Linux 的 arm64/x64；
- 默认新建持久 Session，可在 TUI 内显式恢复；
- CLI 仅支持交互模式、`--help`、`--version`。

不要提前实现筛选、查找、BED/GTF、区间提取、格式转换、SAM/CRAM/VCF 或任意命令代理。

## 开发原则

- 修改前读取完整相关模块、测试、最近提交和本目录最近的 `AGENTS.md`。
- 每条变更必须追溯到当前目标；不顺手重构无关代码。
- 工具参数和统计字段以固定版本官方文档及真实命令输出为准，不猜测。
- 新工具先写失败/中断/路径/真实输出测试，再扩展功能面。
- 测试不得修改真实 `~/.helix`、`~/.pi` 或用户 PATH 中的程序。
- 下载必须固定 HTTPS 来源和 SHA-256，先校验压缩包，再防御性解包并校验可执行文件版本。
- 非零退出、中断、输出截断或解析失败时不得返回部分统计为成功结果。
- 代码注释只解释不明显的约束和原因，不复述语句。

## 命令与验收

```bash
bun --hot src/main.ts
bun test
bun run test:integration
bunx tsc --noEmit
bun build --compile --outfile helix src/main.ts
./helix --version
./helix --help
```

本阶段完成必须满足：

1. 默认测试离线通过；
2. 真实 SeqKit 2.13.0 对 FASTA、FASTQ、BAM fixture 的集成测试通过；
3. 类型检查通过；
4. 单二进制编译及 `--version/--help` 烟测通过；
5. `git diff --check` 通过；
6. 工作区没有测试生成的凭证、工具、Session 或 subagent artifact。

## 上游 Pi 升级

- `@earendil-works/pi-coding-agent` 使用精确版本和 lockfile，不允许浮动升级。
- Pi 相关 import 和组合只存在于 Runtime/资源边界。
- 升级使用独立 `chore(pi)` 分支或 PR，先阅读 changelog 的 breaking changes。
- 必须重新运行 SDK 契约测试、认证/模型交互烟测、Session 恢复、Tool 中断和单二进制构建。
- Helix 版本内嵌一个已验证 Pi 版本，不承诺任意 Helix/Pi 版本组合兼容。

## 工作流

提交信息遵循 `<type>(<scope>): <subject>`，subject 使用英文祈使句。除非用户明确要求，不 stage、commit、push、发布或创建 PR。
