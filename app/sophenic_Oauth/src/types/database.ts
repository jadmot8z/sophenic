// Lightweight domain types. For strict generated Supabase types, run:
// npx supabase gen types typescript --project-id <project-id> > src/types/supabase.generated.ts
export type UserRole="user"|"admin"|"support";
export type ModelKind="text"|"image"|"multimodal"|"embedding";
export type UsageKind="chat"|"image"|"agent";
export type AgentDecision="deny"|"ask"|"allow_once"|"allow_session";
