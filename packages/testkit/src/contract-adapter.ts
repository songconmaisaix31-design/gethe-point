import {
  ALL_OPERATION_CONTRACTS,
  ActorSchema,
  COMMAND_CONTRACTS,
  OPERATION_EXAMPLES,
  QUERY_CONTRACTS,
  type Actor,
  type OperationName,
} from "../../contracts/src/index";

export interface OperationFixtureCase {
  readonly operation: OperationName;
  readonly kind: "command" | "query";
  readonly actor: Actor;
  readonly request: unknown;
  readonly result: unknown;
}

export interface ContractFixtureAdapter {
  listCases(): readonly OperationFixtureCase[];
  getCase(operation: OperationName): OperationFixtureCase;
}

const clone = <Value>(value: Value): Value => structuredClone(value);

const buildOperationFixtureCases = (): readonly OperationFixtureCase[] =>
  Object.freeze(
    ALL_OPERATION_CONTRACTS.map((contract) => {
      const operation = contract.name;
      const example = OPERATION_EXAMPLES[operation];

      return Object.freeze({
        operation,
        kind: contract.kind,
        actor: ActorSchema.parse(contract.actorSchema.parse(clone(example.actor))),
        request: contract.requestSchema.parse(clone(example.request)),
        result: contract.resultSchema.parse(clone(example.result)),
      });
    }),
  );

export const createContractFixtureAdapter = (): ContractFixtureAdapter => {
  const cases = buildOperationFixtureCases();

  return Object.freeze({
    listCases: () => cases.map((item) => clone(item)),
    getCase: (operation: OperationName) => {
      const fixtureCase = cases.find((item) => item.operation === operation);

      if (fixtureCase === undefined) {
        throw new RangeError(`Unknown fixture operation: ${operation}`);
      }

      return clone(fixtureCase);
    },
  });
};

export const CONTRACT_OPERATION_COUNTS = Object.freeze({
  commands: COMMAND_CONTRACTS.length,
  queries: QUERY_CONTRACTS.length,
  total: ALL_OPERATION_CONTRACTS.length,
});
