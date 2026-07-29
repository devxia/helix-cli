import { describe, expect, test } from "bun:test";
import { parseBamStats, parseFastxStats } from "../src/seqkit/parsers.js";

const FASTX = `file\tformat\ttype\tnum_seqs\tsum_len\tmin_len\tavg_len\tmax_len\tQ1\tQ2\tQ3\tsum_gap\tN50\tN50_num\tQ20(%)\tQ30(%)\tAvgQual\tGC(%)\tsum_n
/a.fa\tFASTA\tDNA\t2\t10\t4\t5.0\t6\t4\t5\t6\t0\t6\t1\t0\t0\t0.00\t60.00\t2
/b.fq\tFASTQ\tDNA\t2\t6\t2\t3.0\t4\t2\t3\t4\t0\t4\t1\t67\t67\t4.77\t33.33\t2
`;

const BAM = `PrimAlnPerc\tMultimapPerc\tPrimAln\tSecAln\tSupAln\tUnmapped\tTotalReads\tTotalRecords\tFile\t
100.00\t100.00\t1\t4\t0\t0\t1\t5\t/a.bam\t
`;

describe("SeqKit output parsers", () => {
  test("parses header-driven FASTX rows", () => {
    const rows = parseFastxStats(FASTX);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      file: "/a.fa",
      format: "FASTA",
      numSequences: 2,
      n50: 6,
      l50: 1,
      gcPercent: 60,
      nCount: 2,
      q20Percent: null,
      q30Percent: null,
      averageQuality: null,
    });
    expect(rows[1]).toMatchObject({ format: "FASTQ", q30Percent: 67, averageQuality: 4.77 });
  });

  test("parses BAM statistics emitted on stderr with trailing tabs", () => {
    expect(parseBamStats(BAM)).toEqual({
      file: "/a.bam",
      primaryAlignmentPercent: 100,
      multimappingPercent: 100,
      primaryAlignments: 1,
      secondaryAlignments: 4,
      supplementaryAlignments: 0,
      unmappedReads: 0,
      totalReads: 1,
      totalRecords: 5,
    });
  });

  test("represents BAM NaN percentages as missing observations", () => {
    const row = parseBamStats(BAM.replace("100.00\t100.00", "NaN\tNaN"));
    expect(row.primaryAlignmentPercent).toBeNull();
    expect(row.multimappingPercent).toBeNull();
  });

  test("rejects missing columns and partial rows", () => {
    expect(() => parseFastxStats(FASTX.replace("\tsum_n", ""))).toThrow("missing column: sum_n");
    expect(() => parseBamStats(BAM.replace("\t/a.bam\t", ""))).toThrow("columns; expected");
  });
});
