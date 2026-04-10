# 依頼書: llmharness（Orchestrator強化）

## 背景

現状の `llmharness` は `generate -> apply -> review -> judge` の単発実行が中心で、`review NG -> generate 再実行` の制御ループがありません。構造は成立しているため、次の改善は「制御ロジックの深さ」が主対象です。

## 依頼内容（MVP）

1. 再試行ループの導入
2. 試行状態（state）管理の導入
3. DiffGuard/Astmend の失敗情報を localLlm 入力へ戻すフィードバック生成
4. 各試行の成果物を保存（再現可能性の担保）

## 実装要件

1. `maxAttempts`（例: 3）を設定化する
2. ループ条件を明示する
3. 成功停止条件を明示する
4. 失敗停止条件を明示する

想定 state:

```ts
type OrchestratorState = {
  attempt: number;
  maxAttempts: number;
  lastPatch?: string;
  lastApplyRejects: Array<{ path: string; reason: string }>;
  lastRiskFindings: Array<{ id: string; level: "error" | "warn" | "info"; message: string; file?: string; line?: number }>;
  feedbackForNextPrompt?: string;
};
```

## 期待I/F

localLlm へ渡す入力に `feedback` を追加:

```ts
{
  scenario,
  memoryContext,
  feedback: {
    attempt: 2,
    previousIssues: [...],
    previousRejects: [...]
  }
}
```

## 受入基準（DoD）

1. `review.blocking=true` のとき、同一 scenario 内で再生成が実行される
2. `apply.success=false` のとき、reject 理由を含む再生成が実行される
3. `attempt` ごとの中間結果が `artifacts` に保存される
4. `maxAttempts` 到達時は `error` ではなく説明付き `fail` を返せる
5. 既存シナリオ実行を壊さない（後方互換）

## 成果物

1. Orchestrator 実装
2. 設定スキーマ更新
3. ループ動作を検証するテスト（unit/integration）
4. 運用ドキュメント更新
