import type { ApplyResult } from "../schemas";
import { parseApplyResult } from "../schemas";
import { tryParseJson } from "../utils/json";
import type { AstmendApplyInput } from "./astmend";
import { applyWithAstmend } from "./astmend";
import { applyFileReplace } from "./fileReplaceApply";
import { detectPatchFormat } from "./patchFormat";
import { applyUnifiedDiff } from "./unifiedDiffApply";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isStructuredFileReplacePatch = (patch: string): boolean => {
	const parsed = tryParseJson(patch);
	if (!isRecord(parsed)) {
		return false;
	}
	const hasPath =
		typeof parsed.file === "string" || typeof parsed.path === "string";
	const hasContent =
		typeof parsed.content === "string" ||
		typeof parsed.updatedText === "string";
	return hasPath && hasContent;
};

export const applyPatch = async (
	input: AstmendApplyInput,
): Promise<ApplyResult> => {
	const configuredFormat = input.config.adapters.astmend.patchFormat;
	const format =
		configuredFormat === "auto"
			? detectPatchFormat(input.patch)
			: configuredFormat;

	if (format === "astmend-json") {
		return applyWithAstmend(input);
	}
	if (format === "unified-diff") {
		return applyUnifiedDiff(input);
	}
	if (
		configuredFormat === "auto" &&
		!isStructuredFileReplacePatch(input.patch)
	) {
		return parseApplyResult({
			success: false,
			patchedFiles: [],
			rejects: input.targetFiles.map((path) => ({
				path,
				reason:
					"Auto patch format could not classify payload safely. Provide structured file-replace JSON or set patchFormat=file-replace explicitly.",
			})),
			diagnostics: [
				"Rejected ambiguous auto-detected file-replace payload to avoid accidental overwrite.",
			],
		});
	}
	return applyFileReplace(input);
};
