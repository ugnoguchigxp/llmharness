import { z } from "zod";

export const ReviewPersonaSchema = z
	.object({
		name: z.string().min(1),
		role: z.string().optional(),
		focus: z.array(z.string().min(1)).min(1),
	})
	.strict();

export const RequirementsSchema = z
	.object({
		id: z.string().min(1),
		title: z.string().min(1),
		task: z.string().min(1),
		audience: z.string().optional(),
		constraints: z.array(z.string().min(1)).optional(),
		successCriteria: z.array(z.string().min(1)).optional(),
		nonGoals: z.array(z.string().min(1)).optional(),
		risks: z.array(z.string().min(1)).optional(),
		reviewPersonas: z.array(ReviewPersonaSchema).optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();

export type ReviewPersona = z.infer<typeof ReviewPersonaSchema>;
export type Requirements = z.infer<typeof RequirementsSchema>;
