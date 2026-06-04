"use client";

import { useState, useEffect, useRef } from "react";

const EXAMPLES = [
  "Build a CRM for a real estate agency. Agents manage leads, properties, and deals. Admin sees analytics. WhatsApp notifications when a deal closes.",
  "Task manager for an engineering team. Tasks have due dates, assignees, priorities, and status. Team lead gets a Slack message when a task is overdue.",
  "E-commerce backend. Products, orders, customers, payments via Stripe. Order confirmation sent via Gmail.",
  "HR tool for a 50-person company. Track employees, leave requests, and performance reviews. Notify manager on Slack when leave is approved.",
  "An app.",
];

type StageStatus = "pending" | "running" | "complete" | "failed";

interface StageState {
  name: string;
  status: StageStatus;
  latencyMs?: number;
  repairLogs?: unknown[];
  error?: string;
}

interface JobResult {
  appIntent?: unknown;
  dataSchema?: unknown;
  appSpec?: unknown;
  stages?: unknown[];
  totalCostUsd?: number;
  totalLatencyMs?: number;
}

const STAGE_LABELS: Record<string, string> = {
  intent_extraction: "Intent Extraction",
  schema_generation: "Schema Generation",
  app_spec_generation: "AppSpec Generation",
};

export default function GeneratePage() {
  const [prompt, setPrompt] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [stages, setStages] = useState<StageState[]>([]);
  const [result, setResult] = useState<JobResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"entities" | "pages" | "endpoints" | "workflows" | "errors" | "integrations">("entities");
  const [integrations, setIntegrations] = useState<unknown[]>([]);
  const [clarification, setClarification] = useState<{ question: string } | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    fetch("/api/integrations")
      .then((r) => r.json())
      .then((d) => setIntegrations(d.integrations ?? []));
  }, []);

  const submit = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    setClarification(null);
    setStages([
      { name: "intent_extraction", status: "pending" },
      { name: "schema_generation", status: "pending" },
      { name: "app_spec_generation", status: "pending" },
    ]);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); setLoading(false); return; }
      setJobId(data.jobId);
      listenToStream(data.jobId);
    } catch {
      setError("Failed to start generation");
      setLoading(false);
    }
  };

  const listenToStream = (id: string) => {
    if (eventSourceRef.current) eventSourceRef.current.close();
    const es = new EventSource(`/api/generate/${id}/stream`);
    eventSourceRef.current = es;

    es.addEventListener("stage_start", (e) => {
      const ev = JSON.parse(e.data);
      setStages((prev) => prev.map((s) => s.name === ev.stage ? { ...s, status: "running" } : s));
    });

    es.addEventListener("stage_complete", (e) => {
      const ev = JSON.parse(e.data);
      setStages((prev) => prev.map((s) =>
        s.name === ev.stage ? { ...s, status: "complete", repairLogs: ev.repairLog } : s
      ));
    });

    es.addEventListener("stage_failed", (e) => {
      const ev = JSON.parse(e.data);
      setStages((prev) => prev.map((s) =>
        s.name === ev.stage ? { ...s, status: "failed", error: ev.error } : s
      ));
    });

    es.addEventListener("generation_complete", async () => {
      es.close();
      const r = await fetch(`/api/generate/${id}`);
      const data = await r.json();
      if (data.appIntent?.clarificationRequired) {
        setClarification({ question: data.appIntent.clarificationRequired.question });
      }
      setResult(data);
      setLoading(false);

      // Update stage latencies
      if (data.stages) {
        setStages((prev) => prev.map((s) => {
          const stageData = (data.stages as Array<{ stage: string; latencyMs: number; repairLogs: unknown[] }>).find((d) => d.stage === s.name);
          return stageData ? { ...s, latencyMs: stageData.latencyMs, repairLogs: stageData.repairLogs } : s;
        }));
      }
    });

    es.addEventListener("generation_failed", async (e) => {
      const ev = JSON.parse(e.data);
      es.close();
      setError(ev.error ?? "Generation failed");
      setLoading(false);
    });

    es.onerror = () => { es.close(); setLoading(false); };
  };

  const getStageIcon = (status: StageStatus) => {
    if (status === "running") return "⏳";
    if (status === "complete") return "✅";
    if (status === "failed") return "❌";
    return "○";
  };

  const intent = result?.appIntent as Record<string, unknown> | undefined;
  const schema = result?.dataSchema as { entities: Array<{ name: string; tableName: string; fields: Array<{ name: string; type: string; nullable: boolean; isPrimary: boolean }> }> } | undefined;
  const spec = result?.appSpec as {
    pages: Array<{ name: string; route: string; layout: string; boundEntity: string; components: string[] }>;
    apiEndpoints: Array<{ path: string; method: string; handlerDescription: string; boundEntity: string; authRequired: boolean }>;
    authRules: Array<{ role: string; permissions: Array<{ entity: string; read: boolean; write: boolean; delete: boolean }> }>;
    workflowStubs: Array<{ name: string; trigger: { entity: string; event: string; condition?: string }; integration: string; action: string }>;
    integrationHooks: Array<{ integrationId: string; trigger: string; action: string }>;
  } | undefined;

  const allRepairLogs = stages.flatMap((s) => (s.repairLogs ?? []) as Array<{ strategy: string; outcome: string; errorInput: string }>);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <span className="text-indigo-400 font-bold text-lg tracking-widest">ONEATLAS</span>
          <span className="text-gray-500 text-xs ml-3 tracking-wider">AI GENERATION PIPELINE</span>
        </div>
        <div className="text-gray-600 text-xs">3-STAGE · VALIDATED · MULTI-PROVIDER</div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left panel */}
        <div className="lg:col-span-1 space-y-4">
          {/* Input */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-xs text-gray-500 tracking-widest mb-2">PROMPT INPUT</div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={loading}
              rows={5}
              placeholder="Describe the app you want to build..."
              className="w-full bg-gray-950 border border-gray-800 rounded-lg p-3 text-sm text-gray-300 placeholder-gray-600 resize-none outline-none focus:border-indigo-700"
            />
            <div className="mt-2 space-y-1">
              {EXAMPLES.map((ex, i) => (
                <button key={i} onClick={() => setPrompt(ex)} disabled={loading}
                  className="w-full text-left text-xs text-gray-600 hover:text-gray-400 truncate transition-colors">
                  › {ex.slice(0, 60)}...
                </button>
              ))}
            </div>
            <button onClick={submit} disabled={loading || !prompt.trim()}
              className="mt-3 w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold py-2.5 rounded-lg text-sm transition-colors tracking-wider">
              {loading ? "⏳ RUNNING..." : "▶ GENERATE"}
            </button>
          </div>

          {/* Pipeline stages */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-xs text-gray-500 tracking-widest mb-3">PIPELINE STAGES</div>
            <div className="space-y-2">
              {stages.map((s) => (
                <div key={s.name} className={`rounded-lg p-3 border transition-all ${
                  s.status === "running" ? "border-indigo-700 bg-indigo-950" :
                  s.status === "complete" ? "border-green-800 bg-green-950" :
                  s.status === "failed" ? "border-red-800 bg-red-950" :
                  "border-gray-800 bg-gray-950"
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{getStageIcon(s.status)}</span>
                      <span className="text-xs font-bold text-gray-300">{STAGE_LABELS[s.name]}</span>
                    </div>
                    {s.latencyMs && <span className="text-xs text-gray-500">{s.latencyMs}ms</span>}
                  </div>
                  {s.repairLogs && s.repairLogs.length > 0 && (
                    <div className="mt-1 text-xs text-amber-500">🔧 {s.repairLogs.length} repair(s) applied</div>
                  )}
                  {s.error && <div className="mt-1 text-xs text-red-400">{s.error}</div>}
                </div>
              ))}
            </div>

            {result && (
              <div className="mt-3 pt-3 border-t border-gray-800 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Total Cost</span>
                  <span className="text-green-400">${result.totalCostUsd?.toFixed(6)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Total Latency</span>
                  <span className="text-blue-400">{result.totalLatencyMs}ms</span>
                </div>
              </div>
            )}
          </div>

          {/* Clarification */}
          {clarification && (
            <div className="bg-amber-950 border border-amber-700 rounded-xl p-4">
              <div className="text-xs text-amber-500 tracking-widest mb-2">CLARIFICATION NEEDED</div>
              <p className="text-sm text-amber-200">{clarification.question}</p>
              <input className="mt-2 w-full bg-gray-950 border border-amber-700 rounded p-2 text-sm text-gray-300 outline-none"
                placeholder="Your answer..." onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setPrompt(prompt + " " + (e.target as HTMLInputElement).value);
                    setClarification(null);
                  }
                }} />
            </div>
          )}

          {error && (
            <div className="bg-red-950 border border-red-700 rounded-xl p-4 text-sm text-red-300">
              ⚠️ {error}
            </div>
          )}
        </div>

        {/* Right panel — results */}
        <div className="lg:col-span-2">
          {!result && !loading && (
            <div className="h-full flex items-center justify-center text-gray-700 text-sm">
              Enter a prompt and click Generate to start
            </div>
          )}

          {(result || loading) && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              {/* Tabs */}
              <div className="border-b border-gray-800 flex overflow-x-auto">
                {(["entities", "pages", "endpoints", "workflows", "errors", "integrations"] as const).map((tab) => (
                  <button key={tab} onClick={() => setActiveTab(tab)}
                    className={`px-4 py-3 text-xs font-bold tracking-wider whitespace-nowrap transition-colors ${
                      activeTab === tab ? "bg-indigo-900 text-indigo-300 border-b-2 border-indigo-500" : "text-gray-500 hover:text-gray-300"
                    }`}>
                    {tab.toUpperCase()}
                    {tab === "errors" && allRepairLogs.length > 0 && (
                      <span className="ml-1 bg-amber-700 text-amber-200 rounded-full px-1.5 py-0.5 text-[10px]">{allRepairLogs.length}</span>
                    )}
                  </button>
                ))}
              </div>

              <div className="p-4 overflow-auto max-h-[70vh]">
                {/* Entities */}
                {activeTab === "entities" && (
                  <div>
                    {intent && (
                      <div className="mb-4 bg-gray-950 rounded-lg p-3 border border-gray-800">
                        <div className="text-xs text-indigo-400 tracking-wider mb-2">APP INTENT</div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div><span className="text-gray-500">Name:</span> <span className="text-gray-200">{String(intent.appName)}</span></div>
                          <div><span className="text-gray-500">Type:</span> <span className="text-gray-200">{String(intent.appType)}</span></div>
                        </div>
                        {Array.isArray(intent.features) && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {(intent.features as string[]).map((f) => (
                              <span key={f} className="bg-indigo-900 text-indigo-300 rounded px-2 py-0.5 text-xs">{f}</span>
                            ))}
                          </div>
                        )}
                        {Array.isArray(intent.assumptions) && (intent.assumptions as string[]).length > 0 && (
                          <div className="mt-2">
                            <div className="text-xs text-amber-500 mb-1">Assumptions:</div>
                            {(intent.assumptions as string[]).map((a, i) => (
                              <div key={i} className="text-xs text-gray-400">• {a}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {schema?.entities?.map((entity) => (
                      <div key={entity.name} className="mb-3 bg-gray-950 rounded-lg p-3 border border-gray-800">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-indigo-300 font-bold text-sm">{entity.name}</span>
                          <span className="text-gray-600 text-xs">{entity.tableName}</span>
                        </div>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-600 border-b border-gray-800">
                              <th className="text-left py-1 pr-4">Field</th>
                              <th className="text-left py-1 pr-4">Type</th>
                              <th className="text-left py-1">Flags</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entity.fields.map((f) => (
                              <tr key={f.name} className="border-b border-gray-900">
                                <td className="py-1 pr-4 text-gray-300">{f.name}</td>
                                <td className="py-1 pr-4 text-blue-400">{f.type}</td>
                                <td className="py-1 text-gray-600">
                                  {f.isPrimary && <span className="mr-1 text-yellow-600">PK</span>}
                                  {!f.nullable && <span className="text-red-600">NOT NULL</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                    {!schema && loading && <div className="text-gray-600 text-sm">Generating schema...</div>}
                  </div>
                )}

                {/* Pages */}
                {activeTab === "pages" && (
                  <div>
                    {spec?.pages?.map((page, i) => (
                      <div key={i} className="mb-2 bg-gray-950 rounded-lg p-3 border border-gray-800 text-xs">
                        <div className="flex justify-between items-center">
                          <span className="text-indigo-300 font-bold">{page.name}</span>
                          <span className="text-gray-500">{page.route}</span>
                        </div>
                        <div className="mt-1 flex gap-2 flex-wrap">
                          <span className="text-gray-500">layout: <span className="text-blue-400">{page.layout}</span></span>
                          <span className="text-gray-500">entity: <span className="text-green-400">{page.boundEntity}</span></span>
                        </div>
                        <div className="mt-1 flex gap-1">
                          {page.components.map((c) => (
                            <span key={c} className="bg-gray-800 text-gray-400 rounded px-1.5 py-0.5">{c}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                    {!spec && loading && <div className="text-gray-600 text-sm">Generating pages...</div>}
                  </div>
                )}

                {/* Endpoints */}
                {activeTab === "endpoints" && (
                  <div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-500 border-b border-gray-800">
                          <th className="text-left py-2 pr-3">Method</th>
                          <th className="text-left py-2 pr-3">Path</th>
                          <th className="text-left py-2 pr-3">Entity</th>
                          <th className="text-left py-2">Auth</th>
                        </tr>
                      </thead>
                      <tbody>
                        {spec?.apiEndpoints?.map((ep, i) => (
                          <tr key={i} className="border-b border-gray-900">
                            <td className="py-1.5 pr-3">
                              <span className={`font-bold ${
                                ep.method === "GET" ? "text-green-400" :
                                ep.method === "POST" ? "text-blue-400" :
                                ep.method === "DELETE" ? "text-red-400" : "text-yellow-400"
                              }`}>{ep.method}</span>
                            </td>
                            <td className="py-1.5 pr-3 text-gray-300">{ep.path}</td>
                            <td className="py-1.5 pr-3 text-indigo-400">{ep.boundEntity}</td>
                            <td className="py-1.5">{ep.authRequired ? "🔒" : "🔓"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!spec && loading && <div className="text-gray-600 text-sm">Generating endpoints...</div>}
                  </div>
                )}

                {/* Workflows */}
                {activeTab === "workflows" && (
                  <div className="space-y-3">
                    {spec?.workflowStubs?.map((stub, i) => (
                      <div key={i} className="bg-gray-950 rounded-lg p-3 border border-gray-800 text-xs">
                        <div className="text-indigo-300 font-bold mb-1">{stub.name}</div>
                        <div className="grid grid-cols-2 gap-1 text-gray-500">
                          <span>Trigger: <span className="text-gray-300">{stub.trigger.entity}.{stub.trigger.event}</span></span>
                          <span>Integration: <span className="text-green-400">{stub.integration}</span></span>
                          <span>Action: <span className="text-blue-400">{stub.action}</span></span>
                          {stub.trigger.condition && <span>Condition: <span className="text-amber-400">{stub.trigger.condition}</span></span>}
                        </div>
                      </div>
                    ))}
                    {spec?.workflowStubs?.length === 0 && <div className="text-gray-600 text-sm">No workflow stubs generated</div>}
                    {!spec && loading && <div className="text-gray-600 text-sm">Generating workflows...</div>}
                  </div>
                )}

                {/* Errors / Repair Logs */}
                {activeTab === "errors" && (
                  <div>
                    {allRepairLogs.length === 0 ? (
                      <div className="text-gray-600 text-sm">No repairs needed ✅</div>
                    ) : (
                      <div className="space-y-2">
                        {allRepairLogs.map((log, i) => (
                          <div key={i} className={`rounded-lg p-3 border text-xs ${
                            log.outcome === "repaired" ? "bg-green-950 border-green-800" :
                            log.outcome === "failed" ? "bg-red-950 border-red-800" :
                            "bg-amber-950 border-amber-800"
                          }`}>
                            <div className="flex gap-2 items-center mb-1">
                              <span className={`font-bold ${log.outcome === "repaired" ? "text-green-400" : log.outcome === "failed" ? "text-red-400" : "text-amber-400"}`}>
                                {log.outcome.toUpperCase()}
                              </span>
                              <span className="text-gray-500">strategy: {log.strategy}</span>
                            </div>
                            <div className="text-gray-500 truncate">{log.errorInput}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Integrations */}
                {activeTab === "integrations" && (
                  <div className="space-y-2">
                    {(integrations as Array<{ id: string; displayName: string; authType: string; implemented: boolean; stubNote?: string; actions: Array<{ id: string; displayName: string }> }>).map((integration) => (
                      <div key={integration.id} className="bg-gray-950 rounded-lg p-3 border border-gray-800 text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-indigo-300 font-bold">{integration.displayName}</span>
                          <div className="flex gap-2">
                            <span className="text-gray-500">{integration.authType}</span>
                            <span className={integration.implemented ? "text-green-400" : "text-amber-400"}>
                              {integration.implemented ? "✅ implemented" : "🔶 stubbed"}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {integration.actions.map((a) => (
                            <span key={a.id} className="bg-gray-800 text-gray-400 rounded px-1.5 py-0.5">{a.displayName}</span>
                          ))}
                        </div>
                        {integration.stubNote && (
                          <div className="mt-1 text-amber-600">{integration.stubNote}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
