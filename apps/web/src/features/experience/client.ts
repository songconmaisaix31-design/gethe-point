import type {
  AcknowledgeCareEventActor,
  AcknowledgeCareEventRequest,
  AcknowledgeCareEventResult,
  DecideConsentActor,
  DecideConsentRequest,
  DecideConsentResult,
  DeleteEvidenceActor,
  DeleteEvidenceRequest,
  DeleteEvidenceResult,
  DeleteSpaceActor,
  DeleteSpaceRequest,
  DeleteSpaceResult,
  ExportMyDataActor,
  ExportMyDataRequest,
  ExportMyDataResult,
  GetAuditTrailActor,
  GetAuditTrailRequest,
  GetAuditTrailResult,
  GetCareInboxActor,
  GetCareInboxRequest,
  GetCareInboxResult,
  GetDomainWithEvidenceActor,
  GetDomainWithEvidenceRequest,
  GetDomainWithEvidenceResult,
  GetPendingHandoversActor,
  GetPendingHandoversRequest,
  GetPendingHandoversResult,
  GetPrivateConversationActor,
  GetPrivateConversationRequest,
  GetPrivateConversationResult,
  GetResponsibilityReportActor,
  GetResponsibilityReportRequest,
  GetResponsibilityReportResult,
  GetRoleHomeActor,
  GetRoleHomeRequest,
  GetRoleHomeResult,
  GetVisibleSharedSignalsActor,
  GetVisibleSharedSignalsRequest,
  GetVisibleSharedSignalsResult,
  HandleCareEventActor,
  HandleCareEventRequest,
  HandleCareEventResult,
  RevokeAnalysisConsentActor,
  RevokeAnalysisConsentRequest,
  RevokeAnalysisConsentResult,
  SupplyHandoverInfoActor,
  SupplyHandoverInfoRequest,
  SupplyHandoverInfoResult,
  ConfirmHandoverFromActor,
  ConfirmHandoverFromRequest,
  ConfirmHandoverFromResult,
  ConfirmHandoverToActor,
  ConfirmHandoverToRequest,
  ConfirmHandoverToResult,
} from "./contracts";

export interface OperationInput<Actor, Request> {
  readonly actor: Actor;
  readonly request: Request;
}

export interface ExperienceQueryClient {
  getRoleHome(
    input: OperationInput<GetRoleHomeActor, GetRoleHomeRequest>,
  ): Promise<GetRoleHomeResult>;
  getPrivateConversation(
    input: OperationInput<GetPrivateConversationActor, GetPrivateConversationRequest>,
  ): Promise<GetPrivateConversationResult>;
  getVisibleSharedSignals(
    input: OperationInput<GetVisibleSharedSignalsActor, GetVisibleSharedSignalsRequest>,
  ): Promise<GetVisibleSharedSignalsResult>;
  getResponsibilityReport(
    input: OperationInput<GetResponsibilityReportActor, GetResponsibilityReportRequest>,
  ): Promise<GetResponsibilityReportResult>;
  getDomainWithEvidence(
    input: OperationInput<GetDomainWithEvidenceActor, GetDomainWithEvidenceRequest>,
  ): Promise<GetDomainWithEvidenceResult>;
  getPendingHandovers(
    input: OperationInput<GetPendingHandoversActor, GetPendingHandoversRequest>,
  ): Promise<GetPendingHandoversResult>;
  getCareInbox(
    input: OperationInput<GetCareInboxActor, GetCareInboxRequest>,
  ): Promise<GetCareInboxResult>;
  getAuditTrail(
    input: OperationInput<GetAuditTrailActor, GetAuditTrailRequest>,
  ): Promise<GetAuditTrailResult>;
}

export interface ExperienceCommandClient {
  decideConsent(
    input: OperationInput<DecideConsentActor, DecideConsentRequest>,
  ): Promise<DecideConsentResult>;
  supplyHandoverInfo(
    input: OperationInput<SupplyHandoverInfoActor, SupplyHandoverInfoRequest>,
  ): Promise<SupplyHandoverInfoResult>;
  confirmHandoverFrom(
    input: OperationInput<ConfirmHandoverFromActor, ConfirmHandoverFromRequest>,
  ): Promise<ConfirmHandoverFromResult>;
  confirmHandoverTo(
    input: OperationInput<ConfirmHandoverToActor, ConfirmHandoverToRequest>,
  ): Promise<ConfirmHandoverToResult>;
  acknowledgeCareEvent(
    input: OperationInput<AcknowledgeCareEventActor, AcknowledgeCareEventRequest>,
  ): Promise<AcknowledgeCareEventResult>;
  handleCareEvent(
    input: OperationInput<HandleCareEventActor, HandleCareEventRequest>,
  ): Promise<HandleCareEventResult>;
  deleteEvidence(
    input: OperationInput<DeleteEvidenceActor, DeleteEvidenceRequest>,
  ): Promise<DeleteEvidenceResult>;
  revokeAnalysisConsent(
    input: OperationInput<RevokeAnalysisConsentActor, RevokeAnalysisConsentRequest>,
  ): Promise<RevokeAnalysisConsentResult>;
  exportMyData(
    input: OperationInput<ExportMyDataActor, ExportMyDataRequest>,
  ): Promise<ExportMyDataResult>;
  deleteSpace(
    input: OperationInput<DeleteSpaceActor, DeleteSpaceRequest>,
  ): Promise<DeleteSpaceResult>;
}

export interface ExperienceClient {
  readonly query: ExperienceQueryClient;
  readonly command: ExperienceCommandClient;
}

export interface ExperienceBundle {
  readonly home: GetRoleHomeResult["home"];
  readonly conversation: GetPrivateConversationResult["conversation"];
  readonly signals: GetVisibleSharedSignalsResult["signals"];
  readonly report: GetResponsibilityReportResult["report"] | null;
  readonly domain: GetDomainWithEvidenceResult["domain"];
  readonly handovers: GetPendingHandoversResult["handovers"];
  readonly careEvents: GetCareInboxResult["events"];
  readonly auditEntries: GetAuditTrailResult["entries"];
}
