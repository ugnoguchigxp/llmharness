/**
 * Contract tests for the requirements loader.
 * These tests verify the stable interface contract of loadRequirementsSafe and
 * resolveAndLoadRequirements: callers can rely on the shape of the returned
 * discriminated union regardless of internal implementation details.
 */
import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import {
	loadRequirementsSafe,
	resolveAndLoadRequirements,
	toRequirementsContext,
} from "../../../src/requirements/loadRequirements";

// ---------------------------------------------------------------------------
// Contract 1: loadRequirementsSafe discriminated union shape
// ---------------------------------------------------------------------------

describe("loadRequirementsSafe — discriminated union contract", () => {
	test("undefined path → returns undefined (no summary produced)", async () => {
		const result = await loadRequirementsSafe(undefined);
		expect(result).toBeUndefined();
	});

	test("missing file → ok=false, validationStatus=not_found, loaded=false", async () => {
		const result = await loadRequirementsSafe("does/not/exist.json");
		expect(result).not.toBeUndefined();
		expect(result?.ok).toBe(false);
		if (result && !result.ok) {
			expect(result.summary.validationStatus).toBe("not_found");
			expect(result.summary.loaded).toBe(false);
			expect(result.summary.successCriteriaCount).toBe(0);
			expect(result.summary.reviewPersonasCount).toBe(0);
		}
	});

	test("invalid schema file → ok=false, validationStatus=invalid, loaded=false", async () => {
		const tmpPath = join(resolve("."), "test", "fixtures", "contract-bad.json");
		await Bun.write(tmpPath, JSON.stringify({ garbage: true }));

		const result = await loadRequirementsSafe(tmpPath);
		expect(result?.ok).toBe(false);
		if (result && !result.ok) {
			expect(result.summary.validationStatus).toBe("invalid");
			expect(result.summary.loaded).toBe(false);
		}

		await Bun.file(tmpPath)
			.exists()
			.then(async (e) => {
				if (e) {
					const { unlinkSync } = await import("node:fs");
					unlinkSync(tmpPath);
				}
			});
	});

	test("valid file → ok=true, validationStatus=valid, loaded=true, counts correct", async () => {
		const result = await loadRequirementsSafe(
			"requirements/smoke-001.requirements.json",
		);
		expect(result?.ok).toBe(true);
		if (result?.ok) {
			expect(result.summary.validationStatus).toBe("valid");
			expect(result.summary.loaded).toBe(true);
			expect(typeof result.summary.successCriteriaCount).toBe("number");
			expect(typeof result.summary.reviewPersonasCount).toBe("number");
			expect(result.summary.successCriteriaCount).toBeGreaterThan(0);
			expect(result.summary.reviewPersonasCount).toBeGreaterThan(0);
		}
	});

	test("valid file → ok=true arm includes requirements object matching summary", async () => {
		const result = await loadRequirementsSafe(
			"requirements/smoke-001.requirements.json",
		);
		if (result?.ok) {
			expect(result.requirements.id).toBe(result.summary.id);
			expect(result.requirements.title).toBe(result.summary.title);
			expect(result.requirements.successCriteria?.length ?? 0).toBe(
				result.summary.successCriteriaCount,
			);
		}
	});
});

// ---------------------------------------------------------------------------
// Contract 2: resolveAndLoadRequirements convention behaviour
// ---------------------------------------------------------------------------

describe("resolveAndLoadRequirements — convention contract", () => {
	test("explicit path that exists → loads successfully (same as loadRequirementsSafe)", async () => {
		const result = await resolveAndLoadRequirements(
			"smoke-001",
			"requirements/smoke-001.requirements.json",
		);
		expect(result?.ok).toBe(true);
	});

	test("explicit path that is missing → returns not_found (user made a typo)", async () => {
		const result = await resolveAndLoadRequirements(
			"smoke-001",
			"requirements/no-such.requirements.json",
		);
		expect(result?.ok).toBe(false);
		if (result && !result.ok) {
			expect(result.summary.validationStatus).toBe("not_found");
		}
	});

	test("no path, convention file exists → auto-discovered", async () => {
		const result = await resolveAndLoadRequirements("smoke-001");
		expect(result?.ok).toBe(true);
		if (result?.ok) {
			expect(result.summary.validationStatus).toBe("valid");
		}
	});

	test("no path, convention file absent → returns undefined (silent, no noise)", async () => {
		const result = await resolveAndLoadRequirements("scenario-with-no-req");
		expect(result).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Contract 3: toRequirementsContext projection
// ---------------------------------------------------------------------------

describe("toRequirementsContext — projection contract", () => {
	test("undefined input → undefined output", () => {
		expect(toRequirementsContext(undefined)).toBeUndefined();
	});

	test("ok=false result → undefined (failed load produces no context)", async () => {
		const result = await loadRequirementsSafe("no/such/file.json");
		expect(toRequirementsContext(result)).toBeUndefined();
	});

	test("ok=true result → RequirementsContext with both requirements and summary", async () => {
		const result = await loadRequirementsSafe(
			"requirements/smoke-001.requirements.json",
		);
		const ctx = toRequirementsContext(result);
		expect(ctx).not.toBeUndefined();
		expect(ctx?.requirements).toBeDefined();
		expect(ctx?.summary).toBeDefined();
		expect(ctx?.summary.validationStatus).toBe("valid");
	});
});
