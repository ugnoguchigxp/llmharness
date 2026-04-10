import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export type RunPaths = {
	runId: string;
	runDir: string;
	reportJsonPath: string;
	reportMarkdownPath: string;
	reportSarifPath: string;
};

const createRunId = (): string => {
	const d = new Date();
	const p = (n: number): string => String(n).padStart(2, "0");
	const p3 = (n: number): string => String(n).padStart(3, "0");
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
		d.getMinutes(),
	)}${p(d.getSeconds())}${p3(d.getMilliseconds())}`;
};

export const createRunPaths = async (
	artifactsDir: string,
): Promise<RunPaths> => {
	const runId = createRunId();
	const runDir = resolve(artifactsDir, runId);
	await mkdir(runDir, { recursive: true });
	return {
		runId,
		runDir,
		reportJsonPath: join(runDir, "result.json"),
		reportMarkdownPath: join(runDir, "result.md"),
		reportSarifPath: join(runDir, "result.sarif.json"),
	};
};
