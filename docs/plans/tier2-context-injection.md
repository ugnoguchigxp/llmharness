# Tier 2-5: コンテキスト注入の強化

## 背景と目的

現在の `buildPrompt`（`localllm.ts`）は、シナリオの `instruction` / `title` / `targetFiles`（ファイルパスのみ）をプロンプトに含めるが、対象ファイルの実際のソースコード、型定義、関連テストの内容は含めていない。

LLM がコード修正の精度を出すためには、修正対象のコンテキスト（ソースコード、型情報、テストの期待値）をプロンプトに含めることが不可欠。
Gnosis の RAG recall はプロジェクト横断の知識だが、ここで言う「コンテキスト」はシナリオ固有のローカルファイル情報を指す。

## ゴール

- `targetFiles` の実際のソースコードを自動でプロンプトに注入する
- 関連する型定義・テストファイルを推論して追加コンテキストとして含める
- トークン上限に対する切り詰め戦略を持つ
- コンテキスト注入量の設定を config で制御可能にする

## 設計

### コンテキスト収集: `src/context/contextCollector.ts`

```ts
export type FileContext = {
  path: string;
  content: string;
  role: "target" | "type" | "test" | "related";
  truncated: boolean;
};

export type CollectedContext = {
  files: FileContext[];
  totalTokenEstimate: number;
};

export const collectContext = async (
  scenario: ScenarioInput,
  config: HarnessConfig,
): Promise<CollectedContext> => { ... };
```

#### 収集ステップ

1. **Target files**: `scenario.targetFiles` のソースコードを読み込む
2. **Import 解析**: 各 target file の import 文を解析し、ローカルモジュール（相対パス）の型定義を収集
3. **テスト推論**: `targetFiles` に対応するテストファイルを convention で探索
   - `src/foo.ts` → `test/unit/foo.test.ts`, `test/foo.test.ts`
   - `src/adapters/bar.ts` → `test/contract/adapters/bar.contract.test.ts`
4. **Requirements context**: requirements の `successCriteria` / `constraints` をテキストとして追加

#### import 解析: `src/context/importResolver.ts`

TypeScript の import 文を正規表現でパースし、ローカルの相対 import を解決する。

```ts
export const resolveLocalImports = (
  fileContent: string,
  filePath: string,
  workspaceRoot: string,
): string[] => { ... };
```

AST パーサーは導入せず、正規表現ベースで実装する（依存追加を最小限に保つ）。
カバーするパターン:
- `import { X } from "./foo"`
- `import type { X } from "../schemas"`
- `export { X } from "./bar"`

### トークン見積もり

正確なトークンカウントは tokenizer 依存のため、簡易見積もりを使う:

```ts
const estimateTokens = (text: string): number =>
  Math.ceil(text.length / 4);
```

### 切り詰め戦略

config で `maxContextTokens` を指定し、超過時は以下の優先順位で切り詰める:

1. `related` ファイル → 除外
2. `test` ファイル → 除外
3. `type` ファイル → 先頭 N 行に切り詰め
4. `target` ファイル → 先頭 N 行に切り詰め（最終手段）

切り詰めが発生した場合、`truncated: true` をマークし、プロンプトに `[truncated]` を付与する。

### プロンプトへの統合

`buildPrompt` を拡張し、コンテキストセクションを追加:

```
[Source Context]
--- src/adapters/localllm.ts ---
{file content}

--- src/schemas/domain.ts ---
{file content} [truncated]

[Related Tests]
--- test/unit/adapters/localllm.test.ts ---
{file content}

[Task]
{existing prompt}
```

### config 拡張

```ts
export const ContextConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxContextTokens: z.number().int().positive().default(4000),
  includeImports: z.boolean().default(true),
  includeTests: z.boolean().default(true),
  includeRequirements: z.boolean().default(true),
  maxFileLines: z.number().int().positive().default(500),
}).strict();
```

`HarnessConfigSchema` に `context: ContextConfigSchema.default({...})` として追加。

### シナリオ拡張（optional）

シナリオ JSON に追加コンテキストファイルを明示指定可能にする:

```json
{
  "id": "regression-005",
  "contextFiles": ["src/schemas/domain.ts", "src/utils/json.ts"]
}
```

`contextFiles` が指定されている場合、import 解析よりも優先してそのファイルを含める。

## 変更対象ファイル

| ファイル | 変更内容 |
|----------|----------|
| `src/context/contextCollector.ts` | 新規: コンテキスト収集のメインロジック |
| `src/context/importResolver.ts` | 新規: import 文の解析と解決 |
| `src/context/testDiscovery.ts` | 新規: テストファイルの convention 探索 |
| `src/adapters/localllm.ts` | `buildPrompt` にコンテキストセクション追加 |
| `src/runner/pipeline.ts` | `collectContext` の呼び出し追加 |
| `src/schemas/config.ts` | `ContextConfigSchema` 追加 |
| `src/schemas/scenario.ts` | `contextFiles` optional フィールド追加 |
| `test/unit/context/contextCollector.test.ts` | 新規 |
| `test/unit/context/importResolver.test.ts` | 新規 |

## テスト計画

1. `resolveLocalImports` の単体テスト（各 import パターン）
2. テスト推論の convention テスト（各パス変換パターン）
3. `collectContext` の統合テスト（実ファイル読み込み）
4. トークン切り詰めロジックのテスト（超過時の優先順位）
5. `buildPrompt` のコンテキスト付きプロンプト生成テスト

## マイルストーン

1. `importResolver.ts` の実装とテスト
2. `testDiscovery.ts` の実装とテスト
3. `contextCollector.ts` の実装（収集 + 切り詰め）
4. `ContextConfigSchema` の追加
5. `buildPrompt` への統合
6. `pipeline.ts` からの呼び出し + smoke テスト
