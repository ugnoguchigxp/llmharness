import { resolve } from "node:path";
import {
	type ApplyResult,
	type HarnessConfig,
	parseApplyResult,
} from "../schemas";
import { runCommand } from "../utils/exec";
import { postJson } from "../utils/http";
import { tryParseJson } from "../utils/json";

export type AstmendApplyInput = {
	patch: string;
	targetFiles: string[];
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
	changed: boolean;
	updatedText: string;
	diff: string;
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
): Promise<ApplyResult> => {
	const astmendConfig = config.adapters.astmend;
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
				result.diff.length > 0 ? "diff generated" : "diff empty",
			],
			diff: result.diff,
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

export const applyWithAstmend = async (
	input: AstmendApplyInput,
): Promise<ApplyResult> => {
	const { patch, targetFiles, config } = input;
	const astmendConfig = config.adapters.astmend;

	if (patch.trim().length === 0) {
		return parseApplyResult({
			success: false,
			patchedFiles: [],
			rejects: targetFiles.map((path) => ({ path, reason: "Empty patch" })),
			diagnostics: ["Patch is empty."],
		});
	}

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

	const cliResult = await runCommand(astmendConfig.command, {
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
			const viaLib = await applyWithAstmendLib(patch, targetFiles, config);
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
