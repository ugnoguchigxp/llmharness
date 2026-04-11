import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyUnifiedDiff } from "../../../src/adapters/unifiedDiffApply";
import { parseHarnessConfig } from "../../../src/schemas";
import { cleanupTempDir, createTempDir } from "../utils/tempCli";

describe("unified diff adapter contract", () => {
	test("applies unified diff to target file", async () => {
		const dir = await createTempDir("llmharness-unified-diff-1");
		try {
			await mkdir(join(dir, "src"), { recursive: true });
			await writeFile(
				join(dir, "src/index.ts"),
				"export const version = 1;\n",
				"utf-8",
			);
			const config = parseHarnessConfig({
				runtime: "bun",
				workspaceRoot: dir,
				adapters: {
					localLlm: { mode: "cli", command: "echo '{}'", model: "test-model" },
					astmend: {
						mode: "lib",
						libEntrypoint: "./unused.mjs",
						timeoutMs: 5000,
					},
					diffGuard: { mode: "cli", command: "echo '{}'" },
				},
			});
			const patch = [
				"diff --git a/src/index.ts b/src/index.ts",
				"--- a/src/index.ts",
				"+++ b/src/index.ts",
				"@@ -1 +1 @@",
				"-export const version = 1;",
				"+export const version = 2;",
				"",
			].join("\n");

			const result = await applyUnifiedDiff({
				patch,
				targetFiles: ["src/index.ts"],
				config,
			});

			expect(result.success).toBe(true);
			expect(result.patchedFiles).toEqual(["src/index.ts"]);
			const updated = await readFile(join(dir, "src/index.ts"), "utf-8");
			expect(updated).toContain("version = 2");
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("rejects diff that touches non-target files", async () => {
		const dir = await createTempDir("llmharness-unified-diff-2");
		try {
			await mkdir(join(dir, "src"), { recursive: true });
			await writeFile(
				join(dir, "src/index.ts"),
				"export const x = 1;\n",
				"utf-8",
			);
			await writeFile(
				join(dir, "src/other.ts"),
				"export const y = 1;\n",
				"utf-8",
			);
			const config = parseHarnessConfig({
				runtime: "bun",
				workspaceRoot: dir,
				adapters: {
					localLlm: { mode: "cli", command: "echo '{}'", model: "test-model" },
					astmend: {
						mode: "lib",
						libEntrypoint: "./unused.mjs",
						timeoutMs: 5000,
					},
					diffGuard: { mode: "cli", command: "echo '{}'" },
				},
			});
			const patch = [
				"diff --git a/src/other.ts b/src/other.ts",
				"--- a/src/other.ts",
				"+++ b/src/other.ts",
				"@@ -1 +1 @@",
				"-export const y = 1;",
				"+export const y = 2;",
				"",
			].join("\n");

			const result = await applyUnifiedDiff({
				patch,
				targetFiles: ["src/index.ts"],
				config,
			});

			expect(result.success).toBe(false);
			expect(result.rejects[0]?.reason).toContain("outside");
		} finally {
			await cleanupTempDir(dir);
		}
	});
});
