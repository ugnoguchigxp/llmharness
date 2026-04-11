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
- `bun run src/cli.ts run --scenario smoke-001 --requirements-path requirements/smoke-001.requirements.json`
- `bun run src/cli.ts eval --suite smoke`
- `bun run eval:all`
- `bun run src/cli.ts report --latest`
- `bun run doctor`
- `bun run src/cli.ts generate-scenario --requirements requirements/smoke-001.requirements.json --suite smoke`
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

## Requirements Layer

scenario の前段に **Requirements Layer** を導入しました。シナリオに要件定義（目的・制約・成功基準・レビュアー）を関連付けることで、eval レポートで「要件適合状況」を確認できます。

### Requirements ファイルの形式

`requirements/*.requirements.json` に配置します。

```json
{
  "id": "smoke-001-req",
  "title": "Basic harness flow: smoke validation",
  "task": "Verify end-to-end pipeline execution without errors.",
  "audience": "CI pipeline / developers",
  "constraints": ["Patch must apply cleanly"],
  "successCriteria": ["finalDecision is pass or fail", "Artifacts are created"],
  "nonGoals": ["Does not verify patch semantics"],
  "risks": ["External adapter may be unavailable in CI"],
  "reviewPersonas": [
    {
      "name": "CI Engineer",
      "role": "Infrastructure",
      "focus": ["pipeline reliability", "exit codes"]
    }
  ]
}
```

### シナリオへの紐付け

scenario JSON に `requirementsPath` を追加するだけで有効になります。省略すると従来通りの動作になります。

```json
{
  "id": "smoke-001",
  "requirementsPath": "requirements/smoke-001.requirements.json"
}
```

### eval レポートへの反映

requirements が存在する場合、Markdown レポートに以下が追加されます。

- requirements validation status（`valid` / `invalid` / `not_found`）
- successCriteria 件数・reviewPersonas 件数
- task / constraints / successCriteria / reviewPersonas の詳細

requirements ファイルが見つからない・スキーマ不正の場合もエラーにならず、`not_found` / `invalid` として記録されます（fail-safe）。

### B-3: Convention-based 自動探索

`requirementsPath` を scenario JSON に書かなくても、`requirements/<scenarioId>.requirements.json` が存在すれば自動的にロードされます。ファイルが存在しない場合は警告なしで無視されます（convention-over-configuration）。

### B-2: CLI フラグで一時上書き

```bash
bun run src/cli.ts run --scenario smoke-001 --requirements-path path/to/custom.requirements.json
```

### B-1: eval 完了時のサマリ

`eval --suite` 完了時に各 scenario の requirements 状態を一覧表示します。

```
eval completed: 5 scenario(s)
- smoke-001 [req: valid, criteria=4, personas=2]  artifacts/run/...
- smoke-002 [no requirements]  artifacts/run/...
```

### A-2: SuccessCriteria Judge

requirements の `successCriteria` と judge の `reasons` をキーワードマッチングで照合し、`requirements` フェーズの `JudgeResult` を生成します。達成率が 50% 以上で `pass`。

### A-3: Revision Suggester

`finalDecision` が `fail`/`error` の場合、requirements の `successCriteria` や `constraints` と judge 出力を照合し、改訂提案を report に含めます（ルールベース・LLM 不使用）。

### A-1: Persona Review Executor

requirements の `reviewPersonas` が存在し、パッチが生成された場合、各ペルソナの視点で localLlm にレビューを依頼します。結果は `personaReviews` として `ScenarioResult` に含まれ、Markdown report にも表示されます。fail-safe: LLM が失敗してもパイプライン全体は止まりません。

### D-1: Gnosis requirements 蓄積

`commit-memory` 時、requirements summary と persona review 結果を Gnosis への ingestion コンテンツに含めます。

### D-2: generate-scenario コマンド

requirements ファイルから scenario JSON を scaffold します。

```bash
bun run src/cli.ts generate-scenario \
  --requirements requirements/smoke-001.requirements.json \
  --suite smoke \
  --id smoke-generated-001 \
  --output scenarios/smoke/smoke-generated-001.json
```

### サンプル

- `requirements/smoke-001.requirements.json` — smoke-001 に紐付け済み
- `requirements/regression-001.requirements.json` — regression-001 に紐付け済み

## Smoke Scenarios

`scenarios/` には以下の計20件を同梱しています。

- `smoke`: 5件 (`smoke-001` - `smoke-005`)
- `regression`: 8件 (`regression-001` - `regression-008`)
- `edge-cases`: 7件 (`edge-001` - `edge-007`)

- 単体: `bun run smoke`
- スイート: `bun run smoke:eval`
- 全スイート: `bun run eval:all -- --config configs/harness.config.json`

## Doctor: requirements チェック

`bun run doctor` は adapter の疎通確認に加え、requirements ファイルの整合性もチェックします。

- `requirementsPath` が明示されているシナリオに対してファイルの存在確認
- convention ファイル（`requirements/<id>.requirements.json`）の検出状況を報告

```
[ok] requirements.files: 2 explicit path(s) all found; 0 convention file(s) detected
```

## Adapter Contract Tests

Adapter I/F の破壊的変更検知のため、`test/contract/adapters/` と `test/contract/requirements/` に契約テストを追加しています。

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
