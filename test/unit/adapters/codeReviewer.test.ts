import { describe, expect, test } from "bun:test";
import { reviewCode } from "../../../src/adapters/codeReviewer";
import { parseHarnessConfig } from "../../../src/schemas";
import {
	CodeReviewResultSchema,
	ReviewFindingSchema,
	ReviewSeveritySchema,
} from "../../../src/schemas/review";

const baseConfig = parseHarnessConfig({
	runtime: "bun",
	workspaceRoot: ".",
	adapters: {
		localLlm: {
			mode: "cli",
			command: "echo '{}'",
			model: "test-model",
		},
		astmend: {},
		diffGuard: {},
	},
});

const apiConfig = parseHarnessConfig({
	runtime: "bun",
	workspaceRoot: ".",
	adapters: {
		localLlm: {
			mode: "api",
			apiBaseUrl: "http://localhost:9999",
			model: "test-model",
			timeoutMs: 1000,
		},
		astmend: {},
		diffGuard: {},
	},
});

describe("reviewCode", () => {
	test("returns lgtm result when no files are provided", async () => {
		const result = await reviewCode({ files: [], config: baseConfig });
		expect(result.overallAssessment).toBe("lgtm");
		expect(result.findings).toHaveLength(0);
		expect(result.reviewedFiles).toHaveLength(0);
		expect(result.summary).toContain("No files");
	});

	test("falls back gracefully when LLM CLI returns empty JSON", async () => {
		const config = parseHarnessConfig({
			...baseConfig,
			adapters: {
				...baseConfig.adapters,
				localLlm: {
					mode: "cli",
					command: "echo '{}'",
					model: "test-model",
				},
			},
		});
		const result = await reviewCode({
			files: [{ path: "src/index.ts", content: "export const x = 1;" }],
			config,
		});
		expect(result.reviewedFiles).toEqual(["src/index.ts"]);
		expect(result.overallAssessment).toBe("needs-changes");
		expect(result.findings).toHaveLength(0);
		expect(typeof result.summary).toBe("string");
	});

	test("parses valid LLM JSON response into CodeReviewResult", async () => {
		const mockResponse = JSON.stringify({
			findings: [
				{
					severity: "warning",
					file: "src/foo.ts",
					line: 10,
					message: "Potential null dereference",
					suggestion: "Add null check before accessing property",
				},
				{
					severity: "suggestion",
					file: "src/foo.ts",
					message: "Consider extracting this logic into a helper function",
				},
			],
			summary: "The code has a potential null dereference issue.",
			overallAssessment: "needs-changes",
		});

		const config = parseHarnessConfig({
			...baseConfig,
			adapters: {
				...baseConfig.adapters,
				localLlm: {
					mode: "cli",
					command: `echo ${JSON.stringify(mockResponse)}`,
					model: "test-model",
				},
			},
		});

		const result = await reviewCode({
			files: [{ path: "src/foo.ts", content: "const x = obj.value;" }],
			config,
		});

		expect(result.overallAssessment).toBe("needs-changes");
		expect(result.summary).toBe(
			"The code has a potential null dereference issue.",
		);
		expect(result.findings).toHaveLength(2);

		const first = result.findings[0];
		expect(first?.severity).toBe("warning");
		expect(first?.file).toBe("src/foo.ts");
		expect(first?.line).toBe(10);
		expect(first?.message).toBe("Potential null dereference");
		expect(first?.suggestion).toBe("Add null check before accessing property");
	});

	test("falls back to needs-changes when LLM returns unparseable text", async () => {
		const config = parseHarnessConfig({
			...baseConfig,
			adapters: {
				...baseConfig.adapters,
				localLlm: {
					mode: "cli",
					command: "echo 'This is not JSON at all'",
					model: "test-model",
				},
			},
		});

		const result = await reviewCode({
			files: [{ path: "src/foo.ts", content: "const x = 1;" }],
			config,
		});

		expect(result.overallAssessment).toBe("needs-changes");
		expect(result.findings).toHaveLength(0);
		expect(result.summary).toContain("not JSON at all");
	});

	test("ignores invalid finding entries and keeps valid ones", async () => {
		const mockResponse = JSON.stringify({
			findings: [
				{ severity: "error", message: "Valid finding" },
				{ severity: "invalid-level", message: "Bad severity" },
				null,
				"not-an-object",
				{ severity: "info", message: "Another valid finding" },
			],
			summary: "Mixed findings.",
			overallAssessment: "needs-changes",
		});

		const config = parseHarnessConfig({
			...baseConfig,
			adapters: {
				...baseConfig.adapters,
				localLlm: {
					mode: "cli",
					command: `echo ${JSON.stringify(mockResponse)}`,
					model: "test-model",
				},
			},
		});

		const result = await reviewCode({
			files: [{ path: "src/a.ts", content: "const a = 1;" }],
			config,
		});

		expect(result.findings).toHaveLength(2);
		expect(result.findings[0]?.severity).toBe("error");
		expect(result.findings[1]?.severity).toBe("info");
	});

	test("throws when API mode is configured but apiBaseUrl is missing", async () => {
		const configNoUrl = parseHarnessConfig({
			runtime: "bun",
			workspaceRoot: ".",
			adapters: {
				localLlm: {
					mode: "api",
					model: "test-model",
				},
				astmend: {},
				diffGuard: {},
			},
		});

		await expect(
			reviewCode({
				files: [{ path: "src/foo.ts", content: "const x = 1;" }],
				config: configNoUrl,
			}),
		).rejects.toThrow("apiBaseUrl");
	});

	test("throws when API endpoint is unreachable", async () => {
		await expect(
			reviewCode({
				files: [{ path: "src/foo.ts", content: "const x = 1;" }],
				config: apiConfig,
			}),
		).rejects.toThrow();
	});

	test("sets reviewedAt to a valid ISO timestamp", async () => {
		const result = await reviewCode({ files: [], config: baseConfig });
		expect(() => new Date(result.reviewedAt)).not.toThrow();
		expect(new Date(result.reviewedAt).toISOString()).toBe(result.reviewedAt);
	});
});

describe("ReviewFindingSchema", () => {
	test("accepts all valid severities", () => {
		for (const severity of [
			"error",
			"warning",
			"suggestion",
			"info",
		] as const) {
			const result = ReviewFindingSchema.safeParse({
				severity,
				message: "test message",
			});
			expect(result.success).toBe(true);
		}
	});

	test("rejects invalid severity", () => {
		const result = ReviewFindingSchema.safeParse({
			severity: "critical",
			message: "test message",
		});
		expect(result.success).toBe(false);
	});

	test("optional fields default to undefined", () => {
		const result = ReviewFindingSchema.safeParse({
			severity: "info",
			message: "Just informational",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.file).toBeUndefined();
			expect(result.data.line).toBeUndefined();
			expect(result.data.suggestion).toBeUndefined();
		}
	});
});

describe("CodeReviewResultSchema", () => {
	test("validates a complete result", () => {
		const result = CodeReviewResultSchema.safeParse({
			reviewedFiles: ["src/a.ts", "src/b.ts"],
			findings: [{ severity: "warning", message: "potential bug" }],
			summary: "Overall looks good with minor issues.",
			overallAssessment: "needs-changes",
			reviewedAt: new Date().toISOString(),
			model: "gemma4-default",
		});
		expect(result.success).toBe(true);
	});

	test("rejects invalid overallAssessment", () => {
		const result = CodeReviewResultSchema.safeParse({
			reviewedFiles: [],
			findings: [],
			summary: "ok",
			overallAssessment: "unknown-value",
			reviewedAt: new Date().toISOString(),
		});
		expect(result.success).toBe(false);
	});
});

describe("ReviewSeveritySchema", () => {
	test("accepts all four severity levels", () => {
		for (const s of ["error", "warning", "suggestion", "info"]) {
			expect(ReviewSeveritySchema.safeParse(s).success).toBe(true);
		}
	});
});
