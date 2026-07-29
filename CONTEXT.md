# Helix CLI 领域语言

Helix 是面向科学与生物信息学工作的终端 Agent。本术语表区分用户意图、可调用能力、外部程序与科研数据，避免把实现机制混入领域语言。

## Agent 与执行

**Helix Agent**:
在终端中理解科学问题、选择受控能力并解释结果的对话参与者。
_Avoid_: 聊天客户端、Pi Agent、LLM

**Specialist Agent**:
由 Helix Agent 委派一个边界明确的任务、在独立上下文中工作的专业协作者；Helix Agent 仍对最终决策和结果整合负责。
_Avoid_: Agent Tool、独立用户会话、自治编排器

**Scientific Specialist**:
面向科研分析、方案规划或结果复核且不能修改用户工作区的 Specialist Agent。
_Avoid_: Development Worker、只读工具

**Development Worker**:
仅在用户明确授权代码变更后，才可以修改当前工作区的 Specialist Agent。
_Avoid_: Scientific Specialist、默认写入者

**Delegation**:
Helix Agent 将一个任务及其权限边界交给 Specialist Agent，并接收结果用于当前对话的行为。
_Avoid_: Tool Run、任务转移、放弃父级责任

**Delegation Run**:
一次前台 Delegation 编排；可以包含一个、多个并行或多个顺序执行的 Specialist Run，并具有明确的整体结果。
_Avoid_: Tool Run、后台任务、用户会话

**Specialist Run**:
一个 Specialist Agent 在独立上下文中执行一个被委派任务的过程；它拥有独立结果与可追踪记录。
_Avoid_: Tool Run、Delegation Run、Helix Session

**Writer Authorization**:
用户针对一个含 Development Worker 的 Delegation Run 明确授予的临时开发权限；该权限不会延续到下一次编排。
_Avoid_: 项目授权、永久信任、只读确认

**Agent Tool**:
Helix Agent 可选择的一项具有明确输入和结果契约的确定性能力。
_Avoid_: shell 命令、任意命令代理、外部程序

**Managed Tool**:
由 Helix 获取、验证并保存在私有工具库中的固定版本外部程序。
_Avoid_: 系统依赖、Agent Tool、插件

**Tool Run**:
Agent Tool 对一个外部程序发起的一次可中断执行，包含输入、结果和 Provenance。
_Avoid_: Tool Call、shell session、Job

**Provenance**:
足以说明一次 Tool Run 使用了什么程序、版本、参数、输入、耗时与退出状态的可追溯记录。
_Avoid_: 日志、聊天记录、stdout

## 科研数据

**FASTX Dataset**:
由一个或多个 FASTA 或 FASTQ 文件组成的序列数据集合，可以使用受支持的压缩表示。
_Avoid_: BAM、序列文件（指代所有生物信息学格式时）

**BAM Dataset**:
以 BAM 文件表示的二进制序列比对数据。
_Avoid_: FASTX Dataset、SAM、CRAM

**Dataset Inspection**:
读取数据集并产生描述性统计而不改变输入的分析行为。
_Avoid_: 筛选、转换、编辑

**Artifact**:
Tool Run 在工作区中生成、供用户或后续 Agent Tool 使用的持久文件。
_Avoid_: Tool Result、临时文件、聊天输出

**Sequence Region**:
FASTX 记录中以一基坐标表达、两端均包含的连续区间。
_Avoid_: BED interval、零基区间、flank
