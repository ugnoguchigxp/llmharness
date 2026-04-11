import { resolve } from "node:path";
import type { ApplyResult } from "../schemas";
import { parseApplyResult } from "../schemas";
import { writeTextFile } from "../utils/fs";
import { tryParseJson } from "../utils/json";
import type { AstmendApplyInput } from "./astmend";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const resolveFileReplacePayload = (
	patch: string,
	targetFiles: string[],
): { file?: string; content?: string; error?: string } => {
	const parsed = tryParseJson(patch);
	if (isRecord(parsed)) {
		const file =
			typeof parsed.file === "string"
				? parsed.file
				: typeof parsed.path === "string"
					? parsed.path
					: undefined;
		const content =
			typeof parsed.content === "string"
				? parsed.content
				: typeof parsed.updatedText === "string"
					? parsed.updatedText
					: undefined;
		if (file && content !== undefined) {
			return { file, content };
		}
	}

	if (targetFiles.length === 1) {
		return { file: targetFiles[0], content: patch };
	}

	return {
		error:
			"file-replace patch is ambiguous for multi-file scenario; provide JSON with file and content.",
	};
};

export const applyFileReplace = async (
	input: AstmendApplyInput,
): Promise<ApplyResult> => {
	const { patch, targetFiles, config } = input;
	const workspaceRoot = resolve(config.workspaceRoot);
	const payload = resolveFileReplacePayload(patch, targetFiles);

	if (!payload.file || payload.content === undefined) {
		return parseApplyResult({
			success: false,
			patchedFiles: [],
			rejects: targetFiles.map((path) => ({
				path,
				reason: payload.error ?? "file-replace patch payload is invalid.",
			})),
			diagnostics: [payload.error ?? "Invalid file-replace payload."],
		});
	}

	if (!targetFiles.includes(payload.file)) {
		return parseApplyResult({
			success: false,
			patchedFiles: [],
			rejects: [
				{
					path: payload.file,
					reason: "Patch touches file outside scenario targetFiles.",
				},
			],
			diagnostics: [
				`Rejected file-replace patch for ${payload.file}; outside targetFiles.`,
			],
		});
	}

	const outputPath = resolve(workspaceRoot, payload.file);
	if (
		!outputPath.startsWith(`${workspaceRoot}/`) &&
		outputPath !== workspaceRoot
	) {
		return parseApplyResult({
			success: false,
			patchedFiles: [],
			rejects: [
				{
					path: payload.file,
					reason: "Patch path resolves outside workspaceRoot.",
				},
			],
			diagnostics: ["Rejected file-replace patch with unsafe path."],
		});
	}

	try {
		await writeTextFile(outputPath, payload.content);
		return parseApplyResult({
			success: true,
			patchedFiles: [payload.file],
			rejects: [],
			diagnostics: ["file-replace patch applied."],
			diff: patch,
		});
	} catch (error) {
		return parseApplyResult({
			success: false,
			patchedFiles: [],
			rejects: [
				{
					path: payload.file,
					reason: "file-replace patch write failed.",
				},
			],
			diagnostics: [error instanceof Error ? error.message : String(error)],
		});
	}
};
