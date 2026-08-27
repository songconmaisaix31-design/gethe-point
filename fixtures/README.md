# MVP core fixture

`mvp-core.ts` is the sole canonical fictional graph for `MVP-QA-001`. Fixture UI,
module adapters, database seeders, testkit behavior, and browser acceptance must
import this graph instead of copying IDs, people, messages, health references,
events, timestamps, or layout thresholds.

The graph deliberately reuses the frozen `@we-remember/contracts` examples. It
adds only the core acceptance reminder, persistent demo labels, visibly fictional
presentation copy, and the focused Style A layout thresholds required by this
scenario.
