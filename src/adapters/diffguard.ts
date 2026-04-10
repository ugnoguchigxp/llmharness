import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
	type HarnessConfig,
	parseRiskResult,
	type RiskLevel,
	type RiskResult,
} from "../schemas";
import { runCommand } from "../utils/exec";
import { postJson } from "../utils/http";
import { tryParseJson } from "../utils/json";

export type DiffGuardInput = {
	patch: string;
	config: HarnessConfig;
	sourceFiles?: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeLevel = (value: unknown): RiskLevel => {
	if (typeof value !== "string") {
		return "info";
	}
	const normalized = value.toLowerCase();
	if (
		normalized === "error" ||
		normalized === "critical" ||
		normalized === "high"
	) {
		return "error";
	}
	if (
		normalized === "warn" ||
		normalized === "warning" ||
		normalized === "medium"
	) {
		return "warn";
	}
	return "info";
};

const normalizeFindings = (payload: unknown): RiskResult["findings"] => {
	if (!Array.isArray(payload)) {
		return [];
	}

	return payload.flatMap((item, index) => {
		if (!isRecord(item)) {
			return [];
		}

		const id =
			typeof item.id === "string"
				? item.id
				: typeof item.ruleId === "string"
					? item.ruleId
					: `DG-${index + 1}`;

		const message =
			typeof item.message === "string"
				? item.message
				: typeof item.text === "string"
					? item.text
					: "DiffGuard finding";

		return [
			{
				id,
				level: normalizeLevel(item.level ?? item.severity),
				message,
				file: typeof item.file === "string" ? item.file : undefined,
				line:
					typeof item.line === "number" && Number.isFinite(item.line)
						? Math.max(1, Math.trunc(item.line))
						: undefined,
				ruleId: typeof item.ruleId === "string" ? item.ruleId : undefined,
			},
		];
	});
};

const withComputedCounts = (
	findings: RiskResult["findings"],
	forcedBlocking?: boolean,
): RiskResult => {
	const counts = findings.reduce(
		(acc, finding) => {
			acc[finding.level] += 1;
			return acc;
		},
		{ error: 0, warn: 0, info: 0 },
	);

	return parseRiskResult({
		levelCounts: counts,
		findings,
		blocking:
			typeof forcedBlocking === "boolean" ? forcedBlocking : counts.error > 0,
	});
};

const normalizeRiskResult = (payload: unknown): RiskResult => {
	if (isRecord(payload)) {
		const parsedFindings = normalizeFindings(
			payload.findings ?? payload.issues,
		);
		const blocking =
			typeof payload.blocking === "boolean" ? payload.blocking : undefined;
		if (parsedFindings.length > 0) {
			return withComputedCounts(parsedFindings, blocking);
		}
	}

	if (Array.isArray(payload)) {
		return withComputedCounts(normalizeFindings(payload));
	}

	return parseRiskResult({
		levelCounts: { error: 1, warn: 0, info: 0 },
		findings: [
			{
				id: "DG-PARSE-ERROR",
				level: "error",
				message: "DiffGuard output could not be parsed.",
			},
		],
		blocking: true,
	});
};

const runDiffGuardCli = async (
	command: string,
	diffText: string,
	sourceFiles: string[],
	workspaceRoot: string,
	timeoutMs: number,
): Promise<Awaited<ReturnType<typeof runCommand>>> => {
	const tempDir = await mkdtemp(`${tmpdir()}/llmharness-diffguard-`);
	const diffFilePath = `${tempDir}/input.diff`;
	await writeFile(diffFilePath, diffText, "utf-8");

	const fileArgs =
		sourceFiles.length > 0
			? sourceFiles
					.map((filePath) => `--file ${JSON.stringify(filePath)}`)
					.join(" ")
			: "";
	const commandWithInputs =
		`${command} --diff-file ${JSON.stringify(diffFilePath)} ${fileArgs}`.trim();

	try {
		return await runCommand(commandWithInputs, {
			cwd: workspaceRoot,
			timeoutMs,
		});
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
};

const resolveUrl = (baseUrl: string, path: string): string =>
	new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();

export const reviewWithDiffGuard = async (
	input: DiffGuardInput,
): Promise<RiskResult> => {
	const { patch, config, sourceFiles = [] } = input;
	const diffGuardConfig = config.adapters.diffGuard;

	if (diffGuardConfig.mode === "api") {
		if (!diffGuardConfig.endpoint) {
			return parseRiskResult({
				levelCounts: { error: 1, warn: 0, info: 0 },
				findings: [
					{
						id: "DG-CONFIG-ERROR",
						level: "error",
						message: "diffGuard api mode requires adapters.diffGuard.endpoint",
					},
				],
				blocking: true,
			});
		}

		try {
			const url = resolveUrl(diffGuardConfig.endpoint, diffGuardConfig.apiPath);
			const response = await postJson<unknown>(
				url,
				{
					patch,
				},
				diffGuardConfig.timeoutMs,
			);
			return normalizeRiskResult(response);
		} catch (error) {
			return parseRiskResult({
				levelCounts: { error: 1, warn: 0, info: 0 },
				findings: [
					{
						id: "DG-API-ERROR",
						level: "error",
						message: error instanceof Error ? error.message : String(error),
					},
				],
				blocking: true,
			});
		}
	}

	const cliResult = await runDiffGuardCli(
		diffGuardConfig.command,
		patch,
		sourceFiles,
		resolve(config.workspaceRoot),
		diffGuardConfig.timeoutMs,
	);
	const parsed = tryParseJson(cliResult.stdout);
	if (!parsed) {
		if (cliResult.exitCode === 0) {
			return parseRiskResult({
				levelCounts: { error: 0, warn: 1, info: 0 },
				findings: [
					{
						id: "DG-WARN-NO-JSON",
						level: "warn",
						message:
							"DiffGuard CLI succeeded but did not emit JSON. Risk is treated as warning.",
					},
				],
				blocking: false,
			});
		}

		return parseRiskResult({
			levelCounts: { error: 1, warn: 0, info: 0 },
			findings: [
				{
					id: "DG-CLI-ERROR",
					level: "error",
					message: `DiffGuard CLI failed (exit=${cliResult.exitCode}): ${cliResult.stderr || cliResult.stdout}`,
				},
			],
			blocking: true,
		});
	}

	const normalized = normalizeRiskResult(parsed);
	if (cliResult.exitCode !== 0 && !normalized.blocking) {
		return parseRiskResult({
			levelCounts: {
				error: normalized.levelCounts.error + 1,
				warn: normalized.levelCounts.warn,
				info: normalized.levelCounts.info,
			},
			findings: [
				...normalized.findings,
				{
					id: "DG-CLI-EXIT",
					level: "error",
					message: `DiffGuard CLI exited with code ${cliResult.exitCode}.`,
				},
			],
			blocking: true,
		});
	}

	return normalized;
};
