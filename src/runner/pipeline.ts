import { join, resolve } from "node:path";
import { reviewWithDiffGuard } from "../adapters/diffguard";
import { type Feedback, generateWithLocalLlm } from "../adapters/localllm";
import { applyPatch } from "../adapters/patchRouter";
import { reviewWithPersona } from "../adapters/personaReviewer";
import { runBehaviorJudge } from "../judges/behaviorJudge";
import { runLlmRequirementsJudge } from "../judges/llmRequirementsJudge";
import { runRequirementsJudge } from "../judges/requirementsJudge";
import { runRiskJudge } from "../judges/riskJudge";
import { runSyntaxJudge } from "../judges/syntaxJudge";
import type { RequirementsContext } from "../requirements/loadRequirements";
import { generateRevisionSuggestions } from "../requirements/revisionSuggester";
import {
	type ApplyResult,
	type AttemptResult,
	type GenerateResult,
	type HarnessConfig,
	type JudgePhase,
	type JudgeResult,
	type OrchestratorState,
	parseJudgeResult,
	parseRiskResult,
	parseScenarioResult,
	type RequirementsSummary,
	type RiskResult,
	type ScenarioInput,
	type ScenarioResult,
} from "../schemas";
import { MemoryService } from "../services/memoryService";
import { writeJsonFile, writeTextFile } from "../utils/fs";

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
	requirementsSummary?: RequirementsSummary,
): ScenarioResult => {
	return parseScenarioResult({
		scenarioId: scenario.id,
		durationMs: Date.now() - startedAt,
		finalDecision: "error",
		generate: partial?.generate,
		apply: partial?.apply,
		risk: partial?.risk,
		attempts: partial?.attempts ?? [],
		orchestratorState: partial?.orchestratorState,
		judges: [
			parseJudgeResult({
				phase,
				score: 0,
				pass: false,
				reasons: [reason],
			}),
		],
		artifacts: partial?.artifacts ?? [],
		requirementsSummary,
	});
};

const buildFeedbackForPrompt = (
	state: OrchestratorState,
): Feedback | undefined => {
	if (state.attempt <= 1) {
		return undefined;
	}

	const previousIssues = state.lastRiskFindings.map(
		(finding) => finding.message,
	);
	if (state.feedbackForNextPrompt) {
		previousIssues.unshift(state.feedbackForNextPrompt);
	}

	return {
		attempt: state.attempt,
		previousIssues,
		previousRejects: state.lastApplyRejects.map((reject) => ({
			path: reject.path,
			reason: reject.reason,
		})),
	};
};

const skippedJudge = (reason: string): JudgeResult =>
	parseJudgeResult({
		phase: "test",
		score: 0,
		pass: false,
		reasons: [reason],
	});

const buildSyntheticRiskForApplyFailure = (rejectCount: number): RiskResult =>
	parseRiskResult({
		levelCounts: { error: 0, warn: rejectCount > 0 ? rejectCount : 1, info: 0 },
		findings: [
			{
				id: "APPLY-REJECTED",
				level: "warn",
				message:
					rejectCount > 0
						? `Patch apply failed with ${rejectCount} reject(s).`
						: "Patch apply failed without explicit rejects.",
			},
		],
		blocking: false,
	});

const runRequirementsJudgeWithMode = async (
	config: HarnessConfig,
	requirements: RequirementsContext["requirements"] | undefined,
	judges: JudgeResult[],
	patch: string | undefined,
): Promise<JudgeResult> => {
	if (!requirements) {
		return runRequirementsJudge(requirements, judges);
	}

	const mode = config.judges.mode;
	if (mode === "keyword") {
		return runRequirementsJudge(requirements, judges);
	}

	try {
		return await runLlmRequirementsJudge(
			requirements,
			judges,
			patch ?? "",
			config,
		);
	} catch (error) {
		if (mode === "llm") {
			return parseJudgeResult({
				phase: "requirements",
				score: 0,
				pass: false,
				reasons: [
					`LLM requirements judge failed: ${error instanceof Error ? error.message : String(error)}`,
				],
			});
		}

		const fallback = runRequirementsJudge(requirements, judges);
		return parseJudgeResult({
			...fallback,
			reasons: [
				...fallback.reasons,
				`LLM requirements judge failed; used keyword fallback: ${
					error instanceof Error ? error.message : String(error)
				}`,
			],
		});
	}
};

export const runPipeline = async (
	scenario: ScenarioInput,
	config: HarnessConfig,
	runDir?: string,
	requirementsContext?: RequirementsContext,
	requirementsSummaryInput?: RequirementsSummary,
): Promise<ScenarioResult> => {
	const startedAt = Date.now();
	const workspaceRoot = resolve(config.workspaceRoot);
	const memory = new MemoryService(config);
	const requirementsSummary =
		requirementsSummaryInput ?? requirementsContext?.summary;

	let memoryContext: string | undefined;
	if (config.adapters.memory.enabled) {
		memoryContext = await memory.recall(scenario.instruction);
	}

	const maxAttempts = config.orchestrator.maxAttempts;
	const attempts: AttemptResult[] = [];
	const artifacts: ScenarioResult["artifacts"] = [];

	const orchestratorState: OrchestratorState = {
		attempt: 0,
		maxAttempts,
		lastApplyRejects: [],
		lastRiskFindings: [],
	};

	let finalGenerate: GenerateResult | undefined;
	let finalApply: ApplyResult | undefined;
	let finalRisk: RiskResult | undefined;
	let finalJudges: ScenarioResult["judges"] = [];
	let finalDecision: ScenarioResult["finalDecision"] = "fail";

	for (let attemptIdx = 1; attemptIdx <= maxAttempts; attemptIdx++) {
		orchestratorState.attempt = attemptIdx;
		const feedback = buildFeedbackForPrompt(orchestratorState);

		let generate: GenerateResult;
		try {
			generate = await generateWithLocalLlm({
				scenario,
				config,
				memoryContext,
				feedback,
			});
		} catch (error) {
			const reason = `Generation failed [attempt ${attemptIdx}]: ${error instanceof Error ? error.message : String(error)}`;
			await memory.recordFailure(scenario.id, reason);
			return errorResult(
				scenario,
				startedAt,
				"generation",
				reason,
				{
					generate: finalGenerate,
					apply: finalApply,
					risk: finalRisk,
					attempts,
					orchestratorState,
					artifacts,
				},
				requirementsSummary,
			);
		}

		if (runDir) {
			const patchPath = join(runDir, `attempt${attemptIdx}.patch`);
			await writeTextFile(patchPath, generate.patch);
			artifacts.push({ kind: "diff", path: patchPath });
		}

		let apply: ApplyResult;
		try {
			apply = await applyPatch({
				patch: generate.patch,
				targetFiles: scenario.targetFiles,
				config,
			});
		} catch (error) {
			const reason = `Patch apply failed [attempt ${attemptIdx}]: ${error instanceof Error ? error.message : String(error)}`;
			await memory.recordFailure(scenario.id, reason);
			return errorResult(
				scenario,
				startedAt,
				"apply",
				reason,
				{
					generate,
					apply: finalApply,
					risk: finalRisk,
					attempts,
					orchestratorState,
					artifacts,
				},
				requirementsSummary,
			);
		}

		let risk: RiskResult;
		if (apply.success) {
			try {
				const reviewPatch = apply.diff ?? generate.patch;
				risk = await reviewWithDiffGuard({
					patch: reviewPatch,
					config,
					sourceFiles: scenario.targetFiles,
				});
			} catch (error) {
				const reason = `Risk review failed [attempt ${attemptIdx}]: ${error instanceof Error ? error.message : String(error)}`;
				await memory.recordFailure(scenario.id, reason);
				return errorResult(
					scenario,
					startedAt,
					"review",
					reason,
					{
						generate,
						apply,
						risk: finalRisk,
						attempts,
						orchestratorState,
						artifacts,
					},
					requirementsSummary,
				);
			}
		} else {
			risk = buildSyntheticRiskForApplyFailure(apply.rejects.length);
		}

		const riskJudge = apply.success
			? runRiskJudge(risk, scenario, config)
			: parseJudgeResult({
					phase: "review",
					score: 0,
					pass: false,
					reasons: ["Risk review skipped because patch apply failed."],
				});

		const shouldRunPostReviewChecks = apply.success && !risk.blocking;
		const syntaxJudge = shouldRunPostReviewChecks
			? await runSyntaxJudge(config, workspaceRoot).catch((error) =>
					parseJudgeResult({
						phase: "test",
						score: 0,
						pass: false,
						reasons: [
							`Typecheck execution failed: ${error instanceof Error ? error.message : String(error)}`,
						],
					}),
				)
			: skippedJudge(
					apply.success
						? "Typecheck skipped because DiffGuard returned blocking findings."
						: "Typecheck skipped because patch apply failed.",
				);
		const behaviorJudge = shouldRunPostReviewChecks
			? await runBehaviorJudge({
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
				)
			: skippedJudge(
					apply.success
						? "Tests skipped because DiffGuard returned blocking findings."
						: "Tests skipped because patch apply failed.",
				);

		const minimalityScore = scoreMinimality(
			scenario,
			apply.patchedFiles.length,
			config,
		);
		const instructionScore = scoreInstruction(
			scenario,
			generate.summary,
			config,
		);

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

		const stopReason = pass
			? `Attempt ${attemptIdx} passed all gates.`
			: !apply.success
				? `Attempt ${attemptIdx} failed: patch apply rejected.`
				: risk.blocking
					? `Attempt ${attemptIdx} failed: DiffGuard reported blocking findings.`
					: `Attempt ${attemptIdx} failed: judge thresholds were not met.`;

		const maxAttemptReason =
			!pass && attemptIdx === maxAttempts
				? [`maxAttempts (${maxAttempts}) reached. Returning fail.`]
				: [];

		const finalJudge = parseJudgeResult({
			phase: "final",
			score: Math.min(100, totalScore),
			pass,
			reasons: [
				`score=${totalScore.toFixed(1)} threshold=${config.scoring.passThreshold} scenarioMin=${scenario.expected.minScore}`,
				`apply=${String(apply.success)} syntax=${String(syntaxJudge.pass)} behavior=${String(behaviorJudge.pass)} risk=${String(riskJudge.pass)}`,
				stopReason,
				...maxAttemptReason,
			],
		});

		const currentJudges = [riskJudge, syntaxJudge, behaviorJudge, finalJudge];
		attempts.push({
			attempt: attemptIdx,
			generate,
			apply,
			risk,
		});

		finalGenerate = generate;
		finalApply = apply;
		finalRisk = risk;
		finalJudges = currentJudges;

		if (runDir) {
			const attemptReportPath = join(runDir, `attempt${attemptIdx}.json`);
			await writeJsonFile(attemptReportPath, {
				attempt: attemptIdx,
				feedback,
				stopReason,
				generate,
				apply,
				risk,
				judges: currentJudges,
			});
			artifacts.push({ kind: "log", path: attemptReportPath });
		}

		if (pass) {
			finalDecision = "pass";
			break;
		}

		// Update state for next attempt.
		orchestratorState.lastPatch = generate.patch;
		orchestratorState.lastApplyRejects = apply.rejects;
		orchestratorState.lastRiskFindings = risk.findings;
		orchestratorState.feedbackForNextPrompt = [
			stopReason,
			...apply.rejects.map((reject) => `${reject.path}: ${reject.reason}`),
			...risk.findings.map((finding) => finding.message),
		].join("\n");
	}

	const requirements = requirementsContext?.requirements;

	const requirementsJudge = await runRequirementsJudgeWithMode(
		config,
		requirements,
		finalJudges,
		finalGenerate?.patch,
	);
	const allJudges = [...finalJudges, requirementsJudge];

	const personaReviews = await (async () => {
		const personas = requirements?.reviewPersonas ?? [];
		if (personas.length === 0 || !finalGenerate) return [];
		const reviews = await Promise.allSettled(
			personas.map((persona) =>
				reviewWithPersona(persona, finalGenerate.patch, scenario.title, config),
			),
		);
		return reviews.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
	})();

	const revisionSuggestions = generateRevisionSuggestions(
		requirements,
		finalDecision,
		allJudges,
	);

	return parseScenarioResult({
		scenarioId: scenario.id,
		durationMs: Date.now() - startedAt,
		finalDecision,
		generate: finalGenerate,
		apply: finalApply,
		risk: finalRisk,
		judges: allJudges,
		artifacts,
		attempts,
		orchestratorState,
		requirementsSummary,
		personaReviews,
		revisionSuggestions,
	});
};
