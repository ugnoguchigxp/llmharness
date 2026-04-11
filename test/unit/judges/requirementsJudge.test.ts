import { describe, expect, test } from "bun:test";
import { runRequirementsJudge } from "../../../src/judges/requirementsJudge";
import { parseJudgeResult, parseRequirements } from "../../../src/schemas";

describe("runRequirementsJudge", () => {
	test("skips evaluation when requirements are undefined", () => {
		const judge = runRequirementsJudge(undefined, []);
		expect(judge.phase).toBe("requirements");
		expect(judge.pass).toBe(true);
		expect(judge.score).toBe(0);
		expect(judge.reasons[0]).toContain("skipped");
	});

	test("returns pass when successCriteria are not defined", () => {
		const requirements = parseRequirements({
			id: "req-1",
			title: "No criteria",
			task: "Check baseline behavior",
		});

		const judge = runRequirementsJudge(requirements, []);
		expect(judge.pass).toBe(true);
		expect(judge.score).toBe(100);
		expect(judge.reasons[0]).toContain("no successCriteria");
	});

	test("scores based on criteria coverage from judge reasons", () => {
		const requirements = parseRequirements({
			id: "req-2",
			title: "Coverage",
			task: "Validate criteria coverage",
			successCriteria: [
				"Pipeline terminates within maxAttempts iterations",
				"Feedback includes apply rejection reason",
			],
		});

		const judges = [
			parseJudgeResult({
				phase: "final",
				score: 40,
				pass: false,
				reasons: [
					"pipeline terminates safely when maxattempts is reached",
					"risk threshold was not met",
				],
			}),
		];

		const judge = runRequirementsJudge(requirements, judges);
		expect(judge.score).toBe(50);
		expect(judge.pass).toBe(true);
		expect(judge.reasons).toContain("successCriteria coverage: 1/2 matched");
		expect(judge.reasons.some((r) => r.startsWith("[unmatched]"))).toBe(true);
	});
});
