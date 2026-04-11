# Tier 1-3: ベンチマークダッシュボード

## 背景と目的

llmharness は JSON / Markdown / SARIF のレポートを生成しているが、これらは単一実行のスナップショットに過ぎない。
LLM モデルの比較、プロンプト改善の効果測定、品質の回帰検出には、複数の実行結果を時系列で俯瞰できるダッシュボードが必要。

本計画では、`artifacts/runs/` に蓄積されたレポートを集約し、ブラウザで閲覧できるダッシュボードを構築する。

## ゴール

- 過去の実行結果を集約し、時系列の品質推移を可視化する
- シナリオ別・スイート別のスコア分布と pass 率を表示する
- 試行回数・所要時間のトレンドを表示する
- `bun run dashboard` で起動できる

## 設計

### データ集約: `src/dashboard/aggregator.ts`

`artifacts/runs/*/result.json` を走査し、集約データを構築する。

```ts
export type RunSummary = {
  runId: string;
  scenarioId: string;
  suite: string;
  finalDecision: FinalDecision;
  totalScore: number;
  attemptCount: number;
  durationMs: number;
  timestamp: string;       // runId から抽出（ISO8601 prefix）
  requirementsStatus?: string;
  tokenUsage?: TokenUsage;
};

export type DashboardData = {
  generatedAt: string;
  runs: RunSummary[];
  scenarioStats: Map<string, ScenarioStats>;
  suiteStats: Map<string, SuiteStats>;
};
```

### サーバー: `src/dashboard/server.ts`

Bun.serve() でシンプルな HTTP サーバーを立てる。

```ts
Bun.serve({
  port: 3939,
  routes: {
    "/": indexHtml,
    "/api/dashboard": {
      GET: async () => {
        const data = await aggregateDashboardData(artifactsDir);
        return Response.json(data);
      },
    },
  },
  development: { hmr: true, console: true },
});
```

### フロントエンド: `src/dashboard/index.html` + `src/dashboard/app.tsx`

React + 軽量チャートライブラリで構築。Bun の HTML imports を活用。

#### ページ構成

| セクション | 内容 |
|------------|------|
| Overview | 直近 N 回の pass/fail/error 件数、平均スコア |
| Score Trend | 時系列の折れ線チャート（全シナリオ平均 + 個別） |
| Pass Rate | スイート別の棒グラフ |
| Attempt Distribution | 試行回数のヒストグラム |
| Duration Trend | 所要時間の推移 |
| Scenario Table | 全シナリオの最新結果一覧（ソート・フィルタ対応） |
| Run Detail | 個別実行の詳細（judges, requirements, persona reviews） |

#### チャートライブラリ

軽量性を重視し、`<canvas>` ベースのライブラリを使う。候補:
- **Chart.js**: 広く使われており、バンドルサイズも許容範囲
- **uPlot**: 超軽量・高速（時系列に強い）

最初は Chart.js で実装し、パフォーマンス要件が出れば uPlot に切り替え可能な抽象層を設ける。

### CLI 統合

`src/cli.ts` に `dashboard` サブコマンドを追加:

```
bun run src/cli.ts dashboard [--port 3939] [--config <path>]
```

`package.json` にショートカット追加:

```json
"dashboard": "bun run src/cli.ts dashboard"
```

### 静的エクスポート（オプション）

CI 用に、ダッシュボードを静的 HTML としてエクスポートする機能も用意する:

```
bun run src/cli.ts dashboard --export artifacts/dashboard.html
```

API レスポンスを JSON としてインラインし、サーバー不要で閲覧可能にする。

## 変更対象ファイル

| ファイル | 変更内容 |
|----------|----------|
| `src/dashboard/aggregator.ts` | 新規: result.json の集約ロジック |
| `src/dashboard/server.ts` | 新規: Bun.serve() によるダッシュボードサーバー |
| `src/dashboard/index.html` | 新規: HTML エントリポイント |
| `src/dashboard/app.tsx` | 新規: React ダッシュボード UI |
| `src/dashboard/components/*.tsx` | 新規: チャート・テーブルコンポーネント |
| `src/cli.ts` | `dashboard` サブコマンド追加 |
| `package.json` | `dashboard` スクリプト追加、chart.js 依存追加 |
| `test/unit/dashboard/aggregator.test.ts` | 新規: 集約ロジックのテスト |

## テスト計画

1. `aggregateDashboardData` の単体テスト（空ディレクトリ / 正常データ / 不正 JSON）
2. `RunSummary` への変換テスト（各フィールドの抽出・デフォルト値）
3. API エンドポイントの契約テスト（レスポンス形式の検証）
4. 静的エクスポートの出力検証

## マイルストーン

1. `aggregator.ts` の実装とテスト
2. `server.ts` + API エンドポイント
3. フロントエンド: Overview + Score Trend
4. フロントエンド: Scenario Table + Run Detail
5. CLI 統合（`dashboard` コマンド）
6. 静的エクスポート機能
7. `package.json` への依存追加と scripts 追加
