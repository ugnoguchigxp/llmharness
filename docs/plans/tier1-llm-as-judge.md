# Tier 1-2: LLM-as-Judge

## 背景と目的

現在の `requirementsJudge` は `successCriteria` の各項目をキーワード抽出 → judge の `reasons` とのキーワード一致率で判定している。
この方式には以下の限界がある:

- 同義語・言い換えを捉えられない（"typecheck passes" vs "no type errors"）
- キーワードが3文字以下だと全て無視される（`extractKeywords` の `w.length > 3` フィルタ）
- 成功基準の意図と出力の意味的な一致を評価できない

本実装では、LLM を judge として使い、成功基準への適合度をセマンティックに評価する。

## 実装済みの内容

### モード

| モード | 挙動 |
|--------|------|
| `keyword` | 既存のキーワードマッチング（デフォルト、後方互換） |
| `llm` | LLM による判定のみ（失敗時は fail を返す） |
| `hybrid` | LLM 判定を試み、失敗時はキーワードマッチングにフォールバック |

### 新規ファイル

#### `src/judges/llmRequirementsJudge.ts`

- `runLlmRequirementsJudge(requirements, judges, patch, config)` — LLM ベースの requirements 判定
- OpenAI 互換 API (`/v1/chat/completions`) を呼び出す
- requirements が無い・successCriteria が0件の場合は即座に pass を返す（fail-safe）
- LLM レスポンスを `CriterionEvaluation[]` にパース。confidence が閾値未満の項目は fail 扱い
- 評価できない基準は `"No evaluation returned by LLM"` でフォールバック

### スキーマ変更

#### `src/schemas/config.ts`

```ts
JudgeLlmConfigSchema {
  apiBaseUrl?: string      // 例: "http://localhost:8080", "https://api.groq.com/openai"
  apiPath: string          // default: "/v1/chat/completions"
  apiKeyEnv: string        // default: "LOCAL_LLM_API_KEY"
  model: string            // default: "default"
  timeoutMs: number        // default: 60000
  temperature: number      // default: 0
}

JudgeConfigSchema {
  mode: "keyword" | "llm" | "hybrid"  // default: "keyword"
  confidenceThreshold: number          // default: 0.5
  llm?: JudgeLlmConfigSchema
}
```

`HarnessConfigSchema` に `judges: JudgeConfigSchema` として統合済み。

#### `src/schemas/domain.ts`

```ts
CriterionEvaluationSchema {
  criterion: string
  pass: boolean
  reasoning: string
  confidence: number  // 0.0-1.0
}
```

`JudgeResultSchema` に `criterionEvaluations?: CriterionEvaluation[]` を追加。

### パイプライン統合

`pipeline.ts` の `runRequirementsJudgeWithMode` 関数で mode に応じて分岐:

```ts
const runRequirementsJudgeWithMode = async (config, requirements, judges, patch) => {
  if (!requirements || mode === "keyword") return runRequirementsJudge(...)
  try {
    return await runLlmRequirementsJudge(requirements, judges, patch, config)
  } catch {
    if (mode === "llm") return error judge result
    return keyword fallback with note  // hybrid
  }
}
```

### Markdown レポート

requirements judge が `criterionEvaluations` を持つ場合、各基準の reasoning を表示:

```markdown
- requirements: pass=true score=75 reasons=LLM judge: 3/4 criteria satisfied
  - [pass] "finalDecision is pass or fail" (confidence: 0.92): The result.finalDecision field is present...
  - [fail] "Artifacts are created" (confidence: 0.40): No direct evidence of artifact creation...
```

## 設定例

### localLlm を judge に使う（デフォルト）

`judges.llm.apiBaseUrl` を省略すると `adapters.localLlm.apiBaseUrl` を自動フォールバック。

```json
{
  "judges": {
    "mode": "hybrid",
    "confidenceThreshold": 0.5
  }
}
```

### Groq（無料枠、OpenAI 互換）

```json
{
  "judges": {
    "mode": "llm",
    "confidenceThreshold": 0.5,
    "llm": {
      "apiBaseUrl": "https://api.groq.com/openai",
      "apiKeyEnv": "GROQ_API_KEY",
      "model": "llama-3.3-70b-versatile",
      "timeoutMs": 60000
    }
  }
}
```

### Google Gemini（無料枠、OpenAI 互換エンドポイント）

```json
{
  "judges": {
    "mode": "llm",
    "confidenceThreshold": 0.5,
    "llm": {
      "apiBaseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
      "apiKeyEnv": "GEMINI_API_KEY",
      "model": "gemini-2.0-flash",
      "timeoutMs": 60000
    }
  }
}
```

### OpenAI

```json
{
  "judges": {
    "mode": "llm",
    "confidenceThreshold": 0.6,
    "llm": {
      "apiBaseUrl": "https://api.openai.com",
      "apiKeyEnv": "OPENAI_API_KEY",
      "model": "gpt-4o-mini",
      "timeoutMs": 30000
    }
  }
}
```

## テスト

`test/unit/judges/llmRequirementsJudge.test.ts`:

1. requirements が undefined の場合にスキップして pass を返す
2. successCriteria が0件の場合に pass を返す
3. API が到達不能の場合に fail を返す（エラーメッセージ付き）
4. keyword fallback の動作確認（hybrid モードのシミュレーション）
5. `judges.llm` セクションを持つ config スキーマのバリデーション
6. デフォルトが `keyword` モードであることの確認

## 今後の改善点

- LLM の判定結果に対するテストのためのモック機構（現状は API 到達不能ケースのみ）
- より高性能なモデルが使える環境では `mode: "llm"` を推奨、現状は `mode: "hybrid"` を推奨
- confidence threshold のシナリオ別チューニング（requirements ファイルへの `judgeThreshold` 追加）
