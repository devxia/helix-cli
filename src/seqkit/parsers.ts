export interface FastxStats {
  readonly file: string;
  readonly format: "FASTA" | "FASTQ";
  readonly sequenceType: string;
  readonly numSequences: number;
  readonly sumLength: number;
  readonly minLength: number;
  readonly averageLength: number;
  readonly maxLength: number;
  readonly q1Length: number;
  readonly medianLength: number;
  readonly q3Length: number;
  readonly gapCount: number;
  readonly n50: number;
  readonly l50: number;
  readonly q20Percent: number | null;
  readonly q30Percent: number | null;
  readonly averageQuality: number | null;
  readonly gcPercent: number;
  readonly nCount: number;
}

export interface BamStats {
  readonly file: string;
  readonly primaryAlignmentPercent: number | null;
  readonly multimappingPercent: number | null;
  readonly primaryAlignments: number;
  readonly secondaryAlignments: number;
  readonly supplementaryAlignments: number;
  readonly unmappedReads: number;
  readonly totalReads: number;
  readonly totalRecords: number;
}

interface ParsedTable {
  readonly header: string[];
  readonly rows: string[][];
  readonly index: Map<string, number>;
}

function splitTsvLine(line: string): string[] {
  const cells = line.split("\t");
  if (cells.at(-1) === "") cells.pop();
  return cells;
}

function parseTable(text: string, requiredHeaders: readonly string[]): ParsedTable {
  const lines = text
    .split("\n")
    .map((line) => line.endsWith("\r") ? line.slice(0, -1) : line)
    .filter((line) => line.length > 0);
  if (lines.length < 2) throw new Error("SeqKit output did not contain a header and data row");

  const header = splitTsvLine(lines[0]!);
  const index = new Map<string, number>();
  header.forEach((name, position) => {
    if (index.has(name)) throw new Error(`SeqKit output contains duplicate column: ${name}`);
    index.set(name, position);
  });
  for (const name of requiredHeaders) {
    if (!index.has(name)) throw new Error(`SeqKit output is missing column: ${name}`);
  }

  const rows = lines.slice(1).map((line) => splitTsvLine(line));
  for (const row of rows) {
    if (row.length !== header.length) {
      throw new Error(`SeqKit output row has ${row.length} columns; expected ${header.length}`);
    }
  }
  return { header, rows, index };
}

function value(table: ParsedTable, row: string[], column: string): string {
  return row[table.index.get(column)!]!;
}

function integer(table: ParsedTable, row: string[], column: string): number {
  const raw = value(table, row, column);
  if (!/^-?\d+$/.test(raw)) throw new Error(`SeqKit column ${column} is not an integer: ${raw}`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) throw new Error(`SeqKit column ${column} exceeds safe integer range: ${raw}`);
  return parsed;
}

function decimal(table: ParsedTable, row: string[], column: string, allowNaN = false): number | null {
  const raw = value(table, row, column);
  if (allowNaN && raw === "NaN") return null;
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) {
    throw new Error(`SeqKit column ${column} is not numeric: ${raw}`);
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`SeqKit column ${column} is not finite: ${raw}`);
  return parsed;
}

const FASTX_HEADERS = [
  "file", "format", "type", "num_seqs", "sum_len", "min_len", "avg_len", "max_len",
  "Q1", "Q2", "Q3", "sum_gap", "N50", "N50_num", "Q20(%)", "Q30(%)", "AvgQual", "GC(%)", "sum_n",
] as const;

export function parseFastxStats(text: string): FastxStats[] {
  const table = parseTable(text, FASTX_HEADERS);
  return table.rows.map((row) => {
    const format = value(table, row, "format");
    if (format !== "FASTA" && format !== "FASTQ") {
      throw new Error(`Unexpected SeqKit FASTX format: ${format}`);
    }
    return {
      file: value(table, row, "file"),
      format,
      sequenceType: value(table, row, "type"),
      numSequences: integer(table, row, "num_seqs"),
      sumLength: integer(table, row, "sum_len"),
      minLength: integer(table, row, "min_len"),
      averageLength: decimal(table, row, "avg_len")!,
      maxLength: integer(table, row, "max_len"),
      q1Length: decimal(table, row, "Q1")!,
      medianLength: decimal(table, row, "Q2")!,
      q3Length: decimal(table, row, "Q3")!,
      gapCount: integer(table, row, "sum_gap"),
      n50: integer(table, row, "N50"),
      l50: integer(table, row, "N50_num"),
      q20Percent: format === "FASTQ" ? decimal(table, row, "Q20(%)")! : null,
      q30Percent: format === "FASTQ" ? decimal(table, row, "Q30(%)")! : null,
      averageQuality: format === "FASTQ" ? decimal(table, row, "AvgQual")! : null,
      gcPercent: decimal(table, row, "GC(%)")!,
      nCount: integer(table, row, "sum_n"),
    };
  });
}

const BAM_HEADERS = [
  "PrimAlnPerc", "MultimapPerc", "PrimAln", "SecAln", "SupAln", "Unmapped", "TotalReads", "TotalRecords", "File",
] as const;

export function parseBamStats(text: string): BamStats {
  const table = parseTable(text, BAM_HEADERS);
  if (table.rows.length !== 1) throw new Error(`Expected one BAM statistics row, received ${table.rows.length}`);
  const row = table.rows[0]!;
  return {
    file: value(table, row, "File"),
    primaryAlignmentPercent: decimal(table, row, "PrimAlnPerc", true),
    multimappingPercent: decimal(table, row, "MultimapPerc", true),
    primaryAlignments: integer(table, row, "PrimAln"),
    secondaryAlignments: integer(table, row, "SecAln"),
    supplementaryAlignments: integer(table, row, "SupAln"),
    unmappedReads: integer(table, row, "Unmapped"),
    totalReads: integer(table, row, "TotalReads"),
    totalRecords: integer(table, row, "TotalRecords"),
  };
}
