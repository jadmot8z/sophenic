function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante: ${name}`);
  return value;
}

export const env = {
  appUrl: () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  openRouterKey: () => required("OPENROUTER_API_KEY"),
  openRouterDefaultModel: () => process.env.OPENROUTER_DEFAULT_MODEL ?? "openrouter/auto",
  openRouterAppName: () => process.env.OPENROUTER_APP_NAME ?? "Sophenic",
  openRouterSiteUrl: () => process.env.OPENROUTER_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  stripeSecretKey: () => required("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: () => required("STRIPE_WEBHOOK_SECRET"),
  stripePricePro: () => required("STRIPE_PRICE_PRO"),
  stripePriceBusiness: () => required("STRIPE_PRICE_BUSINESS")
};
