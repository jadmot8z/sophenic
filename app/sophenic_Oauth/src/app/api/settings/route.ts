import { z } from "zod";
import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
const schema=z.object({displayName:z.string().max(80).optional(),locale:z.string().max(12).optional(),systemPrompt:z.string().max(8000).optional()});
export async function PUT(request:Request){const {user,supabase}=await getApiUser(); if(!user)return NextResponse.json({error:"Unauthorized"},{status:401}); const body=schema.parse(await request.json()); const {error}=await supabase.from("user_settings").upsert({user_id:user.id,display_name:body.displayName??null,locale:body.locale??"fr",custom_system_prompt:body.systemPrompt??null},{onConflict:"user_id"}); return error?NextResponse.json({error:error.message},{status:400}):NextResponse.json({ok:true});}
