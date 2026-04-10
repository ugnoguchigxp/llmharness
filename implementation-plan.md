# llmharness 実装計画（TypeScript + Bun + Biome + Zod）

- 作成日: 2026-04-10
- 対象: `llmharness`
- 技術方針: TypeScript を主言語、ランタイム/パッケージマネージャは Bun、静的解析/整形は Biome、型契約は Zod Schema を正本化

## 1. 実装方針

- ハーネス本体は TypeScript で実装し、実行は `bun run` を標準化する
- 型は TypeScript interface 先行ではなく Zod Schema 先行で定義し、`z.infer` で型を生成する
- 外部連携（`localLlm` / `Astmend` / `diffGuard`）は Adapter 層で抽象化し、契約テストで破壊的変更を検知する
- シナリオ実行は `runner` に集約し、評価ロジック（Judge）とレポート生成（Reporter）を分離する
- 品質ゲートは `Biome + test + smoke eval` を CI で強制する

## 2. 初期セットアップ計画

### 2.1 プロジェクト初期化

1. `bun init` で初期化
2. `tsconfig.json` を作成（strict 有効、`moduleResolution: bundler`）
3. `src/cli.ts` をエントリポイントにし、`bun run llmharness` を実行可能にする
4. ディレクトリを以下で作成する

```text
llmharness/
  src/
    cli.ts
    index.ts
    schemas/
      index.ts
      domain.ts
      config.ts
      scenario.ts
  adapters/
  runner/
  judges/
  reporters/
  scenarios/
    smoke/
    regression/
    edge-cases/
  test/
    unit/
    integration/
  configs/
  docs/
```

### 2.2 Biome 導入

1. `bun add zod && bun add -d @biomejs/biome typescript`
2. `biome.json` を作成し、以下を有効化
- formatter
- linter（推奨ルール + import 整理）
- organizeImports
3. `package.json` scripts（Bun 実行）
- `lint`: `biome check .`
- `lint:fix`: `biome check . --write`
- `format`: `biome format . --write`
- `typecheck`: `tsc --noEmit`
- `test`: `bun test`
- `smoke`: `bun run src/cli.ts run --scenario smoke-001`

## 3. 実装フェーズ

## Phase 0: 基盤整備（1週目）

目的: CLI 骨格と実行基盤を Bun 上で安定化

タスク:
1. CLI コマンド骨格実装（`run` / `eval` / `report`）
2. Zod Schema 基盤実装（domain/config/scenario の parse 関数）
3. 設定ローダ実装（`configs/harness.config.json` を Zod で検証）
4. 実行コンテキスト（作業ディレクトリ、タイムアウト、ログID）定義
5. Biome と bun test を pre-commit/CI で実行

完了条件:
- `bun run src/cli.ts run --scenario smoke-001` がダミーシナリオで完走
- `bun run lint` と `bun test` が通る
- 不正な config/scenario を Zod が起動時に検出できる

## Phase 1: Adapter 最小実装（2週目）

目的: 3連携（生成・適用・リスク評価）を最小E2Eで接続

タスク:
1. `adapters/localllm.ts`
- OpenAI 互換 API クライアント
- CLI フォールバック（`gemma4`）
- タイムアウト/リトライ/失敗分類
2. `adapters/astmend.ts`
- パッチ適用リクエスト
- 適用可否、失敗位置、エラーメッセージ標準化
3. `adapters/diffguard.ts`
- diff 入力から JSON 評価結果取得
- `error/warn/info` 正規化
4. Adapter 契約テスト作成（モック + 実機スモーク）

完了条件:
- 5シナリオで「生成→適用→リスク評価」がクラッシュなし
- Adapter 入出力が Zod parse を通過する

## Phase 2: 判定・採点（3週目）

目的: 判定可能な評価パイプラインを完成

タスク:
1. `runner/pipeline.ts` で実行ステップ統合
2. `judges/syntaxJudge.ts`
- TypeScript コンパイル/型整合判定
3. `judges/behaviorJudge.ts`
- 必須テスト通過判定
4. `judges/riskJudge.ts`
- diffGuard 結果から減点/失格判定
5. 総合スコア算出（100点満点、合格閾値80）

完了条件:
- 20シナリオを採点付きで実行できる
- 失敗時に原因分類（生成/適用/レビュー/テスト）を必ず出力

## Phase 3: レポート・運用（4週目）

目的: 再現可能な証跡出力と CI 運用

タスク:
1. `reporters/jsonReporter.ts`（正本）
2. `reporters/markdownReporter.ts`
3. `reporters/sarifReporter.ts`
4. 実行IDごとの成果物保存設計（logs, diff, score, reason）
5. CI 定義
- `bun run lint`
- `bun run typecheck`
- `bun test`
- `bun run smoke`

完了条件:
- PR ごとに smoke eval が自動実行
- すべてのシナリオで評価証跡を保存

## 4. 標準I/F定義（先に固定する）

- `GenerateResultSchema`: 提案パッチ、補足説明、トークン情報
- `ApplyResultSchema`: success, patchedFiles, rejects, diagnostics
- `RiskResultSchema`: levelCounts, findings, blocking
- `JudgeResultSchema`: score, pass, reasons, phase
- `ScenarioResultSchema`: scenarioId, durationMs, artifacts, finalDecision

ポイント:
- この I/F を早期固定し、内部実装差し替えを容易にする
- 実行時は必ず `schema.parse(...)` を通し、暗黙的な型崩れを防ぐ
- 破壊的変更は `docs/scenario-spec.md` と契約テストを同時更新

## 5. Biome 運用ルール

- PR 前に `bun run lint` を必須
- 自動修正可能なものは `bun run lint:fix` を使用
- import 整理と format は Biome に一本化（Prettier/ESLint は導入しない）
- CI では `biome check .` を `--write` なしで実行
- Schema 変更時は `test/unit/schemas/*.test.ts` を必須更新

## 6. CI/CD 設計（最小）

- トリガ: pull_request, push(main)
- ジョブ:
1. setup Bun
2. `bun install --frozen-lockfile`
3. `bun run lint`
4. `bun run typecheck`
5. `bun test`
6. `bun run smoke`
- キャッシュ: `~/.bun/install/cache` を有効化

## 7. 直近2週間の着手順

1. Bun + TS + Biome + Zod の初期化
2. CLI 骨格 (`run/eval/report`) 実装
3. `src/schemas/*` の正本スキーマ作成
4. `localllm` Adapter 実装
5. `astmend` Adapter 実装
6. `diffguard` Adapter 実装
7. `pipeline.ts` に最小E2E統合
8. smoke シナリオ5件作成
9. CI に lint/typecheck/test/smoke 追加

## 8. 受け入れ基準

- `bun run src/cli.ts eval --suite smoke` が再現実行可能
- 20シナリオ以上で採点と失敗分類を出力
- JSON/Markdown/SARIF レポートを生成
- CI 上で `lint + typecheck + unit + smoke` が常時実行
- 外部連携障害時に原因フェーズが特定可能
- 主要入出力がすべて Zod で実行時検証される
