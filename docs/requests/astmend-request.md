# 依頼書: Astmend（Apply結果の診断性強化）

## 背景

Orchestrator が再試行ループを回すには、`apply` 失敗の理由を機械可読で受け取る必要があります。現在の結果でも最低限の判定は可能ですが、再生成に使える粒度の失敗理由が不足しやすいです。

## 依頼内容（MVP）

1. Apply失敗理由の構造化
2. Reject の分類コード化
3. diagnostics の標準化
4. 変更差分の返却を安定化

## 期待I/F

レスポンス例:

```json
{
  "success": false,
  "patchedFiles": [],
  "rejects": [
    {
      "path": "src/foo.ts",
      "reason": "SYMBOL_NOT_FOUND",
      "hunk": "@@ ..."
    }
  ],
  "diagnostics": [
    "target function not found: updateUser"
  ],
  "diff": ""
}
```

`reason` の最小分類:

1. `SYMBOL_NOT_FOUND`
2. `INVALID_PATCH_SCHEMA`
3. `FILE_NOT_FOUND`
4. `CONFLICT`
5. `UNKNOWN`

## 受入基準（DoD）

1. 失敗時に `rejects` が空配列にならない
2. すべての reject が分類コードを持つ
3. 成功時に `diff` と `patchedFiles` の整合が取れる
4. CLI/API/LIB の各モードで戻り値契約が一致する
5. 契約テストで mode 間差分が検知可能

## 成果物

1. 戻り値契約の統一
2. 契約テスト追加
3. 失敗コードのドキュメント化
