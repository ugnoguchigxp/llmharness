import { resolve } from "node:path";
import { applyWithAstmend } from "../adapters/astmend";
import { reviewWithDiffGuard } from "../adapters/diffguard";
import { generateWithLocalLlm } from "../adapters/localllm";
import { runBehaviorJudge } from "../judges/behaviorJudge";
import { runRiskJudge } from "../judges/riskJudge";
import { runSyntaxJudge } from "../judges/syntaxJudge";
import {
	type HarnessConfig,
	type JudgePhase,
	parseJudgeResult,
	parseScenarioResult,
	type ScenarioInput,
	type ScenarioResult,
} from "../schemas";

const scoreMinimality = (
	scenario: ScenarioInput,
	patchedFileCount: number,
	config: HarnessConfig,
): number => {
	return patchedFileCount <= scenario.targetFiles.length
		? config.scoring.minimalityWeight
		: 0;
};

const scoreInstruction = (
	scenario: ScenarioInput,
	summary: string | undefined,
	config: HarnessConfig,
): number => {
	const hasScenarioId = summary?.includes(scenario.id) ?? false;
	return hasScenarioId ? config.scoring.instructionWeight : 0;
};

const errorResult = (
	scenario: ScenarioInput,
	startedAt: number,
	phase: JudgePhase,
	reason: string,
	partial?: Partial<ScenarioResult>,
): ScenarioResult => {
	return parseScenarioResult({
		scenarioId: scenario.id,
		durationMs: Date.now() - startedAt,
		finalDecision: "error",
		generate: partial?.generate,
		apply: partial?.apply,
		risk: partial?.risk,
		judges: [
			parseJudgeResult({
				phase,
				score: 0,
				pass: false,
				reasons: [reason],
			}),
		],
		artifacts: [],
	});
};

export const runPipeline = async (
	scenario: ScenarioInput,
	config: HarnessConfig,
): Promise<ScenarioResult> => {
	const startedAt = Date.now();
	const workspaceRoot = resolve(config.workspaceRoot);

	let generate: ScenarioResult["generate"];
	try {
		generate = await generateWithLocalLlm({ scenario, config });
	} catch (error) {
		return errorResult(
			scenario,
			startedAt,
			"generation",
			`Generation failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	let apply: ScenarioResult["apply"];
	try {
		apply = await applyWithAstmend({
			patch: generate.patch,
			targetFiles: scenario.targetFiles,
			config,
		});
	} catch (error) {
		return errorResult(
			scenario,
			startedAt,
			"apply",
			`Patch apply failed: ${error instanceof Error ? error.message : String(error)}`,
			{ generate },
		);
	}

	let risk: ScenarioResult["risk"];
	try {
		const reviewPatch = apply.diff ?? generate.patch;
		risk = await reviewWithDiffGuard({
			patch: reviewPatch,
			config,
			sourceFiles: scenario.targetFiles,
		});
	} catch (error) {
		return errorResult(
			scenario,
			startedAt,
			"review",
			`Risk review failed: ${error instanceof Error ? error.message : String(error)}`,
			{ generate, apply },
		);
	}

	const syntaxJudge = await runSyntaxJudge(config, workspaceRoot).catch(
		(error) =>
			parseJudgeResult({
				phase: "test",
				score: 0,
				pass: false,
				reasons: [
					`Typecheck execution failed: ${error instanceof Error ? error.message : String(error)}`,
				],
			}),
	);
	const behaviorJudge = await runBehaviorJudge({
		config,
		workspaceRoot,
		mustPassTests: scenario.expected.mustPassTests,
	}).catch((error) =>
		parseJudgeResult({
			phase: "test",
			score: 0,
			pass: false,
			reasons: [
				`Test execution failed: ${error instanceof Error ? error.message : String(error)}`,
			],
		}),
	);
	const riskJudge = runRiskJudge(risk, scenario, config);

	const minimalityScore = scoreMinimality(
		scenario,
		apply.patchedFiles.length,
		config,
	);
	const instructionScore = scoreInstruction(scenario, generate.summary, config);

	const totalScore =
		syntaxJudge.score +
		behaviorJudge.score +
		riskJudge.score +
		minimalityScore +
		instructionScore;

	const passByScore = totalScore >= scenario.expected.minScore;
	const passByThreshold = totalScore >= config.scoring.passThreshold;
	const pass =
		apply.success &&
		syntaxJudge.pass &&
		behaviorJudge.pass &&
		riskJudge.pass &&
		passByScore &&
		passByThreshold;

	const finalJudge = parseJudgeResult({
		phase: "final",
		score: Math.min(100, totalScore),
		pass,
		reasons: [
			`score=${totalScore.toFixed(1)} threshold=${config.scoring.passThreshold} scenarioMin=${scenario.expected.minScore}`,
			`apply=${String(apply.success)} syntax=${String(syntaxJudge.pass)} behavior=${String(behaviorJudge.pass)} risk=${String(riskJudge.pass)}`,
		],
	});

	return parseScenarioResult({
		scenarioId: scenario.id,
		durationMs: Date.now() - startedAt,
		finalDecision: finalJudge.pass ? "pass" : "fail",
		generate,
		apply,
		risk,
		judges: [riskJudge, syntaxJudge, behaviorJudge, finalJudge],
		artifacts: [],
	});
};
