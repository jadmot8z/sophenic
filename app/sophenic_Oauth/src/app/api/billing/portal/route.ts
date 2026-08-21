import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/billing";
import { env } from "@/lib/env";
export async function POST(){const {user}=await getApiUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});const admin=createAdminClient();const {data:p}=await admin.from("profiles").select("stripe_customer_id").eq("id",user.id).single();if(!p?.stripe_customer_id)return NextResponse.json({error:"Aucun compte de facturation"},{status:400});const session=await getStripe().billingPortal.sessions.create({customer:p.stripe_customer_id,return_url:`${env.appUrl()}/billing`});return NextResponse.json({url:session.url});}
