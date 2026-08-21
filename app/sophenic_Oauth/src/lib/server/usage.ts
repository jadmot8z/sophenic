import { createAdminClient } from "@/lib/supabase/admin";

export async function recordUsage(input: {
  userId: string;
  conversationId?: string | null;
  messageId?: string | null;
  modelId?: string | null;
  providerModel: string;
  kind: "chat" | "image" | "agent";
  promptTokens: number;
  completionTokens: number;
  reasoningTokens?: number;
  cachedTokens?: number;
  costUsd: number;
  upstreamCostUsd?: number | null;
  generationId?: string | null;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("usage_events").insert({
    user_id: input.userId,
    conversation_id: input.conversationId ?? null,
    message_id: input.messageId ?? null,
    model_id: input.modelId ?? null,
    provider_model: input.providerModel,
    usage_kind: input.kind,
    prompt_tokens: input.promptTokens,
    completion_tokens: input.completionTokens,
    total_tokens: input.promptTokens + input.completionTokens,
    reasoning_tokens: input.reasoningTokens ?? 0,
    cached_tokens: input.cachedTokens ?? 0,
    cost_usd: input.costUsd,
    upstream_cost_usd: input.upstreamCostUsd ?? null,
    generation_id: input.generationId ?? null
  });
  if (error) console.error("Unable to record usage", error);
}

export async function getRollingUsage(userId: string) {
  const admin = createAdminClient();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [{ data: day }, { data: month }, { data: profile }] = await Promise.all([
    admin.from("usage_events").select("total_tokens,cost_usd").eq("user_id", userId).gte("created_at", since24h),
    admin.from("usage_events").select("total_tokens,cost_usd").eq("user_id", userId).gte("created_at", monthStart.toISOString()),
    admin.from("profiles").select("plan_id").eq("id", userId).single()
  ]);

  const { data: plan } = await admin.from("plans").select("daily_token_limit,monthly_token_limit,monthly_cost_limit_usd").eq("id", profile?.plan_id ?? "free").single();
  const sum = (rows: Array<{ total_tokens: number | null; cost_usd: number | string | null }> | null) => ({
    tokens: (rows ?? []).reduce((a, r) => a + Number(r.total_tokens ?? 0), 0),
    cost: (rows ?? []).reduce((a, r) => a + Number(r.cost_usd ?? 0), 0)
  });
  return { day: sum(day), month: sum(month), plan };
}

export async function assertWithinLimits(userId: string) {
  const usage = await getRollingUsage(userId);
  if (usage.plan?.daily_token_limit && usage.day.tokens >= usage.plan.daily_token_limit) throw new Error("DAILY_TOKEN_LIMIT");
  if (usage.plan?.monthly_token_limit && usage.month.tokens >= usage.plan.monthly_token_limit) throw new Error("MONTHLY_TOKEN_LIMIT");
  if (usage.plan?.monthly_cost_limit_usd && usage.month.cost >= Number(usage.plan.monthly_cost_limit_usd)) throw new Error("MONTHLY_COST_LIMIT");
  return usage;
}
