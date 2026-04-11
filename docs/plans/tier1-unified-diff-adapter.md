# Tier 1-1: Unified Diff / 汎用パッチアダプター

## 背景と目的

現在のパイプラインは Astmend JSON オペレーション形式（`update_function`, `add_import` 等）のみをパッチとして扱う。
しかし Cursor / Copilot / Claude 等の主要 LLM コーディングツールは Unified Diff やファイル全体書き換えを出力するため、llmharness の適用範囲が限定されている。

本計画では、パッチ形式を抽象化し、Unified Diff を第一級でサポートするアダプターを導入する。

## ゴール

- Unified Diff パッチを受け取り、ファイルに適用できるアダプターを追加する
- 既存の Astmend フローを破壊しない（パッチ形式に応じて自動でルーティング）
- LLM への生成プロンプトでパッチ形式を指定可能にする

## 設計

### パッチ形式の判定

`pipeline.ts` で生成されたパッチを受け取った段階で、形式を自動判定する。

```
detectPatchFormat(patch: string): "astmend-json" | "unified-diff" | "file-replace"
```

判定ロジック:
- JSON パースが成功し `type` フィールドを持つ → `astmend-json`
- `---` / `+++` / `@@` のヘッダーパターンを含む → `unified-diff`
- それ以外 → `file-replace`（ファイル全体の内容として扱う）

### 新規アダプター: `src/adapters/unifiedDiffApply.ts`

```ts
export type UnifiedDiffApplyInput = {
  patch: string;
  targetFiles: string[];
  config: HarnessConfig;
};

export const applyUnifiedDiff = async (
  input: UnifiedDiffApplyInput,
): Promise<ApplyResult> => { ... };
```

実装方針:
- Bun の `Bun.$` でシステムの `patch` コマンド（`patch -p1 --dry-run` → `patch -p1`）を使う
- dry-run で適用可否を先に検証し、reject 情報を取得
- `--dry-run` 成功時のみ本適用して `patchedFiles` と `diff` を返す
- reject 時は hunk 情報をパースして `ApplyReject` に変換

### パッチルーター: `src/adapters/patchRouter.ts`

```ts
export const applyPatch = async (input: PatchApplyInput): Promise<ApplyResult> => {
  const format = detectPatchFormat(input.patch);
  switch (format) {
    case "astmend-json":
      return applyWithAstmend(input);
    case "unified-diff":
      return applyUnifiedDiff(input);
    case "file-replace":
      return applyFileReplace(input);
  }
};
```

`pipeline.ts` は現在 `applyWithAstmend` を直接呼んでいるが、これを `applyPatch` に置き換える。

### config 拡張

`HarnessConfigSchema` の `adapters` に新しいセクションを追加するのではなく、既存の `astmend` セクションを拡張する。

```ts
patchFormat: z.enum(["auto", "astmend-json", "unified-diff", "file-replace"]).default("auto")
```

`auto` の場合は `detectPatchFormat` で自動判定。明示指定時は強制的にそのパスを通す。

### プロンプトの拡張

`localllm.ts` の `buildPrompt` に `patchFormat` に応じた指示を追加:

- `astmend-json`: 既存のまま
- `unified-diff`: "Return a unified diff patch. Start with `---` and `+++` headers."
- `file-replace`: "Return the complete updated file content."

## 変更対象ファイル

| ファイル | 変更内容 |
|----------|----------|
| `src/adapters/patchRouter.ts` | 新規: パッチ形式判定 + ルーティング |
| `src/adapters/unifiedDiffApply.ts` | 新規: Unified Diff 適用ロジック |
| `src/adapters/fileReplaceApply.ts` | 新規: ファイル全体書き換えロジック |
| `src/adapters/astmend.ts` | 変更なし（既存のまま） |
| `src/adapters/localllm.ts` | `buildPrompt` に形式別指示を追加 |
| `src/runner/pipeline.ts` | `applyWithAstmend` → `applyPatch` に置換 |
| `src/schemas/config.ts` | `patchFormat` フィールド追加 |
| `test/unit/adapters/patchRouter.test.ts` | 新規: 形式判定テスト |
| `test/contract/adapters/unifiedDiff.contract.test.ts` | 新規: unified diff 適用の契約テスト |

## テスト計画

1. `detectPatchFormat` の単体テスト（各形式のサンプル入力）
2. `applyUnifiedDiff` の契約テスト（有効な diff / 不正な diff / 空の diff）
3. `applyFileReplace` の契約テスト（ファイル存在時 / 非存在時）
4. `patchRouter` の統合テスト（形式ごとに正しいアダプターに委譲されるか）
5. 既存の `orchestrator.test.ts` が壊れないことの確認

## マイルストーン

1. `detectPatchFormat` + `patchRouter` の実装とテスト
2. `applyUnifiedDiff` の実装と契約テスト
3. `applyFileReplace` の実装と契約テスト
4. `pipeline.ts` のルーター切り替え + config 拡張
5. `buildPrompt` の形式別プロンプト対応
6. 既存テストの pass 確認 + smoke シナリオ通過
