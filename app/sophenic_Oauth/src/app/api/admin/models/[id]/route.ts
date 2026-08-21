import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;const {user,supabase}=await getApiUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});const {data:p}=await supabase.from("profiles").select("role").eq("id",user.id).single();if(p?.role!=="admin")return NextResponse.json({error:"Forbidden"},{status:403});const body=z.object({enabled:z.boolean()}).parse(await request.json());const {error}=await createAdminClient().from("models").update({enabled:body.enabled}).eq("id",id);return error?NextResponse.json({error:error.message},{status:400}):NextResponse.json({ok:true});}
