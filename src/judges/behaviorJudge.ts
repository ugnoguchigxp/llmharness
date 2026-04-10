import { runTests } from "../adapters/testRunner";
import {
	type HarnessConfig,
	type JudgeResult,
	parseJudgeResult,
} from "../schemas";

export type BehaviorJudgeInput = {
	config: HarnessConfig;
	workspaceRoot: string;
	mustPassTests: string[];
};

export const runBehaviorJudge = async (
	input: BehaviorJudgeInput,
): Promise<JudgeResult> => {
	const { config, workspaceRoot, mustPassTests } = input;

	if (!config.checks.runTests) {
		return parseJudgeResult({
			phase: "test",
			score: config.scoring.testWeight,
			pass: true,
			reasons: ["Tests are disabled in config."],
		});
	}

	const command = await runTests(config, workspaceRoot);
	const missingRequiredTests = mustPassTests.filter(
		(testId) =>
			!command.stdout.includes(testId) && !command.stderr.includes(testId),
	);
	const pass = command.exitCode === 0 && missingRequiredTests.length === 0;

	if (command.exitCode !== 0) {
		return parseJudgeResult({
			phase: "test",
			score: 0,
			pass: false,
			reasons: [
				`Tests failed (exit=${command.exitCode}): ${command.stderr.trim() || "no stderr"}`,
			],
		});
	}

	if (missingRequiredTests.length > 0) {
		return parseJudgeResult({
			phase: "test",
			score: 0,
			pass: false,
			reasons: [
				`Required tests not found in output: ${missingRequiredTests.join(", ")}`,
			],
		});
	}

	return parseJudgeResult({
		phase: "test",
		score: pass ? config.scoring.testWeight : 0,
		pass,
		reasons: ["Tests passed."],
	});
};
