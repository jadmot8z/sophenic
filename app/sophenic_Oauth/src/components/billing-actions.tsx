"use client";
import { Button } from "@/components/ui/button";
export function BillingActions(){const go=async(path:string,body?:unknown)=>{const r=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:body?JSON.stringify(body):undefined}); const j=await r.json(); if(j.url)location.href=j.url;}; return <div className="flex flex-wrap gap-3"><Button variant="accent" onClick={()=>go("/api/billing/checkout",{plan:"pro"})}>Passer à Pro</Button><Button variant="outline" onClick={()=>go("/api/billing/portal")}>Gérer l’abonnement</Button></div>}
