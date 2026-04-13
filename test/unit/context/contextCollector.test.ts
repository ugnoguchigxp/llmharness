import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { collectContext } from "../../../src/context/contextCollector";
import { parseHarnessConfig, parseScenarioInput } from "../../../src/schemas";

const WS = resolve(".");

const baseConfig = parseHarnessConfig({
	runtime: "bun",
	workspaceRoot: WS,
	adapters: {
		localLlm: { mode: "cli", command: "echo", model: "m" },
		astmend: {},
		diffGuard: {},
	},
	context: {
		enabled: true,
		maxContextTokens: 10000,
		includeImports: true,
		includeTests: true,
		maxFileLines: 500,
	},
});

const disabledConfig = parseHarnessConfig({
	...baseConfig,
	context: {
		enabled: false,
		maxContextTokens: 4000,
		includeImports: true,
		includeTests: true,
		maxFileLines: 500,
	},
});

describe("collectContext", () => {
	test("returns empty when disabled", async () => {
		const scenario = parseScenarioInput({
			id: "test",
			suite: "smoke",
			title: "t",
			instruction: "i",
			targetFiles: ["src/index.ts"],
		});
		const result = await collectContext(scenario, disabledConfig);
		expect(result.files).toHaveLength(0);
		expect(result.totalTokenEstimate).toBe(0);
	});

	test("reads existing target file", async () => {
		const scenario = parseScenarioInput({
			id: "test",
			suite: "smoke",
			title: "t",
			instruction: "i",
			targetFiles: ["src/index.ts"],
		});
		const result = await collectContext(scenario, baseConfig);
		const target = result.files.find((f) => f.path === "src/index.ts");
		expect(target).toBeDefined();
		expect(target?.role).toBe("target");
		expect(target?.content.length).toBeGreaterThan(0);
	});

	test("gracefully skips non-existent target file", async () => {
		const scenario = parseScenarioInput({
			id: "test",
			suite: "smoke",
			title: "t",
			instruction: "i",
			targetFiles: ["src/does-not-exist-xyz.ts"],
		});
		const result = await collectContext(scenario, baseConfig);
		expect(result.files).toHaveLength(0);
	});

	test("discovers related test file for target", async () => {
		const scenario = parseScenarioInput({
			id: "test",
			suite: "smoke",
			title: "t",
			instruction: "i",
			targetFiles: ["src/doctor.ts"],
		});
		const result = await collectContext(scenario, baseConfig);
		const testEntry = result.files.find((f) => f.role === "test");
		expect(testEntry).toBeDefined();
		expect(testEntry?.path).toContain("doctor");
	});

	test("respects maxFileLines truncation", async () => {
		const tinyConfig = parseHarnessConfig({
			...baseConfig,
			context: {
				enabled: true,
				maxContextTokens: 999999,
				includeImports: false,
				includeTests: false,
				maxFileLines: 5,
			},
		});
		const scenario = parseScenarioInput({
			id: "test",
			suite: "smoke",
			title: "t",
			instruction: "i",
			// localllm.ts is 460+ lines, guaranteed to exceed maxFileLines=5
			targetFiles: ["src/adapters/localllm.ts"],
		});
		const result = await collectContext(scenario, tinyConfig);
		const target = result.files.find(
			(f) => f.path === "src/adapters/localllm.ts",
		);
		expect(target?.truncated).toBe(true);
		const lineCount = target?.content.split("\n").length ?? 0;
		expect(lineCount).toBeLessThanOrEqual(5);
	});

	test("applies token budget by removing low-priority files first", async () => {
		// Very small token budget forces truncation
		const tinyTokenConfig = parseHarnessConfig({
			...baseConfig,
			context: {
				enabled: true,
				maxContextTokens: 50,
				includeImports: true,
				includeTests: true,
				maxFileLines: 500,
			},
		});
		const scenario = parseScenarioInput({
			id: "test",
			suite: "smoke",
			title: "t",
			instruction: "i",
			targetFiles: ["src/index.ts"],
		});
		const result = await collectContext(scenario, tinyTokenConfig);
		// With a 50-token budget, most content should be stripped
		expect(result.totalTokenEstimate).toBeLessThanOrEqual(100); // some slack
	});

	test("includes explicit contextFiles from scenario", async () => {
		// Disable imports/tests and use unlimited budget to isolate contextFiles behavior
		const minimalConfig = parseHarnessConfig({
			...baseConfig,
			context: {
				enabled: true,
				maxContextTokens: 999999,
				includeImports: false,
				includeTests: false,
				maxFileLines: 500,
			},
		});
		const scenario = parseScenarioInput({
			id: "test",
			suite: "smoke",
			title: "t",
			instruction: "i",
			targetFiles: ["src/index.ts"],
			contextFiles: ["src/schemas/domain.ts"],
		});
		const result = await collectContext(scenario, minimalConfig);
		const related = result.files.find(
			(f) => f.path === "src/schemas/domain.ts",
		);
		expect(related).toBeDefined();
		expect(related?.role).toBe("related");
	});

	test("totalTokenEstimate matches sum of file contents", async () => {
		const noImportConfig = parseHarnessConfig({
			...baseConfig,
			context: {
				enabled: true,
				maxContextTokens: 999999,
				includeImports: false,
				includeTests: false,
				maxFileLines: 500,
			},
		});
		const scenario = parseScenarioInput({
			id: "test",
			suite: "smoke",
			title: "t",
			instruction: "i",
			targetFiles: ["src/index.ts"],
		});
		const result = await collectContext(scenario, noImportConfig);
		const expectedTotal = result.files.reduce(
			(s, f) => s + Math.ceil(f.content.length / 4),
			0,
		);
		expect(result.totalTokenEstimate).toBe(expectedTotal);
	});
});
