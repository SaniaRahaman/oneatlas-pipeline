export interface ActionDescriptor {
  id: string;
  displayName: string;
  inputSchema: Record<string, string>;
  outputSchema: Record<string, string>;
}

export interface TriggerDescriptor {
  id: string;
  displayName: string;
  entityEvents: string[];
}

export interface Integration {
  id: string;
  displayName: string;
  authType: "oauth2" | "api_key" | "webhook_secret" | "none";
  triggers: TriggerDescriptor[];
  actions: ActionDescriptor[];
  implemented: boolean;
  stubNote?: string;
}

export const INTEGRATION_REGISTRY: Integration[] = [
  {
    id: "slack",
    displayName: "Slack",
    authType: "oauth2",
    implemented: true,
    triggers: [
      { id: "record_created", displayName: "Record Created", entityEvents: ["created"] },
      { id: "record_updated", displayName: "Record Updated", entityEvents: ["updated"] },
      { id: "status_changed", displayName: "Status Changed", entityEvents: ["status_changed"] },
    ],
    actions: [
      {
        id: "send_channel_message",
        displayName: "Send Channel Message",
        inputSchema: { channel: "string", message: "string", blocks: "json?" },
        outputSchema: { messageId: "string", timestamp: "string" },
      },
      {
        id: "send_dm",
        displayName: "Send Direct Message",
        inputSchema: { userId: "string", message: "string" },
        outputSchema: { messageId: "string" },
      },
    ],
  },
  {
    id: "stripe",
    displayName: "Stripe",
    authType: "api_key",
    implemented: true,
    triggers: [
      { id: "payment_succeeded", displayName: "Payment Succeeded", entityEvents: ["created", "status_changed"] },
      { id: "subscription_updated", displayName: "Subscription Updated", entityEvents: ["updated"] },
    ],
    actions: [
      {
        id: "create_customer",
        displayName: "Create Customer",
        inputSchema: { email: "string", name: "string", metadata: "json?" },
        outputSchema: { customerId: "string" },
      },
      {
        id: "create_charge",
        displayName: "Create Charge",
        inputSchema: { amount: "number", currency: "string", customerId: "string" },
        outputSchema: { chargeId: "string", status: "string" },
      },
      {
        id: "manage_subscription",
        displayName: "Manage Subscription",
        inputSchema: { customerId: "string", priceId: "string", action: "string" },
        outputSchema: { subscriptionId: "string", status: "string" },
      },
    ],
  },
  {
    id: "whatsapp",
    displayName: "WhatsApp (via Twilio)",
    authType: "api_key",
    implemented: true,
    triggers: [
      { id: "user_action", displayName: "User Action", entityEvents: ["created", "status_changed"] },
    ],
    actions: [
      {
        id: "send_template_message",
        displayName: "Send Template Message",
        inputSchema: { to: "string", templateName: "string", variables: "json" },
        outputSchema: { messageSid: "string", status: "string" },
      },
      {
        id: "send_notification",
        displayName: "Send Notification",
        inputSchema: { to: "string", body: "string" },
        outputSchema: { messageSid: "string" },
      },
    ],
  },
  {
    id: "gmail",
    displayName: "Gmail / Google Workspace",
    authType: "oauth2",
    implemented: true,
    triggers: [
      { id: "record_event", displayName: "Record Event", entityEvents: ["created", "updated", "status_changed"] },
    ],
    actions: [
      {
        id: "send_email",
        displayName: "Send Email",
        inputSchema: { to: "string", subject: "string", body: "string", cc: "string?" },
        outputSchema: { messageId: "string" },
      },
      {
        id: "create_calendar_event",
        displayName: "Create Calendar Event",
        inputSchema: { title: "string", startTime: "string", endTime: "string", attendees: "string[]" },
        outputSchema: { eventId: "string", link: "string" },
      },
    ],
  },
  {
    id: "jira",
    displayName: "Jira",
    authType: "api_key",
    implemented: true,
    triggers: [
      { id: "task_event", displayName: "Task/Issue Event", entityEvents: ["created", "updated", "status_changed"] },
    ],
    actions: [
      {
        id: "create_issue",
        displayName: "Create Issue",
        inputSchema: { projectKey: "string", summary: "string", description: "string", issueType: "string" },
        outputSchema: { issueId: "string", issueKey: "string", url: "string" },
      },
      {
        id: "update_status",
        displayName: "Update Issue Status",
        inputSchema: { issueKey: "string", transitionId: "string" },
        outputSchema: { success: "boolean" },
      },
    ],
  },
  {
    id: "webhook",
    displayName: "Generic Webhook",
    authType: "webhook_secret",
    implemented: true,
    triggers: [
      { id: "any", displayName: "Any Trigger", entityEvents: ["created", "updated", "deleted", "status_changed"] },
    ],
    actions: [
      {
        id: "post_payload",
        displayName: "POST Payload",
        inputSchema: { url: "string", payload: "json", secret: "string?" },
        outputSchema: { statusCode: "number", response: "json" },
      },
    ],
  },
  {
    id: "google_sheets",
    displayName: "Google Sheets",
    authType: "oauth2",
    implemented: true,
    triggers: [
      { id: "data_export", displayName: "Data Export Event", entityEvents: ["created", "updated"] },
    ],
    actions: [
      {
        id: "append_row",
        displayName: "Append Row",
        inputSchema: { spreadsheetId: "string", sheetName: "string", values: "json" },
        outputSchema: { updatedRange: "string", updatedRows: "number" },
      },
    ],
  },
  {
    id: "salesforce",
    displayName: "Salesforce",
    authType: "oauth2",
    implemented: false,
    stubNote: "Registry and payload schema defined. HTTP calls stubbed — implement OAuth2 flow and REST API calls.",
    triggers: [
      { id: "crm_entity_synced", displayName: "CRM Entity Synced", entityEvents: ["created", "updated"] },
    ],
    actions: [
      {
        id: "create_lead",
        displayName: "Create Lead",
        inputSchema: { firstName: "string", lastName: "string", email: "string", company: "string" },
        outputSchema: { leadId: "string" },
      },
    ],
  },
  {
    id: "hubspot",
    displayName: "HubSpot",
    authType: "oauth2",
    implemented: false,
    stubNote: "Registry and payload schema defined. HTTP calls stubbed.",
    triggers: [
      { id: "contact_event", displayName: "Contact or Deal Event", entityEvents: ["created", "updated", "status_changed"] },
    ],
    actions: [
      {
        id: "create_contact",
        displayName: "Create Contact",
        inputSchema: { email: "string", firstName: "string", lastName: "string" },
        outputSchema: { contactId: "string" },
      },
    ],
  },
];

export function getIntegrationById(id: string): Integration | undefined {
  return INTEGRATION_REGISTRY.find((i) => i.id === id);
}

export function getRegisteredIds(): Set<string> {
  return new Set(INTEGRATION_REGISTRY.map((i) => i.id));
}

// Map common user-mentioned terms to integration IDs
export function normalizeIntegrationName(name: string): string {
  const lower = name.toLowerCase().trim();
  const map: Record<string, string> = {
    slack: "slack",
    stripe: "stripe",
    whatsapp: "whatsapp",
    "whats app": "whatsapp",
    gmail: "gmail",
    email: "gmail",
    google: "gmail",
    jira: "jira",
    webhook: "webhook",
    sheets: "google_sheets",
    "google sheets": "google_sheets",
    salesforce: "salesforce",
    hubspot: "hubspot",
  };
  return map[lower] ?? lower;
}
