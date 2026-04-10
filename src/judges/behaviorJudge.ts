import { runTests } from "../adapters/testRunner";
import {
	type HarnessConfig,
	type JudgeResult,
	parseJudgeResult,
} from "../schemas";

export const runBehaviorJudge = async (
	config: HarnessConfig,
	workspaceRoot: string,
): Promise<JudgeResult> => {
	if (!config.checks.runTests) {
		return parseJudgeResult({
			phase: "test",
			score: config.scoring.testWeight,
			pass: true,
			reasons: ["Tests are disabled in config."],
		});
	}

	const command = await runTests(config, workspaceRoot);
	const pass = command.exitCode === 0;

	return parseJudgeResult({
		phase: "test",
		score: pass ? config.scoring.testWeight : 0,
		pass,
		reasons: pass
			? ["Tests passed."]
			: [
					`Tests failed (exit=${command.exitCode}): ${command.stderr.trim() || "no stderr"}`,
				],
	});
};
