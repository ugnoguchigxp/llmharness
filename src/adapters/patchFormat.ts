import type { PatchFormat } from "../schemas";
import { tryParseJson } from "../utils/json";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const detectPatchFormat = (
	patch: string,
): Exclude<PatchFormat, "auto"> => {
	const parsed = tryParseJson(patch);
	if (isRecord(parsed) && typeof parsed.type === "string") {
		return "astmend-json";
	}

	if (
		/(^|\n)(diff --git\s|---\s.+\n\+\+\+\s.+\n@@\s)/m.test(patch) ||
		/(^|\n)@@\s.*@@/m.test(patch)
	) {
		return "unified-diff";
	}

	return "file-replace";
};
