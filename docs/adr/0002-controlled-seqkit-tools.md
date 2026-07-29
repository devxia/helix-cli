---
status: accepted
---

# 通过受控 Agent Tool 调用 SeqKit

Helix 不向模型暴露 shell 或任意 SeqKit argv，而是用格式特定的 Agent Tool 把用户意图映射为固定命令。本阶段只提供只读的 `inspect_fastx` 与 `inspect_bam`；后续筛选、查找、区间提取和 FASTQ→FASTA 必须各自拥有稳定 Schema 与 Artifact 契约后再加入。

## Considered Options

- 暴露一个通用 `run_seqkit(args)`：覆盖面大，但绕过确定性参数验证并把第三方 CLI 当作领域接口。
- 把 FASTX 与 BAM 统一成一个检查工具：调用简单，但两类数据的统计语义和结果结构不同。
- 要求用户预装 SeqKit：实现最少，但破坏 Helix 的零感知安装目标。

## Consequences

Helix 优先使用 PATH 中受支持的 SeqKit `2.13.x`；不兼容时经用户确认改用固定、校验后的 Managed Tool，并记住该选择直到 PATH 指纹变化。托管版本固定为 2.13.0，首版覆盖 macOS/Linux 的 arm64/x64。FASTX 检查固定为 `seqkit stats --all --tabular --quiet`，BAM 检查固定为 `seqkit bam -s --quiet`。PATH 优先意味着不同机器可能使用不同的 2.13.x 补丁版本，这是为尊重用户环境而接受的复现性权衡；每次 Tool Run 必须在 Provenance 中记录实际路径和版本。
