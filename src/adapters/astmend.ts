import { resolve } from "node:path";
import {
	type ApplyResult,
	type AstmendConfigCandidate,
	type HarnessConfig,
	parseApplyResult,
} from "../schemas";
import { runCommand } from "../utils/exec";
import { postJson } from "../utils/http";
import { tryParseJson } from "../utils/json";
import { type PatchApplyInput, registerPatchApplier } from "./registry";
import { resolveCommandPath } from "../utils/resolve";

export type AstmendApplyInput = PatchApplyInput & {
	config: HarnessConfig;
};

type AstmendApiResponse = {
	success?: unknown;
	patchedFiles?: unknown;
	rejects?: unknown;
	diagnostics?: unknown;
	message?: unknown;
	diff?: unknown;
};

type AstmendLibPatchResult = {
	success?: unknown;
	patchedFiles?: unknown;
	rejects?: unknown;
	diagnostics?: unknown;
	diff?: unknown;
	updatedText?: unknown;
	changed?: unknown;
};

type AstmendLibModule = {
	applyPatchFromFile?: (input: unknown) => Promise<AstmendLibPatchResult>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const asStringArray = (value: unknown): string[] => {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is string => typeof item === "string");
};

const normalizeApplyResult = (
	payload: unknown,
	targetFiles: string[],
): ApplyResult => {
	if (!isRecord(payload)) {
		return parseApplyResult({
			success: false,
			patchedFiles: [],
			rejects: targetFiles.map((path) => ({
				path,
				reason: "Astmend output is not a JSON object.",
			})),
			diagnostics: ["Astmend output is not a JSON object."],
		});
	}

	const success = typeof payload.success === "boolean" ? payload.success : true;
	const patchedFiles = asStringArray(payload.patchedFiles);
	const rejects =
		Array.isArray(payload.rejects) && payload.rejects.length > 0
			? payload.rejects.flatMap((reject) => {
					if (!isRecord(reject)) {
						return [];
					}
					if (
						typeof reject.path !== "string" ||
						typeof reject.reason !== "string"
					) {
						return [];
					}
					return [
						{
							path: reject.path,
							reason: reject.reason,
							hunk: typeof reject.hunk === "string" ? reject.hunk : undefined,
						},
					];
				})
			: [];

	const diagnostics = [
		...asStringArray(payload.diagnostics),
		...(typeof payload.message === "string" ? [payload.message] : []),
	];

	return parseApplyResult({
		success,
		patchedFiles:
			patchedFiles.length > 0 ? patchedFiles : success ? targetFiles : [],
		rejects,
		diagnostics,
		diff: typeof payload.diff === "string" ? payload.diff : undefined,
	});
};

const resolveUrl = (baseUrl: string, path: string): string =>
	new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();

const ensurePatchOperation = (
	patch: string,
	targetFiles: string[],
): { operation?: Record<string, unknown>; error?: string } => {
	const parsed = tryParseJson(patch);
	if (!isRecord(parsed)) {
		return {
			error:
				"Patch is not a JSON object. Astmend library fallback requires Astmend operation JSON.",
		};
	}

	if (typeof parsed.type !== "string") {
		return {
			error: "Patch JSON does not include required field: type",
		};
	}

	const resolvedFile =
		typeof parsed.file === "string"
			? parsed.file
			: targetFiles.length > 0
				? targetFiles[0]
				: undefined;
	if (!resolvedFile) {
		return {
			error:
				"Patch JSON does not include file and no targetFiles were provided.",
		};
	}

	return {
		operation: {
			...parsed,
			file: resolvedFile,
		},
	};
};

const applyWithAstmendLib = async (
	patch: string,
	targetFiles: string[],
	config: HarnessConfig,
	astmendConfig: AstmendConfigCandidate,
): Promise<ApplyResult> => {
	const prepared = ensurePatchOperation(patch, targetFiles);
	if (!prepared.operation) {
		return parseApplyResult({
			success: false,
			patchedFiles: [],
			rejects: targetFiles.map((path) => ({
				path,
				reason: "Astmend library fallback could not parse patch operation.",
			})),
			diagnostics: [prepared.error ?? "Unknown Astmend patch parse error."],
		});
	}

	try {
		const entrypoint = resolve(
			config.workspaceRoot,
			astmendConfig.libEntrypoint,
		);
		const astmendModule = (await import(entrypoint)) as AstmendLibModule;
		if (typeof astmendModule.applyPatchFromFile !== "function") {
			return parseApplyResult({
				success: false,
				patchedFiles: [],
				rejects: targetFiles.map((path) => ({
					path,
					reason: "Astmend library entrypoint is missing applyPatchFromFile.",
				})),
				diagnostics: [`Invalid Astmend module: ${entrypoint}`],
			});
		}

		const result = await astmendModule.applyPatchFromFile(prepared.operation);

		if (
			isRecord(result) &&
			("success" in result ||
				"patchedFiles" in result ||
				"rejects" in result ||
				"diagnostics" in result)
		) {
			return normalizeApplyResult(result, targetFiles);
		}

		if (!isRecord(result) || typeof result.changed !== "boolean") {
			return parseApplyResult({
				success: false,
				patchedFiles: [],
				rejects: targetFiles.map((path) => ({
					path,
					reason:
						"Astmend library returned unsupported response shape from applyPatchFromFile.",
				})),
				diagnostics: ["Astmend library response shape is unsupported."],
			});
		}

		const patchedFile = String(
			prepared.operation.file ?? targetFiles[0] ?? "unknown.ts",
		);
		return parseApplyResult({
			success: result.changed,
			patchedFiles: result.changed ? [patchedFile] : [],
			rejects: result.changed
				? []
				: [
						{
							path: patchedFile,
							reason: "Astmend operation completed but no change was produced.",
						},
					],
			diagnostics: [
				"Astmend library fallback executed.",
				typeof result.diff === "string" && result.diff.length > 0
					? "diff generated"
					: "diff empty",
			],
			diff: typeof result.diff === "string" ? result.diff : undefined,
		});
	} catch (error) {
		return parseApplyResult({
			success: false,
			patchedFiles: [],
			rejects: targetFiles.map((path) => ({
				path,
				reason: "Astmend library fallback failed.",
			})),
			diagnostics: [error instanceof Error ? error.message : String(error)],
		});
	}
};

const TECHNICAL_FAILURE_TOKENS = [
	"failed",
	"error",
	"timeout",
	"not configured",
	"invalid",
	"unsupported",
	"cli",
	"api",
	"library",
	"endpoint",
];

const SEMANTIC_FAILURE_TOKENS = [
	"outside targetfiles",
	"unsafe path",
	"ambiguous",
	"does not include",
	"no change was produced",
];

const collectFailureTexts = (result: ApplyResult): string[] => {
	return [
		...result.diagnostics,
		...result.rejects.map((reject) => reject.reason),
	].map((item) => item.toLowerCase());
};

const isSemanticFailure = (result: ApplyResult): boolean => {
	const texts = collectFailureTexts(result);
	return texts.some((text) =>
		SEMANTIC_FAILURE_TOKENS.some((token) => text.includes(token)),
	);
};

const isTechnicalFailure = (result: ApplyResult): boolean => {
	const texts = collectFailureTexts(result);
	return texts.some((text) =>
		TECHNICAL_FAILURE_TOKENS.some((token) => text.includes(token)),
	);
};

const shouldTryFallbackCandidate = (result: ApplyResult): boolean => {
	if (result.success) return false;
	if (isSemanticFailure(result)) return false;
	return isTechnicalFailure(result);
};

const applyWithAstmendCandidate = async (
	input: AstmendApplyInput,
	astmendConfig: AstmendConfigCandidate,
): Promise<ApplyResult> => {
	const { patch, targetFiles, config } = input;

	if (astmendConfig.mode === "api") {
		if (!astmendConfig.endpoint) {
			return parseApplyResult({
				success: false,
				patchedFiles: [],
				rejects: targetFiles.map((path) => ({
					path,
					reason: "Astmend api mode requires adapters.astmend.endpoint",
				})),
				diagnostics: ["Astmend endpoint is not configured."],
			});
		}

		try {
			const url = resolveUrl(astmendConfig.endpoint, astmendConfig.apiPath);
			const response = await postJson<AstmendApiResponse>(
				url,
				{
					patch,
					targetFiles,
				},
				astmendConfig.timeoutMs,
			);
			return normalizeApplyResult(response, targetFiles);
		} catch (error) {
			return parseApplyResult({
				success: false,
				patchedFiles: [],
				rejects: targetFiles.map((path) => ({
					path,
					reason: "Astmend API call failed.",
				})),
				diagnostics: [error instanceof Error ? error.message : String(error)],
			});
		}
	}

	if (astmendConfig.mode === "lib") {
		return applyWithAstmendLib(patch, targetFiles, config, astmendConfig);
	}

	const command = await resolveCommandPath(astmendConfig.command, config);
	const cliResult = await runCommand(command, {
		cwd: resolve(config.workspaceRoot),
		stdin: patch,
		timeoutMs: astmendConfig.timeoutMs,
	});
	const parsed = tryParseJson(cliResult.stdout);
	if (parsed) {
		const normalized = normalizeApplyResult(parsed, targetFiles);
		if (cliResult.exitCode !== 0 && normalized.success) {
			return parseApplyResult({
				...normalized,
				success: false,
				diagnostics: [
					...normalized.diagnostics,
					`Astmend CLI exited with code ${cliResult.exitCode}.`,
					cliResult.stderr.trim(),
				].filter((item) => item.length > 0),
			});
		}
		return normalized;
	}

	if (cliResult.exitCode !== 0) {
		if (astmendConfig.enableLibFallback) {
			const viaLib = await applyWithAstmendLib(
				patch,
				targetFiles,
				config,
				astmendConfig,
			);
			if (viaLib.success) {
				return parseApplyResult({
					...viaLib,
					diagnostics: [
						`Astmend CLI failed (exit=${cliResult.exitCode}), recovered by library fallback.`,
						...viaLib.diagnostics,
					],
				});
			}
			return parseApplyResult({
				...viaLib,
				diagnostics: [
					`Astmend CLI failed (exit=${cliResult.exitCode}).`,
					cliResult.stderr.trim(),
					...viaLib.diagnostics,
				].filter((item) => item.length > 0),
			});
		}

		return parseApplyResult({
			success: false,
			patchedFiles: [],
			rejects: targetFiles.map((path) => ({
				path,
				reason: `Astmend CLI failed with exit code ${cliResult.exitCode}.`,
			})),
			diagnostics: [cliResult.stderr.trim(), cliResult.stdout.trim()].filter(
				(item) => item.length > 0,
			),
		});
	}

	return parseApplyResult({
		success: true,
		patchedFiles: [...targetFiles],
		diagnostics: [
			"Astmend CLI succeeded without JSON output. Falling back to target files.",
		],
	});
};

export const applyWithAstmend = async (
	input: AstmendApplyInput,
): Promise<ApplyResult> => {
	const { patch, targetFiles, config } = input;
	const astmendConfig = config.adapters.astmend;
	const candidates: AstmendConfigCandidate[] = [
		astmendConfig,
		...astmendConfig.fallbacks,
	];

	if (patch.trim().length === 0) {
		return parseApplyResult({
			success: false,
			patchedFiles: [],
			rejects: targetFiles.map((path) => ({ path, reason: "Empty patch" })),
			diagnostics: ["Patch is empty."],
		});
	}

	let lastResult: ApplyResult | undefined;
	const failures: string[] = [];

	for (const [index, candidate] of candidates.entries()) {
		const result = await applyWithAstmendCandidate(input, candidate);
		lastResult = result;
		if (result.success) {
			if (index === 0) return result;
			return parseApplyResult({
				...result,
				diagnostics: [
					`Astmend succeeded via fallback candidate ${index}.`,
					...result.diagnostics,
				],
			});
		}

		failures.push(
			`candidate ${index} (${candidate.mode}): ${
				result.diagnostics.join(" | ") ||
				result.rejects.map((reject) => reject.reason).join(" | ") ||
				"unknown failure"
			}`,
		);

		const hasNext = index < candidates.length - 1;
		if (!hasNext || !shouldTryFallbackCandidate(result)) {
			return result;
		}
	}

	if (lastResult) {
		return parseApplyResult({
			...lastResult,
			diagnostics: [
				...lastResult.diagnostics,
				`All Astmend fallback candidates failed: ${failures.join(" || ")}`,
			],
		});
	}

	return parseApplyResult({
		success: false,
		patchedFiles: [],
		rejects: targetFiles.map((path) => ({
			path,
			reason: "Astmend did not produce a result.",
		})),
		diagnostics: ["Astmend fallback execution ended without result."],
	});
};

registerPatchApplier("astmend-json", applyWithAstmend);
