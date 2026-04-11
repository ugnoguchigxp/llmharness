import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyFileReplace } from "../../../src/adapters/fileReplaceApply";
import { parseHarnessConfig } from "../../../src/schemas";
import { cleanupTempDir, createTempDir } from "../../contract/utils/tempCli";

describe("applyFileReplace", () => {
	test("applies plain-text replacement for single target file", async () => {
		const dir = await createTempDir("llmharness-file-replace-1");
		try {
			await mkdir(join(dir, "src"), { recursive: true });
			const target = join(dir, "src/index.ts");
			await writeFile(target, "export const before = true;\n", "utf-8");
			const config = parseHarnessConfig({
				runtime: "bun",
				workspaceRoot: dir,
				adapters: {
					localLlm: { mode: "cli", command: "echo '{}'", model: "test-model" },
					astmend: { mode: "lib", libEntrypoint: "./unused.mjs" },
					diffGuard: { mode: "cli", command: "echo '{}'" },
				},
			});

			const result = await applyFileReplace({
				patch: "export const after = true;\n",
				targetFiles: ["src/index.ts"],
				config,
			});

			expect(result.success).toBe(true);
			expect(result.patchedFiles).toEqual(["src/index.ts"]);
			const updated = await readFile(target, "utf-8");
			expect(updated).toContain("after");
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("rejects ambiguous payload when multiple target files exist", async () => {
		const dir = await createTempDir("llmharness-file-replace-2");
		try {
			await mkdir(join(dir, "src"), { recursive: true });
			await writeFile(join(dir, "src/a.ts"), "export const a = 1;\n", "utf-8");
			await writeFile(join(dir, "src/b.ts"), "export const b = 1;\n", "utf-8");
			const config = parseHarnessConfig({
				runtime: "bun",
				workspaceRoot: dir,
				adapters: {
					localLlm: { mode: "cli", command: "echo '{}'", model: "test-model" },
					astmend: { mode: "lib", libEntrypoint: "./unused.mjs" },
					diffGuard: { mode: "cli", command: "echo '{}'" },
				},
			});

			const result = await applyFileReplace({
				patch: "export const x = 1;\n",
				targetFiles: ["src/a.ts", "src/b.ts"],
				config,
			});

			expect(result.success).toBe(false);
			expect(result.rejects[0]?.reason).toContain("ambiguous");
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("applies JSON payload with file and content fields", async () => {
		const dir = await createTempDir("llmharness-file-replace-3");
		try {
			await mkdir(join(dir, "src"), { recursive: true });
			const target = join(dir, "src/index.ts");
			await writeFile(target, "export const before = true;\n", "utf-8");
			const config = parseHarnessConfig({
				runtime: "bun",
				workspaceRoot: dir,
				adapters: {
					localLlm: { mode: "cli", command: "echo '{}'", model: "test-model" },
					astmend: { mode: "lib", libEntrypoint: "./unused.mjs" },
					diffGuard: { mode: "cli", command: "echo '{}'" },
				},
			});

			const result = await applyFileReplace({
				patch: JSON.stringify({
					file: "src/index.ts",
					content: "export const after = 'json';\n",
				}),
				targetFiles: ["src/index.ts"],
				config,
			});

			expect(result.success).toBe(true);
			const updated = await readFile(target, "utf-8");
			expect(updated).toContain("after = 'json'");
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("accepts equivalent path with leading ./ in targetFiles", async () => {
		const dir = await createTempDir("llmharness-file-replace-4");
		try {
			await mkdir(join(dir, "src"), { recursive: true });
			const target = join(dir, "src/index.ts");
			await writeFile(target, "export const before = true;\n", "utf-8");
			const config = parseHarnessConfig({
				runtime: "bun",
				workspaceRoot: dir,
				adapters: {
					localLlm: { mode: "cli", command: "echo '{}'", model: "test-model" },
					astmend: { mode: "lib", libEntrypoint: "./unused.mjs" },
					diffGuard: { mode: "cli", command: "echo '{}'" },
				},
			});

			const result = await applyFileReplace({
				patch: JSON.stringify({
					file: "src/index.ts",
					content: "export const after = 'normalized';\n",
				}),
				targetFiles: ["./src/index.ts"],
				config,
			});

			expect(result.success).toBe(true);
			expect(result.patchedFiles).toEqual(["./src/index.ts"]);
			const updated = await readFile(target, "utf-8");
			expect(updated).toContain("normalized");
		} finally {
			await cleanupTempDir(dir);
		}
	});
});
