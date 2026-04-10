import { resolve } from "node:path";
import {
	type GenerateResult,
	type HarnessConfig,
	parseGenerateResult,
	type ScenarioInput,
} from "../schemas";
import { runCommand } from "../utils/exec";
import { postJson } from "../utils/http";
import { tryParseJson } from "../utils/json";

export type LocalLlmInput = {
	scenario: ScenarioInput;
	config: HarnessConfig;
};

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

const buildPrompt = (scenario: ScenarioInput): string => {
	return [
		"You are a code-fix model.",
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
		`Scenario ID: ${scenario.id}`,
		`Title: ${scenario.title}`,
		`Target files: ${scenario.targetFiles.join(", ")}`,
		"Instruction:",
		scenario.instruction,
	].join("\n");
};

const resolveUrl = (baseUrl: string, path: string): string => {
	return new URL(
		path,
		baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
	).toString();
};

const readApiKey = (envName: string): string | undefined => {
	const value = process.env[envName];
	return typeof value === "string" && value.length > 0 ? value : undefined;
};

const extractContent = (content: unknown): string | undefined => {
	if (typeof content === "string") {
		return content.trim();
	}
	if (!Array.isArray(content)) {
		return undefined;
	}

	const textParts = content
		.map((item) => {
			if (!isRecord(item)) {
				return undefined;
			}
			return typeof item.text === "string" ? item.text : undefined;
		})
		.filter((item): item is string => typeof item === "string");
	return textParts.join("\n").trim();
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

const normalizePatchOperation = (
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

const parseCliOutput = (
	stdout: string,
	scenario: ScenarioInput,
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
				patch: normalizePatchOperation(stdout.trim(), scenario),
				summary: `CLI generation for ${scenario.id}`,
				rawResponse: parsed,
			});
		}

		return parseGenerateResult({
			patch: normalizePatchOperation(patch, scenario),
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
		patch: normalizePatchOperation(patch, scenario),
		summary: `CLI generation for ${scenario.id}`,
	});
};

const shellQuote = (value: string): string => {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
};

export const generateWithLocalLlm = async (
	input: LocalLlmInput,
): Promise<GenerateResult> => {
	const { scenario, config } = input;
	const llmConfig = config.adapters.localLlm;
	const prompt = buildPrompt(scenario);
	const workspaceRoot = resolve(config.workspaceRoot);

	if (llmConfig.mode === "api") {
		if (!llmConfig.apiBaseUrl) {
			throw new Error(
				"localLlm api mode requires adapters.localLlm.apiBaseUrl in config.",
			);
		}

		const url = resolveUrl(llmConfig.apiBaseUrl, llmConfig.apiPath);
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

		const content = extractContent(response.choices?.[0]?.message?.content);
		if (!content || content.length === 0) {
			throw new Error(
				"localLlm API response does not include choices[0].message.content.",
			);
		}

		return parseGenerateResult({
			patch: normalizePatchOperation(content, scenario),
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

	let command = llmConfig.command;
	let stdin: string | undefined = prompt;
	const placeholder = llmConfig.commandPromptPlaceholder;

	if (command.includes(placeholder)) {
		command = command.split(placeholder).join(shellQuote(prompt));
		stdin = undefined;
	} else if (llmConfig.commandPromptMode === "arg") {
		command = `${command} ${shellQuote(prompt)}`;
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

	return parseCliOutput(cliResult.stdout, scenario);
};
