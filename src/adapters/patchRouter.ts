import type { ApplyResult } from "../schemas";
import { parseApplyResult } from "../schemas";
import { tryParseJson } from "../utils/json";
import { detectPatchFormat } from "./patchFormat";
import { ensureBuiltinAdaptersRegistered } from "./registerBuiltins";
import { type PatchApplyInput, resolvePatchApplier } from "./registry";

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
	input: PatchApplyInput,
): Promise<ApplyResult> => {
	ensureBuiltinAdaptersRegistered();

	const configuredFormat = input.config.adapters.astmend.patchFormat;
	const format =
		configuredFormat === "auto"
			? detectPatchFormat(input.patch)
			: configuredFormat;

	if (
		configuredFormat === "auto" &&
		format === "file-replace" &&
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

	const applier = resolvePatchApplier(format);
	if (!applier) {
		return parseApplyResult({
			success: false,
			patchedFiles: [],
			rejects: input.targetFiles.map((path) => ({
				path,
				reason: `No adapter registered for patch format: ${format}`,
			})),
			diagnostics: [`Missing patch applier adapter for format "${format}".`],
		});
	}

	return applier(input);
};
