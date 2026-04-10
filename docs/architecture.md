# Architecture

`llmharness` is a Bun + TypeScript evaluation harness that runs one scenario through four phases:

1. Generation: `localLlm` returns one Astmend operation JSON.
2. Apply: `Astmend` applies the operation and returns normalized apply results.
3. Review: `diffGuard` reviews the produced diff and returns risk findings.
4. Judge: syntax/test/risk judges compute final score and decision.

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
