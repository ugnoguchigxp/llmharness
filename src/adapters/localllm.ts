import { resolve } from "node:path";
import {
	type GenerateResult,
	type HarnessConfig,
	type LocalLlmConfigCandidate,
	parseGenerateResult,
	type ScenarioInput,
} from "../schemas";
import { runCommand } from "../utils/exec";
import { postJson } from "../utils/http";
import { tryParseJson } from "../utils/json";
import {
	extractLlmText,
	readApiKey,
	resolveApiUrl,
	shellQuoteLlm,
} from "../utils/llm";
import { detectPatchFormat } from "./patchFormat";
import {
	type GenerationFeedback,
	type GenerationInput,
	registerPatchGenerator,
} from "./registry";
import { resolveCommandPath } from "../utils/resolve";

export type Feedback = GenerationFeedback;

export type LocalLlmInput = GenerationInput;

type OpenAICompatibleResponse = {
	choices?: Array<{
		message?: {
			content?: unknown;
		};
	}>;
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
	};
};

type NamedImport = {
	name: string;
	alias?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const toNonEmptyString = (value: unknown, fallback: string): string => {
	if (typeof value === "string" && value.trim().length > 0) {
		return value.trim();
	}
	return fallback;
};

const toNamedImports = (value: unknown): NamedImport[] => {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.flatMap((item) => {
		if (!isRecord(item)) {
			return [];
		}
		if (typeof item.name !== "string" || item.name.trim().length === 0) {
			return [];
		}
		return [
			{
				name: item.name.trim(),
				alias:
					typeof item.alias === "string" && item.alias.trim().length > 0
						? item.alias.trim()
						: undefined,
			},
		];
	});
};

const toFiniteNumber = (value: unknown): number => {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return 0;
};

const buildPrompt = (input: LocalLlmInput): string => {
	const { scenario, feedback, config, contextData } = input;
	const format = config.adapters.astmend.patchFormat;
	const parts = [
		"You are a code-fix model.",
		`Scenario ID: ${scenario.id}`,
		`Title: ${scenario.title}`,
		`Target files: ${scenario.targetFiles.join(", ")}`,
	];

	if (format === "astmend-json") {
		parts.push(
			"Return exactly one JSON object for Astmend patch operation.",
			'Do not include markdown fences or explanation. Output must start with "{" and end with "}".',
			"Required top-level fields: type, file.",
			"Allowed `type` values: update_function, update_interface, add_import, remove_import, update_constructor.",
			"Schema hints:",
			'- update_function: {"type":"update_function","file":"...","name":"...","changes":{"add_param":{"name":"...","type":"..."}}}',
			'- update_interface: {"type":"update_interface","file":"...","name":"...","changes":{"add_property":{"name":"...","type":"...","optional":true}}}',
			'- add_import/remove_import: {"type":"add_import","file":"...","module":"...","named":[{"name":"..."}]}',
			'- update_constructor: {"type":"update_constructor","file":"...","class_name":"...","changes":{"add_param":{"name":"...","type":"..."}}}',
			"When unsure, choose a valid add_import operation for the first target file.",
		);
	} else if (format === "unified-diff") {
		parts.push(
			"Return only unified diff patch text.",
			'Do not include markdown fences or explanation. Start directly with diff headers such as "diff --git", "---", "+++", "@@".',
			"Patch must modify only target files.",
		);
	} else if (format === "file-replace") {
		parts.push(
			"Return one JSON object with full replacement content.",
			'Do not include markdown fences or explanation. Output must start with "{" and end with "}".',
			'Schema: {"file":"<target-file>","content":"<entire updated file content>"}',
			"Patch must modify only target files.",
		);
	} else {
		parts.push(
			"Return a patch in one of these formats: Astmend operation JSON, unified diff, or file-replace JSON.",
			"When possible, prefer unified diff for multi-line edits.",
			"Patch must modify only target files.",
			"Do not include markdown fences or explanation.",
		);
	}

	// Inject source context
	if (contextData && contextData.files.length > 0) {
		const targetFiles = contextData.files.filter((f) => f.role === "target");
		const typeFiles = contextData.files.filter((f) => f.role === "type");
		const testFiles = contextData.files.filter((f) => f.role === "test");
		const relatedFiles = contextData.files.filter((f) => f.role === "related");

		if (
			targetFiles.length > 0 ||
			typeFiles.length > 0 ||
			relatedFiles.length > 0
		) {
			parts.push("", "[Source Context]");
			for (const f of [...targetFiles, ...typeFiles, ...relatedFiles]) {
				const suffix = f.truncated ? " [truncated]" : "";
				parts.push(`--- ${f.path}${suffix} ---`, f.content, "");
			}
		}

		if (testFiles.length > 0) {
			parts.push("[Related Tests]");
			for (const f of testFiles) {
				const suffix = f.truncated ? " [truncated]" : "";
				parts.push(`--- ${f.path}${suffix} ---`, f.content, "");
			}
		}
	}

	if (feedback) {
		parts.push(`[Retry Feedback (Attempt ${feedback.attempt})]`);
		if (feedback.previousIssues.length > 0) {
			parts.push("Previous issues:");
			for (const issue of feedback.previousIssues) {
				parts.push(`- ${issue}`);
			}
		}
		if (feedback.previousRejects.length > 0) {
			parts.push("Previous patch rejections:");
			for (const reject of feedback.previousRejects) {
				parts.push(`- ${reject.path}: ${reject.reason}`);
			}
		}
		parts.push("");
	}

	parts.push("Instruction:");
	parts.push(scenario.instruction);
	return parts.join("\n");
};

const fallbackOperation = (
	scenario: ScenarioInput,
): Record<string, unknown> => {
	const targetFile = scenario.targetFiles[0] ?? "src/index.ts";
	return {
		type: "add_import",
		file: targetFile,
		module: "./schemas",
		named: [{ name: "ScenarioResultSchema" }],
	};
};

const normalizeAstmendPatchOperation = (
	rawPatch: string,
	scenario: ScenarioInput,
): string => {
	const parsed = tryParseJson(rawPatch);
	if (!isRecord(parsed)) {
		return JSON.stringify(fallbackOperation(scenario));
	}

	const type = toNonEmptyString(parsed.type, "");
	const file = toNonEmptyString(
		parsed.file,
		scenario.targetFiles[0] ?? "src/index.ts",
	);

	if (type === "add_import" || type === "remove_import") {
		const named = toNamedImports(parsed.named);
		return JSON.stringify({
			type,
			file,
			module: toNonEmptyString(parsed.module, "./schemas"),
			named: named.length > 0 ? named : [{ name: "ScenarioResultSchema" }],
		});
	}

	if (type === "update_function") {
		if (
			typeof parsed.name === "string" &&
			isRecord(parsed.changes) &&
			isRecord(parsed.changes.add_param)
		) {
			const addParam = parsed.changes.add_param;
			return JSON.stringify({
				type,
				file,
				name: parsed.name,
				changes: {
					add_param: {
						name: toNonEmptyString(addParam.name, "context"),
						type: toNonEmptyString(addParam.type, "unknown"),
					},
				},
			});
		}
		return JSON.stringify(fallbackOperation(scenario));
	}

	if (type === "update_interface") {
		if (
			typeof parsed.name === "string" &&
			isRecord(parsed.changes) &&
			isRecord(parsed.changes.add_property)
		) {
			const addProperty = parsed.changes.add_property;
			return JSON.stringify({
				type,
				file,
				name: parsed.name,
				changes: {
					add_property: {
						name: toNonEmptyString(addProperty.name, "extra"),
						type: toNonEmptyString(addProperty.type, "unknown"),
						optional:
							typeof addProperty.optional === "boolean"
								? addProperty.optional
								: true,
					},
				},
			});
		}
		return JSON.stringify(fallbackOperation(scenario));
	}

	if (type === "update_constructor") {
		if (
			typeof parsed.class_name === "string" &&
			isRecord(parsed.changes) &&
			isRecord(parsed.changes.add_param)
		) {
			const addParam = parsed.changes.add_param;
			return JSON.stringify({
				type,
				file,
				class_name: parsed.class_name,
				changes: {
					add_param: {
						name: toNonEmptyString(addParam.name, "options"),
						type: toNonEmptyString(addParam.type, "unknown"),
					},
				},
			});
		}
		return JSON.stringify(fallbackOperation(scenario));
	}

	return JSON.stringify(fallbackOperation(scenario));
};

const normalizeGeneratedPatch = (
	rawPatch: string,
	scenario: ScenarioInput,
	config: HarnessConfig,
): string => {
	const trimmed = rawPatch.trim();
	if (trimmed.length === 0) {
		return JSON.stringify(fallbackOperation(scenario));
	}

	const configuredFormat = config.adapters.astmend.patchFormat;
	const resolvedFormat =
		configuredFormat === "auto" ? detectPatchFormat(trimmed) : configuredFormat;

	if (resolvedFormat === "astmend-json") {
		return normalizeAstmendPatchOperation(trimmed, scenario);
	}

	return trimmed;
};

const parseCliOutput = (
	stdout: string,
	scenario: ScenarioInput,
	config: HarnessConfig,
): GenerateResult => {
	const parsed = tryParseJson(stdout);
	if (isRecord(parsed)) {
		const patch =
			typeof parsed.patch === "string"
				? parsed.patch
				: typeof parsed.response === "string"
					? parsed.response
					: undefined;
		if (!patch) {
			return parseGenerateResult({
				patch: normalizeGeneratedPatch(stdout.trim(), scenario, config),
				summary: `CLI generation for ${scenario.id}`,
				rawResponse: parsed,
			});
		}

		return parseGenerateResult({
			patch: normalizeGeneratedPatch(patch, scenario, config),
			summary:
				typeof parsed.summary === "string"
					? parsed.summary
					: `CLI generation for ${scenario.id}`,
			rawResponse: parsed,
			tokenUsage: isRecord(parsed.tokenUsage)
				? {
						promptTokens: toFiniteNumber(parsed.tokenUsage.promptTokens),
						completionTokens: toFiniteNumber(
							parsed.tokenUsage.completionTokens,
						),
						totalTokens: toFiniteNumber(parsed.tokenUsage.totalTokens),
					}
				: undefined,
		});
	}

	const patch = stdout.trim();
	if (patch.length === 0) {
		throw new Error("localLlm CLI returned empty output.");
	}

	return parseGenerateResult({
		patch: normalizeGeneratedPatch(patch, scenario, config),
		summary: `CLI generation for ${scenario.id}`,
	});
};

const generateWithLocalLlmCandidate = async (
	input: LocalLlmInput,
	llmConfig: LocalLlmConfigCandidate,
	prompt: string,
): Promise<GenerateResult> => {
	const { scenario, config } = input;
	const workspaceRoot = resolve(config.workspaceRoot);

	if (llmConfig.mode === "api") {
		if (!llmConfig.apiBaseUrl) {
			throw new Error(
				"localLlm api mode requires adapters.localLlm.apiBaseUrl in config.",
			);
		}

		const url = resolveApiUrl(llmConfig.apiBaseUrl, llmConfig.apiPath);
		const apiKey = readApiKey(llmConfig.apiKeyEnv);
		const response = await postJson<OpenAICompatibleResponse>(
			url,
			{
				model: llmConfig.model,
				temperature: llmConfig.temperature,
				messages: [
					{
						role: "system",
						content: "You output only patch text.",
					},
					{
						role: "user",
						content: prompt,
					},
				],
			},
			llmConfig.timeoutMs,
			apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
		);

		const content = extractLlmText(response.choices?.[0]?.message?.content);
		if (!content || content.length === 0) {
			throw new Error(
				"localLlm API response does not include choices[0].message.content.",
			);
		}

		return parseGenerateResult({
			patch: normalizeGeneratedPatch(content, scenario, config),
			summary: `API generation for ${scenario.id}`,
			tokenUsage: response.usage
				? {
						promptTokens: response.usage.prompt_tokens ?? 0,
						completionTokens: response.usage.completion_tokens ?? 0,
						totalTokens: response.usage.total_tokens ?? 0,
					}
				: undefined,
			rawResponse: response,
		});
	}

	let command = await resolveCommandPath(llmConfig.command, config);
	let stdin: string | undefined = prompt;
	const placeholder = llmConfig.commandPromptPlaceholder;

	if (command.includes(placeholder)) {
		command = command.split(placeholder).join(shellQuoteLlm(prompt));
		stdin = undefined;
	} else if (llmConfig.commandPromptMode === "arg") {
		command = `${command} ${shellQuoteLlm(prompt)}`;
		stdin = undefined;
	}

	const cliResult = await runCommand(command, {
		cwd: workspaceRoot,
		stdin,
		timeoutMs: llmConfig.timeoutMs,
	});
	if (cliResult.exitCode !== 0) {
		throw new Error(
			`localLlm CLI failed (exit=${cliResult.exitCode}): ${cliResult.stderr || cliResult.stdout}`,
		);
	}

	return parseCliOutput(cliResult.stdout, scenario, config);
};

export const generateWithLocalLlm = async (
	input: LocalLlmInput,
): Promise<GenerateResult> => {
	const { config, memoryContext } = input;
	const llmConfig = config.adapters.localLlm;
	const basePrompt = buildPrompt(input);
	const prompt = memoryContext
		? `[Memory Context]\n${memoryContext}\n\n[Task]\n${basePrompt}`
		: basePrompt;
	const candidates: LocalLlmConfigCandidate[] = [
		llmConfig,
		...llmConfig.fallbacks,
	];
	const failures: string[] = [];

	for (const [index, candidate] of candidates.entries()) {
		try {
			const result = await generateWithLocalLlmCandidate(
				input,
				candidate,
				prompt,
			);
			if (index === 0) {
				return result;
			}
			return parseGenerateResult({
				...result,
				summary:
					result.summary && !result.summary.includes("[fallback")
						? `${result.summary} [fallback ${index}]`
						: (result.summary ?? `generation succeeded via fallback ${index}`),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			failures.push(`candidate ${index} (${candidate.mode}): ${message}`);
		}
	}

	throw new Error(
		`localLlm failed across ${candidates.length} candidate(s): ${failures.join(" | ")}`,
	);
};

registerPatchGenerator("localLlm", generateWithLocalLlm);
