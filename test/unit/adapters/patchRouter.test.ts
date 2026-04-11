import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyPatch } from "../../../src/adapters/patchRouter";
import { parseHarnessConfig } from "../../../src/schemas";
import { cleanupTempDir, createTempDir } from "../../contract/utils/tempCli";

const createConfig = (
	workspaceRoot: string,
	overrides?: {
		patchFormat?: "auto" | "astmend-json" | "unified-diff" | "file-replace";
		libEntrypoint?: string;
	},
) =>
	parseHarnessConfig({
		runtime: "bun",
		workspaceRoot,
		adapters: {
			localLlm: { mode: "cli", command: "echo '{}'", model: "test-model" },
			astmend: {
				mode: "lib",
				libEntrypoint: overrides?.libEntrypoint ?? "./fake-astmend.mjs",
				patchFormat: overrides?.patchFormat ?? "auto",
			},
			diffGuard: { mode: "cli", command: "echo '{}'" },
		},
	});

describe("applyPatch router", () => {
	test("routes astmend-json patch to astmend adapter", async () => {
		const dir = await createTempDir("llmharness-patch-router-astmend");
		try {
			await mkdir(join(dir, "src"), { recursive: true });
			const libPath = join(dir, "fake-astmend.mjs");
			await writeFile(
				libPath,
				[
					"export const applyPatchFromFile = async (input) => ({",
					"  success: true,",
					"  patchedFiles: [String(input?.file ?? 'src/index.ts')],",
					"  diagnostics: ['router-astmend'],",
					"});",
					"",
				].join("\n"),
				"utf-8",
			);
			const config = createConfig(dir, { libEntrypoint: libPath });

			const result = await applyPatch({
				patch: JSON.stringify({
					type: "add_import",
					file: "src/index.ts",
					module: "./x",
					named: [{ name: "X" }],
				}),
				targetFiles: ["src/index.ts"],
				config,
			});

			expect(result.success).toBe(true);
			expect(result.diagnostics).toContain("router-astmend");
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("routes unified diff patch to unified diff adapter", async () => {
		const dir = await createTempDir("llmharness-patch-router-diff");
		try {
			await mkdir(join(dir, "src"), { recursive: true });
			const target = join(dir, "src/index.ts");
			await writeFile(target, "export const version = 1;\n", "utf-8");
			const config = createConfig(dir);
			const patch = [
				"diff --git a/src/index.ts b/src/index.ts",
				"--- a/src/index.ts",
				"+++ b/src/index.ts",
				"@@ -1 +1 @@",
				"-export const version = 1;",
				"+export const version = 2;",
				"",
			].join("\n");

			const result = await applyPatch({
				patch,
				targetFiles: ["src/index.ts"],
				config,
			});

			expect(result.success).toBe(true);
			const updated = await readFile(target, "utf-8");
			expect(updated).toContain("version = 2");
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("routes plain text patch to file-replace adapter", async () => {
		const dir = await createTempDir("llmharness-patch-router-file");
		try {
			await mkdir(join(dir, "src"), { recursive: true });
			const target = join(dir, "src/index.ts");
			await writeFile(target, "export const before = true;\n", "utf-8");
			const config = createConfig(dir, { patchFormat: "file-replace" });

			const result = await applyPatch({
				patch: "export const after = true;\n",
				targetFiles: ["src/index.ts"],
				config,
			});

			expect(result.success).toBe(true);
			const updated = await readFile(target, "utf-8");
			expect(updated).toContain("after");
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("respects explicit patchFormat override", async () => {
		const dir = await createTempDir("llmharness-patch-router-override");
		try {
			await mkdir(join(dir, "src"), { recursive: true });
			const target = join(dir, "src/index.ts");
			await writeFile(target, "export const before = true;\n", "utf-8");
			const config = createConfig(dir, {
				patchFormat: "file-replace",
			});
			const astmendPatch = JSON.stringify({
				type: "add_import",
				file: "src/index.ts",
				module: "./x",
				named: [{ name: "X" }],
			});

			const result = await applyPatch({
				patch: astmendPatch,
				targetFiles: ["src/index.ts"],
				config,
			});

			expect(result.success).toBe(true);
			const updated = await readFile(target, "utf-8");
			expect(updated).toBe(astmendPatch);
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("rejects ambiguous plain text in auto mode", async () => {
		const dir = await createTempDir("llmharness-patch-router-auto-reject");
		try {
			await mkdir(join(dir, "src"), { recursive: true });
			const target = join(dir, "src/index.ts");
			const original = "export const before = true;\n";
			await writeFile(target, original, "utf-8");
			const config = createConfig(dir, { patchFormat: "auto" });

			const result = await applyPatch({
				patch: "I could not produce a patch for this request.",
				targetFiles: ["src/index.ts"],
				config,
			});

			expect(result.success).toBe(false);
			const updated = await readFile(target, "utf-8");
			expect(updated).toBe(original);
		} finally {
			await cleanupTempDir(dir);
		}
	});
});
