import {
	type CriterionEvaluation,
	type HarnessConfig,
	type JudgeResult,
	parseJudgeResult,
	type Requirements,
} from "../schemas";
import { postJson } from "../utils/http";
import { tryParseJson } from "../utils/json";
import { extractLlmText, readApiKey, resolveApiUrl } from "../utils/llm";

type OpenAICompatibleResponse = {
	choices?: Array<{
		message?: {
			content?: unknown;
		};
	}>;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const buildJudgePrompt = (
	successCriteria: string[],
	patch: string,
	judgeReasons: string[],
): string => {
	const criteriaList = successCriteria
		.map((c, i) => `${i + 1}. ${c}`)
		.join("\n");

	const reasonsText =
		judgeReasons.length > 0
			? judgeReasons.map((r) => `- ${r}`).join("\n")
			: "(none)";

	const patchPreview =
		patch.length > 2000 ? `${patch.slice(0, 2000)}\n...[truncated]` : patch;

	return [
		"You are a code review judge. Evaluate whether a code patch satisfies each success criterion.",
		"",
		"## Patch",
		patchPreview,
		"",
		"## Pipeline Judge Output",
		reasonsText,
		"",
		"## Success Criteria",
		criteriaList,
		"",
		"For each criterion, evaluate whether the patch and judge output provide evidence of satisfaction.",
		"Respond with ONLY a JSON array — no markdown fences, no explanation.",
		"Each element must have these fields: criterion (string), pass (boolean), reasoning (string), confidence (number 0.0-1.0).",
		'Example: [{"criterion":"...","pass":true,"reasoning":"...","confidence":0.9}]',
	].join("\n");
};

const parseEvaluations = (
	raw: string,
	successCriteria: string[],
	confidenceThreshold: number,
): CriterionEvaluation[] | null => {
	const trimmed = raw.trim();

	const startIdx = trimmed.indexOf("[");
	const endIdx = trimmed.lastIndexOf("]");
	if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;

	const parsed = tryParseJson(trimmed.slice(startIdx, endIdx + 1));
	if (!Array.isArray(parsed)) return null;

	const evaluations: CriterionEvaluation[] = [];
	for (const item of parsed) {
		if (!isRecord(item)) continue;
		if (typeof item.criterion !== "string") continue;
		if (typeof item.pass !== "boolean") continue;
		if (typeof item.reasoning !== "string") continue;
		const rawConf =
			typeof item.confidence === "number" ? item.confidence : undefined;
		const confidence =
			rawConf !== undefined && Number.isFinite(rawConf)
				? Math.max(0, Math.min(1, rawConf))
				: 0.5;

		evaluations.push({
			criterion: item.criterion,
			pass: item.pass && confidence >= confidenceThreshold,
			reasoning: item.reasoning || "(no reasoning provided)",
			confidence,
		});
	}

	if (evaluations.length === 0) return null;

	// Align to successCriteria order, filling missing entries as uncertain
	const aligned = successCriteria.map((criterion) => {
		const found = evaluations.find(
			(e) => e.criterion.toLowerCase() === criterion.toLowerCase(),
		);
		if (found) return found;
		// fallback: best-effort substring match
		const fuzzy = evaluations.find((e) =>
			criterion.toLowerCase().includes(e.criterion.toLowerCase().slice(0, 20)),
		);
		if (fuzzy) return { ...fuzzy, criterion };
		return {
			criterion,
			pass: false,
			reasoning: "No evaluation returned by LLM for this criterion.",
			confidence: 0,
		};
	});

	return aligned;
};

const callLlmApi = async (
	prompt: string,
	config: HarnessConfig,
): Promise<string> => {
	const judgeConfig = config.judges;
	const llmConfig = judgeConfig.llm;

	const apiBaseUrl =
		llmConfig?.apiBaseUrl ?? config.adapters.localLlm.apiBaseUrl;
	if (!apiBaseUrl) {
		throw new Error(
			"LLM judge requires an API base URL. Set judges.llm.apiBaseUrl or adapters.localLlm.apiBaseUrl in config.",
		);
	}

	const apiPath = llmConfig?.apiPath ?? "/v1/chat/completions";
	const apiKeyEnv =
		llmConfig?.apiKeyEnv ??
		config.adapters.localLlm.apiKeyEnv ??
		"LOCAL_LLM_API_KEY";
	const model = llmConfig?.model ?? config.adapters.localLlm.model ?? "default";
	const temperature = llmConfig?.temperature ?? 0;
	const timeoutMs = llmConfig?.timeoutMs ?? 60000;

	const url = resolveApiUrl(apiBaseUrl, apiPath);
	const apiKey = readApiKey(apiKeyEnv);

	const response = await postJson<OpenAICompatibleResponse>(
		url,
		{
			model,
			temperature,
			messages: [
				{
					role: "system",
					content:
						"You are a strict code review judge. Respond only with a valid JSON array.",
				},
				{ role: "user", content: prompt },
			],
		},
		timeoutMs,
		apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
	);

	const content = extractLlmText(response.choices?.[0]?.message?.content);
	if (!content) {
		throw new Error("LLM judge: empty response from API.");
	}
	return content;
};

export const runLlmRequirementsJudge = async (
	requirements: Requirements | undefined,
	judges: JudgeResult[],
	patch: string,
	config: HarnessConfig,
): Promise<JudgeResult> => {
	if (!requirements) {
		return parseJudgeResult({
			phase: "requirements",
			score: 0,
			pass: true,
			reasons: ["No requirements defined; requirements judge skipped."],
		});
	}

	const successCriteria = requirements.successCriteria ?? [];
	if (successCriteria.length === 0) {
		return parseJudgeResult({
			phase: "requirements",
			score: 100,
			pass: true,
			reasons: [
				`Requirements '${requirements.title}' loaded; no successCriteria to evaluate.`,
			],
		});
	}

	const judgeReasons = judges.flatMap((j) => j.reasons);
	const prompt = buildJudgePrompt(successCriteria, patch, judgeReasons);
	const confidenceThreshold = config.judges.confidenceThreshold;

	let rawContent: string;
	try {
		rawContent = await callLlmApi(prompt, config);
	} catch (error) {
		throw new Error(
			`LLM judge call failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	const evaluations = parseEvaluations(
		rawContent,
		successCriteria,
		confidenceThreshold,
	);
	if (!evaluations) {
		return parseJudgeResult({
			phase: "requirements",
			score: 0,
			pass: false,
			reasons: [
				"LLM judge: could not parse response as criterion evaluations.",
				`Raw response (first 300 chars): ${rawContent.slice(0, 300)}`,
			],
		});
	}

	const passedCount = evaluations.filter((e) => e.pass).length;
	const score = Math.round((passedCount / successCriteria.length) * 100);
	const pass = score >= 50;

	const reasons = [
		`LLM judge: ${passedCount}/${successCriteria.length} criteria satisfied`,
		...evaluations.map(
			(e) =>
				`[${e.pass ? "pass" : "fail"}] "${e.criterion}" — ${e.reasoning} (confidence: ${e.confidence.toFixed(2)})`,
		),
	];

	return parseJudgeResult({
		phase: "requirements",
		score,
		pass,
		reasons,
		criterionEvaluations: evaluations,
	});
};
