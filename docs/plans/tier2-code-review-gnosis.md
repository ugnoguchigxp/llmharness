# Tier 2-6: LLM コードレビュー結果の Gnosis 保存

## 背景と目的

開発者が LLM にコードレビューを依頼するワークフローにおいて、レビュー結果（指摘事項・改善提案）を Gnosis に蓄積することで、将来の類似ファイルへの作業時に過去の知見を recall できるようにする。

### ユースケース

- 開発中の任意ファイルに対してアドホックなコードレビューを依頼
- `git diff` で変更したファイルだけを対象にレビュー
- レビュー結果は JSON 出力 + Gnosis 保存の両方に対応

### 既存機能との関係

`llmharness` は既に以下を持っており、コードレビュー機能を追加するのに自然な場所:

- `adapters.localLlm`: LLM API 呼び出しインフラ（OpenAI 互換）
- `MemoryService`: Gnosis への記録・ingest インフラ
- CLI コマンド体系 (`run`, `eval`, `commit-memory` 等)

## ゴール

- `code-review` CLI コマンドの追加
- `--files` による任意ファイル指定と `--git-diff` による変更ファイル自動取得の両対応
- LLM に構造化 JSON でレビュー結果を返させる
- `--save` フラグで Gnosis に ingestion
- `--output` フラグで JSON ファイルに出力

## 設計

### CLI インターフェース

```bash
# 任意ファイルを指定してレビュー
bun run src/cli.ts code-review \
  --files src/adapters/localllm.ts src/schemas/config.ts \
  [--save] [--output review.json] [--config <path>]

# git 変更ファイルをレビュー（unstaged）
bun run src/cli.ts code-review \
  --git-diff \
  [--staged] \
  [--save] [--output review.json] [--config <path>]
```

### 新規スキーマ: `src/schemas/review.ts`

```ts
ReviewSeveritySchema: "error" | "warning" | "suggestion" | "info"

ReviewFindingSchema {
  severity: ReviewSeverity
  file?: string          // 対象ファイルパス（任意）
  line?: number          // 行番号（任意）
  message: string        // 指摘内容
  suggestion?: string    // 修正提案（任意）
}

CodeReviewResultSchema {
  reviewedFiles: string[]                      // レビュー対象ファイルリスト
  findings: ReviewFinding[]                    // 指摘事項リスト
  summary: string                              // レビュー全体サマリー
  overallAssessment: "lgtm" | "needs-changes" | "major-issues"
  reviewedAt: string                           // ISO 8601 タイムスタンプ
  model?: string                               // 使用モデル名（任意）
}
```

### 新規アダプター: `src/adapters/codeReviewer.ts`

```ts
export type CodeReviewInput = {
  files: Array<{ path: string; content: string }>;
  config: HarnessConfig;
};

export const reviewCode = async (input: CodeReviewInput): Promise<CodeReviewResult>
```

**処理フロー:**

1. ファイル内容を `[Files to Review]` セクションとしてプロンプトに埋め込む
2. `adapters.localLlm` の API 設定（`mode: "api"` の場合）または CLI コマンドで LLM を呼び出す
3. LLM のレスポンスを `CodeReviewResult` 形式の JSON にパース
4. パース失敗時は raw テキストを summary に格納した最小限の結果を返す（フォールバック）

**LLM プロンプト構造:**

```
You are an expert code reviewer with deep knowledge of TypeScript best practices,
security, performance, and software design.

Review the following file(s) and provide structured feedback.

[Files to Review]
--- <path> ---
<content>
...

Return exactly one JSON object:
{
  "findings": [
    {
      "severity": "error|warning|suggestion|info",
      "file": "<path or null>",
      "line": <number or null>,
      "message": "<issue description>",
      "suggestion": "<how to fix>"
    }
  ],
  "summary": "<overall review in 2-3 sentences>",
  "overallAssessment": "lgtm|needs-changes|major-issues"
}

severity meanings:
- error: must fix — breaks functionality or introduces bugs
- warning: should fix — potential bugs or bad practices
- suggestion: nice to have improvement
- info: informational, no action required

Do not include markdown fences. Output must start with "{" and end with "}".
```

### `MemoryService` への追加: `ingestReview()`

```ts
async ingestReview(result: CodeReviewResult): Promise<void>
```

Gnosis に保存するコンテンツ形式:

```
Code Review: src/adapters/localllm.ts, src/schemas/config.ts
Overall: needs-changes
Reviewed At: 2026-04-11T12:00:00Z

Summary: The localllm adapter has some issues with null checking...

Findings:
[warning] src/adapters/localllm.ts:195 — API key may be undefined without explicit check
  → Add explicit null check: if (!apiKey) throw new Error(...)
[suggestion] src/adapters/localllm.ts:54 — resolveUrl name doesn't convey side-effect-free nature
  → Consider renaming to buildApiUrl
```

セッション ID: `<memory.sessionId>-reviews`（`-verified` と分離）

### `cli.ts` への追加: `code-review` コマンド

```ts
const codeReviewCommand = async (flags) => {
  // 1. ファイルリストを解決（--files or --git-diff）
  // 2. ファイル内容を読み込む
  // 3. reviewCode() を呼び出す
  // 4. 結果をコンソール出力
  // 5. --output があれば JSON ファイルに書き出す
  // 6. --save があれば MemoryService.ingestReview() を呼び出す
}
```

`--git-diff` の場合: `git diff --name-only` (unstaged) または `git diff --cached --name-only` (staged) で変更ファイルを取得。

## 影響ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/schemas/review.ts` | 新規作成: `ReviewFinding`, `CodeReviewResult` スキーマ |
| `src/schemas/index.ts` | 新規スキーマの re-export 追加 |
| `src/adapters/codeReviewer.ts` | 新規作成: LLM コードレビューアダプター |
| `src/services/memoryService.ts` | `ingestReview()` メソッドを追加 |
| `src/cli.ts` | `code-review` サブコマンドを追加 |
| `test/unit/adapters/codeReviewer.test.ts` | 新規テスト |

## テスト計画

`test/unit/adapters/codeReviewer.test.ts`:

1. ファイルが空の場合にフォールバック結果を返す
2. LLM が有効な JSON を返した場合に `CodeReviewResult` として正しくパースされる
3. LLM が不正な JSON を返した場合にフォールバックする（findings=[], summary=raw text）
4. API 到達不能時にエラーをスローする
5. `CodeReviewResultSchema` のバリデーション（各フィールド）

## 今後の改善点

- コードレビュー専用の LLM 設定 `review.llm` を `HarnessConfigSchema` に追加（より高性能モデルを使いたい場合）
- `contextCollector` との統合: レビュー対象ファイルのインポートや関連テストも自動で含める
- Markdown レポート出力（`--format markdown`）
- `commit-memory` への `--with-review` フラグ追加（コミット時に自動レビュー）
