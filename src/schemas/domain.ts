import { z } from "zod";

export const TokenUsageSchema = z
	.object({
		promptTokens: z.number().int().nonnegative(),
		completionTokens: z.number().int().nonnegative(),
		totalTokens: z.number().int().nonnegative(),
	})
	.strict();

export const GenerateResultSchema = z
	.object({
		patch: z.string().min(1),
		summary: z.string().optional(),
		tokenUsage: TokenUsageSchema.optional(),
		rawResponse: z.unknown().optional(),
	})
	.strict();

export const ApplyRejectSchema = z
	.object({
		path: z.string().min(1),
		reason: z.string().min(1),
		hunk: z.string().optional(),
	})
	.strict();

export const ApplyResultSchema = z
	.object({
		success: z.boolean(),
		patchedFiles: z.array(z.string().min(1)),
		rejects: z.array(ApplyRejectSchema).default([]),
		diagnostics: z.array(z.string()).default([]),
		diff: z.string().optional(),
	})
	.strict();

export const RiskLevelSchema = z.enum(["error", "warn", "info"]);

export const RiskFindingSchema = z
	.object({
		id: z.string().min(1),
		level: RiskLevelSchema,
		message: z.string().min(1),
		file: z.string().optional(),
		line: z.number().int().positive().optional(),
		ruleId: z.string().optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();

export const RiskResultSchema = z
	.object({
		levelCounts: z
			.object({
				error: z.number().int().nonnegative(),
				warn: z.number().int().nonnegative(),
				info: z.number().int().nonnegative(),
			})
			.strict(),
		findings: z.array(RiskFindingSchema),
		blocking: z.boolean(),
	})
	.strict();

export const JudgePhaseSchema = z.enum([
	"generation",
	"apply",
	"review",
	"test",
	"final",
]);

export const JudgeResultSchema = z
	.object({
		phase: JudgePhaseSchema,
		score: z.number().min(0).max(100),
		pass: z.boolean(),
		reasons: z.array(z.string()).min(1),
	})
	.strict();

export const ArtifactKindSchema = z.enum(["log", "diff", "report", "other"]);

export const ArtifactSchema = z
	.object({
		kind: ArtifactKindSchema,
		path: z.string().min(1),
	})
	.strict();

export const FinalDecisionSchema = z.enum(["pass", "fail", "error"]);

export const ScenarioResultSchema = z
	.object({
		scenarioId: z.string().min(1),
		durationMs: z.number().int().nonnegative(),
		artifacts: z.array(ArtifactSchema).default([]),
		finalDecision: FinalDecisionSchema,
		generate: GenerateResultSchema.optional(),
		apply: ApplyResultSchema.optional(),
		risk: RiskResultSchema.optional(),
		judges: z.array(JudgeResultSchema).default([]),
	})
	.strict();

export type TokenUsage = z.infer<typeof TokenUsageSchema>;
export type GenerateResult = z.infer<typeof GenerateResultSchema>;
export type ApplyReject = z.infer<typeof ApplyRejectSchema>;
export type ApplyResult = z.infer<typeof ApplyResultSchema>;
export type RiskLevel = z.infer<typeof RiskLevelSchema>;
export type RiskFinding = z.infer<typeof RiskFindingSchema>;
export type RiskResult = z.infer<typeof RiskResultSchema>;
export type JudgePhase = z.infer<typeof JudgePhaseSchema>;
export type JudgeResult = z.infer<typeof JudgeResultSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type FinalDecision = z.infer<typeof FinalDecisionSchema>;
export type ScenarioResult = z.infer<typeof ScenarioResultSchema>;
