import type { CollectedContext } from "../context/contextCollector";
import type {
	ApplyResult,
	GenerateResult,
	HarnessConfig,
	RiskResult,
	ScenarioInput,
} from "../schemas";

export type GenerationFeedback = {
	attempt: number;
	previousIssues: string[];
	previousRejects: Array<{ path: string; reason: string }>;
};

export type GenerationInput = {
	scenario: ScenarioInput;
	config: HarnessConfig;
	memoryContext?: string;
	feedback?: GenerationFeedback;
	contextData?: CollectedContext;
};

export type GenerationAdapter = (
	input: GenerationInput,
) => Promise<GenerateResult>;

export type PatchApplyInput = {
	patch: string;
	targetFiles: string[];
	config: HarnessConfig;
};

export type PatchApplierAdapter = (
	input: PatchApplyInput,
) => Promise<ApplyResult>;

export type RiskReviewInput = {
	patch: string;
	config: HarnessConfig;
	sourceFiles?: string[];
};

export type RiskReviewerAdapter = (
	input: RiskReviewInput,
) => Promise<RiskResult>;

const generatorRegistry = new Map<string, GenerationAdapter>();
const patchApplierRegistry = new Map<string, PatchApplierAdapter>();
const riskReviewerRegistry = new Map<string, RiskReviewerAdapter>();

const warnOverwrite = (kind: string, name: string): void => {
	console.warn(
		`[adapter-registry] overwriting existing ${kind} adapter: ${name}`,
	);
};

export const registerPatchGenerator = (
	name: string,
	adapter: GenerationAdapter,
): void => {
	if (generatorRegistry.has(name)) {
		warnOverwrite("generator", name);
	}
	generatorRegistry.set(name, adapter);
};

export const resolvePatchGenerator = (
	name: string,
): GenerationAdapter | undefined => {
	return generatorRegistry.get(name);
};

export const registerPatchApplier = (
	format: string,
	adapter: PatchApplierAdapter,
): void => {
	if (patchApplierRegistry.has(format)) {
		warnOverwrite("patch applier", format);
	}
	patchApplierRegistry.set(format, adapter);
};

export const resolvePatchApplier = (
	format: string,
): PatchApplierAdapter | undefined => {
	return patchApplierRegistry.get(format);
};

export const registerRiskReviewer = (
	name: string,
	adapter: RiskReviewerAdapter,
): void => {
	if (riskReviewerRegistry.has(name)) {
		warnOverwrite("risk reviewer", name);
	}
	riskReviewerRegistry.set(name, adapter);
};

export const resolveRiskReviewer = (
	name: string,
): RiskReviewerAdapter | undefined => {
	return riskReviewerRegistry.get(name);
};

export const listRegisteredAdapterNames = (): {
	generators: string[];
	patchAppliers: string[];
	riskReviewers: string[];
} => ({
	generators: [...generatorRegistry.keys()].sort(),
	patchAppliers: [...patchApplierRegistry.keys()].sort(),
	riskReviewers: [...riskReviewerRegistry.keys()].sort(),
});
