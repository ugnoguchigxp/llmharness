# 依頼書: DiffGuard（レビュー結果の再生成利用性強化）

## 背景

Orchestrator の再試行品質は、DiffGuard が返す指摘の機械可読性に依存します。`blocking` の真偽だけでは、次の修正指示を高精度に作れません。

## 依頼内容（MVP）

1. 指摘フォーマットの正規化
2. `blocking` 判定理由の明示
3. 修正ガイド情報（remediation hint）の付与

## 期待I/F

レスポンス例:

```json
{
  "blocking": true,
  "levelCounts": { "error": 1, "warn": 2, "info": 0 },
  "findings": [
    {
      "id": "DG001",
      "level": "error",
      "message": "public API changed without migration note",
      "file": "src/index.ts",
      "line": 42,
      "ruleId": "API_BREAK",
      "metadata": {
        "blockingReason": "api-compatibility",
        "remediation": "restore original signature or add adapter layer"
      }
    }
  ]
}
```

## 受入基準（DoD）

1. `blocking=true` のとき、少なくとも1件の `error` finding に判定理由が付く
2. finding ごとに `id/level/message` が必須で欠損しない
3. 非JSON出力時の安全側挙動を維持しつつ、可能な範囲で構造化変換される
4. 既存 CLI/API の互換を壊さない
5. 契約テストに `metadata.remediation` 利用ケースが追加される

## 成果物

1. 出力契約拡張
2. ルール別 remediation 文言
3. 契約テスト更新
