# makefun-csv-reader

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Idky1/makefun-csv-reader/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Idky1/makefun-csv-reader/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A dependency-free, ~3x-faster drop-in for csv-reader 1.0.0: a hand-written
indexOf/slice scanner that reproduces csv-reader's broken-CSV semantics
exactly — unterminated quotes, ragged rows, stray CRs, quote junk, multi-line
quoted fields, BOM, CRLF — verified byte-identical against the reference on the
kit's 6 practice cases, 84 hand-written edge cases, 25,000 fuzz inputs and 120
fresh generator-drawn cases (0 failures). The house driver `main.ts` is kept
unchanged; only `solve.js` is replaced.

## Run it

```sh
MAKEFUN_INPUT_DIR=./input MAKEFUN_OUTPUT_DIR=./output node main.ts
```

`main.ts` reads `cases.json` from `MAKEFUN_INPUT_DIR` (default `/input`),
answers every case with `run()` from `solve.js`, and writes `answers.json` to
`MAKEFUN_OUTPUT_DIR` (default `/output`).

---

<sub>Entered on [make.fun](https://make.fun/?ref={referral_code}&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
