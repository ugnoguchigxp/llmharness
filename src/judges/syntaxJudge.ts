import { runTypecheck } from "../adapters/testRunner";
import {
	type HarnessConfig,
	type JudgeResult,
	parseJudgeResult,
} from "../schemas";

export const runSyntaxJudge = async (
	config: HarnessConfig,
	workspaceRoot: string,
): Promise<JudgeResult> => {
	if (!config.checks.runTypecheck) {
		return parseJudgeResult({
			phase: "test",
			score: config.scoring.syntaxWeight,
			pass: true,
			reasons: ["Typecheck is disabled in config."],
		});
	}

	const command = await runTypecheck(config, workspaceRoot);
	const pass = command.exitCode === 0;

	return parseJudgeResult({
		phase: "test",
		score: pass ? config.scoring.syntaxWeight : 0,
		pass,
		reasons: pass
			? ["Typecheck passed."]
			: [
					`Typecheck failed (exit=${command.exitCode}): ${command.stderr.trim() || "no stderr"}`,
				],
	});
};
