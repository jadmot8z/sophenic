import { z } from "zod";
import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/billing";
import { env } from "@/lib/env";
export async function POST(request:Request){const {user}=await getApiUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});const {plan}=z.object({plan:z.enum(["pro","business"])}).parse(await request.json());const admin=createAdminClient();const {data:profile}=await admin.from("profiles").select("stripe_customer_id").eq("id",user.id).single();const stripe=getStripe();let customer=profile?.stripe_customer_id;if(!customer){const c=await stripe.customers.create({email:user.email,metadata:{sophenic_user_id:user.id}});customer=c.id;await admin.from("profiles").update({stripe_customer_id:customer}).eq("id",user.id);}const price=plan==="pro"?env.stripePricePro():env.stripePriceBusiness();const session=await stripe.checkout.sessions.create({mode:"subscription",customer,line_items:[{price,quantity:1}],success_url:`${env.appUrl()}/billing?success=1`,cancel_url:`${env.appUrl()}/billing?canceled=1`,allow_promotion_codes:true,metadata:{sophenic_user_id:user.id,plan}});return NextResponse.json({url:session.url});}
