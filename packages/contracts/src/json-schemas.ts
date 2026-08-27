import { z } from "zod";

import {
  CareEventSchema,
  CareRuleSchema,
  ConsentDecisionSchema,
  DomainSchema,
  HandoverSchema,
  SharedSignalSchema,
  TaskSchema,
} from "./entities";
import { ContractErrorSchema } from "./errors";
import { AuditEntrySchema, DomainEventSchema } from "./events";
import { ALL_OPERATION_CONTRACTS } from "./operations";
import { NeedsHumanReviewSchema } from "./ports";

const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";

const generateJsonSchema = (schema: z.ZodType, id: string) =>
  Object.freeze({
    $id: id,
    ...z.toJSONSchema(schema, {
      target: "draft-2020-12",
      io: "input",
      unrepresentable: "throw",
    }),
  });

const operationJsonSchemas = Object.fromEntries(
  ALL_OPERATION_CONTRACTS.map((contract) => [
    contract.name,
    Object.freeze({
      kind: contract.kind,
      actor: generateJsonSchema(
        contract.actorSchema,
        `urn:we-remember:operation:${contract.name}:actor`,
      ),
      request: generateJsonSchema(
        contract.requestSchema,
        `urn:we-remember:operation:${contract.name}:request`,
      ),
      result: generateJsonSchema(
        contract.resultSchema,
        `urn:we-remember:operation:${contract.name}:result`,
      ),
      error: generateJsonSchema(
        contract.errorSchema,
        `urn:we-remember:operation:${contract.name}:error`,
      ),
      errorCodes: contract.errorCodes,
    }),
  ]),
);

export const contractJsonSchemas = Object.freeze({
  contractVersion: "1.0.0",
  dialect: JSON_SCHEMA_DIALECT,
  operations: Object.freeze(operationJsonSchemas),
  entities: Object.freeze({
    Task: generateJsonSchema(TaskSchema, "urn:we-remember:entity:Task"),
    Domain: generateJsonSchema(DomainSchema, "urn:we-remember:entity:Domain"),
    ConsentDecision: generateJsonSchema(
      ConsentDecisionSchema,
      "urn:we-remember:entity:ConsentDecision",
    ),
    SharedSignal: generateJsonSchema(
      SharedSignalSchema,
      "urn:we-remember:entity:SharedSignal",
    ),
    Handover: generateJsonSchema(
      HandoverSchema,
      "urn:we-remember:entity:Handover",
    ),
    CareRule: generateJsonSchema(
      CareRuleSchema,
      "urn:we-remember:entity:CareRule",
    ),
    CareEvent: generateJsonSchema(
      CareEventSchema,
      "urn:we-remember:entity:CareEvent",
    ),
    AuditEntry: generateJsonSchema(
      AuditEntrySchema,
      "urn:we-remember:entity:AuditEntry",
    ),
    DomainEvent: generateJsonSchema(
      DomainEventSchema,
      "urn:we-remember:event:DomainEvent",
    ),
    NeedsHumanReview: generateJsonSchema(
      NeedsHumanReviewSchema,
      "urn:we-remember:ai:NeedsHumanReview",
    ),
    ContractError: generateJsonSchema(
      ContractErrorSchema,
      "urn:we-remember:error:ContractError",
    ),
  }),
});

export type ContractJsonSchemas = typeof contractJsonSchemas;
