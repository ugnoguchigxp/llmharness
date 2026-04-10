export type ParsedArgs = {
	command: string | undefined;
	flags: Record<string, string | boolean>;
};

export const parseArgv = (argv: string[]): ParsedArgs => {
	const [command, ...rest] = argv;
	const flags: Record<string, string | boolean> = {};

	for (let i = 0; i < rest.length; i += 1) {
		const token = rest[i];
		if (!token) {
			continue;
		}
		if (!token.startsWith("--")) {
			continue;
		}

		const key = token.slice(2);
		const next = rest[i + 1];
		if (!next || next.startsWith("--")) {
			flags[key] = true;
			continue;
		}

		flags[key] = next;
		i += 1;
	}

	return { command, flags };
};
