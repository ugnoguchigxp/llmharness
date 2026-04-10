import { z } from "zod";

export const LocalLlmModeSchema = z.enum(["api", "cli"]);
export const AstmendModeSchema = z.enum(["api", "cli", "lib"]);
export const DiffGuardModeSchema = z.enum(["api", "cli"]);
export const PromptModeSchema = z.enum(["stdin", "arg"]);

export const LocalLlmConfigSchema = z
	.object({
		mode: LocalLlmModeSchema.default("cli"),
		apiBaseUrl: z.string().url().optional(),
		apiPath: z.string().min(1).default("/v1/chat/completions"),
		apiKeyEnv: z.string().min(1).default("LOCAL_LLM_API_KEY"),
		command: z.string().min(1).default("localLlm --json"),
		commandPromptMode: PromptModeSchema.default("stdin"),
		commandPromptPlaceholder: z.string().min(1).default("{{prompt}}"),
		model: z.string().min(1),
		timeoutMs: z.number().int().positive().default(30000),
		temperature: z.number().min(0).max(2).default(0),
	})
	.strict();

export const AstmendConfigSchema = z
	.object({
		mode: AstmendModeSchema.default("lib"),
		endpoint: z.string().url().optional(),
		apiPath: z.string().min(1).default("/apply"),
		command: z.string().min(1).default("astmend apply --json"),
		enableLibFallback: z.boolean().default(true),
		libEntrypoint: z.string().min(1).default("../Astmend/dist/index.js"),
		timeoutMs: z.number().int().positive().default(15000),
	})
	.strict();

export const DiffGuardConfigSchema = z
	.object({
		mode: DiffGuardModeSchema.default("cli"),
		endpoint: z.string().url().optional(),
		apiPath: z.string().min(1).default("/review"),
		command: z.string().min(1).default("diffguard --format json"),
		timeoutMs: z.number().int().positive().default(15000),
	})
	.strict();

export const HarnessChecksConfigSchema = z
	.object({
		runTypecheck: z.boolean().default(true),
		typecheckCommand: z.string().min(1).default("bun run typecheck"),
		runTests: z.boolean().default(true),
		testCommand: z.string().min(1).default("bun test"),
	})
	.strict();

export const MemoryConfigSchema = z
	.object({
		enabled: z.boolean().default(false),
		mode: z.enum(["cli", "mcp"]).default("cli"),
		gnosisPath: z.string().min(1).default("../gnosis"),
		sessionId: z.string().min(1).default("llmharness"),
		ragLimit: z.number().int().positive().default(5),
		verifyCommands: z
			.array(z.string())
			.default(["bun run lint", "bun run typecheck", "bun test"]),
		git: z
			.object({
				autoCommit: z.boolean().default(false),
				autoPush: z.boolean().default(false),
				commitMessagePrefix: z.string().default("harness: "),
			})
			.default({
				autoCommit: false,
				autoPush: false,
				commitMessagePrefix: "harness: ",
			}),
	})
	.strict();

export const HarnessScoringConfigSchema = z
	.object({
		syntaxWeight: z.number().int().nonnegative().default(30),
		testWeight: z.number().int().nonnegative().default(30),
		riskWeight: z.number().int().nonnegative().default(20),
		minimalityWeight: z.number().int().nonnegative().default(10),
		instructionWeight: z.number().int().nonnegative().default(10),
		passThreshold: z.number().min(0).max(100).default(80),
	})
	.strict();

export const HarnessConfigSchema = z
	.object({
		runtime: z.literal("bun"),
		workspaceRoot: z.string().min(1),
		artifactsDir: z.string().min(1).default("artifacts/runs"),
		adapters: z
			.object({
				localLlm: LocalLlmConfigSchema,
				astmend: AstmendConfigSchema,
				diffGuard: DiffGuardConfigSchema,
				memory: MemoryConfigSchema.default({
					enabled: false,
					mode: "cli",
					gnosisPath: "../gnosis",
					sessionId: "llmharness",
					ragLimit: 5,
					verifyCommands: ["bun run lint", "bun run typecheck", "bun test"],
					git: {
						autoCommit: false,
						autoPush: false,
						commitMessagePrefix: "harness: ",
					},
				}),
			})
			.strict(),
		checks: HarnessChecksConfigSchema.default({
			runTypecheck: true,
			typecheckCommand: "bun run typecheck",
			runTests: true,
			testCommand: "bun test",
		}),
		scoring: HarnessScoringConfigSchema.default({
			syntaxWeight: 30,
			testWeight: 30,
			riskWeight: 20,
			minimalityWeight: 10,
			instructionWeight: 10,
			passThreshold: 80,
		}),
	})
	.strict();

export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;
export type LocalLlmMode = z.infer<typeof LocalLlmModeSchema>;
export type AstmendMode = z.infer<typeof AstmendModeSchema>;
export type DiffGuardMode = z.infer<typeof DiffGuardModeSchema>;
export type LocalLlmConfig = z.infer<typeof LocalLlmConfigSchema>;
export type AstmendConfig = z.infer<typeof AstmendConfigSchema>;
export type DiffGuardConfig = z.infer<typeof DiffGuardConfigSchema>;
export type HarnessChecksConfig = z.infer<typeof HarnessChecksConfigSchema>;
export type HarnessScoringConfig = z.infer<typeof HarnessScoringConfigSchema>;
export type HarnessConfig = z.infer<typeof HarnessConfigSchema>;
