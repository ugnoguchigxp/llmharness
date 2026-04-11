import { resolve } from "node:path";
import type { HarnessConfig } from "./schemas";
import { runCommand } from "./utils/exec";
import { exists, listJsonFilesRecursive, readJsonFile } from "./utils/fs";

export type HealthStatus = "ok" | "warn" | "error";

export type HealthItem = {
	name: string;
	status: HealthStatus;
	message: string;
};

const firstToken = (command: string): string => {
	const trimmed = command.trim();
	const token = trimmed.split(/\s+/)[0];
	return token ?? trimmed;
};

const checkCliCommand = async (
	name: string,
	command: string,
	cwd: string,
): Promise<HealthItem> => {
	const bin = firstToken(command);
	const probe = await runCommand(`command -v ${bin}`, { cwd, timeoutMs: 5000 });
	if (probe.exitCode !== 0 || probe.stdout.trim().length === 0) {
		return {
			name,
			status: "error",
			message: `binary not found: ${bin}`,
		};
	}

	return {
		name,
		status: "ok",
		message: `binary found: ${probe.stdout.trim()}`,
	};
};

const checkApi = (
	name: string,
	baseUrl: string | undefined,
	path: string,
): HealthItem => {
	if (!baseUrl) {
		return {
			name,
			status: "error",
			message: "api mode requires endpoint/baseUrl",
		};
	}

	try {
		const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
		return {
			name,
			status: "ok",
			message: `api target: ${url.toString()}`,
		};
	} catch {
		return {
			name,
			status: "error",
			message: `invalid URL combination: base=${baseUrl} path=${path}`,
		};
	}
};

const checkLocalLlmApiKey = (config: HarnessConfig): HealthItem => {
	if (config.adapters.localLlm.mode !== "api") {
		return {
			name: "localLlm.apiKey",
			status: "ok",
			message: "not required in cli mode",
		};
	}

	const envName = config.adapters.localLlm.apiKeyEnv;
	const value = process.env[envName];
	if (typeof value === "string" && value.length > 0) {
		return {
			name: "localLlm.apiKey",
			status: "ok",
			message: `env ${envName} is set`,
		};
	}

	return {
		name: "localLlm.apiKey",
		status: "warn",
		message: `env ${envName} is not set`,
	};
};

const checkRequirementsFiles = async (
	workspaceRoot: string,
): Promise<HealthItem[]> => {
	const scenariosRoot = resolve(workspaceRoot, "scenarios");
	const items: HealthItem[] = [];

	let scenarioFiles: string[] = [];
	try {
		scenarioFiles = await listJsonFilesRecursive(scenariosRoot);
	} catch {
		items.push({
			name: "requirements.scenariosDir",
			status: "warn",
			message: `Could not scan scenarios directory: ${scenariosRoot}`,
		});
		return items;
	}

	let withPath = 0;
	let missingCount = 0;
	let conventionCount = 0;

	for (const filePath of scenarioFiles) {
		let raw: unknown;
		try {
			raw = await readJsonFile(filePath);
		} catch {
			continue;
		}

		const scenarioRaw = raw as Record<string, unknown>;
		const scenarioId =
			typeof scenarioRaw.id === "string" ? scenarioRaw.id : null;
		const requirementsPath =
			typeof scenarioRaw.requirementsPath === "string"
				? scenarioRaw.requirementsPath
				: null;

		if (requirementsPath) {
			withPath++;
			const resolved = resolve(workspaceRoot, requirementsPath);
			if (!(await exists(resolved))) {
				missingCount++;
				items.push({
					name: `requirements.${scenarioId ?? "unknown"}`,
					status: "error",
					message: `requirementsPath not found: ${requirementsPath}`,
				});
			}
		} else if (scenarioId) {
			const conventionPath = `requirements/${scenarioId}.requirements.json`;
			if (await exists(resolve(workspaceRoot, conventionPath))) {
				conventionCount++;
			}
		}
	}

	if (missingCount === 0) {
		const detail =
			withPath > 0
				? `${withPath} explicit path(s) all found; ${conventionCount} convention file(s) detected`
				: conventionCount > 0
					? `${conventionCount} convention requirements file(s) found (no explicit requirementsPath)`
					: "no requirements files configured or found";
		items.push({
			name: "requirements.files",
			status: "ok",
			message: detail,
		});
	}

	return items;
};

const checkPatchBinary = async (
	config: HarnessConfig,
	cwd: string,
): Promise<HealthItem | undefined> => {
	const patchFormat = config.adapters.astmend.patchFormat;
	if (patchFormat === "astmend-json" || patchFormat === "file-replace") {
		return undefined;
	}

	const probe = await runCommand("command -v patch", {
		cwd,
		timeoutMs: 5000,
	});
	if (probe.exitCode === 0 && probe.stdout.trim().length > 0) {
		return {
			name: "patch.binary",
			status: "ok",
			message: `binary found: ${probe.stdout.trim()}`,
		};
	}

	if (patchFormat === "unified-diff") {
		return {
			name: "patch.binary",
			status: "error",
			message:
				"binary not found: patch (required when adapters.astmend.patchFormat=unified-diff)",
		};
	}

	return {
		name: "patch.binary",
		status: "warn",
		message:
			"binary not found: patch (auto mode may fail on unified-diff payloads)",
	};
};

export const runDoctor = async (
	config: HarnessConfig,
): Promise<HealthItem[]> => {
	const cwd = config.workspaceRoot;
	const items: HealthItem[] = [];

	if (config.adapters.localLlm.mode === "cli") {
		items.push(
			await checkCliCommand(
				"localLlm.cli",
				config.adapters.localLlm.command,
				cwd,
			),
		);
	} else {
		items.push(
			checkApi(
				"localLlm.api",
				config.adapters.localLlm.apiBaseUrl,
				config.adapters.localLlm.apiPath,
			),
		);
	}

	if (config.adapters.astmend.mode === "cli") {
		const cliHealth = await checkCliCommand(
			"astmend.cli",
			config.adapters.astmend.command,
			cwd,
		);
		if (
			cliHealth.status === "error" &&
			config.adapters.astmend.enableLibFallback
		) {
			const libPath = resolve(cwd, config.adapters.astmend.libEntrypoint);
			if (await exists(libPath)) {
				items.push({
					name: "astmend.cli",
					status: "warn",
					message: `binary not found, but library fallback is available: ${libPath}`,
				});
			} else {
				items.push({
					...cliHealth,
					message: `${cliHealth.message}; fallback not found: ${libPath}`,
				});
			}
		} else {
			items.push(cliHealth);
		}
	} else if (config.adapters.astmend.mode === "api") {
		items.push(
			checkApi(
				"astmend.api",
				config.adapters.astmend.endpoint,
				config.adapters.astmend.apiPath,
			),
		);
	} else {
		const libPath = resolve(cwd, config.adapters.astmend.libEntrypoint);
		const libExists = await exists(libPath);
		items.push({
			name: "astmend.lib",
			status: libExists ? "ok" : "error",
			message: libExists
				? `library entrypoint found: ${libPath}`
				: `library entrypoint not found: ${libPath}`,
		});
	}

	if (config.adapters.diffGuard.mode === "cli") {
		items.push(
			await checkCliCommand(
				"diffGuard.cli",
				config.adapters.diffGuard.command,
				cwd,
			),
		);
	} else {
		items.push(
			checkApi(
				"diffGuard.api",
				config.adapters.diffGuard.endpoint,
				config.adapters.diffGuard.apiPath,
			),
		);
	}

	items.push(checkLocalLlmApiKey(config));
	const patchBinary = await checkPatchBinary(config, cwd);
	if (patchBinary) {
		items.push(patchBinary);
	}
	items.push(...(await checkRequirementsFiles(cwd)));
	return items;
};

export const summarizeDoctor = (
	items: HealthItem[],
): { ok: boolean; lines: string[] } => {
	const lines = items.map(
		(item) => `[${item.status}] ${item.name}: ${item.message}`,
	);
	const ok = items.every((item) => item.status !== "error");
	return { ok, lines };
};
