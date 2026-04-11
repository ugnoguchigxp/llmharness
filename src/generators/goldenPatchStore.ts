import { join } from "node:path";
import { runCommand } from "../utils/exec";
import { writeTextFile } from "../utils/fs";

export const saveGoldenPatch = async (
	commitHash: string,
	workspaceRoot: string,
	outputDir: string,
): Promise<string> => {
	const result = await runCommand(
		`git diff ${commitHash}^..${commitHash}`,
		{ cwd: workspaceRoot, timeoutMs: 10000 },
	);

	if (result.exitCode !== 0) {
		throw new Error(
			`git diff failed for ${commitHash}: ${result.stderr || result.stdout}`,
		);
	}

	const shortHash = commitHash.slice(0, 8);
	const patchPath = join(outputDir, `${shortHash}.patch`);
	await writeTextFile(patchPath, result.stdout);
	return patchPath;
};
