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

		// collect all consecutive non-flag values as a space-joined string
		const values: string[] = [next];
		i += 1;
		while (i + 1 < rest.length) {
			const lookahead = rest[i + 1];
			if (!lookahead || lookahead.startsWith("--")) break;
			values.push(lookahead);
			i += 1;
		}

		flags[key] = values.join(" ");
	}

	return { command, flags };
};
