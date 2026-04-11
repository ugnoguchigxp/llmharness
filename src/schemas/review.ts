import { z } from "zod";

export const ReviewSeveritySchema = z.enum([
	"error",
	"warning",
	"suggestion",
	"info",
]);

export type ReviewSeverity = z.infer<typeof ReviewSeveritySchema>;

export const ReviewFindingSchema = z.object({
	severity: ReviewSeveritySchema,
	file: z.string().optional(),
	line: z.number().int().positive().optional(),
	message: z.string(),
	suggestion: z.string().optional(),
});

export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

export const OverallAssessmentSchema = z.enum([
	"lgtm",
	"needs-changes",
	"major-issues",
]);

export type OverallAssessment = z.infer<typeof OverallAssessmentSchema>;

export const CodeReviewResultSchema = z.object({
	reviewedFiles: z.array(z.string()),
	findings: z.array(ReviewFindingSchema),
	summary: z.string(),
	overallAssessment: OverallAssessmentSchema,
	reviewedAt: z.string(),
	model: z.string().optional(),
});

export type CodeReviewResult = z.infer<typeof CodeReviewResultSchema>;
