# MVP core fixture

`mvp-core.ts` is the sole canonical fictional graph for `MVP-QA-002`.
Fixture UI, module adapters, database seeders, testkit behavior, and browser
acceptance import this graph instead of copying IDs, people, private text,
events, timestamps, ownership, or layout thresholds.

The graph reuses frozen `@we-remember/contracts` examples and adds only the QA
scenario reminder, persistent demo labels, visibly fictional presentation copy,
and the corrected Style A acceptance values. The Style A values are defined
directly in this fixture; they intentionally do not reuse the older contract
palette.
