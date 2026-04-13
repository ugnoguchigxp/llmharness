import { resolve } from "node:path";
import type {
	HarnessConfig,
	PersonaReviewResult,
	ReviewPersona,
} from "../schemas";
import { parsePersonaReviewResult } from "../schemas";
import { runCommand } from "../utils/exec";
import { postJson } from "../utils/http";
import { tryParseJson } from "../utils/json";
import {
	extractLlmText,
	readApiKey,
	resolveApiUrl,
	shellQuoteLlm,
} from "../utils/llm";
import { resolveCommandPath } from "../utils/resolve";

type OpenAICompatibleResponse = {
	choices?: Array<{ message?: { content?: unknown } }>;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const buildReviewPrompt = (
	persona: ReviewPersona,
	patch: string,
	scenarioTitle: string,
): string => {
	const roleNote = persona.role ? ` (${persona.role})` : "";
	const focusNote = persona.focus.join(", ");
	return [
		`You are ${persona.name}${roleNote}.`,
		`Review the following patch for the scenario: "${scenarioTitle}".`,
		`Focus your review on: ${focusNote}.`,
		`Respond with exactly one JSON object: {"pass": true|false, "feedback": "<your review>"}`,
		`Do not include markdown fences. Output must start with "{" and end with "}".`,
		"",
		"Patch:",
		patch,
	].join("\n");
};

const parseReviewResponse = (
	raw: string,
	persona: ReviewPersona,
): PersonaReviewResult => {
	const parsed = tryParseJson(raw);
	if (isRecord(parsed)) {
		const pass =
			typeof parsed.pass === "boolean"
				? parsed.pass
				: String(parsed.pass).toLowerCase() === "true";
		const feedback =
			typeof parsed.feedback === "string" && parsed.feedback.trim().length > 0
				? parsed.feedback.trim()
				: raw.trim() || "No feedback provided.";
		return parsePersonaReviewResult({
			personaName: persona.name,
			personaRole: persona.role,
			feedback,
			pass,
		});
	}

	return parsePersonaReviewResult({
		personaName: persona.name,
		personaRole: persona.role,
		feedback: raw.trim() || "No feedback provided.",
		pass: false,
	});
};

export const reviewWithPersona = async (
	persona: ReviewPersona,
	patch: string,
	scenarioTitle: string,
	config: HarnessConfig,
): Promise<PersonaReviewResult> => {
	const llmConfig = config.adapters.localLlm;
	const prompt = buildReviewPrompt(persona, patch, scenarioTitle);

	if (llmConfig.mode === "api") {
		if (!llmConfig.apiBaseUrl) {
			return parsePersonaReviewResult({
				personaName: persona.name,
				personaRole: persona.role,
				feedback: "Persona review skipped: api mode requires apiBaseUrl.",
				pass: true,
			});
		}

		try {
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
							content: "You are a code reviewer. Output only JSON.",
						},
						{ role: "user", content: prompt },
					],
				},
				llmConfig.timeoutMs,
				apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
			);
			const content = extractLlmText(response.choices?.[0]?.message?.content);
			if (!content) {
				return parsePersonaReviewResult({
					personaName: persona.name,
					personaRole: persona.role,
					feedback: "Persona review: empty API response.",
					pass: true,
				});
			}
			return parseReviewResponse(content, persona);
		} catch (error) {
			return parsePersonaReviewResult({
				personaName: persona.name,
				personaRole: persona.role,
				feedback: `Persona review failed: ${error instanceof Error ? error.message : String(error)}`,
				pass: true,
			});
		}
	}

	try {
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

		const result = await runCommand(command, {
			cwd: resolve(config.workspaceRoot),
			stdin,
			timeoutMs: llmConfig.timeoutMs,
		});

		if (result.exitCode !== 0) {
			return parsePersonaReviewResult({
				personaName: persona.name,
				personaRole: persona.role,
				feedback: `Persona review CLI failed (exit=${result.exitCode}).`,
				pass: true,
			});
		}

		return parseReviewResponse(result.stdout, persona);
	} catch (error) {
		return parsePersonaReviewResult({
			personaName: persona.name,
			personaRole: persona.role,
			feedback: `Persona review failed: ${error instanceof Error ? error.message : String(error)}`,
			pass: true,
		});
	}
};
