export type CommandResult = {
	command: string;
	exitCode: number;
	stdout: string;
	stderr: string;
	durationMs: number;
};

export type RunCommandOptions = {
	cwd: string;
	stdin?: string;
	timeoutMs?: number;
	env?: Record<string, string | undefined>;
};

export const runCommand = async (
	command: string,
	options: RunCommandOptions,
): Promise<CommandResult> => {
	const { cwd, env, stdin, timeoutMs } = options;
	const started = Date.now();

	const child = Bun.spawn({
		cmd: ["zsh", "-lc", command],
		cwd,
		env: {
			...process.env,
			...env,
		},
		stdin: stdin ? new Blob([stdin]) : "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});

	let didTimeout = false;
	const timer =
		typeof timeoutMs === "number"
			? setTimeout(() => {
					didTimeout = true;
					child.kill();
				}, timeoutMs)
			: undefined;

	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);

	if (timer) {
		clearTimeout(timer);
	}

	return {
		command,
		exitCode,
		stdout,
		stderr: didTimeout
			? `${stderr}\nCommand timed out after ${timeoutMs} ms.`.trim()
			: stderr,
		durationMs: Date.now() - started,
	};
};
