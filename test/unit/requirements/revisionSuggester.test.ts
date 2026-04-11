import { describe, expect, test } from "bun:test";
import { generateRevisionSuggestions } from "../../../src/requirements/revisionSuggester";
import { parseJudgeResult, parseRequirements } from "../../../src/schemas";

describe("generateRevisionSuggestions", () => {
	test("returns empty suggestions without requirements", () => {
		const suggestions = generateRevisionSuggestions(undefined, "fail", []);
		expect(suggestions).toEqual([]);
	});

	test("returns empty suggestions when final decision is pass", () => {
		const requirements = parseRequirements({
			id: "req-pass",
			title: "Passing case",
			task: "No revision needed",
			successCriteria: ["Typecheck passes"],
		});
		const suggestions = generateRevisionSuggestions(requirements, "pass", []);
		expect(suggestions).toEqual([]);
	});

	test("suggests untestable successCriteria when no matching judge signal exists", () => {
		const requirements = parseRequirements({
			id: "req-untestable",
			title: "Untestable criteria",
			task: "Detect missing signal",
			successCriteria: ["Database migration checksum validation"],
		});
		const judges = [
			parseJudgeResult({
				phase: "final",
				score: 10,
				pass: false,
				reasons: ["typecheck failed due to syntax error"],
			}),
		];

		const suggestions = generateRevisionSuggestions(
			requirements,
			"fail",
			judges,
		);
		expect(suggestions.length).toBeGreaterThan(0);
		expect(suggestions[0]).toContain("no matching judge signal");
		expect(suggestions[0]).toContain("Database migration checksum validation");
	});

	test("suggests revising constraints when failure reasons overlap", () => {
		const requirements = parseRequirements({
			id: "req-constraints",
			title: "Constraint overlap",
			task: "Detect conflict",
			successCriteria: ["Ensure evaluation passes"],
			constraints: ["No dangerous eval usage"],
		});
		const judges = [
			parseJudgeResult({
				phase: "review",
				score: 0,
				pass: false,
				reasons: ["dangerous eval usage found in patch"],
			}),
		];

		const suggestions = generateRevisionSuggestions(
			requirements,
			"fail",
			judges,
		);
		expect(
			suggestions.some((s) => s.includes("overlap with constraint keywords")),
		).toBe(true);
	});

	test("falls back to generic suggestion when no specific signal is found", () => {
		const requirements = parseRequirements({
			id: "req-fallback",
			title: "Fallback",
			task: "No specific signal",
			successCriteria: ["Typecheck passes cleanly"],
		});
		const judges = [
			parseJudgeResult({
				phase: "final",
				score: 30,
				pass: false,
				reasons: [
					"typecheck passes cleanly but total score is below threshold",
				],
			}),
		];

		const suggestions = generateRevisionSuggestions(
			requirements,
			"fail",
			judges,
		);
		expect(suggestions).toEqual([
			"Scenario failed but no specific revision signal found. Review successCriteria alignment with pipeline judges.",
		]);
	});
});
