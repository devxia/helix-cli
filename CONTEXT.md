# Helix CLI 领域语言

Helix 是面向科学与生物信息学工作的终端 Agent。本术语表区分用户意图、可调用能力、外部程序与科研数据，避免把实现机制混入领域语言。

## Agent 与执行

**Helix Agent**:
在终端中理解科学问题、选择受控能力并解释结果的对话参与者。
_Avoid_: 聊天客户端、Pi Agent、LLM

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
