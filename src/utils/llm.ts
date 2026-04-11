/**
 * Common utilities shared across LLM adapter implementations.
 * Avoids duplication across localllm, personaReviewer, llmRequirementsJudge, and codeReviewer.
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Resolves an API path against a base URL with proper trailing-slash handling.
 */
export const resolveApiUrl = (base: string, path: string): string =>
	new URL(path, base.endsWith("/") ? base : `${base}/`).toString();

/**
 * Reads an API key from the environment. Returns undefined if not set or empty.
 */
export const readApiKey = (envName: string): string | undefined => {
	const v = process.env[envName];
	return typeof v === "string" && v.length > 0 ? v : undefined;
};

/**
 * Shell-quotes a string for safe embedding in subprocess CLI commands.
 */
export const shellQuoteLlm = (v: string): string =>
	`'${v.replace(/'/g, `'"'"'`)}'`;

/**
 * Extracts text from an OpenAI-compatible API response content field.
 * Handles both plain string and content-array formats (e.g. Claude/Gemini).
 * Returns undefined when the extracted text is empty.
 */
export const extractLlmText = (content: unknown): string | undefined => {
	if (typeof content === "string") {
		const trimmed = content.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	}
	if (!Array.isArray(content)) return undefined;
	const text = content
		.map((item) =>
			isRecord(item) && typeof item.text === "string" ? item.text : "",
		)
		.join("\n")
		.trim();
	return text.length > 0 ? text : undefined;
};
