# Operations

## Local prerequisites

- Bun runtime
- `localLlm` CLI or API endpoint
- `Astmend` library entrypoint (`../Astmend/dist/index.js`) or API/CLI
- `diffGuard` CLI or API endpoint

## Health check

Run doctor before scenario execution:

```bash
bun run doctor -- --config configs/harness.config.json
```

Blocking `error` means one or more adapters are not reachable.

## Run commands

- Single scenario:

```bash
bun run src/cli.ts run --scenario smoke-001 --config configs/harness.config.json
```

- Smoke suite:

```bash
bun run src/cli.ts eval --suite smoke --config configs/harness.config.json
```

- Latest report path:

```bash
bun run src/cli.ts report --latest --config configs/harness.config.json
```

## CI notes

`.github/workflows/ci.yml` uses:

- `quality` job on GitHub-hosted runner (`lint`, `typecheck`, `test`)
- `smoke-integration` job on self-hosted runner (real adapters)

This keeps integration smoke on an environment where external tools are actually installed.
The smoke job executes `bun run smoke:eval -- --config configs/harness.config.json`.

## Configuration

`configs/harness.config.json` includes the following sections:

- `adapters`: configuration for `localLlm`, `astmend`, `diffGuard`, and `memory`.
- `orchestrator`: `maxAttempts` (default 3), maximum retry attempts for one scenario. `suiteConcurrency` controls parallel scenario execution for `eval --suite`.
- `judges`: requirements judge mode (`keyword | llm | hybrid`) and LLM thresholds/timeouts.
- `checks`: which static analysis or tests to run.
- `scoring`: weights for each judge phase.

## Retry behavior

- Retries happen when `apply.success=false`, `risk.blocking=true`, or judge gates fail.
- Pipeline returns `pass` immediately when all gates pass.
- Pipeline returns `fail` (not `error`) when `maxAttempts` is exhausted, with a reason in final judge output.

## Attempt artifacts

- Each attempt stores the following files:
- `attemptN.patch`: generated patch payload.
- `attemptN.json`: attempt summary (feedback, apply/review results, judges, stop reason).
