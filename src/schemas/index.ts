import type { ZodError, z } from "zod";
import { type HarnessConfig, HarnessConfigSchema } from "./config";
import {
	type ApplyResult,
	ApplyResultSchema,
	type GenerateResult,
	GenerateResultSchema,
	type JudgeResult,
	JudgeResultSchema,
	type PersonaReviewResult,
	PersonaReviewResultSchema,
	type RiskResult,
	RiskResultSchema,
	type ScenarioResult,
	ScenarioResultSchema,
} from "./domain";
import { type Requirements, RequirementsSchema } from "./requirements";
import { type ScenarioInput, ScenarioInputSchema } from "./scenario";

export * from "./config";
export * from "./domain";
export * from "./requirements";
export * from "./review";
export * from "./scenario";

const formatIssuePath = (path: PropertyKey[]): string =>
	path.length > 0 ? path.map((item) => String(item)).join(".") : "(root)";

export const formatZodError = (error: ZodError): string =>
	error.issues
		.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`)
		.join("; ");

const safeParseOrThrow = <T>(
	schema: z.ZodSchema<T>,
	input: unknown,
	name: string,
): T => {
	const result = schema.safeParse(input);
	if (result.success) {
		return result.data;
	}
	throw new Error(`${name} validation failed: ${formatZodError(result.error)}`);
};

export const parseHarnessConfig = (input: unknown): HarnessConfig =>
	safeParseOrThrow(HarnessConfigSchema, input, "HarnessConfig");

export const parseScenarioInput = (input: unknown): ScenarioInput =>
	safeParseOrThrow(ScenarioInputSchema, input, "ScenarioInput");

export const parseGenerateResult = (input: unknown): GenerateResult =>
	safeParseOrThrow(GenerateResultSchema, input, "GenerateResult");

export const parseApplyResult = (input: unknown): ApplyResult =>
	safeParseOrThrow(ApplyResultSchema, input, "ApplyResult");

export const parseRiskResult = (input: unknown): RiskResult =>
	safeParseOrThrow(RiskResultSchema, input, "RiskResult");

export const parseJudgeResult = (input: unknown): JudgeResult =>
	safeParseOrThrow(JudgeResultSchema, input, "JudgeResult");

export const parseScenarioResult = (input: unknown): ScenarioResult =>
	safeParseOrThrow(ScenarioResultSchema, input, "ScenarioResult");

export const parseRequirements = (input: unknown): Requirements =>
	safeParseOrThrow(RequirementsSchema, input, "Requirements");

export const parsePersonaReviewResult = (input: unknown): PersonaReviewResult =>
	safeParseOrThrow(PersonaReviewResultSchema, input, "PersonaReviewResult");
