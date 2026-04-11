const STOPWORDS = new Set([
	"a",
	"an",
	"the",
	"is",
	"are",
	"was",
	"be",
	"to",
	"of",
	"in",
	"or",
	"and",
	"not",
	"no",
	"at",
	"by",
	"for",
	"it",
	"its",
]);

export const extractKeywords = (text: string): string[] =>
	text
		.toLowerCase()
		.split(/\W+/)
		.filter((w) => w.length > 3 && !STOPWORDS.has(w));
