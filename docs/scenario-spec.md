# Scenario Spec

Scenario files are JSON and validated by `ScenarioInputSchema`.

Required fields:

- `id`: unique scenario id (`smoke-001`)
- `suite`: one of `smoke | regression | edge-cases`
- `title`: short display title
- `instruction`: prompt text for generation phase
- `targetFiles`: one or more target file paths

`expected` fields:

- `mustPassTests`: reserved list of mandatory test identifiers
- `maxRiskErrors`: max allowed risk findings with `error`
- `minScore`: minimum total score for pass

Example:

```json
{
  "id": "smoke-001",
  "suite": "smoke",
  "title": "Basic harness flow",
  "instruction": "Produce a minimal safe patch for a simple scenario.",
  "targetFiles": ["src/index.ts"],
  "expected": {
    "mustPassTests": [],
    "maxRiskErrors": 0,
    "minScore": 80
  }
}
```
