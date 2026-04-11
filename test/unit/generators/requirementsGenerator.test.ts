import { describe, expect, test } from "bun:test";
import type { DiffAnalysis } from "../../../src/generators/diffAnalyzer";
import { generateRequirementsFromDiff } from "../../../src/generators/requirementsGenerator";

const makeAnalysis = (overrides: Partial<DiffAnalysis> = {}): DiffAnalysis => ({
	commitHash: "abc1234567890def",
	commitMessage: "fix: handle null pointer in parser",
	author: "Alice",
	date: "2026-01-01",
	files: [
		{
			path: "src/parser.ts",
			additions: 8,
			deletions: 3,
			isNew: false,
			isDeleted: false,
			isRenamed: false,
		},
	],
	totalAdditions: 8,
	totalDeletions: 3,
	complexity: "simple",
	category: "bugfix",
	isMergeCommit: false,
	...overrides,
});

describe("generateRequirementsFromDiff", () => {
	test("generates id derived from commit hash with -req suffix", () => {
		const req = generateRequirementsFromDiff(makeAnalysis());
		expect(req.id).toBe("auto-abc12345-req");
	});

	test("uses commit message as title", () => {
		const req = generateRequirementsFromDiff(makeAnalysis());
		expect(req.title).toBe("fix: handle null pointer in parser");
	});

	test("task references the commit message", () => {
		const req = generateRequirementsFromDiff(makeAnalysis());
		expect(req.task).toContain("fix: handle null pointer in parser");
	});

	test("constraints include file list and complexity", () => {
		const req = generateRequirementsFromDiff(makeAnalysis());
		const constraints = req.constraints ?? [];
		expect(constraints.some((c) => c.includes("src/parser.ts"))).toBe(true);
		expect(constraints.some((c) => c.includes("simple"))).toBe(true);
	});

	test("successCriteria contains at least the baseline criteria", () => {
		const req = generateRequirementsFromDiff(makeAnalysis());
		const criteria = req.successCriteria ?? [];
		expect(criteria.length).toBeGreaterThanOrEqual(2);
		expect(criteria.some((c) => c.includes("src/parser.ts"))).toBe(true);
	});

	test("adds bugfix-specific criterion for bugfix category", () => {
		const req = generateRequirementsFromDiff(
			makeAnalysis({ category: "bugfix" }),
		);
		const criteria = req.successCriteria ?? [];
		expect(criteria.some((c) => c.toLowerCase().includes("bug"))).toBe(true);
	});

	test("adds feature-specific criterion for feature category", () => {
		const req = generateRequirementsFromDiff(
			makeAnalysis({ category: "feature" }),
		);
		const criteria = req.successCriteria ?? [];
		expect(criteria.some((c) => c.toLowerCase().includes("feature"))).toBe(
			true,
		);
	});

	test("adds refactor-specific criterion for refactor category", () => {
		const req = generateRequirementsFromDiff(
			makeAnalysis({ category: "refactor" }),
		);
		const criteria = req.successCriteria ?? [];
		expect(criteria.some((c) => c.toLowerCase().includes("behavior"))).toBe(
			true,
		);
	});

	test("adds test-specific criterion for test category", () => {
		const req = generateRequirementsFromDiff(
			makeAnalysis({ category: "test" }),
		);
		const criteria = req.successCriteria ?? [];
		expect(criteria.some((c) => c.toLowerCase().includes("test"))).toBe(true);
	});

	test("reviewPersonas is empty by default", () => {
		const req = generateRequirementsFromDiff(makeAnalysis());
		expect(req.reviewPersonas).toEqual([]);
	});

	test("parses as valid Requirements schema", () => {
		const req = generateRequirementsFromDiff(makeAnalysis());
		expect(req.id).toBeTruthy();
		expect(req.title).toBeTruthy();
		expect(req.task).toBeTruthy();
	});
});
