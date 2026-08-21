import { z } from "zod";
import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import { autoTitle } from "@/lib/utils";
import { assertWithinLimits, recordUsage } from "@/lib/server/usage";
import { createOpenRouterChatStream, type OpenRouterChunk, type OpenRouterUsage } from "@/lib/openrouter";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const schema=z.object({conversationId:z.string().uuid().optional(),modelId:z.string().uuid(),message:z.string().trim().min(1).max(50000)});

export async function POST(request:Request){
 const {user,supabase}=await getApiUser(); if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 let body:z.infer<typeof schema>; try{body=schema.parse(await request.json())}catch{return NextResponse.json({error:"Requête invalide"},{status:400})}
 try{await assertWithinLimits(user.id)}catch(e){return NextResponse.json({error:e instanceof Error&&e.message.includes("LIMIT")?"Votre limite d’utilisation est atteinte.":"Limite indisponible"},{status:429})}
 const {data:model}=await supabase.from("models").select("id,name,openrouter_id,enabled,kind").eq("id",body.modelId).eq("enabled",true).maybeSingle();
 if(!model||model.kind==="image")return NextResponse.json({error:"Modèle texte indisponible"},{status:400});
 let conversationId=body.conversationId; let isNew=false;
 if(conversationId){const {data:c}=await supabase.from("conversations").select("id").eq("id",conversationId).maybeSingle();if(!c)return NextResponse.json({error:"Conversation introuvable"},{status:404}); await supabase.from("conversations").update({model_id:model.id,model_snapshot:model.openrouter_id,updated_at:new Date().toISOString()}).eq("id",conversationId);}else{const {data:c,error}=await supabase.from("conversations").insert({user_id:user.id,title:autoTitle(body.message),model_id:model.id,model_snapshot:model.openrouter_id}).select("id").single();if(error)return NextResponse.json({error:error.message},{status:400});conversationId=c.id;isNew=true;}
 const {data:userMessage,error:userMessageError}=await supabase.from("messages").insert({conversation_id:conversationId,user_id:user.id,role:"user",content:body.message,model_id:model.id,model_snapshot:model.openrouter_id}).select("id").single();
 if(userMessageError)return NextResponse.json({error:userMessageError.message},{status:400});
 const [{data:history},{data:settings}]=await Promise.all([supabase.from("messages").select("role,content").eq("conversation_id",conversationId).in("role",["user","assistant"]).order("created_at",{ascending:false}).limit(60),supabase.from("user_settings").select("custom_system_prompt").eq("user_id",user.id).maybeSingle()]);
 const messages:Array<{role:"system"|"user"|"assistant";content:string}>=(history??[]).reverse().map(m=>({role:m.role as "user"|"assistant",content:m.content})); if(settings?.custom_system_prompt)messages.unshift({role:"system" as const,content:settings.custom_system_prompt});
 let upstream;try{upstream=await createOpenRouterChatStream({model:model.openrouter_id,messages,signal:request.signal})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"OpenRouter indisponible"},{status:502})}
 const generationId=upstream.response.headers.get("x-generation-id"); const encoder=new TextEncoder(); let full=""; let usage:OpenRouterUsage={}; let resolvedModel=model.openrouter_id;
 const stream=new ReadableStream({async start(controller){const reader=upstream.body.getReader();const decoder=new TextDecoder();let buffer="";try{while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split(/\r?\n/);buffer=lines.pop()??"";for(const line of lines){if(!line.startsWith("data:"))continue;const data=line.slice(5).trim();if(!data||data==="[DONE]")continue;let chunk:OpenRouterChunk;try{chunk=JSON.parse(data)}catch{continue}if(chunk.error)throw new Error(chunk.error.message??"Erreur OpenRouter");if(chunk.model)resolvedModel=chunk.model;const delta=chunk.choices?.[0]?.delta?.content;if(delta){full+=delta;controller.enqueue(encoder.encode(JSON.stringify({type:"delta",text:delta})+"\n"));}if(chunk.usage)usage=chunk.usage;}}
   const {data:assistant}=await supabase.from("messages").insert({conversation_id:conversationId,user_id:user.id,role:"assistant",content:full,model_id:model.id,model_snapshot:resolvedModel,prompt_tokens:usage.prompt_tokens??0,completion_tokens:usage.completion_tokens??0,total_tokens:usage.total_tokens??0,cost_usd:usage.cost??0,metadata:{generation_id:generationId}}).select("id").single();
   await recordUsage({userId:user.id,conversationId,messageId:assistant?.id??null,modelId:model.id,providerModel:resolvedModel,kind:"chat",promptTokens:usage.prompt_tokens??0,completionTokens:usage.completion_tokens??0,reasoningTokens:usage.completion_tokens_details?.reasoning_tokens??0,cachedTokens:usage.prompt_tokens_details?.cached_tokens??0,costUsd:Number(usage.cost??0),upstreamCostUsd:usage.cost_details?.upstream_inference_cost??null,generationId});
   const admin=createAdminClient();await admin.rpc("increment_conversation_usage",{p_conversation_id:conversationId,p_tokens:usage.total_tokens??0,p_cost:Number(usage.cost??0)});
   controller.enqueue(encoder.encode(JSON.stringify({type:"usage",totalTokens:usage.total_tokens??0,costUsd:Number(usage.cost??0),model:resolvedModel})+"\n"));controller.close();
  }catch(e){if(full){await supabase.from("messages").insert({conversation_id:conversationId,user_id:user.id,role:"assistant",content:full,model_id:model.id,model_snapshot:resolvedModel,metadata:{interrupted:true,generation_id:generationId}});}controller.enqueue(encoder.encode(JSON.stringify({type:"error",message:e instanceof Error?e.message:"Streaming interrompu"})+"\n"));controller.close();}}});
 return new Response(stream,{headers:{"Content-Type":"application/x-ndjson; charset=utf-8","Cache-Control":"no-cache, no-transform","X-Accel-Buffering":"no","X-Conversation-Id":conversationId as string,"X-Sophenic-New-Conversation":isNew?"1":"0"}});
}
