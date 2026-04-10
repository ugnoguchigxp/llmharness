# llmharness

TypeScript + Bun で構築した LLM 修正評価ハーネスです。`localLlm` / `Astmend` / `diffGuard` を Adapter 層で抽象化し、Zod Schema で入出力契約を検証します。

## Commands

- `bun run lint`
- `bun run typecheck`
- `bun test`
- `bun run smoke`
- `bun run src/cli.ts run --scenario smoke-001`
- `bun run src/cli.ts eval --suite smoke`
- `bun run src/cli.ts report --latest`
- `bun run doctor`

## Adapter Modes

`mock` モードは廃止し、`api` または `cli` で実コンポーネントに接続します。

- `localLlm`
  - `api`: OpenAI互換 `/v1/chat/completions` を呼び出し
  - `cli`: `adapters.localLlm.command` を実行。`{{prompt}}` を含む場合は置換し、含まない場合は `commandPromptMode`（`stdin`/`arg`）で投入
- `astmend`
  - `api`: `endpoint + apiPath` へ `POST { patch, targetFiles }`
  - `cli`: `adapters.astmend.command` を実行し、stdin に patch を渡す（失敗時は `libEntrypoint` によるライブラリフォールバック）
- `diffGuard`
  - `api`: `endpoint + apiPath` へ `POST { patch }`
  - `cli`: `adapters.diffGuard.command` を実行し、stdin に patch を渡す

CLI 出力は JSON を優先して解析し、JSON がない場合は安全側（失敗または警告）で判定します。
初回のモデルロードが重い環境では `localLlm.timeoutMs` を長め（例: `180000`）に設定してください。

## Next Step (Real Integration)

1. 設定を選ぶ
- CLI: [harness.config.cli.example.json](/Users/y.noguchi/Code/llmharness/configs/harness.config.cli.example.json)
- API: [harness.config.api.example.json](/Users/y.noguchi/Code/llmharness/configs/harness.config.api.example.json)

2. 設定ファイルを指定して接続確認
- `bun run doctor -- --config configs/harness.config.json`

3. 問題がなければ実行
- `bun run src/cli.ts run --scenario smoke-001 --config configs/harness.config.json`
