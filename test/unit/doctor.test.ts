import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runDoctor, summarizeDoctor } from "../../src/doctor";
import { parseHarnessConfig } from "../../src/schemas";
import { cleanupTempDir, createTempDir } from "../contract/utils/tempCli";

const buildApiOnlyConfig = (
	workspaceRoot: string,
	patchFormat:
		| "auto"
		| "astmend-json"
		| "unified-diff"
		| "file-replace" = "auto",
) =>
	parseHarnessConfig({
		runtime: "bun",
		workspaceRoot,
		adapters: {
			localLlm: {
				mode: "api",
				model: "test-model",
				apiBaseUrl: "https://example.com",
				apiPath: "/v1/chat/completions",
			},
			astmend: {
				mode: "api",
				endpoint: "https://example.com",
				apiPath: "/apply",
				patchFormat,
			},
			diffGuard: {
				mode: "api",
				endpoint: "https://example.com",
				apiPath: "/review",
			},
		},
	});

describe("runDoctor requirements checks", () => {
	test("scans scenarios under config.workspaceRoot and reports ok when files exist", async () => {
		const dir = await createTempDir("llmharness-doctor-ok");
		try {
			await mkdir(join(dir, "scenarios", "smoke"), { recursive: true });
			await mkdir(join(dir, "requirements"), { recursive: true });

			await writeFile(
				join(dir, "scenarios", "smoke", "sample.json"),
				JSON.stringify({
					id: "sample",
					suite: "smoke",
					title: "Sample",
					instruction: "Test",
					targetFiles: ["src/index.ts"],
					expected: {
						mustPassTests: [],
						maxRiskErrors: 0,
						minScore: 80,
					},
					requirementsPath: "requirements/sample.requirements.json",
				}),
				"utf-8",
			);
			await writeFile(
				join(dir, "requirements", "sample.requirements.json"),
				JSON.stringify({
					id: "sample-req",
					title: "Sample requirements",
					task: "Validate sample flow",
				}),
				"utf-8",
			);

			const items = await runDoctor(buildApiOnlyConfig(dir));
			const reqItem = items.find((item) => item.name === "requirements.files");
			expect(reqItem).toBeDefined();
			expect(reqItem?.status).toBe("ok");
			expect(reqItem?.message).toContain("explicit path(s) all found");
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("reports an error when explicit requirementsPath is missing", async () => {
		const dir = await createTempDir("llmharness-doctor-missing");
		try {
			await mkdir(join(dir, "scenarios", "smoke"), { recursive: true });
			await writeFile(
				join(dir, "scenarios", "smoke", "broken.json"),
				JSON.stringify({
					id: "broken",
					suite: "smoke",
					title: "Broken",
					instruction: "Test",
					targetFiles: ["src/index.ts"],
					expected: {
						mustPassTests: [],
						maxRiskErrors: 0,
						minScore: 80,
					},
					requirementsPath: "requirements/missing.requirements.json",
				}),
				"utf-8",
			);

			const items = await runDoctor(buildApiOnlyConfig(dir));
			const errorItem = items.find(
				(item) => item.name === "requirements.broken",
			);
			expect(errorItem).toBeDefined();
			expect(errorItem?.status).toBe("error");
			expect(errorItem?.message).toContain("requirementsPath not found");
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("skips patch binary check when patchFormat=file-replace", async () => {
		const dir = await createTempDir("llmharness-doctor-patch-skip");
		try {
			const items = await runDoctor(buildApiOnlyConfig(dir, "file-replace"));
			expect(items.some((item) => item.name === "patch.binary")).toBe(false);
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("checks patch binary when patchFormat=unified-diff", async () => {
		const dir = await createTempDir("llmharness-doctor-patch-check");
		try {
			const items = await runDoctor(buildApiOnlyConfig(dir, "unified-diff"));
			const patchItem = items.find((item) => item.name === "patch.binary");
			expect(patchItem).toBeDefined();
			expect(patchItem?.status === "ok" || patchItem?.status === "error").toBe(
				true,
			);
		} finally {
			await cleanupTempDir(dir);
		}
	});
});

describe("summarizeDoctor", () => {
	test("returns ok=false when any error item exists", () => {
		const summary = summarizeDoctor([
			{ name: "a", status: "ok", message: "fine" },
			{ name: "b", status: "error", message: "bad" },
		]);

		expect(summary.ok).toBe(false);
		expect(summary.lines).toContain("[error] b: bad");
	});
});
