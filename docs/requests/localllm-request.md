# 依頼書: localLlm（修復モード入力の受理）

## 背景

再試行ループを成立させるため、localLlm 側で「前回失敗理由」を入力として受理し、次回パッチを改善できるようにする必要があります。

## 依頼内容（MVP）

1. repair モード用入力の受理
2. feedback をプロンプトへ安全に埋め込むテンプレート化
3. JSON厳格出力の維持

## 期待I/F

入力例:

```json
{
  "task": {
    "scenarioId": "smoke-001",
    "instruction": "..."
  },
  "feedback": {
    "attempt": 2,
    "previousRejects": [
      { "path": "src/foo.ts", "reason": "SYMBOL_NOT_FOUND" }
    ],
    "previousIssues": [
      { "id": "DG001", "level": "error", "message": "..." }
    ]
  }
}
```

出力要件:

1. 返却は Astmend operation JSON 1件のみ
2. 余計な説明文・Markdownを含めない
3. targetFiles 外の編集を最小化する

## 受入基準（DoD）

1. feedback あり/なしの双方で安定動作する
2. feedback あり時に同一ミスを反復しにくくなる
3. 既存 CLI/API 統合を壊さない
4. トークン増加が許容範囲内（運用閾値を定義）

## 成果物

1. repair モード入力仕様
2. プロンプトテンプレート更新
3. 回帰テスト（JSON厳格性・誤編集抑制）
