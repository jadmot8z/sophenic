export type KnownApplication = "notepad" | "calculator" | "spotify" | "whatsapp" | "chrome" | "discord" | "edge" | "firefox";

export type SophenicAction =
  | { kind: "application.launch"; app: KnownApplication; label: string }
  | { kind: "application.kill"; app: KnownApplication; label: string }
  | { kind: "web.open"; target: "youtube"; url: string; label: string }
  | { kind: "spotify.search_play"; query: string; label: string }
  | { kind: "spotify.pause"; label: string }
  | { kind: "spotify.resume"; label: string }
  | { kind: "spotify.next"; label: string }
  | { kind: "spotify.previous"; label: string }
  | { kind: "audio.get_volume"; label: string }
  | { kind: "audio.set_volume"; level: number; label: string }
  | { kind: "audio.change_volume"; delta: number; label: string }
  | { kind: "audio.set_mute"; muted: boolean; label: string }
  | { kind: "system.time"; label: string }
  | { kind: "system.date"; label: string }
  | { kind: "filesystem.open_known_folder"; folder: "downloads" | "desktop"; label: string }
  | { kind: "filesystem.choose_open_file"; label: string }
  | { kind: "filesystem.create_directory"; name: string; label: string }
  | { kind: "filesystem.create_file"; name: string; label: string };

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’']/g, " ").replace(/[-–—]+/g, " ").replace(/\s+/g, " ").trim();
}

function stripPoliteness(value: string): string {
  return value
    .replace(/^(?:stp|svp|s il te plait|s il vous plait)\s+/i, "")
    .replace(/^(?:(?:est ce que )?(?:tu peux|vous pouvez|peux tu|peux-tu|pourrais tu|pourrais-tu|pourriez vous)\s+)/i, "")
    .trim();
}

const APP_ALIASES: Array<[KnownApplication, RegExp, string]> = [
  ["notepad", /^(?:bloc notes|bloc-notes|notepad)$/, "Bloc-notes"],
  ["calculator", /^(?:calculatrice|calculator|calc)$/, "Calculatrice"],
  ["spotify", /^spotify$/, "Spotify"],
  ["whatsapp", /^whatsapp$/, "WhatsApp"],
  ["chrome", /^(?:chrome|google chrome)$/, "Google Chrome"],
  ["discord", /^discord$/, "Discord"],
  ["edge", /^(?:edge|microsoft edge)$/, "Microsoft Edge"],
  ["firefox", /^firefox$/, "Firefox"]
];

function applicationFromText(value: string): { app: KnownApplication; name: string } | null {
  const clean = value.replace(/^(?:l application|l app|application|app)\s+/, "").replace(/[?!.,;:]+$/g, "").trim();
  for (const [app, pattern, name] of APP_ALIASES) if (pattern.test(clean)) return { app, name };
  return null;
}

function safeLeafName(value: string, fallback: string): string {
  const clean = value
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/[?!;]+$/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\.{2,}/g, ".")
    .trim();
  return (clean || fallback).slice(0, 120);
}

/**
 * Priority action router used by the Desktop renderer before Chat/Code/Hermes.
 * It intentionally handles only deterministic local actions. Returning null is
 * the only path that allows the normal intent router / LLM pipeline to run.
 */
export function routeAction(message: string): SophenicAction | null {
  const original = message.trim();
  if (!original) return null;
  const normalizedOriginal = normalize(original).replace(/[?!.,;:]+$/g, "").trim();
  const p = stripPoliteness(normalizedOriginal);

  // Spotify search/play must win over generic "mets ..." media/volume rules.
  const spotifySearch = p.match(/^(?:mets?|joue|lance)\s+(.+?)\s+(?:sur|dans)\s+spotify$/i);
  if (spotifySearch?.[1]) {
    const query = spotifySearch[1].trim().slice(0, 180);
    if (query) return { kind: "spotify.search_play", query, label: "Spotify — rechercher et lire" };
  }

  if (/^(?:mets?\s+(?:la\s+musique\s+)?en\s+pause|mets?\s+pause|pause(?:\s+la\s+musique)?|pause\s+musique)$/i.test(p)) {
    return { kind: "spotify.pause", label: "Musique — pause" };
  }
  if (/^(?:reprends?|reprend|continue|relance)(?:\s+la\s+musique)?$/i.test(p) || /^reprends?\s+la\s+musique$/i.test(p)) {
    return { kind: "spotify.resume", label: "Musique — reprendre" };
  }
  if (/^(?:chanson|musique|titre|piste)\s+suivante?$|^(?:suivant|next)$/i.test(p)) {
    return { kind: "spotify.next", label: "Musique — suivante" };
  }
  if (/^(?:chanson|musique|titre|piste)\s+precedente?$|^(?:precedent|previous)$/i.test(p)) {
    return { kind: "spotify.previous", label: "Musique — précédente" };
  }

  if (/^(?:quel(?:le)?\s+est\s+mon\s+volume|a\s+combien\s+est\s+(?:mon\s+)?volume|volume(?:\s+actuel)?|mon\s+volume)$/i.test(p)) {
    return { kind: "audio.get_volume", label: "Volume Windows — lire" };
  }
  const volumeSet = p.match(/^(?:mets?|regle|fixe|monte|baisse)(?:\s+le)?\s+volume(?:\s+(?:a|sur))?\s+(\d{1,3})\s*%?$/i);
  if (volumeSet) {
    const level = Math.max(0, Math.min(100, Number(volumeSet[1])));
    return { kind: "audio.set_volume", level, label: `Volume Windows — ${level}%` };
  }
  const shorthandVolumeSet = p.match(/^(?:monte|mets?|regle|fixe)\s+(?:a|sur)\s+(\d{1,3})\s*%?$/i);
  if (shorthandVolumeSet) {
    const level = Math.max(0, Math.min(100, Number(shorthandVolumeSet[1])));
    return { kind: "audio.set_volume", level, label: `Volume Windows — ${level}%` };
  }
  if (/^(?:monte|augmente)(?:\s+le)?\s+volume$/i.test(p)) return { kind: "audio.change_volume", delta: 10, label: "Volume Windows — augmenter" };
  if (/^(?:baisse|diminue)(?:\s+le)?\s+volume$/i.test(p)) return { kind: "audio.change_volume", delta: -10, label: "Volume Windows — baisser" };
  if (/^(?:coupe|desactive)(?:\s+le)?\s+son$|^(?:mute|mets?\s+en\s+sourdine)$/i.test(p)) return { kind: "audio.set_mute", muted: true, label: "Volume Windows — couper le son" };
  if (/^(?:remets?|reactive|retablis)(?:\s+le)?\s+son$|^(?:unmute|enleve\s+la\s+sourdine)$/i.test(p)) return { kind: "audio.set_mute", muted: false, label: "Volume Windows — remettre le son" };

  if (/^(?:quelle\s+heure(?:\s+est\s+il)?|il\s+est\s+quelle\s+heure|donne\s+moi\s+l\s+heure)$/i.test(p)) return { kind: "system.time", label: "Heure système" };
  if (/^(?:quelle\s+date(?:\s+sommes\s+nous)?|quelle\s+date\s+sommes\s+nous|quel\s+jour\s+sommes\s+nous|date\s+d\s+aujourd\s+hui)$/i.test(p)) return { kind: "system.date", label: "Date système" };

  if (/^(?:ouvre|ouvrir|affiche)\s+(?:mes\s+|mon\s+)?(?:telechargements?|downloads?)$/i.test(p)) return { kind: "filesystem.open_known_folder", folder: "downloads", label: "Ouvrir Téléchargements" };
  if (/^(?:ouvre|ouvrir|affiche)\s+(?:mon\s+|le\s+)?bureau$/i.test(p)) return { kind: "filesystem.open_known_folder", folder: "desktop", label: "Ouvrir Bureau" };
  if (/^(?:ouvre|ouvrir)\s+(?:un\s+)?fichier$/i.test(p)) return { kind: "filesystem.choose_open_file", label: "Ouvrir un fichier" };

  const folderCreate = p.match(/^(?:cree|creer|fais|fabrique)\s+(?:un\s+)?dossier(?:\s+(?:nomme|appele))?\s*(.*)$/i);
  if (folderCreate) {
    const name = safeLeafName(folderCreate[1] || "", "Nouveau dossier");
    return { kind: "filesystem.create_directory", name, label: "Créer un dossier" };
  }
  const fileCreate = p.match(/^(?:cree|creer|fais|fabrique)\s+(?:un\s+)?fichier(?:\s+(?:nomme|appele))?\s*(.*)$/i);
  if (fileCreate) {
    let name = safeLeafName(fileCreate[1] || "", "nouveau-fichier.txt");
    if (!/\.[a-z0-9]{1,12}$/i.test(name)) name += ".txt";
    return { kind: "filesystem.create_file", name, label: "Créer un fichier" };
  }

  if (/^(?:ouvre|ouvrir|lance|lancer)\s+(?:youtube|you tube)$/i.test(p)) {
    return { kind: "web.open", target: "youtube", url: "https://www.youtube.com/", label: "Ouvrir YouTube" };
  }

  const launch = p.match(/^(?:ouvre|ouvrir|lance|lancer|demarre|demarrer)\s+(.+)$/i);
  if (launch?.[1]) {
    const app = applicationFromText(launch[1]);
    if (app) return { kind: "application.launch", app: app.app, label: `Ouvrir ${app.name}` };
  }

  const kill = p.match(/^(?:ferme|fermer|quitte|quitter|arrete|arreter)\s+(.+)$/i);
  if (kill?.[1]) {
    const app = applicationFromText(kill[1]);
    if (app) return { kind: "application.kill", app: app.app, label: `Fermer ${app.name}` };
  }

  return null;
}
