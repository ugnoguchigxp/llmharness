import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { HarnessConfig } from "./schemas";
import { runCommand } from "./utils/exec";

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

const exists = async (path: string): Promise<boolean> => {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
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
	} else {
		items.push(
			checkApi(
				"astmend.api",
				config.adapters.astmend.endpoint,
				config.adapters.astmend.apiPath,
			),
		);
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
