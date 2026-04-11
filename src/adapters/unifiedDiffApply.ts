import { resolve } from "node:path";
import type { ApplyResult } from "../schemas";
import { parseApplyResult } from "../schemas";
import { runCommand } from "../utils/exec";
import type { AstmendApplyInput } from "./astmend";

const normalizeDiffPath = (value: string): string | undefined => {
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed === "/dev/null") {
		return undefined;
	}
	const noTimestamp = trimmed.split(/\s+/)[0];
	if (!noTimestamp) {
		return undefined;
	}
	return noTimestamp.replace(/^[ab]\//, "");
};

const parsePatchedFilesFromDiff = (patch: string): string[] => {
	const files: string[] = [];
	for (const line of patch.split("\n")) {
		if (line.startsWith("+++ ")) {
			const maybePath = normalizeDiffPath(line.slice(4));
			if (maybePath && !files.includes(maybePath)) {
				files.push(maybePath);
			}
			continue;
		}

		if (line.startsWith("diff --git ")) {
			const parts = line.trim().split(/\s+/);
			const maybePath =
				parts.length >= 4 ? normalizeDiffPath(parts[3] ?? "") : undefined;
			if (maybePath && !files.includes(maybePath)) {
				files.push(maybePath);
			}
		}
	}
	return files;
};

const isWorkspaceSafe = (
	workspaceRoot: string,
	relativePath: string,
): boolean => {
	const absolute = resolve(workspaceRoot, relativePath);
	return absolute.startsWith(`${workspaceRoot}/`) || absolute === workspaceRoot;
};

const buildRejectResult = (
	targetFiles: string[],
	impactedFiles: string[],
	reason: string,
	diagnostics: string[],
): ApplyResult =>
	parseApplyResult({
		success: false,
		patchedFiles: [],
		rejects: (impactedFiles.length > 0 ? impactedFiles : targetFiles).map(
			(path) => ({
				path,
				reason,
			}),
		),
		diagnostics,
	});

export const applyUnifiedDiff = async (
	input: AstmendApplyInput,
): Promise<ApplyResult> => {
	const { patch, targetFiles, config } = input;
	const workspaceRoot = resolve(config.workspaceRoot);
	const impactedFiles = parsePatchedFilesFromDiff(patch);

	if (impactedFiles.length === 0) {
		return buildRejectResult(
			targetFiles,
			[],
			"Unified diff does not include file headers.",
			["Unified diff parse failed: no +++ or diff --git file headers."],
		);
	}

	const outsideTarget = impactedFiles.find(
		(file) => !targetFiles.includes(file),
	);
	if (outsideTarget) {
		return buildRejectResult(
			targetFiles,
			[outsideTarget],
			"Patch touches file outside scenario targetFiles.",
			[`Rejected unified diff for ${outsideTarget}; outside targetFiles.`],
		);
	}

	const unsafeFile = impactedFiles.find(
		(file) => !isWorkspaceSafe(workspaceRoot, file),
	);
	if (unsafeFile) {
		return buildRejectResult(
			targetFiles,
			[unsafeFile],
			"Patch path resolves outside workspaceRoot.",
			["Rejected unified diff with unsafe path."],
		);
	}

	const stripLevels = [1, 0];
	let lastDryRunError = "Failed to apply unified diff.";

	for (const stripLevel of stripLevels) {
		const dryRun = await runCommand(
			`patch -p${stripLevel} --forward --reject-file=- --dry-run`,
			{
				cwd: workspaceRoot,
				stdin: patch,
				timeoutMs: config.adapters.astmend.timeoutMs,
			},
		);

		if (dryRun.exitCode !== 0) {
			lastDryRunError =
				dryRun.stderr.trim() || dryRun.stdout.trim() || lastDryRunError;
			continue;
		}

		const apply = await runCommand(
			`patch -p${stripLevel} --forward --reject-file=-`,
			{
				cwd: workspaceRoot,
				stdin: patch,
				timeoutMs: config.adapters.astmend.timeoutMs,
			},
		);
		if (apply.exitCode !== 0) {
			const reason =
				apply.stderr.trim() ||
				apply.stdout.trim() ||
				`patch command failed with exit code ${apply.exitCode}`;
			return buildRejectResult(
				targetFiles,
				impactedFiles,
				"Unified diff apply command failed.",
				[`patch -p${stripLevel} failed: ${reason}`],
			);
		}

		return parseApplyResult({
			success: true,
			patchedFiles: impactedFiles,
			rejects: [],
			diagnostics: [`Unified diff applied with patch -p${stripLevel}.`],
			diff: patch,
		});
	}

	return buildRejectResult(
		targetFiles,
		impactedFiles,
		"Unified diff dry-run failed.",
		[lastDryRunError],
	);
};
