import { killApplication, launchApplication, type KnownApplication } from "./actions/applications";

export type NativePcActionResult = { handled: boolean; ok?: boolean; message?: string; target?: string; verified?: boolean };

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’']/g, " ").replace(/[-–—]+/g, " ").replace(/\s+/g, " ").trim();
}

function appFromName(value: string): KnownApplication | null {
  const clean = value.replace(/^(?:l application|l app|application|app)\s+/, "").replace(/[?!.,;:]+$/g, "").trim();
  if (/^(?:bloc notes|bloc-notes|notepad)$/.test(clean)) return "notepad";
  if (/^(?:calculatrice|calculator|calc)$/.test(clean)) return "calculator";
  if (/^spotify$/.test(clean)) return "spotify";
  if (/^whatsapp$/.test(clean)) return "whatsapp";
  if (/^(?:chrome|google chrome)$/.test(clean)) return "chrome";
  if (/^discord$/.test(clean)) return "discord";
  if (/^(?:edge|microsoft edge)$/.test(clean)) return "edge";
  if (/^firefox$/.test(clean)) return "firefox";
  return null;
}

function simpleAppAction(prompt: string): { verb: "launch" | "kill"; app: KnownApplication } | null {
  const p = normalize(prompt)
    .replace(/^(?:stp|svp|s il te plait|s il vous plait)\s+/, "")
    .replace(/^(?:(?:est ce que )?(?:tu peux|vous pouvez|peux tu|pourrais tu|pourriez vous)\s+)/, "")
    .trim();
  const launch = /^(?:ouvre|ouvrir|lance|lancer|demarre|demarrer)\s+(.+)$/.exec(p);
  if (launch) {
    const app = appFromName(launch[1]);
    return app ? { verb: "launch", app } : null;
  }
  const kill = /^(?:ferme|fermer|quitte|quitter|arrete|arreter)\s+(.+)$/.exec(p);
  if (kill) {
    const app = appFromName(kill[1]);
    return app ? { verb: "kill", app } : null;
  }
  return null;
}

/** Legacy fast-path kept for renderer compatibility. All success messages now
 * come from verified Windows process state; it never claims an app is open just
 * because a launch command was dispatched. */
export async function tryNativePcAction(prompt: string): Promise<NativePcActionResult> {
  if (process.platform !== "win32") return { handled: false };
  const action = simpleAppAction(prompt);
  if (!action) return { handled: false };
  const result = action.verb === "launch" ? await launchApplication(action.app) : await killApplication(action.app);
  return { handled: true, ...result };
}
