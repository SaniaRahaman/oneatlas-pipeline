import { z } from "zod";
import { ValidationResult } from "@/types";

// ── AppIntent Schema ──────────────────────────────────────────
export const AppIntentSchema = z.object({
  appName: z.string().min(1),
  appType: z.enum([
    "crm",
    "project_management",
    "ecommerce",
    "hr_tool",
    "inventory",
    "content_platform",
    "analytics",
    "custom",
  ]),
  features: z.array(z.string()).min(1),
  entities: z.array(z.string()).min(1),
  integrationsRequested: z.array(z.string()),
  assumptions: z.array(z.string()),
  clarificationRequired: z
    .object({ flag: z.literal(true), question: z.string() })
    .optional(),
});

// ── DataSchema ────────────────────────────────────────────────
const FieldSchemaZ = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "date", "uuid", "text", "enum", "json"]),
  nullable: z.boolean(),
  isRelation: z.boolean(),
  isPrimary: z.boolean(),
  isUnique: z.boolean(),
});

const RelationSchemaZ = z.object({
  type: z.enum(["hasMany", "belongsTo", "hasOne"]),
  target: z.string(),
  foreignKey: z.string(),
  onDelete: z.enum(["cascade", "set_null", "restrict"]),
});

const EntitySchemaZ = z.object({
  name: z.string().min(1),
  tableName: z.string().regex(/^[a-z_]+$/, "tableName must be snake_case"),
  fields: z.array(FieldSchemaZ).min(1),
  relations: z.array(RelationSchemaZ),
});

export const DataSchemaZ = z.object({
  entities: z.array(EntitySchemaZ).min(1),
});

// ── AppSpec Schema ────────────────────────────────────────────
const PageSpecZ = z.object({
  name: z.string(),
  route: z.string().startsWith("/"),
  layout: z.enum(["list", "detail", "dashboard", "settings"]),
  boundEntity: z.string(),
  components: z.array(z.enum(["table", "form", "chart", "card"])).min(1),
});

const ApiEndpointZ = z.object({
  path: z.string().startsWith("/"),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]),
  handlerDescription: z.string(),
  boundEntity: z.string(),
  authRequired: z.boolean(),
  rateLimitFlag: z.boolean(),
});

const AuthRuleZ = z.object({
  role: z.string(),
  permissions: z.array(
    z.object({
      entity: z.string(),
      read: z.boolean(),
      write: z.boolean(),
      delete: z.boolean(),
    })
  ),
});

const IntegrationHookZ = z.object({
  integrationId: z.string(),
  trigger: z.string(),
  action: z.string(),
});

const WorkflowStubZ = z.object({
  name: z.string(),
  trigger: z.object({
    entity: z.string(),
    event: z.enum(["created", "updated", "deleted", "status_changed"]),
    condition: z.string().optional(),
  }),
  integration: z.string(),
  action: z.string(),
  payload: z.record(z.string(), z.string()),
});

export const AppSpecSchema = z.object({
  pages: z.array(PageSpecZ).min(1),
  apiEndpoints: z.array(ApiEndpointZ).min(1),
  authRules: z.array(AuthRuleZ).min(1),
  integrationHooks: z.array(IntegrationHookZ),
  workflowStubs: z.array(WorkflowStubZ),
});

// ── Validation Functions ──────────────────────────────────────
function zodValidate(schema: z.ZodTypeAny, data: unknown): ValidationResult {
  const result = schema.safeParse(data);
  if (result.success) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: result.error.issues.map((e) => ({
      field: e.path.join("."),
      message: e.message,
      code: e.code,
    })),
  };
}

export function validateIntent(data: unknown): ValidationResult {
  return zodValidate(AppIntentSchema, data);
}

export function validateDataSchema(data: unknown): ValidationResult {
  const base = zodValidate(DataSchemaZ, data);
  if (!base.valid) return base;

  const schema = data as { entities: Array<{ name: string; fields: Array<{ name: string }>; relations: Array<{ target: string }> }> };
  const entityNames = new Set(schema.entities.map((e) => e.name));
  const extraErrors: ValidationResult["errors"] = [];

  // Every entity must have tenantId field
  for (const entity of schema.entities) {
    const hasTenantId = entity.fields.some((f) => f.name === "tenantId");
    if (!hasTenantId) {
      extraErrors.push({
        field: `entities.${entity.name}.fields`,
        message: `Entity "${entity.name}" is missing required tenantId field`,
        code: "missing_tenant_id",
      });
    }
    // Relations must reference existing entities
    for (const rel of entity.relations) {
      if (!entityNames.has(rel.target)) {
        extraErrors.push({
          field: `entities.${entity.name}.relations`,
          message: `Relation target "${rel.target}" does not exist in schema`,
          code: "invalid_relation_target",
        });
      }
    }
  }

  return extraErrors.length > 0
    ? { valid: false, errors: [...base.errors, ...extraErrors] }
    : base;
}

export function validateAppSpec(
  data: unknown,
  dataSchema: { entities: Array<{ name: string }> },
  integrationIds: Set<string>
): ValidationResult {
  const base = zodValidate(AppSpecSchema, data);
  if (!base.valid) return base;

  const spec = data as {
    pages: Array<{ boundEntity: string; name: string }>;
    apiEndpoints: Array<{ boundEntity: string; path: string }>;
    authRules: Array<{ role: string }>;
    workflowStubs: Array<{ trigger: { entity: string }; integration: string }>;
    integrationHooks: Array<{ integrationId: string }>;
  };

  const entityNames = new Set(dataSchema.entities.map((e) => e.name));
  const roles = new Set(spec.authRules.map((r) => r.role));
  const extraErrors: ValidationResult["errors"] = [];

  // Every page must have at least one API endpoint
  for (const page of spec.pages) {
    const hasEndpoint = spec.apiEndpoints.some(
      (ep) => ep.boundEntity === page.boundEntity
    );
    if (!hasEndpoint) {
      extraErrors.push({
        field: `pages.${page.name}`,
        message: `Page "${page.name}" has no corresponding API endpoint`,
        code: "page_missing_api",
      });
    }
  }

  // Workflow stubs must reference valid entities
  for (const stub of spec.workflowStubs) {
    if (!entityNames.has(stub.trigger.entity)) {
      extraErrors.push({
        field: `workflowStubs.${stub.integration}`,
        message: `WorkflowStub references unknown entity "${stub.trigger.entity}"`,
        code: "invalid_entity_ref",
      });
    }
    if (!integrationIds.has(stub.integration)) {
      extraErrors.push({
        field: `workflowStubs.${stub.integration}`,
        message: `WorkflowStub references unregistered integration "${stub.integration}"`,
        code: "unregistered_integration",
      });
    }
  }

  // Integration hooks must reference registered integrations
  for (const hook of spec.integrationHooks) {
    if (!integrationIds.has(hook.integrationId)) {
      extraErrors.push({
        field: `integrationHooks.${hook.integrationId}`,
        message: `IntegrationHook references unregistered integration "${hook.integrationId}"`,
        code: "unregistered_integration",
      });
    }
  }

  return extraErrors.length > 0
    ? { valid: false, errors: [...base.errors, ...extraErrors] }
    : base;
}
