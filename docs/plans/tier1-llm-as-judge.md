# Tier 1-2: LLM-as-Judge

## 背景と目的

現在の `requirementsJudge` は `successCriteria` の各項目をキーワード抽出 → judge の `reasons` とのキーワード一致率で判定している。
この方式には以下の限界がある:

- 同義語・言い換えを捉えられない（"typecheck passes" vs "no type errors"）
- キーワードが3文字以下だと全て無視される（`extractKeywords` の `w.length > 3` フィルタ）
- 成功基準の意図と出力の意味的な一致を評価できない

本計画では、LLM を judge として使い、成功基準への適合度をセマンティックに評価する。

## ゴール

- `successCriteria` の各項目に対して、LLM がパッチ内容と judge 出力を見て pass/fail を判定する
- 既存のキーワードマッチング方式をフォールバックとして残す（LLM 接続不可時）
- 判定の根拠（reasoning）をレポートに含める

## 設計

### 新規 Judge: `src/judges/llmRequirementsJudge.ts`

```ts
export type LlmJudgeInput = {
  successCriteria: string[];
  patch: string;
  judgeReasons: string[];
  config: HarnessConfig;
};

export type CriterionEvaluation = {
  criterion: string;
  pass: boolean;
  reasoning: string;
  confidence: number;
};

export const runLlmRequirementsJudge = async (
  input: LlmJudgeInput,
): Promise<JudgeResult> => { ... };
```

### LLM プロンプト設計

```
You are a code review judge. Evaluate whether a code patch satisfies each success criterion.

## Patch
{patch}

## Pipeline Judge Output
{judge reasons joined}

## Success Criteria
1. {criterion1}
2. {criterion2}
...

For each criterion, respond with a JSON array:
[
  {
    "criterion": "...",
    "pass": true/false,
    "reasoning": "...",
    "confidence": 0.0-1.0
  }
]
```

### LLM 呼び出し

既存の `localLlm` アダプターと同じ設定（`config.adapters.localLlm`）を再利用する。
新たに `judges` セクションを config に追加し、judge 用のモデル・temperature を独立させる。

```ts
// schemas/config.ts への追加
export const JudgeConfigSchema = z.object({
  mode: z.enum(["keyword", "llm", "hybrid"]).default("keyword"),
  llmModel: z.string().optional(),
  llmTemperature: z.number().min(0).max(2).default(0),
  llmTimeoutMs: z.number().int().positive().default(30000),
  confidenceThreshold: z.number().min(0).max(1).default(0.6),
}).strict();
```

### モード

| モード | 挙動 |
|--------|------|
| `keyword` | 既存のキーワードマッチング（デフォルト、後方互換） |
| `llm` | LLM による判定のみ |
| `hybrid` | LLM 判定を実行し、失敗時はキーワードマッチングにフォールバック |

### pipeline.ts での統合

```ts
// 現在
const requirementsJudge = runRequirementsJudge(requirements, finalJudges);

// 変更後
const requirementsJudge = config.judges?.mode === "keyword"
  ? runRequirementsJudge(requirements, finalJudges)
  : await runLlmRequirementsJudge({
      successCriteria: requirements.successCriteria ?? [],
      patch: finalGenerate?.patch ?? "",
      judgeReasons: finalJudges.flatMap(j => j.reasons),
      config,
    }).catch(() => runRequirementsJudge(requirements, finalJudges));
```

### レポートへの反映

`CriterionEvaluation` の `reasoning` を `JudgeResult.reasons` に含める:

```
[pass] "Artifacts are created" — reasoning: result.json and result.md are written to artifacts dir (confidence: 0.95)
[fail] "Patch must not introduce regressions" — reasoning: No test execution evidence found in output (confidence: 0.7)
```

### ScenarioResult スキーマ拡張

`JudgeResultSchema` に optional フィールドを追加:

```ts
criterionEvaluations: z.array(CriterionEvaluationSchema).optional()
```

## 変更対象ファイル

| ファイル | 変更内容 |
|----------|----------|
| `src/judges/llmRequirementsJudge.ts` | 新規: LLM ベース判定ロジック |
| `src/judges/requirementsJudge.ts` | 変更なし（フォールバックとして維持） |
| `src/runner/pipeline.ts` | judge モードに応じた分岐 |
| `src/schemas/config.ts` | `JudgeConfigSchema` 追加、`HarnessConfigSchema` に統合 |
| `src/schemas/domain.ts` | `CriterionEvaluationSchema` 追加 |
| `src/reporters/markdownReporter.ts` | reasoning の表示対応 |
| `configs/harness.config.json` | `judges` セクション追加（デフォルト `keyword`） |
| `test/unit/judges/llmRequirementsJudge.test.ts` | 新規: プロンプト構築・レスポンスパースのテスト |

## テスト計画

1. プロンプト構築の単体テスト（入力 → 期待プロンプト文字列）
2. LLM レスポンスのパース・正規化テスト（正常 JSON / 不正 JSON / 空）
3. confidence threshold によるフィルタリングテスト
4. hybrid モードのフォールバック動作テスト
5. 既存 `requirementsJudge.test.ts` の pass 確認（keyword モードの後方互換）

## マイルストーン

1. `JudgeConfigSchema` + config 拡張
2. `CriterionEvaluationSchema` のドメインスキーマ追加
3. `llmRequirementsJudge.ts` の実装（プロンプト構築 + レスポンスパース）
4. `pipeline.ts` の分岐ロジック
5. Markdown レポートの reasoning 表示
6. テスト + smoke シナリオ通過
