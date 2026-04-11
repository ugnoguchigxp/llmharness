import type { ApplyResult } from "../schemas";
import type { AstmendApplyInput } from "./astmend";
import { applyWithAstmend } from "./astmend";
import { applyFileReplace } from "./fileReplaceApply";
import { detectPatchFormat } from "./patchFormat";
import { applyUnifiedDiff } from "./unifiedDiffApply";

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
	return applyFileReplace(input);
};
