export type OperatorAccountReasonCode =
  | "SECURITY_REVIEW"
  | "USER_REQUEST"
  | "ABUSE_PREVENTION"
  | "INCIDENT_RESPONSE";

export interface OperatorAccountDto {
  id: string;
  maskedEmail: string;
  status: "ACTIVE" | "SUSPENDED";
  emailVerified: boolean;
  authRevision: number;
  activeMembershipCount: number;
  activeSessionCount: number;
  createdAt: string;
  updatedAt: string;
}
