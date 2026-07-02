# AGENTS.md — Helix Cli

Repository-level Agent Guide

---

## 产品哲学

**终端是科学家的工作环境。** Helix Cli 不是一个 Web 应用的终端 fallback，而是一个原生的终端 Agent。用户 SSH 到服务器，输入 `helix`，就能对话、提交分析、监控任务。不需要浏览器，不需要鼠标，不需要离开终端。

**确定性工具层是可信度的根基。** LLM 不直接生成 shell 命令。LLM 选择工具，代码执行工具。每个工具有 Zod Schema 验证参数，每个执行路径可追踪、可回放。参考 Anthropic "Paving the way for agents in biology"：确定性检索层将准确率从"有时对"提升到"几乎永远对"。

**零感知安装是分发的前提。** 用户通过 `curl | bash` 安装，不需要知道 Bun 存在，不需要知道 TypeScript 存在，不需要知道 pi-TUI 存在。用户下载一个文件，运行它。仅此而已。

---

## 技术约束（不可违背）

| 层级 | 技术 | 替换条件 | 现状(v1) |
|------|------|---------|---------|
| 运行时 | Bun 1.2+ | 仅当 Bun 停止维护时可退至 Node.js + tsx | ✅ 已落地 |
| TUI | pi-TUI (`@earendil-works/pi-tui`) | 仅当项目停止维护时可考虑 blessed | ✅ 已落地 |
| Agent | LangGraph TS (`@langchain/langgraph`) | 不接受替换 | ⏳ 未引入 |
| LLM SDK | OpenAI SDK (`openai` + base_url) 为主；Anthropic (`@anthropic-ai/sdk`)、Google GenAI (`@google/genai`) 用于原生协议 | 不接受替换 OpenAI SDK 的核心地位；新增原生 SDK 需经 ADR | ✅ 已落地 |
| 数据 | bun:sqlite | 不接受替换 | ⏳ 未引入（暂用 `Bun.TOML` 读配置） |
| 验证 | Zod | 不接受替换 | ✅ 已落地 |
| 分发 | `bun build --compile` | 仅当 Bun 取消该功能时可退至 pkg | ✅ 已落地 |

**不在技术栈列表上的依赖不引入。** 不引入 PostgreSQL、Redis、Docker、FastAPI、Express、React（Web）、MCP Server 架构。Helix Cli 是单进程终端应用，不是分布式系统。

---

## 架构原则

**命令式组件模型。** pi-TUI 不是 React。你创建组件用 `new`，添加子组件用 `addChild()`，管理焦点用 `setFocus()`，处理输入用 `addInputListener()` + `matchesKey()`。忘掉 JSX，忘掉 hooks，忘掉虚拟 DOM。

**三层分离，事件总线连接。** TUI 层（pi-TUI）和 Agent 层（LangGraph）不直接调用对方。两者通过 `appState`（EventEmitter + bun:sqlite）通信：Agent 提交事件，TUI 监听刷新；TUI 提交命令，Agent 监听执行。这种解耦让 TUI 可以在 Agent 还在思考时保持 60fps。

**每个子进程都是流。** 所有生物信息学工具通过 `Bun.spawn()` 异步调用，stdout/stderr 通过 `for await` 实时流式传输到 TUI。不允许阻塞等待命令完成后再显示输出。用户在 BWA 比对 30 亿条 reads 时应该看到每一行的 SAM 头部实时闪过。

---

## 开发原则

**代码是唯一的真理。** 文档会过时，注释会撒谎，类型定义会漂移。实现细节以代码为准。修改前先读相关代码和最近的提交记录，不要盲目遵循文档。

**先读后改。** 任何变更前，读取涉及的完整模块、相关的测试文件、以及目录下最近的 `AGENTS.md`。不理解代码的上下文就不动手。

**变更聚焦。** 一个提交只做一件事。不在修复 bug 的 PR 里混入重构，不在添加工具的 PR 里修改 TUI 主题。如果改着改着发现"顺便可以优化一下"，记下来，另开一个任务。

**递进式交付，不是瀑布式。** 遵循 `HelixCli_vibecoding_prompt.txt` 中的阶段定义。阶段 N 必须独立可运行、有明确的验收标准，才能进入阶段 N+1。不要提前实现下一阶段的功能。

**生物信息学工具是生产力，不是演示品。** 每个工具封装必须能在真实数据上运行，不是 mock。工具参数的描述要精确到让生物信息学家知道该填什么。如果一个参数的含义你不确定，查该工具的官方文档，不要猜测。

---

## 项目地图

```
src/
  main.ts              — 入口。解析参数，启动 TUI，处理崩溃。
  config.ts            — Zod 配置模型 + ~/.helix/config.json 读写。
  state.ts             — EventEmitter + bun:sqlite。唯一的状态源。
  db.ts                — bun:sqlite 封装。单例，延迟初始化。

  agent/
    graph.ts           — LangGraph StateGraph 定义。节点 + 边 + 条件路由。
    nodes.ts           — 状态节点函数。parseIntent, planSteps, executeTool 等。
    tools.ts           — 工具注册表。registerTool + LangGraph ToolNode 集成。
    prompts.ts         — 系统提示词 + 工具描述模板。直接影响 Agent 行为。
    checkpointer.ts    — SqliteSaver。bun:sqlite 实现的检查点持久化。

  tui/
    app.ts             — TUI 根应用。ProcessTerminal + TUI 实例管理。
    screens/           — 全屏界面。chat（默认）, jobs, detail, tools, config。
    components/        — 可复用组件。messagelist, jobtable, logstream 等。
    themes/            — pi-TUI 主题定义。颜色、边框、间距。

  executor/
    subprocess.ts      — 通用子进程执行。Bun.spawn + 流式 stdout/stderr。
    nextflow.ts        — Nextflow 调用封装。pipeline 参数传递 + 进度解析。
    gget.ts            — 生物数据确定性检索。Ensembl REST, NCBI E-utilities。
    monitor.ts         — 系统资源采集。/proc, nvidia-smi 解析。

  tools/               — 确定性工具定义。每个文件一个工具类别。
    index.ts           — 注册所有工具到全局数组。Agent 启动时读取。
    aligners.ts        — bwa_mem, star_align, bowtie2_align
    variant.ts         — gatk_haplotypecaller, gatk_mutect2, bcftools_call
    qc.ts              — fastqc, multiqc, samtools_flagstat
    quant.ts           — featurecounts, salmon_quant, kallisto_quant
    annotation.ts      — ensembl_lookup, ncbi_fetch, uniprot_query
    pipelines.ts       — nextflow_run_rnaseq, nextflow_run_wgs 等

  types/               — Zod Schema 定义。所有数据结构从这里导出。
    job.ts, tool.ts, message.ts, config.ts

  utils/               — 纯函数工具。无状态，无副作用。
    logger.ts, ansi.ts, time.ts, validators.ts
```

---

## 现状(v1)

> 上方「项目地图」是完整愿景。当前 `src/` 只实现了聊天客户端层；Agent、工具、子进程、bun:sqlite 均未引入。以下为代码真相，修改以本节为准。

### 已实现文件

```
src/
  main.ts              — 入口。解析 --version，启动 HelixApp。
  config.ts            — Zod 配置模型 + ~/.helix/config.toml 持久化，
                         模型缓存（~/.helix/models_cache.toml），从 /v1/models 拉模型列表。
  catalog.ts           — 从 models.dev/api.json 拉 provider 目录，磁盘缓存。
  commands/
    index.ts           — CommandRegistry 单例 + CommandContext + SlashCommandDef。
    provider.ts        — /provider 斜杠命令（选 provider → 输 API key）。
    model.ts           — /model 斜杠命令（选模型 + thinking 开关）。
  llm/
    types.ts           — 统一 LLM 类型（LLMMessage / LLMEvent / LLMToolCall）。
    provider.ts        — LLMProvider 接口（只有 stream() 一个方法）。
    factory.ts         — 按 provider.type 创建适配器。
    adapters/
      openai.ts        — OpenAI Chat Completions + reasoning_content。
      anthropic.ts     — Anthropic Messages。
      google-genai.ts  — Google GenAI。
  tui/
    app.ts             — HelixApp：全局快捷键（Ctrl+L / Ctrl+/ / Ctrl+C）。
    screens/
      chat.ts          — ChatScreen：唯一常驻界面。编辑器 + 流式聊天 +
                         reasoning 展示 + 斜杠命令路由 + 自动补全。
  utils/
    icons.ts           — provider 图标。
```

### 命令

```bash
bun --hot src/main.ts                             # 开发热重载
bun build --compile --outfile helix src/main.ts   # 编译单二进制（~70MB）
./helix                                           # 运行
bunx tsc --noEmit                                 # 类型检查
```

无测试套件、无 linter。

### 关键模式

**斜杠命令。** 命令通过 `registry.register({name, description, execute})` 注册。`execute` 回调收到 `CommandContext`，可替换编辑器显示内联 UI、加系统消息、触发 provider/model 刷新。自动补全经 pi-TUI 的 `CombinedAutocompleteProvider` 接入。

**配置流。** `loadConfig()` 读 `~/.helix/config.toml` → Zod 解析 → 类型化 Config。`saveConfig()` 校验后写 TOML。Provider/model 变更即时持久化。环境变量（如 `KIMI_API_KEY`、`KIMI_BASE_URL`、`KIMI_MODEL`）在运行时覆盖配置值。

**多协议流式聊天。** `ChatScreen` 通过 `createLLMProvider()` 拿到 `LLMProvider`，调 `stream()` 得 `AsyncIterable<LLMEvent>`。适配器把各家协议映射成统一事件流（`content` / `tool_call` / `status` / `error` / `done`）。中断用 `AbortController`——首次 Ctrl+C 中断流，第二次退出。

**ANSI 渲染。** pi-TUI 期望字符串内嵌原始 ANSI 转义。颜色常量（`DIM`、`CYAN`、`GREEN`、`RED`、`YELLOW`）在各渲染文件内定义。辅助函数：`truncateToWidth`、`visibleWidth`、`wrapTextWithAnsi`。

---

## 工作流要求

**提交规范。** 提交信息遵循 `<type>(<scope>): <subject>`。类型：`feat`, `fix`, `docs`, `refactor`, `test`, `chore`。Scope 是修改的目录或模块。Subject 用英文祈使句（"add" not "added"）。

**阶段门控。** 每个开发阶段在 `HelixCli_vibecoding_prompt.txt` 中有验收标准。完成一个阶段后，运行全部验收检查，全部通过后才能标记阶段完成并进入下一阶段。

---

## 分发原则

**构建产物是唯一的交付单元。** 用户拿到的是 `helix` 这一个文件（50-80MB），不是源码，不是 npm 包，不是 Docker 镜像。CI 通过 `bun build --compile` 生成多平台二进制，通过 GitHub Releases 分发。

**install.sh 是唯一的安装入口。** 脚本检测平台、下载对应二进制、放到 `~/.local/bin`、验证。用户不需要选择，不需要配置，不需要阅读文档。一行命令，一个可执行文件。
