import { describe, expect, it } from "vitest";

import fixtureManifest from "../../../fixtures/golden-household.json";
import {
  ALL_OPERATION_CONTRACTS,
  COMMAND_CONTRACTS,
  QUERY_CONTRACTS,
} from "../../contracts/src/index";
import {
  ACCEPTANCE_OUTCOMES,
  CONTRACT_OPERATION_COUNTS,
  EVIDENCE_LEVELS,
  assertAcceptanceScenario,
  createAcceptanceScenarios,
  createAuthenticationScenarios,
  createContractFixtureAdapter,
  createEvidenceAccessScenarios,
  createGoldenFixture,
} from "../src/index";

describe("contract fixture adapter", () => {
  it("covers every command and query exactly once", () => {
    const cases = createContractFixtureAdapter().listCases();
    const operationNames = cases.map((item) => item.operation);

    expect(CONTRACT_OPERATION_COUNTS).toEqual({
      commands: fixtureManifest.expectedCounts.commands,
      queries: fixtureManifest.expectedCounts.queries,
      total:
        fixtureManifest.expectedCounts.commands +
        fixtureManifest.expectedCounts.queries,
    });
    expect(COMMAND_CONTRACTS).toHaveLength(CONTRACT_OPERATION_COUNTS.commands);
    expect(QUERY_CONTRACTS).toHaveLength(CONTRACT_OPERATION_COUNTS.queries);
    expect(cases).toHaveLength(ALL_OPERATION_CONTRACTS.length);
    expect(new Set(operationNames).size).toBe(operationNames.length);
    expect(operationNames).toEqual(
      ALL_OPERATION_CONTRACTS.map((contract) => contract.name),
    );
  });

  it("returns independent validated values instead of shared mutable examples", () => {
    const adapter = createContractFixtureAdapter();
    const first = adapter.getCase("GetRoleHome");
    const second = adapter.getCase("GetRoleHome");

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.actor).not.toBe(second.actor);
    expect(first.request).not.toBe(second.request);
    expect(first.result).not.toBe(second.result);
  });
});

describe("acceptance outcome scenarios", () => {
  it("asserts all successes and every representative non-success outcome", () => {
    const scenarios = createAcceptanceScenarios();
    const outcomes = new Set(scenarios.map((scenario) => scenario.expectedOutcome));

    expect([...outcomes]).toEqual(ACCEPTANCE_OUTCOMES);
    expect([...outcomes]).toEqual(fixtureManifest.requiredOutcomes);
    expect(
      scenarios.filter((scenario) => scenario.expectedOutcome === "success"),
    ).toHaveLength(ALL_OPERATION_CONTRACTS.length);

    for (const scenario of scenarios) {
      expect(() => {
        assertAcceptanceScenario(scenario);
      }).not.toThrow();
      expect(scenario.fixtureLabels).toEqual(fixtureManifest.labels);
      expect(scenario.requiredFacts.length).toBeGreaterThan(0);
    }

    expect(
      scenarios.find((scenario) => scenario.expectedOutcome === "blocked"),
    ).toMatchObject({
      operation: "ProposeHandover",
      responseKind: "result",
      response: {
        status: "proposal_recorded",
        handover: { status: "blocked" },
      },
    });
    expect(
      scenarios.find((scenario) => scenario.expectedOutcome === "denied"),
    ).toMatchObject({ responseKind: "error", response: { code: "not_found" } });
    expect(
      scenarios.find(
        (scenario) => scenario.expectedOutcome === "needs_human_review",
      ),
    ).toMatchObject({
      responseKind: "result",
      response: {
        status: "needs_human_review",
        consequentialMutationAllowed: false,
      },
    });
    expect(
      scenarios.find((scenario) => scenario.expectedOutcome === "failed"),
    ).toMatchObject({
      responseKind: "error",
      response: { code: "provider_unavailable" },
    });
  });

  it("covers all member roles and both authentication evidence levels", () => {
    const scenarios = createAuthenticationScenarios();

    expect(scenarios).toHaveLength(6);
    expect(new Set(scenarios.map((scenario) => scenario.role))).toEqual(
      new Set(["primary", "partner", "subject"]),
    );
    expect(
      new Set(scenarios.map((scenario) => scenario.authentication)),
    ).toEqual(new Set(["fixture_demo", "verified_session"]));

    for (const scenario of scenarios) {
      expect(scenario.actor.role).toBe(scenario.role);
      expect(scenario.actor.authentication).toBe(scenario.authentication);
    }
  });

  it("asserts raw, provenance, redacted, deleted, and denied evidence facts", () => {
    const fixture = createGoldenFixture();
    const scenarios = createEvidenceAccessScenarios(fixture);
    const rawMessage = fixture.messages.find(
      (message) => message.evidenceId === fixture.evidence[0]?.id,
    );

    expect(scenarios.map((scenario) => scenario.evidenceLevel)).toEqual(
      EVIDENCE_LEVELS,
    );
    expect(scenarios.map((scenario) => scenario.evidenceLevel)).toEqual(
      fixtureManifest.evidenceLevels,
    );

    for (const scenario of scenarios) {
      expect(() => {
        assertAcceptanceScenario(scenario);
      }).not.toThrow();
      const serializedResponse = JSON.stringify(scenario.response);
      if (scenario.evidenceLevel === "raw_private") {
        expect(serializedResponse).toContain(rawMessage?.content);
      } else {
        expect(serializedResponse).not.toContain(rawMessage?.content);
      }
    }
  });
});
