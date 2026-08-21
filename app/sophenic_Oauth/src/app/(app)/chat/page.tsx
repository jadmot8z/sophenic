import { ChatClient } from "@/components/chat/chat-client";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
export const metadata={title:"Nouveau chat"};
export default async function NewChatPage(){const {supabase}=await requireUser();const {data:models}=await supabase.from("models").select("id,name,provider,kind,openrouter_id").eq("enabled",true).order("sort_order").order("name");const list=models??[];const def=list.find(m=>m.openrouter_id===env.openRouterDefaultModel())??list.find(m=>m.kind!=="image")??list[0];return <ChatClient initialMessages={[]} models={list as never} initialModelId={def?.id??""}/>}
