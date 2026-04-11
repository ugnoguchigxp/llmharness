import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import {
	loadRequirements,
	loadRequirementsSafe,
} from "../../../src/requirements/loadRequirements";
import { parseRequirements, parseScenarioInput } from "../../../src/schemas";

// ---------------------------------------------------------------------------
// A. Requirements Schema validation
// ---------------------------------------------------------------------------

describe("RequirementsSchema", () => {
	test("parses a minimal valid requirements object", () => {
		const result = parseRequirements({
			id: "req-001",
			title: "Test requirements",
			task: "Do something useful",
		});

		expect(result.id).toBe("req-001");
		expect(result.title).toBe("Test requirements");
		expect(result.task).toBe("Do something useful");
	});

	test("parses a fully populated requirements object", () => {
		const result = parseRequirements({
			id: "req-full",
			title: "Full requirements",
			task: "Build a feature",
			audience: "developers",
			constraints: ["no breaking changes"],
			successCriteria: ["all tests pass", "no lint errors"],
			nonGoals: ["performance optimization"],
			risks: ["external dependency may be slow"],
			reviewPersonas: [
				{
					name: "Alice",
					role: "Engineer",
					focus: ["correctness", "safety"],
				},
			],
			metadata: { version: "1.0" },
		});

		expect(result.successCriteria).toHaveLength(2);
		expect(result.reviewPersonas).toHaveLength(1);
		expect(result.reviewPersonas?.[0]?.name).toBe("Alice");
	});

	test("rejects missing required field 'task'", () => {
		expect(() =>
			parseRequirements({
				id: "req-bad",
				title: "Missing task",
			}),
		).toThrow("Requirements validation failed");
	});

	test("rejects unknown extra fields (strict mode)", () => {
		expect(() =>
			parseRequirements({
				id: "req-extra",
				title: "Extra field",
				task: "Do something",
				unknownField: "should fail",
			}),
		).toThrow("Requirements validation failed");
	});

	test("rejects empty focus array in reviewPersona", () => {
		expect(() =>
			parseRequirements({
				id: "req-persona-bad",
				title: "Bad persona",
				task: "Test",
				reviewPersonas: [
					{
						name: "Bob",
						focus: [],
					},
				],
			}),
		).toThrow("Requirements validation failed");
	});
});

// ---------------------------------------------------------------------------
// B. loadRequirementsSafe: fail-safe behavior
// ---------------------------------------------------------------------------

describe("loadRequirementsSafe", () => {
	test("returns undefined when requirementsPath is undefined", async () => {
		const result = await loadRequirementsSafe(undefined);
		expect(result).toBeUndefined();
	});

	test("returns not_found summary when file does not exist", async () => {
		const result = await loadRequirementsSafe(
			"non-existent/path/requirements.json",
		);
		expect(result).toBeDefined();
		expect(result?.ok).toBe(false);
		expect(result?.summary.validationStatus).toBe("not_found");
		expect(result?.summary.loaded).toBe(false);
	});

	test("returns invalid summary when file contains invalid JSON structure", async () => {
		const tmpPath = join(
			resolve("."),
			"test",
			"fixtures",
			"bad-requirements.json",
		);
		// Write a temp bad file
		await Bun.write(tmpPath, JSON.stringify({ notARequirements: true }));

		const result = await loadRequirementsSafe(tmpPath);
		expect(result?.ok).toBe(false);
		expect(result?.summary.validationStatus).toBe("invalid");

		// Cleanup
		await Bun.file(tmpPath)
			.exists()
			.then(async (exists) => {
				if (exists) {
					const { unlinkSync } = await import("node:fs");
					unlinkSync(tmpPath);
				}
			});
	});

	test("returns ok result for a valid requirements file", async () => {
		const result = await loadRequirementsSafe(
			"requirements/smoke-001.requirements.json",
		);
		expect(result?.ok).toBe(true);
		if (result?.ok) {
			expect(result.requirements.id).toBe("smoke-001-req");
			expect(result.summary.loaded).toBe(true);
			expect(result.summary.validationStatus).toBe("valid");
			expect(result.summary.successCriteriaCount).toBeGreaterThan(0);
			expect(result.summary.reviewPersonasCount).toBeGreaterThan(0);
		}
	});
});

// ---------------------------------------------------------------------------
// C. Scenario backward compatibility
// ---------------------------------------------------------------------------

describe("ScenarioInput backward compatibility", () => {
	test("scenario without requirementsPath parses successfully", () => {
		const result = parseScenarioInput({
			id: "smoke-001",
			suite: "smoke",
			title: "Basic harness flow",
			instruction: "Produce a minimal safe patch.",
			targetFiles: ["src/index.ts"],
			expected: {
				mustPassTests: [],
				maxRiskErrors: 0,
				minScore: 80,
			},
		});

		expect(result.requirementsPath).toBeUndefined();
		expect(result.id).toBe("smoke-001");
	});

	test("scenario with requirementsPath parses successfully", () => {
		const result = parseScenarioInput({
			id: "smoke-001",
			suite: "smoke",
			title: "Basic harness flow",
			instruction: "Produce a minimal safe patch.",
			targetFiles: ["src/index.ts"],
			expected: {
				mustPassTests: [],
				maxRiskErrors: 0,
				minScore: 80,
			},
			requirementsPath: "requirements/smoke-001.requirements.json",
		});

		expect(result.requirementsPath).toBe(
			"requirements/smoke-001.requirements.json",
		);
	});
});

// ---------------------------------------------------------------------------
// D. Sample requirements files load correctly
// ---------------------------------------------------------------------------

describe("sample requirements files", () => {
	test("smoke-001.requirements.json is valid", async () => {
		const req = await loadRequirements(
			"requirements/smoke-001.requirements.json",
		);
		expect(req.id).toBe("smoke-001-req");
		expect(req.successCriteria?.length).toBeGreaterThan(0);
		expect(req.reviewPersonas?.length).toBeGreaterThan(0);
	});

	test("regression-001.requirements.json is valid", async () => {
		const req = await loadRequirements(
			"requirements/regression-001.requirements.json",
		);
		expect(req.id).toBe("regression-001-req");
		expect(req.constraints?.length).toBeGreaterThan(0);
		expect(req.successCriteria?.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// E. RequirementsSummary in report
// ---------------------------------------------------------------------------

describe("RequirementsSummary in ScenarioResult", () => {
	test("ScenarioResult parses with requirementsSummary", async () => {
		const { parseScenarioResult } = await import("../../../src/schemas");

		const result = parseScenarioResult({
			scenarioId: "smoke-001",
			durationMs: 100,
			finalDecision: "pass",
			judges: [{ phase: "final", score: 90, pass: true, reasons: ["ok"] }],
			requirementsSummary: {
				id: "smoke-001-req",
				title: "Basic harness flow: smoke validation",
				loaded: true,
				validationStatus: "valid",
				successCriteriaCount: 4,
				reviewPersonasCount: 2,
			},
		});

		expect(result.requirementsSummary).toBeDefined();
		expect(result.requirementsSummary?.id).toBe("smoke-001-req");
		expect(result.requirementsSummary?.successCriteriaCount).toBe(4);
	});

	test("ScenarioResult parses without requirementsSummary (backward compat)", async () => {
		const { parseScenarioResult } = await import("../../../src/schemas");

		const result = parseScenarioResult({
			scenarioId: "smoke-001",
			durationMs: 100,
			finalDecision: "pass",
			judges: [{ phase: "final", score: 90, pass: true, reasons: ["ok"] }],
		});

		expect(result.requirementsSummary).toBeUndefined();
	});
});
