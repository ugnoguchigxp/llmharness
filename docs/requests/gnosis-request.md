# 依頼書: gnosis（失敗学習ループの知識化）

## 背景

現在の memory 連携は recall/ingest の基盤があります。次段では「何が失敗し、何で成功したか」を再利用可能な形で保存し、次回生成に効く知識へ変換することが必要です。

## 依頼内容（MVP）

1. 失敗イベントの構造化保存
2. 成功パッチとの関連付け
3. 類似失敗に対する recall 精度向上

## 期待I/F

記録スキーマ例:

```json
{
  "scenarioId": "smoke-001",
  "attempt": 2,
  "failureType": "RISK_BLOCKING",
  "riskFindings": [
    { "id": "DG001", "level": "error", "message": "...", "ruleId": "API_BREAK" }
  ],
  "applyRejects": [],
  "patchDigest": "sha256:...",
  "timestamp": "2026-04-10T12:00:00.000Z"
}
```

## 受入基準（DoD）

1. 失敗記録が scenario 単位で追跡可能
2. 成功時に「どの失敗パターンを克服したか」をリンクできる
3. recall が「類似失敗 + 有効だった修正方針」を返せる
4. セッション混在時にデータ汚染しない
5. ingest/recall の実行失敗時ハンドリングが明示される

## 成果物

1. failure/success 関連スキーマ
2. 類似検索ロジック改善
3. 運用ドキュメント更新（保存ポリシーと再現手順）
