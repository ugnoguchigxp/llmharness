import { resolve } from "node:path";
import {
	parseRequirements,
	type Requirements,
	type RequirementsSummary,
} from "../schemas";
import { exists, readJsonFile } from "../utils/fs";

export type RequirementsContext = {
	requirements: Requirements;
	summary: RequirementsSummary;
};

export type LoadRequirementsResult =
	| { ok: true; requirements: Requirements; summary: RequirementsSummary }
	| { ok: false; summary: RequirementsSummary };

const buildSummary = (requirements: Requirements): RequirementsSummary => ({
	id: requirements.id,
	title: requirements.title,
	loaded: true,
	validationStatus: "valid",
	successCriteriaCount: requirements.successCriteria?.length ?? 0,
	reviewPersonasCount: requirements.reviewPersonas?.length ?? 0,
});

export const loadRequirements = async (
	requirementsPath: string,
): Promise<Requirements> => {
	const resolved = resolve(requirementsPath);
	if (!(await exists(resolved))) {
		throw new Error(`Requirements file not found: ${requirementsPath}`);
	}
	const raw = await readJsonFile(resolved);
	return parseRequirements(raw);
};

export const loadRequirementsSafe = async (
	requirementsPath: string | undefined,
): Promise<LoadRequirementsResult | undefined> => {
	if (!requirementsPath) {
		return undefined;
	}

	const resolved = resolve(requirementsPath);

	if (!(await exists(resolved))) {
		return {
			ok: false,
			summary: {
				id: requirementsPath,
				title: requirementsPath,
				loaded: false,
				validationStatus: "not_found",
				successCriteriaCount: 0,
				reviewPersonasCount: 0,
			},
		};
	}

	try {
		const raw = await readJsonFile(resolved);
		const requirements = parseRequirements(raw);
		return {
			ok: true,
			requirements,
			summary: buildSummary(requirements),
		};
	} catch {
		return {
			ok: false,
			summary: {
				id: requirementsPath,
				title: requirementsPath,
				loaded: false,
				validationStatus: "invalid",
				successCriteriaCount: 0,
				reviewPersonasCount: 0,
			},
		};
	}
};

/**
 * B-3: Convention-based auto-discovery.
 * If requirementsPath is explicit → always use it (even if not_found → show warning).
 * If requirementsPath is absent → try requirements/<scenarioId>.requirements.json silently.
 *   Found   → load and return context.
 *   Missing → return undefined (no requirements, no noise).
 */
export const resolveAndLoadRequirements = async (
	scenarioId: string,
	requirementsPath?: string,
): Promise<LoadRequirementsResult | undefined> => {
	if (requirementsPath) {
		return loadRequirementsSafe(requirementsPath);
	}

	const conventionPath = `requirements/${scenarioId}.requirements.json`;
	const result = await loadRequirementsSafe(conventionPath);

	if (result && !result.ok && result.summary.validationStatus === "not_found") {
		return undefined;
	}

	return result;
};

export const toRequirementsContext = (
	result: LoadRequirementsResult | undefined,
): RequirementsContext | undefined => {
	if (!result?.ok) return undefined;
	return { requirements: result.requirements, summary: result.summary };
};
