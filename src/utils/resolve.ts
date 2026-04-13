import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { HarnessConfig } from "../schemas";
import { runCommand } from "./exec";

/**
 * Resolves the path to a CLI command binary.
 * Priority:
 * 1. Absolute path (returned as is)
 * 2. Local workspace (relative to workspaceRoot)
 * 3. Gnosis monorepo (services/local-llm/scripts or services/embedding/.venv/bin)
 * 4. Systems $PATH (via 'which')
 *
 * @param command The full command string (e.g., "gemma4 --prompt {{prompt}}")
 * @param config The harness configuration
 * @returns The command string with the binary part resolved to an absolute path if found.
 */
export const resolveCommandPath = async (
	command: string,
	config: HarnessConfig,
): Promise<string> => {
	const trimmed = command.trim();
	if (trimmed.length === 0) return command;

	// Extract the binary/executable part (first token)
	const parts = trimmed.split(/\s+/);
	const binaryName = parts[0];
	if (!binaryName) return command;

	// 1. If absolute, use as is
	if (isAbsolute(binaryName)) {
		return command;
	}

	const workspaceRoot = resolve(config.workspaceRoot);

	// 2. Check local workspace
	const localPath = join(workspaceRoot, binaryName);
	if (existsSync(localPath)) {
		return [localPath, ...parts.slice(1)].join(" ");
	}

	// 3. Check gnosis monorepo structure
	if (config.adapters.memory.gnosisPath) {
		const gnosisPath = resolve(workspaceRoot, config.adapters.memory.gnosisPath);

		// Check local-llm scripts
		const llmPath = join(gnosisPath, "services/local-llm/scripts", binaryName);
		if (existsSync(llmPath)) {
			return [llmPath, ...parts.slice(1)].join(" ");
		}

		// Check embedding bin
		const embedPath = join(gnosisPath, "services/embedding/.venv/bin", binaryName);
		if (existsSync(embedPath)) {
			return [embedPath, ...parts.slice(1)].join(" ");
		}
	}

	// 4. Check systems $PATH
	try {
		// Use 'command -v' as it's more portable than 'which' and often faster
		const probe = await runCommand(`command -v ${binaryName}`, {
			cwd: workspaceRoot,
			timeoutMs: 2000,
		});
		if (probe.exitCode === 0 && probe.stdout.trim().length > 0) {
			const resolvedPath = probe.stdout.trim();
			return [resolvedPath, ...parts.slice(1)].join(" ");
		}
	} catch (_) {}

	return command;
};
