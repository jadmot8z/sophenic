import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { LandingHero } from "@/components/landing-hero";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return <div className="min-h-screen bg-[#fafafa] text-zinc-950 dark:bg-[#08090b] dark:text-zinc-100">
    <header className="fixed inset-x-0 top-0 z-50 border-b border-black/[0.055] bg-[#fafafa]/82 backdrop-blur-2xl dark:border-white/[0.055] dark:bg-[#08090b]/82">
      <div className="mx-auto flex h-16 max-w-6xl items-center px-5">
        <Link href="/" className="mr-8"><Logo /></Link>
        <nav className="hidden items-center gap-6 text-[11px] font-medium text-zinc-500 md:flex"><a href="#product">Produit</a><Link href="/help">Sécurité</Link><Link href="/models">Modèles</Link></nav>
        <div className="ml-auto flex items-center gap-1.5"><ThemeToggle /><Link href="/login"><Button variant="ghost" size="sm" className="rounded-lg text-xs">Connexion</Button></Link><Link href="/signup"><Button size="sm" className="rounded-lg bg-zinc-950 text-xs text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200">Commencer</Button></Link></div>
      </div>
    </header>
    <div id="product"><LandingHero /></div>
  </div>;
}
