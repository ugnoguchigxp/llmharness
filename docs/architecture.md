# Architecture

`llmharness` is a Bun + TypeScript evaluation harness that runs scenario execution in a loop (up to `maxAttempts`) through four phases:

1. Generation: `localLlm` returns patch text (Astmend JSON / Unified Diff / file-replace). On retries, includes feedback from previous failures.
2. Apply: patch router selects an apply path (`Astmend` / unified diff / file-replace). If it fails, the loop may retry with feedback.
3. Review: `diffGuard` reviews the produced diff. If blocking findings exist, the loop may retry with feedback.
4. Judge: syntax/test/risk judges compute scores. Requirements judge runs in `keyword` / `llm` / `hybrid` mode. If all judges pass, the loop terminates successfully.
5. Stop condition: loop stops on `pass`, or on `maxAttempts` with `finalDecision=fail` and an explicit exhaustion reason.
6. Attempt artifacts: each attempt writes `attemptN.patch` and `attemptN.json` for reproducibility.

Core modules:

- `src/runner/pipeline.ts`: phase orchestration and scoring.
- `src/adapters/*`: integration boundary for external components.
- `src/judges/*`: scoring and gate logic.
- `src/reporters/*`: JSON / Markdown / SARIF artifacts.
- `src/schemas/*`: Zod contracts for config, scenario, and domain data.

Design principles:

- Schema-first contracts with Zod parsing at runtime boundaries.
- Adapter isolation for external integration changes.
- Reproducible artifacts for every scenario run under `artifacts/runs/<run-id>/`.
