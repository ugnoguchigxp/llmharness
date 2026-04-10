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
