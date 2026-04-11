import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyWithAstmend } from "../../../src/adapters/astmend";
import { parseHarnessConfig } from "../../../src/schemas";
import {
	cleanupTempDir,
	createCliScript,
	createTempDir,
} from "../utils/tempCli";

const patch = JSON.stringify({
	type: "add_import",
	file: "src/index.ts",
	module: "./utils",
	named: [{ name: "runPipeline" }],
});

const createAstmendLib = async (dir: string): Promise<string> => {
	const modulePath = join(dir, "fake-astmend.mjs");
	await writeFile(
		modulePath,
		[
			"export const applyPatchFromFile = async (input) => ({",
			"  changed: true,",
			"  updatedText: String(input?.file ?? ''),",
			"  diff: 'Index: src/index.ts\\n+import { runPipeline } from \\\"./utils\\\";\\n'",
			"});",
			"",
		].join("\n"),
		"utf-8",
	);
	return modulePath;
};

const createAstmendLibModern = async (dir: string): Promise<string> => {
	const modulePath = join(dir, "fake-astmend-modern.mjs");
	await writeFile(
		modulePath,
		[
			"export const applyPatchFromFile = async (input) => ({",
			"  success: true,",
			"  patchedFiles: [String(input?.file ?? 'src/index.ts')],",
			"  rejects: [],",
			"  diagnostics: ['modern-response'],",
			"  diff: 'Index: src/index.ts\\n+import { runPipeline } from \\\"./utils\\\";\\n'",
			"});",
			"",
		].join("\n"),
		"utf-8",
	);
	return modulePath;
};

describe("astmend adapter contract", () => {
	test("supports lib mode entrypoint contract", async () => {
		const dir = await createTempDir("llmharness-astmend-lib");
		try {
			const libEntrypoint = await createAstmendLib(dir);
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
						libEntrypoint,
					},
					diffGuard: {
						mode: "cli",
						command: "echo '{}'",
					},
				},
			});

			const result = await applyWithAstmend({
				patch,
				targetFiles: ["src/index.ts"],
				config,
			});

			expect(result.success).toBe(true);
			expect(result.patchedFiles).toEqual(["src/index.ts"]);
			expect(result.diff?.includes("Index: src/index.ts")).toBe(true);
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("supports modern ApplyResponse shape from library", async () => {
		const dir = await createTempDir("llmharness-astmend-lib-modern");
		try {
			const libEntrypoint = await createAstmendLibModern(dir);
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
						libEntrypoint,
					},
					diffGuard: {
						mode: "cli",
						command: "echo '{}'",
					},
				},
			});

			const result = await applyWithAstmend({
				patch,
				targetFiles: ["src/index.ts"],
				config,
			});

			expect(result.success).toBe(true);
			expect(result.patchedFiles).toEqual(["src/index.ts"]);
			expect(result.diagnostics).toContain("modern-response");
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("recovers with library fallback when CLI fails", async () => {
		const dir = await createTempDir("llmharness-astmend-fallback");
		try {
			const libEntrypoint = await createAstmendLib(dir);
			const failingCli = await createCliScript(
				dir,
				"astmend-fail.sh",
				["echo 'cli failed' 1>&2", "exit 127"].join("\n"),
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
						mode: "cli",
						command: failingCli,
						enableLibFallback: true,
						libEntrypoint,
						timeoutMs: 5000,
					},
					diffGuard: {
						mode: "cli",
						command: "echo '{}'",
					},
				},
			});

			const result = await applyWithAstmend({
				patch,
				targetFiles: ["src/index.ts"],
				config,
			});

			expect(result.success).toBe(true);
			expect(
				result.diagnostics.some((item) =>
					item.includes("recovered by library fallback"),
				),
			).toBe(true);
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("treats non-zero CLI exit as failure even if JSON says success", async () => {
		const dir = await createTempDir("llmharness-astmend-cli-exit");
		try {
			const cli = await createCliScript(
				dir,
				"astmend-exit.sh",
				[
					"cat <<'JSON'",
					'{"success":true,"patchedFiles":["src/index.ts"],"diagnostics":["cli returned success payload"]}',
					"JSON",
					"echo 'non-zero exit for compatibility' 1>&2",
					"exit 2",
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
						mode: "cli",
						command: cli,
						enableLibFallback: false,
						timeoutMs: 5000,
					},
					diffGuard: {
						mode: "cli",
						command: "echo '{}'",
					},
				},
			});

			const result = await applyWithAstmend({
				patch,
				targetFiles: ["src/index.ts"],
				config,
			});

			expect(result.success).toBe(false);
			expect(
				result.diagnostics.some((item) =>
					item.includes("Astmend CLI exited with code 2"),
				),
			).toBe(true);
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("uses configured fallback candidate when primary astmend is unavailable", async () => {
		const dir = await createTempDir("llmharness-astmend-config-fallback");
		try {
			const fallbackCli = await createCliScript(
				dir,
				"astmend-fallback-ok.sh",
				[
					"cat <<'JSON'",
					'{"success":true,"patchedFiles":["src/index.ts"],"rejects":[],"diagnostics":["fallback cli ok"]}',
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
						mode: "api",
						apiPath: "/apply",
						timeoutMs: 5000,
						fallbacks: [
							{
								mode: "cli",
								command: fallbackCli,
								timeoutMs: 5000,
								enableLibFallback: false,
								patchFormat: "astmend-json",
							},
						],
					},
					diffGuard: {
						mode: "cli",
						command: "echo '{}'",
					},
				},
			});

			const result = await applyWithAstmend({
				patch,
				targetFiles: ["src/index.ts"],
				config,
			});

			expect(result.success).toBe(true);
			expect(result.diagnostics).toContain("fallback cli ok");
			expect(
				result.diagnostics.some((item) =>
					item.includes("fallback candidate 1"),
				),
			).toBe(true);
		} finally {
			await cleanupTempDir(dir);
		}
	});
});
