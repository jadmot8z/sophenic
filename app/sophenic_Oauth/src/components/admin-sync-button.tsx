"use client";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
export function AdminSyncButton(){const [loading,setLoading]=useState(false);return <Button variant="accent" disabled={loading} onClick={async()=>{setLoading(true);const r=await fetch("/api/models/sync",{method:"POST"});const j=await r.json();setLoading(false);r.ok?toast.success(`${j.synced} modèles synchronisés`):toast.error(j.error??"Erreur")}}><RefreshCw className={`size-4 ${loading?"animate-spin":""}`}/>Synchroniser OpenRouter</Button>}
