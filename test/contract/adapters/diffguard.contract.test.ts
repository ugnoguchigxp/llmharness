import { describe, expect, test } from "bun:test";
import { reviewWithDiffGuard } from "../../../src/adapters/diffguard";
import { parseHarnessConfig } from "../../../src/schemas";
import {
	cleanupTempDir,
	createCliScript,
	createTempDir,
} from "../utils/tempCli";

const patch = "Index: src/index.ts\n+import { x } from './y';\n";

describe("diffGuard adapter contract", () => {
	test("normalizes issues payload with severity field", async () => {
		const dir = await createTempDir("llmharness-diffguard-1");
		try {
			const cli = await createCliScript(
				dir,
				"diffguard-ok.sh",
				[
					"if [[ \"$*\" != *'--diff-file'* ]]; then",
					"  echo 'missing --diff-file' 1>&2",
					"  exit 10",
					"fi",
					"cat <<'JSON'",
					'{"issues":[{"ruleId":"DG003","severity":"warning","message":"unused import","file":"src/index.ts","line":1}],"blocking":false}',
					"JSON",
				].join("\n"),
			);

			const config = parseHarnessConfig({
				runtime: "bun",
				workspaceRoot: dir,
				adapters: {
					localLlm: {
						mode: "cli",
						command: "echo '{}'",
						model: "test-model",
					},
					astmend: {
						mode: "lib",
						libEntrypoint: "./unused.mjs",
					},
					diffGuard: {
						mode: "cli",
						command: cli,
						timeoutMs: 5000,
					},
				},
			});

			const result = await reviewWithDiffGuard({
				patch,
				config,
				sourceFiles: ["src/index.ts"],
			});

			expect(result.blocking).toBe(false);
			expect(result.levelCounts.warn).toBe(1);
			expect(result.findings[0]?.level).toBe("warn");
			expect(result.findings[0]?.id).toBe("DG003");
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("returns warning when CLI emits non-JSON with zero exit", async () => {
		const dir = await createTempDir("llmharness-diffguard-2");
		try {
			const cli = await createCliScript(
				dir,
				"diffguard-nonjson.sh",
				"echo 'review complete with text output only'",
			);
			const config = parseHarnessConfig({
				runtime: "bun",
				workspaceRoot: dir,
				adapters: {
					localLlm: {
						mode: "cli",
						command: "echo '{}'",
						model: "test-model",
					},
					astmend: {
						mode: "lib",
						libEntrypoint: "./unused.mjs",
					},
					diffGuard: {
						mode: "cli",
						command: cli,
						timeoutMs: 5000,
					},
				},
			});

			const result = await reviewWithDiffGuard({ patch, config });

			expect(result.blocking).toBe(false);
			expect(result.findings[0]?.id).toBe("DG-WARN-NO-JSON");
			expect(result.levelCounts.warn).toBe(1);
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("adds DG-CLI-EXIT when non-blocking JSON arrives with non-zero exit", async () => {
		const dir = await createTempDir("llmharness-diffguard-3");
		try {
			const cli = await createCliScript(
				dir,
				"diffguard-exit.sh",
				[
					"cat <<'JSON'",
					'{"findings":[{"id":"DG010","level":"warn","message":"minor issue"}],"blocking":false}',
					"JSON",
					"exit 3",
				].join("\n"),
			);
			const config = parseHarnessConfig({
				runtime: "bun",
				workspaceRoot: dir,
				adapters: {
					localLlm: {
						mode: "cli",
						command: "echo '{}'",
						model: "test-model",
					},
					astmend: {
						mode: "lib",
						libEntrypoint: "./unused.mjs",
					},
					diffGuard: {
						mode: "cli",
						command: cli,
						timeoutMs: 5000,
					},
				},
			});

			const result = await reviewWithDiffGuard({ patch, config });

			expect(result.blocking).toBe(true);
			expect(result.levelCounts.error).toBe(1);
			expect(result.findings.some((item) => item.id === "DG-CLI-EXIT")).toBe(
				true,
			);
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("accepts empty findings payload as non-blocking", async () => {
		const dir = await createTempDir("llmharness-diffguard-4");
		try {
			const cli = await createCliScript(
				dir,
				"diffguard-empty.sh",
				["cat <<'JSON'", '{"issues":[],"blocking":false}', "JSON"].join("\n"),
			);
			const config = parseHarnessConfig({
				runtime: "bun",
				workspaceRoot: dir,
				adapters: {
					localLlm: {
						mode: "cli",
						command: "echo '{}'",
						model: "test-model",
					},
					astmend: {
						mode: "lib",
						libEntrypoint: "./unused.mjs",
					},
					diffGuard: {
						mode: "cli",
						command: cli,
						timeoutMs: 5000,
					},
				},
			});

			const result = await reviewWithDiffGuard({ patch, config });

			expect(result.blocking).toBe(false);
			expect(result.levelCounts).toEqual({ error: 0, warn: 0, info: 0 });
			expect(result.findings).toEqual([]);
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("uses levelCounts when findings are empty", async () => {
		const dir = await createTempDir("llmharness-diffguard-5");
		try {
			const cli = await createCliScript(
				dir,
				"diffguard-levelcounts.sh",
				[
					"cat <<'JSON'",
					'{"findings":[],"levelCounts":{"error":0,"warn":2,"info":1},"blocking":false}',
					"JSON",
				].join("\n"),
			);
			const config = parseHarnessConfig({
				runtime: "bun",
				workspaceRoot: dir,
				adapters: {
					localLlm: {
						mode: "cli",
						command: "echo '{}'",
						model: "test-model",
					},
					astmend: {
						mode: "lib",
						libEntrypoint: "./unused.mjs",
					},
					diffGuard: {
						mode: "cli",
						command: cli,
						timeoutMs: 5000,
					},
				},
			});

			const result = await reviewWithDiffGuard({ patch, config });

			expect(result.blocking).toBe(false);
			expect(result.levelCounts).toEqual({ error: 0, warn: 2, info: 1 });
			expect(result.findings).toEqual([]);
		} finally {
			await cleanupTempDir(dir);
		}
	});
});
