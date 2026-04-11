import { describe, expect, test } from "bun:test";
import { comparePatches, runGoldenPatchJudge } from "../../../src/judges/goldenPatchJudge";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir, cleanupTempDir } from "../../contract/utils/tempCli";

const SAMPLE_GOLDEN_PATCH = `diff --git a/src/parser.ts b/src/parser.ts
index abc..def 100644
--- a/src/parser.ts
+++ b/src/parser.ts
@@ -1,5 +1,6 @@
 export function parse(input: string) {
+  if (!input) return null;
   return JSON.parse(input);
 }
`;

const MATCHING_PATCH = `--- a/src/parser.ts
+++ b/src/parser.ts
@@ -1,4 +1,5 @@
 export function parse(input: string) {
+  if (!input) return null;
   return JSON.parse(input);
 }
`;

const DIFFERENT_FILE_PATCH = `--- a/src/other.ts
+++ b/src/other.ts
@@ -1,3 +1,4 @@
 export const foo = 1;
+export const bar = 2;
`;

describe("comparePatches", () => {
	test("identical patches have max similarity", () => {
		const result = comparePatches(SAMPLE_GOLDEN_PATCH, SAMPLE_GOLDEN_PATCH);
		expect(result.fileOverlap).toBeCloseTo(1, 1);
		expect(result.semanticSimilarity).toBeGreaterThan(0.8);
	});

	test("similar patches (same file, same change) have high similarity", () => {
		const result = comparePatches(MATCHING_PATCH, SAMPLE_GOLDEN_PATCH);
		expect(result.fileOverlap).toBeGreaterThan(0.5);
	});

	test("completely different files have low file overlap", () => {
		const result = comparePatches(DIFFERENT_FILE_PATCH, SAMPLE_GOLDEN_PATCH);
		expect(result.fileOverlap).toBeLessThan(0.5);
	});

	test("empty generated patch has zero similarity", () => {
		const result = comparePatches("", SAMPLE_GOLDEN_PATCH);
		expect(result.fileOverlap).toBe(0);
		expect(result.semanticSimilarity).toBe(0);
	});
});

describe("runGoldenPatchJudge", () => {
	test("returns fail when golden patch file does not exist", async () => {
		const result = await runGoldenPatchJudge(MATCHING_PATCH, "/nonexistent/path.patch");
		expect(result.phase).toBe("golden");
		expect(result.pass).toBe(false);
		expect(result.reasons[0]).toContain("not found");
	});

	test("returns pass for matching patch", async () => {
		const dir = await createTempDir("llmharness-golden-judge");
		try {
			const goldenPath = join(dir, "golden.patch");
			await writeFile(goldenPath, SAMPLE_GOLDEN_PATCH, "utf-8");

			const result = await runGoldenPatchJudge(MATCHING_PATCH, goldenPath);
			expect(result.phase).toBe("golden");
			expect(result.pass).toBe(true);
			expect(result.score).toBeGreaterThan(30);
		} finally {
			await cleanupTempDir(dir);
		}
	});

	test("returns fail for completely different patch", async () => {
		const dir = await createTempDir("llmharness-golden-judge-fail");
		try {
			const goldenPath = join(dir, "golden.patch");
			await writeFile(goldenPath, SAMPLE_GOLDEN_PATCH, "utf-8");

			const result = await runGoldenPatchJudge(DIFFERENT_FILE_PATCH, goldenPath);
			expect(result.phase).toBe("golden");
			expect(result.pass).toBe(false);
		} finally {
			await cleanupTempDir(dir);
		}
	});
});
