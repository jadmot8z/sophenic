import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function NotFound(){return <div className="grid min-h-screen place-items-center p-6 text-center"><div><div className="text-sm text-indigo-500">404</div><h1 className="mt-2 text-3xl font-semibold">Cette page n’existe pas.</h1><p className="mt-2 text-sm text-zinc-500">Retournez à votre espace Sophenic.</p><Link href="/chat"><Button className="mt-6">Ouvrir Sophenic</Button></Link></div></div>}
