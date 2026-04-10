import { describe, expect, test } from "bun:test";
import { parseScenarioResult } from "../../../src/schemas";

describe("ScenarioResultSchema", () => {
	test("parses minimal valid result", () => {
		const value = parseScenarioResult({
			scenarioId: "smoke-001",
			durationMs: 100,
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

		expect(value.scenarioId).toBe("smoke-001");
		expect(value.judges[0]?.phase).toBe("final");
	});

	test("rejects unknown finalDecision", () => {
		expect(() =>
			parseScenarioResult({
				scenarioId: "smoke-001",
				durationMs: 100,
				finalDecision: "unknown",
				judges: [
					{
						phase: "final",
						score: 90,
						pass: true,
						reasons: ["ok"],
					},
				],
			}),
		).toThrow("ScenarioResult validation failed");
	});
});
