# SeqKit integration fixtures

- `tiny.fa` and `tiny.fq` are synthetic records created for Helix parser and real-tool tests.
- `malformed.fq` is intentionally truncated and must fail inspection.
- `tiny.bam` is a five-record derivative of SeqKit's MIT-licensed tagged fixture `tests/pcs109_5k.bam` at `shenwei356/seqkit@v2.13.0` (Git blob `790250449930be8f050a3f85d2e48dbdb2388ae5`). It was produced with SeqKit 2.13.0:

  ```bash
  seqkit bam -f Acc -@ tiny.bam -? 5 -Q pcs109_5k.bam
  ```

  The resulting fixture is 1,348 bytes with SHA-256 `1f81b61250f5dda54bc0789270f380c8b1b99ed53be5c2ee4f94d096228b4a0d`. Its small size keeps the real BAM statistics test deterministic without downloading the 5 MiB upstream fixture.
