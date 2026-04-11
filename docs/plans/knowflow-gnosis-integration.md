# knowFlow 作業指示書: Bun 移行 + Gnosis 知識委譲

## 背景と目的

現在の knowFlow は以下の問題を抱えている：

- ランタイムが `tsx`（Node）であり、エコシステムが Bun に統一されていない
- `PgKnowledgeRepository` が PostgreSQL に直接接続しており、知識の所有権が分散している

本作業により以下のアーキテクチャに移行する：

```
knowFlow
  ├─ キュー操作  ──▶ Gnosis PostgreSQL（直接接続・既存の PgJsonbQueueRepository を維持）
  └─ 知識操作   ──▶ Gnosis スクリプト経由（knowledge-merge / knowledge-get / knowledge-search）
```

Gnosis が知識の単一オーナーとなり、knowFlow は **キュー管理とオーケストレーションのみ**を担う。

---

## 前提条件

- Gnosis 側の以下のスクリプトが実装・動作済みであること（実装済み）
  - `src/scripts/knowledge-merge.ts`
  - `src/scripts/knowledge-get.ts`
  - `src/scripts/knowledge-search.ts`
- Gnosis の PostgreSQL が `postgresql://postgres:postgres@localhost:7888/gnosis` で起動済みであること
- migration `0007_knowflow_queue_knowledge.sql` が適用済みであること

---

## 作業 1: Bun 移行

### 1-1. package.json の更新

```json
{
  "type": "module",
  "scripts": {
    "enqueue":         "bun src/cli.ts enqueue",
    "run-once":        "bun src/cli.ts run-once",
    "run-worker":      "bun src/cli.ts run-worker",
    "db:init":         "bun src/scripts/initPgPhase3.ts",
    "queue:health":    "bun src/scripts/queueHealth.ts",
    "queue:cleanup":   "bun src/scripts/queueCleanup.ts",
    "test":            "bun test",
    "test:e2e":        "bun test test/flows.e2e.test.ts",
    "typecheck":       "tsc --noEmit"
  },
  "dependencies": {
    "pg": "^8.x",
    "zod": "^3.x"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "@types/pg": "^8.x",
    "typescript": "^5.x"
  }
}
```

- `tsx` を `devDependencies` から削除
- `vitest` を削除し `bun test` に移行
- `@types/bun` を追加

### 1-2. tsconfig.json の更新

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun-types"],
    "strict": true,
    "noUncheckedIndexedAccess": true
  }
}
```

- `"types": ["vitest/globals"]` を `"types": ["bun-types"]` に変更

### 1-3. テストの移行

`vitest` の API は `bun:test` とほぼ互換だが、以下を変更する：

```ts
// Before
import { describe, test, expect, vi } from 'vitest';

// After
import { describe, test, expect, mock } from 'bun:test';
// vi.fn() → mock(() => ...)
// vi.spyOn() → spyOn()
```

`bun.lock` を生成し直す：
```bash
bun install
```

---

## 作業 2: キュー接続先を Gnosis DB に変更

### 2-1. 環境変数の設定

`.env`（または実行環境）に以下を設定：

```bash
QUEUE_BACKEND=postgres
QUEUE_POSTGRES_URL=postgresql://postgres:postgres@localhost:7888/gnosis
```

`topic_tasks` テーブルは Gnosis の migration 0007 で既に作成済みのため、**追加のマイグレーション不要**。

### 2-2. 確認

```bash
bun src/cli.ts enqueue --topic "test-topic"
bun src/cli.ts run-once --handler default
```

---

## 作業 3: GnosisKnowledgeRepository の実装

### 3-1. 新ファイル: `src/knowledge/gnosisRepository.ts`

`PgKnowledgeRepository` と同じ `KnowledgeRepositoryLike` インターフェースを Gnosis スクリプト呼び出しで実装する。

```ts
import { resolve } from 'node:path';
import type { Knowledge, KnowledgeUpsertInput } from './types';

export type GnosisKnowledgeRepositoryOptions = {
  gnosisPath: string; // Gnosis プロジェクトの絶対パス
};

export class GnosisKnowledgeRepository {
  private readonly gnosisPath: string;

  constructor(options: GnosisKnowledgeRepositoryOptions) {
    this.gnosisPath = resolve(options.gnosisPath);
  }

  async getByTopic(topic: string): Promise<Knowledge | null> {
    const scriptPath = `${this.gnosisPath}/src/scripts/knowledge-get.ts`;
    const proc = Bun.spawn(['bun', 'run', scriptPath, '--topic', topic], {
      cwd: this.gnosisPath,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const err = await new Response(proc.stderr).text();
      throw new Error(`knowledge-get failed: ${err}`);
    }

    const trimmed = output.trim();
    if (!trimmed) return null;
    return JSON.parse(trimmed) as Knowledge;
  }

  async merge(
    input: KnowledgeUpsertInput,
  ): Promise<{ knowledge: Knowledge; changed: boolean }> {
    const scriptPath = `${this.gnosisPath}/src/scripts/knowledge-merge.ts`;
    const proc = Bun.spawn(
      ['bun', 'run', scriptPath, '--input', JSON.stringify(input)],
      {
        cwd: this.gnosisPath,
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const err = await new Response(proc.stderr).text();
      throw new Error(`knowledge-merge failed: ${err}`);
    }

    const { changed } = JSON.parse(output.trim()) as { changed: boolean };

    // merge 後に getByTopic で最新状態を取得
    const knowledge = await this.getByTopic(input.topic);
    if (!knowledge) {
      throw new Error(`knowledge-merge succeeded but topic not found: ${input.topic}`);
    }

    return { knowledge, changed };
  }
}
```

### 3-2. `src/cli.ts` の修正

`createHandler` 関数内の `PgKnowledgeRepository` 生成を `GnosisKnowledgeRepository` に切り替える：

```ts
// Before
import { PgKnowledgeRepository } from './knowledge/repository';

const repository = new PgKnowledgeRepository({ connectionString });

// After
import { GnosisKnowledgeRepository } from './knowledge/gnosisRepository';

const gnosisPath = options.gnosisPath ?? process.env.GNOSIS_PATH;
if (!gnosisPath) {
  throw new Error('--gnosis-path or GNOSIS_PATH is required when --handler knowflow');
}
const repository = new GnosisKnowledgeRepository({ gnosisPath });
```

CLI に `--gnosis-path` フラグを追加し、`GNOSIS_PATH` 環境変数でも設定できるようにする。

### 3-3. 環境変数の追加

`.env` に追加：

```bash
GNOSIS_PATH=/Users/<user>/Code/gnosis
```

---

## 作業 4: 不要コードの整理（任意・後回し可）

以下は Gnosis 委譲後に参照されなくなるが、削除は確認後に行う：

- `src/knowledge/repository.ts`（`PgKnowledgeRepository`）
- `src/db/pg.ts`（キュー側がまだ使う可能性があるため要確認）
- `src/scripts/knowledgeMerge.ts` / `knowledgeGet.ts` / `knowledgeSearch.ts`（独自スクリプト）

---

## DoD（完了定義）

- [ ] `bun test` が全テスト通過
- [ ] `bun src/cli.ts enqueue --topic "test"` が Gnosis DB（topic_tasks テーブル）にタスクを登録できる
- [ ] `bun src/cli.ts run-once --handler knowflow` が 1 タスクを処理し、Gnosis DB（knowledge_topics / knowledge_claims テーブル）に知識が保存される
- [ ] `bun run typecheck` がエラーなしで通過
- [ ] `tsx` への依存が `package.json` から消えている

---

## 参考：Gnosis 側で実装済みのスクリプト I/F

### `knowledge-merge.ts`

```bash
bun run src/scripts/knowledge-merge.ts \
  --input '{"topic":"TypeScript","aliases":[],"claims":[{"text":"...","confidence":0.9,"sourceIds":[]}],"relations":[],"sources":[]}'
# stdout: {"changed":true}
```

### `knowledge-get.ts`

```bash
bun run src/scripts/knowledge-get.ts --topic "TypeScript"
# stdout: JSON（Knowledge オブジェクト）、未存在時は空文字
```

### `knowledge-search.ts`

```bash
bun run src/scripts/knowledge-search.ts --query "TypeScript error" --limit 5
# stdout: JSON 配列（{topic, text, confidence}[]）
```
