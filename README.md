# llmharness

**LLM が生成したコードパッチを自動で「適用 → レビュー → テスト → 評価」する、自己修正ループ型の評価ハーネス。**

ローカル LLM が生成したパッチを Astmend で適用し、diffGuard でリスク審査し、TypeCheck / テスト / 要件適合度で多角的にスコアリング。失敗したら前回のフィードバック付きで再生成を指示し、成功したら Gnosis ナレッジグラフに知識として蓄積する ── 人間の介入なくコード品質を自律的に改善し続けるフレームワークです。

```
┌─────────────────────────────────────────────────────────────┐
│                     llmharness Pipeline                     │
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌────────┐│
│  │ Generate │───▸│  Apply   │───▸│  Review  │───▸│ Judge  ││
│  │ (LLM)    │    │(Astmend) │    │(diffGuard│    │(multi) ││
│  └──────────┘    └──────────┘    └──────────┘    └────────┘│
│       ▲                                              │     │
│       │          ◀── feedback ──                     │     │
│       └──────────────────────────────────────────────┘     │
│                                                             │
│  On pass ──▸ Gnosis (Knowledge Graph + KnowFlow Task)      │
│  On fail ──▸ Gnosis (Failure Lesson)                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 目次

- [特長](#特長)
- [アーキテクチャ](#アーキテクチャ)
- [クイックスタート](#クイックスタート)
- [設定](#設定)
- [CLI コマンド一覧](#cli-コマンド一覧)
- [パイプラインの詳細](#パイプラインの詳細)
- [Adapter 層](#adapter-層)
- [Requirements Layer](#requirements-layer)
- [Gnosis メモリ統合](#gnosis-メモリ統合)
- [MCP Server 設定](#mcp-server-設定)
- [Run Index（全文検索）](#run-index全文検索)
- [テスト](#テスト)
- [プロジェクト構造](#プロジェクト構造)

---

## 特長

| 機能 | 概要 |
|---|---|
| **自己修正ループ** | 失敗時に過去のリジェクト理由・リスク指摘をフィードバックとして LLM に渡し、`maxAttempts` まで自動リトライ |
| **マルチジャッジ評価** | Syntax / Behavior(テスト) / Risk / Requirements / Golden Patch の 5 軸 + ペルソナレビュー |
| **パッチ形式の自動判定** | Astmend JSON / Unified Diff / file-replace を自動識別して適切なアプライヤーに委譲 |
| **要件駆動テスト** | `requirements.json` で成功基準・制約・レビュアーペルソナを定義し、LLM/キーワードで適合度を評価 |
| **実行アーティファクト** | 各試行ごとに `attemptN.patch` / `attemptN.json` を保存し、完全な再現性を保証 |
| **Gnosis 連携** | 成功パッチは Knowledge Graph + KnowFlow タスクキューに、失敗は Failure Lesson として自動蓄積 |
| **Run 全文検索** | SQLite FTS5 によるシナリオ実行結果のインデックスと高速検索 |
| **Schema-First** | Zod による入出力契約の実行時検証。型安全性とランタイム安全性を両立 |

---

## アーキテクチャ

```
src/
├── adapters/           # 外部コンポーネントとの統合境界
│   ├── localllm.ts     #   LLM (API / CLI)
│   ├── astmend.ts      #   パッチ適用 (API / CLI / Lib)
│   ├── diffguard.ts    #   リスクレビュー (API / CLI)
│   ├── patchRouter.ts  #   パッチ形式の自動判定・ルーティング
│   ├── codeReviewer.ts #   コードレビュー
│   └── personaReviewer.ts # ペルソナ視点レビュー
├── runner/
│   ├── pipeline.ts     # フェーズオーケストレーション & スコアリング
│   └── scenarioRunner.ts # シナリオ読み込み & 実行制御
├── judges/             # 各軸の評価ロジック
├── schemas/            # Zod スキーマ（Config / Scenario / Domain）
├── services/
│   └── memoryService.ts # Gnosis 連携サービス
├── storage/
│   └── runIndex.ts     # SQLite + FTS5 実行インデックス
├── reporters/          # JSON / Markdown / SARIF レポート生成
├── requirements/       # 要件ローダー / リビジョンサジェスター
├── context/            # ソースコードコンテキスト収集
└── cli.ts              # コマンドラインインターフェース
```

**設計原則:**
- **Schema-First** — Zod パースをランタイム境界に配置し、契約違反を即座に検出
- **Adapter 分離** — 外部ツールの変更がパイプライン本体に波及しない疎結合設計
- **再現性** — 全試行のパッチ / 判定結果 / 状態をアーティファクトとして永続化

---

## クイックスタート

### 前提条件

- [Bun](https://bun.sh) v1.x
- TypeScript 6.x
- Gnosis メモリ統合を使う場合: [Gnosis](../gnosis) + PostgreSQL

### セットアップ

```bash
# 依存関係のインストール
bun install

# 接続確認（Adapter の疎通 + requirements 整合性チェック）
bun run doctor
```

### 実行

```bash
# 単一シナリオの実行
bun run src/cli.ts run --scenario smoke-001

# スイート評価
bun run src/cli.ts eval --suite smoke

# 最新レポートの確認
bun run src/cli.ts report --latest
```

---

## 設定

`configs/` ディレクトリにサンプル設定を同梱しています。

| ファイル | 用途 |
|---|---|
| `harness.config.json` | 実運用設定 |
| `harness.config.cli.example.json` | CLI モードのサンプル |
| `harness.config.api.example.json` | API モードのサンプル |

### 主要な設定項目

```jsonc
{
  "adapters": {
    "localLlm": {
      "mode": "cli",           // "api" | "cli"
      "command": "gemma4 --prompt {{prompt}}",
      "timeoutMs": 180000      // 初回のモデルロードが重い場合は長めに
    },
    "astmend": {
      "mode": "lib",           // "api" | "cli" | "lib" (推奨)
      "patchFormat": "auto"    // 自動判定
    },
    "diffGuard": {
      "mode": "cli"            // "api" | "cli"
    },
    "memory": {
      "enabled": true,         // Gnosis 連携の有効化
      "gnosisPath": "../gnosis",
      "sessionId": "my-project"
    }
  },
  "orchestrator": {
    "maxAttempts": 3           // 自動リトライ回数
  },
  "scoring": {
    "passThreshold": 80        // 合格スコア
  }
}
```

---

## CLI コマンド一覧

| コマンド | 説明 |
|---|---|
| `run --scenario <id>` | 単一シナリオを実行 |
| `eval --suite <name>` | スイート内の全シナリオを一括評価 |
| `report --latest` | 最新の実行レポートを表示 |
| `search-runs --query <text>` | 過去の実行結果を全文検索 |
| `reindex-runs` | Run Index を再構築 |
| `commit-memory` | 検証 → Gnosis 同期 → Git コミット |
| `generate-scenario` | requirements から scenario JSON を生成 |
| `doctor` | Adapter 疎通 + requirements 整合性チェック |

### 使用例

```bash
# 要件定義付きで実行
bun run src/cli.ts run --scenario smoke-001 \
  --requirements-path requirements/smoke-001.requirements.json

# 全スイート評価
bun run src/cli.ts eval --suite all --config configs/harness.config.json

# 過去の失敗パターンを検索
bun run src/cli.ts search-runs --query "retry timeout" --limit 10

# 検証後に Gnosis へ同期してコミット & プッシュ
bun run src/cli.ts commit-memory --message "feat: 認証フロー修正" --push
```

---

## パイプラインの詳細

各シナリオは最大 `maxAttempts` 回のループで実行されます。

### 1. Generate（パッチ生成）
ローカル LLM にシナリオの指示文、コンテキスト（対象ファイル・テスト）、Gnosis からの過去知識（RAG）を渡してパッチを生成。2回目以降は前回の失敗フィードバックも含めます。

### 2. Apply（パッチ適用）
`patchRouter` がパッチ形式を自動判定し、適切なアプライヤー（Astmend / Unified Diff / file-replace）に委譲。リジェクトがあればフィードバックとして次回の生成に反映。

### 3. Review（リスク審査）
diffGuard がパッチの安全性を審査。ブロッキングな指摘があった場合、テスト・型チェックをスキップして即座に次の試行へ。

### 4. Judge（多軸評価）

| Judge | Weight | 内容 |
|---|---|---|
| Syntax | 30 | TypeCheck の合格判定 |
| Behavior | 30 | テスト実行の合格判定 |
| Risk | 20 | diffGuard のリスクスコア |
| Minimality | 10 | パッチの簡潔さ（変更ファイル数） |
| Instruction | 10 | 指示への準拠度 |

合計スコアが `passThreshold` を超え、かつ全ゲートが `pass` の場合に合格。

### 5. 停止と再試行
- **Pass**: 全ゲート通過で即座に成功終了。
- **Fail**: フィードバック（リジェクト / リスク指摘 / テスト失敗）を含めて再生成を指示。
- **maxAttempts 到達**: `finalDecision=fail` として記録。改善提案（Revision Suggestions）をレポートに追記。

---

## Adapter 層

外部ツールとの接続は全て Adapter パターンで抽象化。`api` / `cli` / `lib` を設定で切り替え可能です。

### localLlm
- **`api`**: OpenAI 互換 `/v1/chat/completions` エンドポイント
- **`cli`**: シェルコマンド実行。`{{prompt}}` のプレースホルダー置換または stdin 投入に対応
- **`fallbacks`**: primary が失敗した場合の順次フォールバック

### Astmend
- **`lib`** (推奨): `libEntrypoint` を直接 import
- **`api`**: HTTP エンドポイントへ POST
- **`cli`**: stdin にパッチを渡して実行。失敗時はライブラリフォールバック
- **`patchFormat`**: `auto` | `astmend-json` | `unified-diff` | `file-replace`

### diffGuard
- **`api`**: HTTP エンドポイントへ POST
- **`cli`**: stdin にパッチを渡して実行

> CLI の出力は JSON を優先解析。JSON がない場合は安全側（失敗または警告）で判定します。

---

## Requirements Layer

シナリオに **要件定義** を関連付けることで、生成されたパッチが目的に適合しているかを評価できます。

### 要件ファイルの例

```json
{
  "id": "smoke-001-req",
  "title": "Basic harness flow: smoke validation",
  "task": "Verify end-to-end pipeline execution without errors.",
  "constraints": ["Patch must apply cleanly"],
  "successCriteria": ["finalDecision is pass or fail", "Artifacts are created"],
  "reviewPersonas": [
    { "name": "CI Engineer", "role": "Infrastructure", "focus": ["pipeline reliability"] }
  ]
}
```

### 主な機能

| 機能 | 説明 |
|---|---|
| **Convention-based 自動探索** | `requirements/<scenarioId>.requirements.json` を自動検出 |
| **CLI フラグで上書き** | `--requirements-path` で一時的に別の要件を指定可能 |
| **SuccessCriteria Judge** | `keyword` / `llm` / `hybrid` モードで成功基準を判定（達成率 50% 以上で pass） |
| **Persona Review** | 定義されたペルソナごとに LLM にレビューを依頼。fail-safe 設計 |
| **Revision Suggester** | 失敗時に要件と judge 出力を照合して改善提案を自動生成 |
| **generate-scenario** | 要件ファイルからシナリオ JSON をスキャフォールド |

---

## Gnosis メモリ統合

[Gnosis](../gnosis) ナレッジグラフとの統合により、エージェントの自律的な学習ループを実現します。

### 有効化

```json
{
  "adapters": {
    "memory": {
      "enabled": true,
      "gnosisPath": "../gnosis",
      "sessionId": "my-project"
    }
  }
}
```

### 動作フロー

```
パイプライン実行
  ├─ 実行前: Gnosis から過去の解決策を RAG で取得 (recall)
  ├─ 失敗時: Failure Lesson として Gnosis に記録 (record-failure)
  └─ 成功時: commit-memory コマンドで以下を実行
       ├─ プロジェクト検証 (lint / test / typecheck)
       ├─ 検証済みパッチを Gnosis に同期 (ingest-verified)
       ├─ KnowFlow タスクキューに知識拡張を依頼 (enqueue-task)
       └─ Git commit & push
```

### commit-memory

```bash
# 基本用法
bun run src/cli.ts commit-memory

# メッセージ指定 + プッシュ
bun run src/cli.ts commit-memory --message "feat: 認証フロー修正" --push
```

---

## Run Index（全文検索）

各シナリオ実行後、結果は `artifacts/runs/run-index.sqlite` に自動インデックスされます。BM25 ランキングによる全文検索が可能です。

```bash
# 検索
bun run src/cli.ts search-runs --query "retry timeout" --limit 10

# インデックスの再構築
bun run src/cli.ts reindex-runs
```

---

## テスト

```bash
# 全テスト
bun test

# Adapter 契約テストのみ
bun run test:contract

# 型チェック + リント
bun run typecheck
bun run lint
```

### 契約テスト

`test/contract/` にて、Adapter の入出力契約を検証しています。

- **localLlm**: CLI payload / OpenAI 互換 API 応答の契約
- **Astmend**: `lib` エントリポイント / CLI フォールバック / 非0 exit の取り扱い
- **diffGuard**: `issues/findings` 正規化 / 非 JSON 出力時の安全側判定

---

## プロジェクト構造

```
llmharness/
├── configs/            # 設定ファイル (JSON)
├── scenarios/          # シナリオ定義
│   ├── smoke/          #   smoke テスト (5件)
│   ├── regression/     #   回帰テスト (8件)
│   └── edge-cases/     #   エッジケース (7件)
├── requirements/       # 要件定義ファイル
├── artifacts/          # 実行アーティファクト (gitignored)
├── src/                # ソースコード
├── test/               # テスト (契約テスト含む)
├── docs/               # 追加ドキュメント
│   ├── architecture.md
│   ├── operations.md
│   └── scenario-spec.md
└── README.md
```

---

## MCP Server 設定

`llmharness` のメモリ機能は [Gnosis](../gnosis) MCP Server を介して動作します。AI コーディングエージェント（Claude Code, Antigravity, Cursor, VS Code Copilot 等）から Gnosis の全機能を利用するための設定方法を記載します。

### Gnosis MCP Server の起動

```bash
# Gnosis ディレクトリで起動（STDIO トランスポート）
cd ../gnosis && bun run src/index.ts
```

### クライアント別設定

#### Claude Code（`.claude/settings.json` または `claude_desktop_config.json`）

```json
{
  "mcpServers": {
    "gnosis": {
      "command": "/Users/<username>/.bun/bin/bun",
      "args": ["run", "src/index.ts"],
      "cwd": "/Users/<username>/Code/gnosis",
      "env": {
        "DATABASE_URL": "postgres://postgres:postgres@localhost:7888/gnosis"
      }
    }
  }
}
```

#### Antigravity（`~/.gemini/antigravity/mcp_config.json`）

```json
{
  "mcpServers": {
    "gnosis": {
      "command": "/Users/<username>/.bun/bin/bun",
      "args": ["run", "src/index.ts"],
      "cwd": "/Users/<username>/Code/gnosis",
      "env": {
        "DATABASE_URL": "postgres://postgres:postgres@localhost:7888/gnosis"
      }
    }
  }
}
```

#### Cursor（`.cursor/mcp.json`）

```json
{
  "mcpServers": {
    "gnosis": {
      "command": "/Users/<username>/.bun/bin/bun",
      "args": ["run", "src/index.ts"],
      "cwd": "/Users/<username>/Code/gnosis",
      "env": {
        "DATABASE_URL": "postgres://postgres:postgres@localhost:7888/gnosis"
      }
    }
  }
}
```

#### VS Code Copilot（`~/.copilot/mcp-config.json`）

```json
{
  "mcpServers": {
    "gnosis": {
      "command": "/Users/<username>/.bun/bin/bun",
      "args": ["run", "src/index.ts"],
      "cwd": "/Users/<username>/Code/gnosis",
      "env": {
        "DATABASE_URL": "postgres://postgres:postgres@localhost:7888/gnosis"
      }
    }
  }
}
```

> **Note**: `<username>` はご自身のユーザー名に置き換えてください。`DATABASE_URL` は Gnosis 用の PostgreSQL 接続先です。

### 利用可能な MCP ツール一覧

Gnosis MCP Server が提供する全 18 ツールの概要です。

#### 記憶の保存・検索・削除

| ツール | 説明 | 主な引数 |
|---|---|---|
| `store_memory` | 観察・知見・レビュー結果をベクトルメモリ + KG に保存 | `sessionId`, `content`, `entities?`, `relations?` |
| `search_memory` | セマンティック検索（意味的類似度）で記憶を検索 | `sessionId`, `query`, `limit?`, `filter?` |
| `delete_memory` | 特定の記憶を ID 指定で削除（忘却操作） | `memoryId` |

#### ナレッジグラフ操作

| ツール | 説明 | 主な引数 |
|---|---|---|
| `query_graph` | エンティティを起点に最大 2 ホップの関連情報を取得（Graph RAG） | `query` |
| `digest_text` | テキスト中のキーワードに関連するグラフエンティティを検索・提案 | `text`, `limit?` |
| `update_graph` | エンティティの更新またはリレーションの削除 | `action`, `entity?`, `relation?` |
| `find_path` | 2 つのエンティティ間の最短経路を探索 | `queryA`, `queryB` |
| `build_communities` | グラフ全体を分析し、知識のクラスタ（コミュニティ）を検出 | *(引数なし)* |
| `reflect_on_memories` | 未処理の記憶を自動分析し、エンティティ・関係性を KG に統合 | *(引数なし)* |

#### 経験学習（llmharness 連携）

| ツール | 説明 | 主な引数 |
|---|---|---|
| `record_experience` | シナリオ実行の失敗・成功を構造化された教訓として記録 | `sessionId`, `scenarioId`, `attempt`, `type`, `content` |
| `recall_lessons` | 過去の類似失敗から解決策・教訓を検索 | `sessionId`, `query`, `limit?` |

#### KnowFlow（自律的知識拡張）

| ツール | 説明 | 主な引数 |
|---|---|---|
| `search_knowledge` | 蓄積された検証済み知識（claims）を全文検索 | `query`, `limit?` |
| `get_knowledge` | 特定トピックの詳細知識（クレーム・関連・情報源）を取得 | `topic` |
| `enqueue_knowledge_task` | トピックの調査・知識化タスクをキューに投入 | `topic`, `mode?`, `priority?` |
| `run_knowledge_worker` | キューから 1 タスクを取り出して実行 | `maxAttempts?` |

#### 統合検索

| ツール | 説明 | 主な引数 |
|---|---|---|
| `search_unified` | FTS / KG / Semantic を選択して検索 | `query`, `mode`, `limit?`, `sessionId?` |

#### ユーティリティ

| ツール | 説明 | 主な引数 |
|---|---|---|
| `sync_agent_logs` | Claude Code / Cursor 等の会話履歴を解析して一括同期 | *(引数なし)* |

### 使用例

以下は AI エージェントが Gnosis MCP ツールを活用する典型的なフローです。

```
1. 作業開始時
   └─ search_unified(query="認証フロー", mode="kg")    # 関連知識の把握
   └─ recall_lessons(query="auth middleware 失敗")      # 過去の教訓を取得

2. コードレビュー後
   └─ store_memory(content="JWTの有効期限...", entities=[...])  # 知見の保存

3. パッチ成功時
   └─ record_experience(type="success", content="...")  # 成功パターン記録
   └─ enqueue_knowledge_task(topic="JWT認証", mode="expand")  # 知識拡張

4. パッチ失敗時
   └─ record_experience(type="failure", content="...")  # 失敗パターン記録
   └─ search_unified(query="型エラー", mode="fts")      # 過去の解決策検索
```

---

## ライセンス

Private
