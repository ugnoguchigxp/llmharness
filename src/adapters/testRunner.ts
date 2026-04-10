import type { HarnessConfig } from "../schemas";
import { type CommandResult, runCommand } from "../utils/exec";

export const runTypecheck = async (
	config: HarnessConfig,
	cwd: string,
): Promise<CommandResult> => {
	return runCommand(config.checks.typecheckCommand, {
		cwd,
	});
};

export const runTests = async (
	config: HarnessConfig,
	cwd: string,
): Promise<CommandResult> => {
	return runCommand(config.checks.testCommand, {
		cwd,
	});
};
