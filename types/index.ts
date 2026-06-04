export type AppType =
  | "crm"
  | "project_management"
  | "ecommerce"
  | "hr_tool"
  | "inventory"
  | "content_platform"
  | "analytics"
  | "custom";

export interface AppIntent {
  appName: string;
  appType: AppType;
  features: string[];
  entities: string[];
  integrationsRequested: string[];
  assumptions: string[];
  clarificationRequired?: { flag: true; question: string };
}

export type FieldType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "uuid"
  | "text"
  | "enum"
  | "json";

export type RelationType = "hasMany" | "belongsTo" | "hasOne";
export type OnDelete = "cascade" | "set_null" | "restrict";

export interface FieldSchema {
  name: string;
  type: FieldType;
  nullable: boolean;
  isRelation: boolean;
  isPrimary: boolean;
  isUnique: boolean;
}

export interface RelationSchema {
  type: RelationType;
  target: string;
  foreignKey: string;
  onDelete: OnDelete;
}

export interface EntitySchema {
  name: string;
  tableName: string;
  fields: FieldSchema[];
  relations: RelationSchema[];
}

export interface DataSchema {
  entities: EntitySchema[];
}

export type PageLayout = "list" | "detail" | "dashboard" | "settings";
export type ComponentType = "table" | "form" | "chart" | "card";

export interface PageSpec {
  name: string;
  route: string;
  layout: PageLayout;
  boundEntity: string;
  components: ComponentType[];
}

export interface ApiEndpoint {
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  handlerDescription: string;
  boundEntity: string;
  authRequired: boolean;
  rateLimitFlag: boolean;
}

export interface AuthRule {
  role: string;
  permissions: {
    entity: string;
    read: boolean;
    write: boolean;
    delete: boolean;
  }[];
}

export interface IntegrationHook {
  integrationId: string;
  trigger: string;
  action: string;
}

export interface WorkflowStub {
  name: string;
  trigger: {
    entity: string;
    event: "created" | "updated" | "deleted" | "status_changed";
    condition?: string;
  };
  integration: string;
  action: string;
  payload: Record<string, string>;
}

export interface AppSpec {
  pages: PageSpec[];
  apiEndpoints: ApiEndpoint[];
  authRules: AuthRule[];
  integrationHooks: IntegrationHook[];
  workflowStubs: WorkflowStub[];
}

export type StageStatus = "pending" | "running" | "complete" | "failed";
export type RepairStrategy = "structural" | "field" | "consistency";

export interface RepairLog {
  stage: string;
  strategy: RepairStrategy;
  errorInput: string;
  outcome: "repaired" | "escalated" | "failed";
  timestamp: string;
}

export interface StageResult {
  stage: string;
  status: StageStatus;
  output?: unknown;
  error?: string;
  latencyMs: number;
  tokensUsed: number;
  estimatedCostUsd: number;
  model: string;
  repairLogs: RepairLog[];
}

export interface Job {
  jobId: string;
  prompt: string;
  status: "pending" | "running" | "complete" | "failed";
  createdAt: string;
  stages: StageResult[];
  appIntent?: AppIntent;
  dataSchema?: DataSchema;
  appSpec?: AppSpec;
  totalCostUsd: number;
  totalLatencyMs: number;
  events: SSEEvent[];
}

export interface SSEEvent {
  type:
    | "stage_start"
    | "stage_complete"
    | "stage_failed"
    | "generation_complete"
    | "generation_failed";
  stage?: string;
  timestamp: string;
  data?: unknown;
  error?: string;
  repairLog?: RepairLog[];
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}
