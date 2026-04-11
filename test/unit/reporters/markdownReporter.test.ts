import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMarkdownReport } from "../../../src/reporters/markdownReporter";
import { parseRequirements, parseScenarioResult } from "../../../src/schemas";
import { cleanupTempDir } from "../../contract/utils/tempCli";

describe("writeMarkdownReport", () => {
	test("renders requirements, persona reviews, and revision suggestions", async () => {
		const dir = await mkdtemp(join(tmpdir(), "llmharness-md-report-"));
		try {
			const outPath = join(dir, "result.md");
			const result = parseScenarioResult({
				scenarioId: "smoke-001",
				durationMs: 123,
				finalDecision: "fail",
				judges: [
					{
						phase: "final",
						score: 55,
						pass: false,
						reasons: ["score below threshold"],
					},
				],
				requirementsSummary: {
					id: "smoke-001-req",
					title: "Smoke requirements",
					loaded: true,
					validationStatus: "valid",
					successCriteriaCount: 2,
					reviewPersonasCount: 1,
				},
				personaReviews: [
					{
						personaName: "CI Engineer",
						personaRole: "Infrastructure",
						feedback: "Output needs clearer failure reason.",
						pass: false,
					},
				],
				revisionSuggestions: ["Link criteria to judge signals."],
			});
			const requirements = parseRequirements({
				id: "smoke-001-req",
				title: "Smoke requirements",
				task: "Validate smoke pipeline behavior",
				constraints: ["No blocking risk findings"],
				successCriteria: ["Final decision is not error"],
				reviewPersonas: [{ name: "CI Engineer", focus: ["reliability"] }],
			});

			await writeMarkdownReport(outPath, result, requirements);
			const content = await readFile(outPath, "utf-8");
			expect(content).toContain("## requirements");
			expect(content).toContain("### reviewPersonas");
			expect(content).toContain("## persona reviews");
			expect(content).toContain("## revision suggestions");
			expect(content).toContain("CI Engineer");
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("omits optional sections when data is absent", async () => {
		const dir = await mkdtemp(join(tmpdir(), "llmharness-md-report-min-"));
		try {
			const outPath = join(dir, "result.md");
			const result = parseScenarioResult({
				scenarioId: "smoke-002",
				durationMs: 10,
				finalDecision: "pass",
				judges: [
					{
						phase: "final",
						score: 90,
						pass: true,
						reasons: ["ok"],
					},
				],
			});

			await writeMarkdownReport(outPath, result);
			const content = await readFile(outPath, "utf-8");
			expect(content).not.toContain("## requirements");
			expect(content).not.toContain("## persona reviews");
			expect(content).not.toContain("## revision suggestions");
		} finally {
			await cleanupTempDir(dir);
		}
	});
});
