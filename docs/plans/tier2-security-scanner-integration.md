# Tier 2-6: セキュリティ・品質スキャナー連携

## 背景と目的

現在のリスク評価は DiffGuard のみに依存している。DiffGuard はパッチ差分に対するレビューツールだが、ESLint / Semgrep / SonarQube 等の静的解析ツールが持つルールベースの検出能力とは異なる視点を提供する。

パッチ適用後のコード全体に対して複数のスキャナーを実行し、新たに導入された問題を検出することで、パッチの品質評価を多角化する。

## ゴール

- パッチ適用後に外部スキャナーを実行し、結果を `JudgeResult` に統合する
- スキャナーは設定で追加・削除可能（プラグイン的な構造）
- 既存の DiffGuard フローは維持する（スキャナーは追加レイヤー）
- パッチ適用前後の差分でスキャナー結果を比較し、「新規導入された問題」のみを検出する

## 設計

### スキャナーアダプター: `src/adapters/scanners/`

各スキャナーのアダプターを統一インターフェースで実装する。

```ts
// src/adapters/scanners/types.ts
export type ScanFinding = {
  ruleId: string;
  level: "error" | "warn" | "info";
  message: string;
  file: string;
  line?: number;
  column?: number;
  source: string; // "eslint" | "semgrep" | "biome" 等
};

export type ScanResult = {
  scanner: string;
  findings: ScanFinding[];
  exitCode: number;
  durationMs: number;
};

export type Scanner = {
  name: string;
  run: (workspaceRoot: string, targetFiles: string[]) => Promise<ScanResult>;
};
```

### 組み込みスキャナーアダプター

#### Biome（既に devDependency にある）

```ts
// src/adapters/scanners/biomeScanner.ts
export const biomeScanner: Scanner = {
  name: "biome",
  run: async (workspaceRoot, targetFiles) => {
    const result = await runCommand(
      `bunx biome check --reporter=json ${targetFiles.join(" ")}`,
      { cwd: workspaceRoot },
    );
    return parseBiomeOutput(result);
  },
};
```

#### ESLint

```ts
// src/adapters/scanners/eslintScanner.ts
export const eslintScanner: Scanner = {
  name: "eslint",
  run: async (workspaceRoot, targetFiles) => {
    const result = await runCommand(
      `bunx eslint --format json ${targetFiles.join(" ")}`,
      { cwd: workspaceRoot },
    );
    return parseEslintOutput(result);
  },
};
```

#### カスタムスキャナー（config 駆動）

```ts
// src/adapters/scanners/customScanner.ts
export const createCustomScanner = (config: CustomScannerConfig): Scanner => ({
  name: config.name,
  run: async (workspaceRoot, targetFiles) => {
    const command = config.command
      .replace("{{files}}", targetFiles.join(" "));
    const result = await runCommand(command, { cwd: workspaceRoot });
    return parseGenericOutput(result, config);
  },
});
```

### 差分検出: `src/adapters/scanners/diffDetector.ts`

パッチ適用前後でスキャン結果を比較し、新規導入された findings のみを抽出する。

```ts
export const detectNewFindings = (
  before: ScanFinding[],
  after: ScanFinding[],
): ScanFinding[] => {
  const beforeKeys = new Set(
    before.map(f => `${f.file}:${f.ruleId}:${f.line}`)
  );
  return after.filter(f => !beforeKeys.has(`${f.file}:${f.ruleId}:${f.line}`));
};
```

ただしパッチ適用前のスキャン実行はコストが高いため、`baseline` モードとして:
- **full**: パッチ適用前後の両方をスキャン → 差分を取る（精密だが遅い）
- **post-only**: パッチ適用後のみスキャン → 全 findings をレポート（高速だが既存問題も含む）
- **cached**: 前回の baseline を `artifacts/` にキャッシュ → 差分を取る

### Judge 統合: `src/judges/scannerJudge.ts`

```ts
export const runScannerJudge = (
  scanResults: ScanResult[],
  scenario: ScenarioInput,
  config: HarnessConfig,
): JudgeResult => {
  const newErrors = scanResults
    .flatMap(r => r.findings)
    .filter(f => f.level === "error");

  const pass = newErrors.length === 0;
  const score = pass ? config.scoring.scannerWeight : 0;

  return parseJudgeResult({
    phase: "scanner",
    score,
    pass,
    reasons: [
      `${scanResults.length} scanner(s) executed`,
      `${newErrors.length} new error(s) detected`,
      ...newErrors.map(f => `[${f.source}] ${f.ruleId}: ${f.message} (${f.file}:${f.line})`),
    ],
  });
};
```

### config 拡張

```ts
export const ScannerConfigSchema = z.object({
  enabled: z.boolean().default(false),
  baseline: z.enum(["full", "post-only", "cached"]).default("post-only"),
  scanners: z.array(z.object({
    name: z.string().min(1),
    enabled: z.boolean().default(true),
    command: z.string().min(1),
    outputFormat: z.enum(["json", "sarif", "text"]).default("json"),
    timeoutMs: z.number().int().positive().default(30000),
  })).default([]),
  builtIn: z.object({
    biome: z.boolean().default(true),
    eslint: z.boolean().default(false),
  }).default({ biome: true, eslint: false }),
}).strict();

// scoring に追加
scannerWeight: z.number().int().nonnegative().default(0),
```

`scannerWeight` のデフォルトは `0`（後方互換: スキャナー無効時にスコアに影響しない）。
有効化時は他の weight を調整するガイダンスを README に記載。

### pipeline.ts への統合位置

DiffGuard の直後、syntax/behavior judge の前に実行する:

```
generate → apply → diffGuard → [scanners] → syntaxJudge → behaviorJudge → ...
```

スキャナーの findings が blocking 相当（error 件数 > 閾値）であれば、syntax/behavior をスキップ可能にする（config で制御）。

### SARIF レポートへの統合

スキャナーの findings は既存の SARIF レポーターに統合可能。
`ScanFinding` → SARIF `Result` への変換を `sarifReporter.ts` に追加。

## 変更対象ファイル

| ファイル | 変更内容 |
|----------|----------|
| `src/adapters/scanners/types.ts` | 新規: Scanner インターフェース定義 |
| `src/adapters/scanners/biomeScanner.ts` | 新規: Biome アダプター |
| `src/adapters/scanners/eslintScanner.ts` | 新規: ESLint アダプター |
| `src/adapters/scanners/customScanner.ts` | 新規: カスタムスキャナー |
| `src/adapters/scanners/diffDetector.ts` | 新規: 前後差分検出 |
| `src/adapters/scanners/runner.ts` | 新規: 全スキャナーの並列実行 |
| `src/judges/scannerJudge.ts` | 新規: スキャナー結果の判定 |
| `src/runner/pipeline.ts` | スキャナー実行ステップ追加 |
| `src/schemas/config.ts` | `ScannerConfigSchema` 追加 |
| `src/schemas/domain.ts` | `JudgePhaseSchema` に `"scanner"` 追加 |
| `src/reporters/sarifReporter.ts` | スキャナー findings の SARIF 変換 |
| `test/unit/scanners/diffDetector.test.ts` | 新規 |
| `test/unit/judges/scannerJudge.test.ts` | 新規 |
| `test/contract/scanners/biome.contract.test.ts` | 新規 |

## テスト計画

1. `detectNewFindings` の単体テスト（追加/削除/移動の各パターン）
2. Biome アダプターの出力パーステスト（JSON 出力のサンプル）
3. カスタムスキャナーのコマンド構築テスト
4. `scannerJudge` のスコア計算テスト（0件/N件のエラー）
5. pipeline 統合テスト（スキャナー有効/無効の切り替え）

## マイルストーン

1. Scanner インターフェースと `ScannerConfigSchema` の定義
2. Biome スキャナーアダプターの実装
3. `diffDetector` + `scannerJudge` の実装
4. `pipeline.ts` への統合
5. カスタムスキャナー対応
6. SARIF レポートへの統合
7. ESLint アダプター（optional、プロジェクトに ESLint がある場合のみ）
