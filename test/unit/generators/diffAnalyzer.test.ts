import { describe, expect, test } from "bun:test";
import {
	parseNumStatLine,
	parseDiffAnalysisFromRawOutput,
} from "../../../src/generators/diffAnalyzer";

// ---------------------------------------------------------------------------
// Fixtures: sample output as would be produced by git commands
// ---------------------------------------------------------------------------

const LOG_BUGFIX = [
	"abc1234567890def1234567890abcdef12345678",
	"parent0000000000000000000000000000000000",
	"fix: handle null pointer in parser",
	"Alice",
	"2026-01-15 10:23:45 +0900",
].join("\n");

const NUMSTAT_BUGFIX = [
	"8\t3\tsrc/parser.ts",
	"2\t0\tsrc/utils/errors.ts",
].join("\n");

const LOG_MERGE = [
	"merge0000000000000000000000000000000000",
	"parent1111111111111111 parent2222222222222222",
	"Merge branch 'feature/foo' into main",
	"Bob",
	"2026-01-16 09:00:00 +0900",
].join("\n");

const NUMSTAT_MERGE = "5\t2\tsrc/index.ts\n";

const LOG_FEATURE_MULTIFILE = [
	"feat0000000000000000000000000000000000ab",
	"base0000000000000000000000000000000000",
	"feat: add CSV export endpoint",
	"Carol",
	"2026-02-01 14:00:00 +0900",
].join("\n");

const NUMSTAT_FEATURE_MULTIFILE = [
	"30\t0\tsrc/routes/export.ts",
	"12\t5\tsrc/services/exportService.ts",
	"0\t0\tassets/data.bin",   // binary file (- -)
	"18\t4\ttest/routes/export.test.ts",
].join("\n");

const LOG_RENAMED = [
	"ren00000000000000000000000000000000000a",
	"base0000000000000000000000000000000000",
	"refactor: rename helper module",
	"Dave",
	"2026-03-01 11:00:00 +0000",
].join("\n");

const NUMSTAT_RENAMED = "10\t10\tsrc/old.ts => src/new.ts\n";

// ---------------------------------------------------------------------------

describe("parseNumStatLine", () => {
	test("parses a standard addition/deletion line", () => {
		const f = parseNumStatLine("8\t3\tsrc/parser.ts");
		expect(f).not.toBeNull();
		expect(f?.path).toBe("src/parser.ts");
		expect(f?.additions).toBe(8);
		expect(f?.deletions).toBe(3);
		expect(f?.isNew).toBe(false);
		expect(f?.isDeleted).toBe(false);
		expect(f?.isRenamed).toBe(false);
	});

	test("marks file as new when deletions are 0 and additions > 0", () => {
		const f = parseNumStatLine("5\t0\tsrc/new.ts");
		expect(f?.isNew).toBe(true);
		expect(f?.isDeleted).toBe(false);
	});

	test("marks file as deleted when additions are 0 and deletions > 0", () => {
		const f = parseNumStatLine("0\t10\tsrc/old.ts");
		expect(f?.isDeleted).toBe(true);
		expect(f?.isNew).toBe(false);
	});

	test("handles binary files represented as dashes", () => {
		const f = parseNumStatLine("-\t-\tassets/image.png");
		expect(f).not.toBeNull();
		expect(f?.additions).toBe(0);
		expect(f?.deletions).toBe(0);
	});

	test("parses renamed file and extracts destination path", () => {
		const f = parseNumStatLine("10\t10\tsrc/old.ts => src/new.ts");
		expect(f?.isRenamed).toBe(true);
		expect(f?.path).toBe("src/new.ts");
	});

	test("returns null for malformed line", () => {
		expect(parseNumStatLine("")).toBeNull();
		expect(parseNumStatLine("8")).toBeNull();
		expect(parseNumStatLine("abc\tdef\tsrc/a.ts")).toBeNull();
	});
});

describe("parseDiffAnalysisFromRawOutput", () => {
	test("parses a simple bugfix commit correctly", () => {
		const result = parseDiffAnalysisFromRawOutput("abc1234567890def1234567890abcdef12345678", {
			logOutput: LOG_BUGFIX,
			numstatOutput: NUMSTAT_BUGFIX,
		});

		expect(result.commitHash).toBe("abc1234567890def1234567890abcdef12345678");
		expect(result.commitMessage).toBe("fix: handle null pointer in parser");
		expect(result.author).toBe("Alice");
		expect(result.isMergeCommit).toBe(false);
		expect(result.category).toBe("bugfix");
		expect(result.files).toHaveLength(2);
		expect(result.totalAdditions).toBe(10);
		expect(result.totalDeletions).toBe(3);
		expect(result.complexity).toBe("simple");
	});

	test("detects merge commit from multiple parents", () => {
		const result = parseDiffAnalysisFromRawOutput("merge0000000000000000000000000000000000", {
			logOutput: LOG_MERGE,
			numstatOutput: NUMSTAT_MERGE,
		});
		expect(result.isMergeCommit).toBe(true);
	});

	test("parses multi-file feature commit", () => {
		const result = parseDiffAnalysisFromRawOutput("feat0000000000000000000000000000000000ab", {
			logOutput: LOG_FEATURE_MULTIFILE,
			numstatOutput: NUMSTAT_FEATURE_MULTIFILE,
		});

		expect(result.category).toBe("feature");
		expect(result.files).toHaveLength(4);
		expect(result.totalAdditions).toBe(60);
		expect(result.totalDeletions).toBe(9);
	});

	test("correctly computes complexity for moderate change", () => {
		const result = parseDiffAnalysisFromRawOutput("feat0000000000000000000000000000000000ab", {
			logOutput: LOG_FEATURE_MULTIFILE,
			numstatOutput: NUMSTAT_FEATURE_MULTIFILE,
		});
		expect(result.complexity).toBe("moderate");
	});

	test("handles renamed files", () => {
		const result = parseDiffAnalysisFromRawOutput("ren00000000000000000000000000000000000a", {
			logOutput: LOG_RENAMED,
			numstatOutput: NUMSTAT_RENAMED,
		});
		expect(result.files[0]?.isRenamed).toBe(true);
		expect(result.files[0]?.path).toBe("src/new.ts");
	});

	test("handles empty numstat (no changed files)", () => {
		const result = parseDiffAnalysisFromRawOutput("abc", {
			logOutput: LOG_BUGFIX,
			numstatOutput: "",
		});
		expect(result.files).toHaveLength(0);
		expect(result.totalAdditions).toBe(0);
		expect(result.totalDeletions).toBe(0);
		expect(result.complexity).toBe("trivial");
	});
});
