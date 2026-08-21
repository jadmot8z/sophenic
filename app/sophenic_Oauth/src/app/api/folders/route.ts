import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUser } from "@/lib/auth";
export async function POST(request:Request){const {user,supabase}=await getApiUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});const {name}=z.object({name:z.string().trim().min(1).max(80)}).parse(await request.json());const {data,error}=await supabase.from("folders").insert({user_id:user.id,name}).select("id,name").single();return error?NextResponse.json({error:error.message},{status:400}):NextResponse.json(data);}
