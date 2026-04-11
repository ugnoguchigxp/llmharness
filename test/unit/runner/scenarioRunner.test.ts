import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runSuite } from "../../../src/runner/scenarioRunner";
import { parseHarnessConfig } from "../../../src/schemas";
import { resolveRunIndexPath } from "../../../src/storage/runIndex";
import {
	cleanupTempDir,
	createCliScript,
	createTempDir,
} from "../../contract/utils/tempCli";

describe("runSuite", () => {
	test("runs with suiteConcurrency>1 and returns stable result ordering", async () => {
		const dir = await createTempDir("llmharness-suite-runner");
		try {
			await mkdir(join(dir, "workspace"), { recursive: true });

			const localLlm = await createCliScript(
				dir,
				"local-llm.sh",
				[
					"cat >/dev/null",
					"cat <<'JSON'",
					'{"patch":"{\\"type\\":\\"add_import\\",\\"file\\":\\"src/index.ts\\",\\"module\\":\\"./x\\",\\"named\\":[{\\"name\\":\\"X\\"}]}","summary":"suite-runner"}',
					"JSON",
				].join("\n"),
			);
			const astmend = await createCliScript(
				dir,
				"astmend.sh",
				[
					"cat >/dev/null",
					"cat <<'JSON'",
					'{"success":true,"patchedFiles":["src/index.ts"],"rejects":[],"diagnostics":[],"diff":"diff --git a/src/index.ts b/src/index.ts\\n--- a/src/index.ts\\n+++ b/src/index.ts\\n@@ -1 +1 @@\\n-export const x = 1;\\n+export const x = 2;"}',
					"JSON",
				].join("\n"),
			);
			const diffGuard = await createCliScript(
				dir,
				"diffguard.sh",
				[
					"cat >/dev/null",
					"cat <<'JSON'",
					'{"levelCounts":{"error":0,"warn":0,"info":0},"findings":[],"blocking":false}',
					"JSON",
				].join("\n"),
			);

			const configPath = join(dir, "config.json");
			await writeFile(
				configPath,
				`${JSON.stringify(
					{
						runtime: "bun",
						workspaceRoot: join(dir, "workspace"),
						artifactsDir: join(dir, "artifacts"),
						adapters: {
							localLlm: {
								mode: "cli",
								command: localLlm,
								commandPromptMode: "stdin",
								model: "test-model",
								timeoutMs: 5000,
								temperature: 0,
							},
							astmend: {
								mode: "cli",
								command: astmend,
								enableLibFallback: false,
								timeoutMs: 5000,
							},
							diffGuard: {
								mode: "cli",
								command: diffGuard,
								timeoutMs: 5000,
							},
						},
						orchestrator: {
							maxAttempts: 1,
							suiteConcurrency: 2,
						},
						checks: {
							runTypecheck: false,
							typecheckCommand: "echo skip",
							runTests: false,
							testCommand: "echo skip",
						},
					},
					null,
					2,
				)}\n`,
				"utf-8",
			);

			const results = await runSuite("smoke", configPath);

			expect(results.length).toBeGreaterThan(1);
			const ids = results.map((item) => item.scenarioId);
			expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
			const runDirs = results.map((item) => item.runDir);
			expect(new Set(runDirs).size).toBe(runDirs.length);

			const parsedConfig = parseHarnessConfig(
				JSON.parse(await Bun.file(configPath).text()),
			);
			const indexPath = resolveRunIndexPath(parsedConfig);
			const db = new Database(indexPath, { readonly: true });
			try {
				const row = db.query(`SELECT COUNT(*) as count FROM runs`).get() as {
					count: number | bigint;
				};
				expect(Number(row.count)).toBe(results.length);
			} finally {
				db.close();
			}
		} finally {
			await cleanupTempDir(dir);
		}
	});
});
