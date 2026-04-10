# llmharness プロジェクト計画書

- 作成日: 2026-04-10
- 対象: 新規プロジェクト `llmharness` 立ち上げ
- 前提連携先: `Astmend`, `diffGuard`, `localLlm`

## 1. 背景と目的

LLM の出力品質を実運用レベルに引き上げるため、以下を一貫して検証できるハーネス基盤を整備する。

- 生成した修正案が「適用可能」か
- 適用後の差分が「安全」か
- 修正後のコードが「正しい」か（型・テスト・ルール）
- 評価結果を再現可能な形で保存できるか

本計画では、既存プロジェクトを物理統合せず、**新規のハーネス専用プロジェクト**を作成して集約利用する。

## 2. 方針（採用アーキテクチャ）

### 2.1 採用方針

- `llmharness` を新規作成する
- `Astmend` / `diffGuard` / `localLlm` は独立リポジトリのまま利用する
- ハーネスは Adapter 層で外部コンポーネントを呼び出す

### 2.2 採用理由

- 各リポジトリの責務が明確で衝突を避けられる
- Python/TypeScript/Bun の実行環境を分離しやすい
- 各コンポーネントの更新を独立して追従できる
- 検証基盤（評価シナリオ・採点）に集中できる

## 3. スコープ

### 3.1 In Scope

- シナリオ実行ランナー
- LLM 生成アダプタ（`localLlm` 連携）
- パッチ適用アダプタ（`Astmend` 連携）
- リスク評価アダプタ（`diffGuard` 連携）
- 型チェック/テスト実行アダプタ
- 評価レポート出力（JSON/Markdown/SARIF）
- ベースライン比較（モデル/プロンプト/設定）

### 3.2 Out of Scope（初期）

- GUI ダッシュボード
- 分散実行基盤（k8s等）
- 大規模データレイク統合
- 本番デプロイ自動化

## 4. 成果物

- `llmharness` リポジトリ
- ハーネスCLI（例: `llmharness run`, `llmharness eval`, `llmharness report`）
- シナリオ定義セット（最小20件）
- 判定ルール（成功条件/失敗分類）
- CI 定義（最小: lint + unit + smoke eval）
- 運用ドキュメント（セットアップ、実行、障害対応）

## 5. 目標KPI

初期 KPI（PoC 完了時点）:

- 実行再現率: 同条件再実行で 95% 以上同一判定
- パイプライン成功率: 20シナリオ中 80% 以上完走
- 評価時間: 1シナリオあたり 120秒以内（ローカル標準環境）
- レポート完全性: 全シナリオで「生成→適用→レビュー→検証」の証跡を100%保存

## 6. リポジトリ構成案

```text
llmharness/
  README.md
  docs/
    architecture.md
    operations.md
    scenario-spec.md
  configs/
    harness.config.json
    models/
      gemma4-default.json
  scenarios/
    smoke/
    regression/
    edge-cases/
  adapters/
    astmend.ts
    diffguard.ts
    localllm.ts
    testRunner.ts
  judges/
    syntaxJudge.ts
    behaviorJudge.ts
    riskJudge.ts
  runner/
    pipeline.ts
    scenarioRunner.ts
  reporters/
    jsonReporter.ts
    markdownReporter.ts
    sarifReporter.ts
  scripts/
    setup.sh
    smoke.sh
  src/
    cli.ts
    index.ts
  test/
    unit/
    integration/
```

## 7. 実行フロー（1シナリオ）

1. シナリオ読込（課題文・対象ファイル・期待条件）
2. `localLlm` に修正提案を要求
3. `Astmend` で構造的にパッチ適用（メモリ上）
4. 生成 diff を `diffGuard` で評価
5. 型チェック/テスト実行
6. Judge が総合判定（pass/fail + 理由）
7. レポート保存（実行ログ、diff、判定根拠）

## 8. 連携インターフェース方針

### 8.1 localLlm

- 優先: OpenAI互換API（`/v1/chat/completions`）
- 代替: `gemma4` CLI（`--prompt` / `--session-id`）

### 8.2 Astmend

- 優先: ライブラリ呼び出し
- 代替: MCP 経由で `apply_patch_*`

### 8.3 diffGuard

- 優先: CLI もしくは MCP の `review_diff`
- 出力は JSON を正本とし、必要に応じ SARIF に変換

## 9. 評価モデル（判定基準）

総合スコア = 100点満点

- 構文/型整合: 30点
- テスト通過: 30点
- リスク（DiffGuard）: 20点
- 変更最小性（過剰変更抑制）: 10点
- 指示遵守（要件適合）: 10点

合格条件（初期）:

- 総合 80点以上
- かつ重大リスク（error）が 0 件
- かつ必須テストが全通過

## 10. 開発フェーズ計画

### Phase 0: キックオフ（2026-04-13 〜 2026-04-17）

- リポジトリ作成
- 実行環境統一（Node/Bun/Pythonバージョン固定）
- Adapter のI/F定義
- 最小CLIひな形

完了条件:

- `llmharness run --scenario smoke-001` が空実行で完走

### Phase 1: 最小E2E（2026-04-20 〜 2026-05-01）

- localLlm/Astmend/diffGuard の3連携
- 5シナリオで E2E 実行
- JSON レポート出力

完了条件:

- 5シナリオ連続実行でクラッシュ 0

### Phase 2: 判定強化（2026-05-04 〜 2026-05-15）

- Judge 実装（型・テスト・リスク）
- スコアリング導入
- Markdown/SARIF 出力

完了条件:

- 20シナリオを採点付きで再現実行可能

### Phase 3: CI運用化（2026-05-18 〜 2026-05-22）

- CI 組込み（smoke + 主要ユニット）
- 失敗時のトリアージテンプレート
- 運用手順書整備

完了条件:

- PRごとに smoke eval が自動実行される

## 11. 役割分担（最小体制）

- Tech Lead: 判定設計、採点基準、品質ゲート定義
- Harness Dev: ランナー、アダプタ、レポーター実装
- Scenario Author: シナリオ設計、期待値メンテナンス
- Ops/QA: CI、再現検証、失敗分析

## 12. リスクと対策

- リスク: LLM 応答の揺らぎで判定が不安定
  - 対策: 温度固定、複数回実行中央値、失敗分類を分離
- リスク: 外部3プロジェクトの更新で互換崩れ
  - 対策: Adapter に契約テストを用意
- リスク: 評価時間が長く運用負荷が高い
  - 対策: smoke/regression の2段階実行
- リスク: シナリオ期待値の腐敗
  - 対策: 月次メンテナンスとベースライン再生成

## 13. 受け入れ基準（Definition of Done）

- 新規環境でセットアップ手順のみで実行可能
- 20シナリオ以上が `llmharness eval` で完走
- 各シナリオの判定理由がレポートに明記される
- 失敗時に原因分類（生成/適用/レビュー/テスト）が必ず付く
- CIで smoke シナリオが自動実行される

## 14. 初期バックログ（着手順）

1. `llmharness` リポジトリ初期化（Node + TypeScript）
2. `adapters/localllm.ts` 作成（API/CLI両対応）
3. `adapters/astmend.ts` 作成（適用結果を標準化）
4. `adapters/diffguard.ts` 作成（リスク結果を標準化）
5. `runner/pipeline.ts` で1シナリオE2E
6. `reporters/jsonReporter.ts` で証跡保存
7. smokeシナリオ5件作成
8. CIに smoke 実行追加

## 15. 開始時の技術決定（推奨）

- 言語: TypeScript
- 実行: Node.js LTS（必要に応じ Bun 互換）
- テスト: Vitest
- 設定: JSON（将来YAML対応）
- ログ: JSON Lines（追跡容易）
- パッケージ管理: pnpm

---

この計画書は「新規プロジェクト立ち上げ用の初版」です。  
キックオフ後は Phase 0 の実測結果を反映して、2026-04-17 時点で改訂版（v1.1）を作成する。

