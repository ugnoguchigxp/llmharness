# llmharness

TypeScript + Bun で構築した LLM 修正評価ハーネスです。`localLlm` / `Astmend` / `diffGuard` を Adapter 層で抽象化し、Zod Schema で入出力契約を検証します。

## Commands

- `bun run lint`
- `bun run typecheck`
- `bun test`
- `bun run test:contract`
- `bun run smoke`
- `bun run smoke:eval`
- `bun run src/cli.ts run --scenario smoke-001`
- `bun run src/cli.ts eval --suite smoke`
- `bun run eval:all`
- `bun run src/cli.ts report --latest`
- `bun run doctor`
- `bun run src/cli.ts commit-memory` (Gnosis への同期と検証)

## Adapter Modes

`mock` モードは廃止し、`api` または `cli` で実コンポーネントに接続します。

- `localLlm`
  - `api`: OpenAI互換 `/v1/chat/completions` を呼び出し
  - `cli`: `adapters.localLlm.command` を実行。`{{prompt}}` を含む場合は置換し、含まない場合は `commandPromptMode`（`stdin`/`arg`）で投入
- `astmend`
  - `api`: `endpoint + apiPath` へ `POST { patch, targetFiles }`
  - `cli`: `adapters.astmend.command` を実行し、stdin に patch を渡す（失敗時は `libEntrypoint` によるライブラリフォールバック）
  - `lib`: `libEntrypoint` を直接 import して `applyPatchFromFile` を実行（推奨）
- `diffGuard`
  - `api`: `endpoint + apiPath` へ `POST { patch }`
  - `cli`: `adapters.diffGuard.command` を実行し、stdin に patch を渡す

CLI 出力は JSON を優先して解析し、JSON がない場合は安全側（失敗または警告）で判定します。
初回のモデルロードが重い環境では `localLlm.timeoutMs` を長め（例: `180000`）に設定してください。

## Smoke Scenarios

`scenarios/` には以下の計20件を同梱しています。

- `smoke`: 5件 (`smoke-001` - `smoke-005`)
- `regression`: 8件 (`regression-001` - `regression-008`)
- `edge-cases`: 7件 (`edge-001` - `edge-007`)

- 単体: `bun run smoke`
- スイート: `bun run smoke:eval`
- 全スイート: `bun run eval:all -- --config configs/harness.config.json`

## Adapter Contract Tests

Adapter I/F の破壊的変更検知のため、`test/contract/adapters/` に契約テストを追加しています。

- `localLlm`: CLI payload（`patch`/`response`）と OpenAI互換 API 応答の契約
- `Astmend`: `lib` エントリポイント契約、CLI失敗時フォールバック契約、非0 exit 取り扱い契約
- `diffGuard`: `issues/findings` 正規化契約、非JSON出力時の安全側判定契約

実行コマンド:

- `bun run test:contract`

## Next Step (Real Integration)

1. 設定を選ぶ
- CLI: [harness.config.cli.example.json](/Users/y.noguchi/Code/llmharness/configs/harness.config.cli.example.json)
- API: [harness.config.api.example.json](/Users/y.noguchi/Code/llmharness/configs/harness.config.api.example.json)

2. 設定ファイルを指定して接続確認
- `bun run doctor -- --config configs/harness.config.json`

3. 問題がなければ実行
- `bun run src/cli.ts run --scenario smoke-001 --config configs/harness.config.json`
- `bun run src/cli.ts eval --suite smoke --config configs/harness.config.json`
## Memory Integration (Gnosis)

`gnosis` プロジェクトと連携して、過去の修正事例を RAG として利用したり、成功したパッチを知識として蓄積したりできます。

### 有効化 (`configs/harness.config.json`)

```json
{
  "adapters": {
    "memory": {
      "enabled": true,
      "gnosisPath": "../gnosis",
      "sessionId": "my-project"
    }
  }
}
```

### 知識の同期

開発後、以下のコマンドを実行することで、プロジェクトの整合性チェック（lint, test等）を行い、パスした場合に最新の成功パッチを `gnosis` へ同期し、Git コミットまで実行します。

```bash
# 基本用法（メッセージ指定なし、設定に基づく）
bun run src/cli.ts commit-memory

# カスタムメッセージでコミット & プッシュ
bun run src/cli.ts commit-memory --message "feat: 課題を解決" --push
```

設定により、デフォルトで自動コミットや自動プッシュを有効にすることも可能です。
