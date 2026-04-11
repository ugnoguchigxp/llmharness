import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHarnessConfig } from "../../../src/schemas";
import { runCommand } from "../../../src/utils/exec";

describe("reindex-runs command", () => {
	test("rebuilds run index from artifacts/result.json files", async () => {
		const root = await mkdtemp(join(tmpdir(), "llmharness-reindex-"));
		try {
			const artifactsDir = join(root, "artifacts", "runs");
			const runDir = join(artifactsDir, "20260411-010101001-abcd");
			await mkdir(runDir, { recursive: true });

			const resultJson = {
				scenarioId: "smoke-001",
				durationMs: 3210,
				artifacts: [],
				finalDecision: "pass",
				generate: {
					patch: "--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@",
					summary: "reindex command test patch",
				},
				apply: {
					success: true,
					patchedFiles: ["src/index.ts"],
					rejects: [],
					diagnostics: [],
				},
				risk: {
					levelCounts: { error: 0, warn: 0, info: 0 },
					findings: [],
					blocking: false,
				},
				judges: [
					{
						phase: "final",
						score: 88,
						pass: true,
						reasons: ["reindex verification"],
					},
				],
				attempts: [],
			};
			await writeFile(
				join(runDir, "result.json"),
				`${JSON.stringify(resultJson, null, 2)}\n`,
				"utf-8",
			);

			const config = parseHarnessConfig({
				runtime: "bun",
				workspaceRoot: ".",
				artifactsDir,
				adapters: {
					localLlm: {
						mode: "cli",
						command: "echo '{}'",
						model: "test-model",
					},
					astmend: {
						mode: "lib",
						libEntrypoint: "../Astmend/dist/index.js",
					},
					diffGuard: {
						mode: "cli",
						command: "echo '{}'",
					},
				},
			});
			const configPath = join(root, "config.json");
			await writeFile(
				configPath,
				`${JSON.stringify(config, null, 2)}\n`,
				"utf-8",
			);

			const commandResult = await runCommand(
				`bun run src/cli.ts reindex-runs --config ${JSON.stringify(configPath)}`,
				{
					cwd: "/Users/y.noguchi/Code/llmharness",
					timeoutMs: 30000,
				},
			);
			expect(commandResult.exitCode).toBe(0);
			expect(commandResult.stdout.includes("reindex-runs completed")).toBe(
				true,
			);

			const db = new Database(join(artifactsDir, "run-index.sqlite"), {
				readonly: true,
			});
			try {
				const row = db.query("SELECT scenario_id, suite FROM runs").get() as {
					scenario_id: string;
					suite: string;
				};
				expect(row.scenario_id).toBe("smoke-001");
				expect(row.suite).toBe("smoke");
			} finally {
				db.close();
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
