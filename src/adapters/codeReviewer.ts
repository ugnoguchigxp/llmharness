import { resolve } from "node:path";
import type { HarnessConfig } from "../schemas";
import {
	type CodeReviewResult,
	CodeReviewResultSchema,
	type ReviewFinding,
	ReviewFindingSchema,
} from "../schemas/review";
import { runCommand } from "../utils/exec";
import { postJson } from "../utils/http";
import { tryParseJson } from "../utils/json";
import {
	extractLlmText,
	readApiKey,
	resolveApiUrl,
	shellQuoteLlm,
} from "../utils/llm";

export type ReviewableFile = {
	path: string;
	content: string;
};

export type CodeReviewInput = {
	files: ReviewableFile[];
	config: HarnessConfig;
};

type OpenAICompatibleResponse = {
	choices?: Array<{ message?: { content?: unknown } }>;
	model?: string;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const toOverallAssessment = (
	value: unknown,
): "lgtm" | "needs-changes" | "major-issues" => {
	if (
		value === "lgtm" ||
		value === "needs-changes" ||
		value === "major-issues"
	) {
		return value;
	}
	return "needs-changes";
};

const buildReviewPrompt = (files: ReviewableFile[]): string => {
	const fileSections = files
		.map((f) => `--- ${f.path} ---\n${f.content}`)
		.join("\n\n");

	return [
		"You are an expert code reviewer with deep knowledge of TypeScript best practices,",
		"security, performance, and software design.",
		"",
		"Review the following file(s) and provide structured feedback.",
		"",
		"[Files to Review]",
		fileSections,
		"",
		"Return exactly one JSON object:",
		"{",
		'  "findings": [',
		"    {",
		'      "severity": "error|warning|suggestion|info",',
		'      "file": "<path or null>",',
		'      "line": <number or null>,',
		'      "message": "<issue description>",',
		'      "suggestion": "<how to fix>"',
		"    }",
		"  ],",
		'  "summary": "<overall review in 2-3 sentences>",',
		'  "overallAssessment": "lgtm|needs-changes|major-issues"',
		"}",
		"",
		"severity meanings:",
		"- error: must fix — breaks functionality or introduces bugs",
		"- warning: should fix — potential bugs or bad practices",
		"- suggestion: nice to have improvement",
		"- info: informational, no action required",
		"",
		'Do not include markdown fences. Output must start with "{" and end with "}".',
	].join("\n");
};

const parseReviewResponse = (
	raw: string,
	files: ReviewableFile[],
	model?: string,
): CodeReviewResult => {
	const now = new Date().toISOString();
	const reviewedFiles = files.map((f) => f.path);

	const parsed = tryParseJson(raw);
	if (isRecord(parsed)) {
		const findings: ReviewFinding[] = [];
		if (Array.isArray(parsed.findings)) {
			for (const item of parsed.findings) {
				if (!isRecord(item)) continue;
				const result = ReviewFindingSchema.safeParse(item);
				if (result.success) {
					findings.push(result.data);
				}
			}
		}

		const summary =
			typeof parsed.summary === "string" && parsed.summary.trim().length > 0
				? parsed.summary.trim()
				: "Review completed.";

		return CodeReviewResultSchema.parse({
			reviewedFiles,
			findings,
			summary,
			overallAssessment: toOverallAssessment(parsed.overallAssessment),
			reviewedAt: now,
			model,
		});
	}

	return CodeReviewResultSchema.parse({
		reviewedFiles,
		findings: [],
		summary: raw.trim() || "Review completed (unparseable response).",
		overallAssessment: "needs-changes",
		reviewedAt: now,
		model,
	});
};

export const reviewCode = async (
	input: CodeReviewInput,
): Promise<CodeReviewResult> => {
	const { files, config } = input;

	if (files.length === 0) {
		return CodeReviewResultSchema.parse({
			reviewedFiles: [],
			findings: [],
			summary: "No files provided for review.",
			overallAssessment: "lgtm",
			reviewedAt: new Date().toISOString(),
		});
	}

	const llmConfig = config.adapters.localLlm;
	const prompt = buildReviewPrompt(files);

	if (llmConfig.mode === "api") {
		if (!llmConfig.apiBaseUrl) {
			throw new Error(
				"code-review requires adapters.localLlm.apiBaseUrl when mode is 'api'.",
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
						content:
							"You are an expert code reviewer. Output only JSON without markdown fences.",
					},
					{ role: "user", content: prompt },
				],
			},
			llmConfig.timeoutMs,
			apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
		);

		const content = extractLlmText(response.choices?.[0]?.message?.content);
		if (!content) {
			throw new Error("code-review: empty API response from LLM.");
		}

		return parseReviewResponse(
			content,
			files,
			response.model ?? llmConfig.model,
		);
	}

	let command = llmConfig.command;
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
		throw new Error(
			`code-review: LLM CLI failed (exit=${result.exitCode}): ${result.stderr || result.stdout}`,
		);
	}

	return parseReviewResponse(result.stdout, files, llmConfig.model);
};
