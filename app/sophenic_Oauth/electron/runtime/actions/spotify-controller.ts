import { clipboard } from "electron";
import { isProcessRunning, launchApplication } from "./applications";
import { runWindowsPowerShell } from "./windows-powershell";
import { localText } from "../localization";

export type SpotifyActionResult = { ok: boolean; message: string; verified?: boolean };

const APP_COMMAND_SOURCE = String.raw`
using System;
using System.Runtime.InteropServices;
public static class SophenicSpotifyMedia {
  private const uint WM_APPCOMMAND = 0x0319;
  [DllImport("user32.dll", CharSet=CharSet.Auto, SetLastError=true)]
  private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  public static void Send(IntPtr hWnd, int command) {
    if (hWnd == IntPtr.Zero) throw new InvalidOperationException("Spotify window not found");
    SendMessage(hWnd, WM_APPCOMMAND, hWnd, new IntPtr(command << 16));
  }
}`;

// WM_APPCOMMAND values defined by Windows. Unlike VK_MEDIA_PLAY_PAUSE,
// PLAY and PAUSE are separate commands and cannot accidentally toggle state.
const APPCOMMAND_MEDIA_NEXTTRACK = 11;
const APPCOMMAND_MEDIA_PREVIOUSTRACK = 12;
const APPCOMMAND_MEDIA_PLAY = 46;
const APPCOMMAND_MEDIA_PAUSE = 47;

function spotifyProcessRunning(): boolean {
  return isProcessRunning(["Spotify.exe"]);
}

function sendSpotifyAppCommand(command: number): SpotifyActionResult {
  if (!spotifyProcessRunning()) {
    return {
      ok: false,
      verified: false,
      message: localText({
        fr: "Spotify Desktop n’est pas lancé. La commande média n’a pas été envoyée.",
        en: "Spotify Desktop is not running. The media command was not sent."
      })
    };
  }

  const script = [
    "$src=$env:SOPHENIC_SPOTIFY_MEDIA_SOURCE",
    "Add-Type -TypeDefinition $src -Language CSharp -ErrorAction Stop",
    "$p = Get-Process -Name Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
    "if (-not $p) { Write-Error 'Spotify window not found'; exit 8 }",
    `[SophenicSpotifyMedia]::Send($p.MainWindowHandle, ${command})`,
    "Write-Output 'OK'"
  ].join("; ");
  const result = runWindowsPowerShell(script, { SOPHENIC_SPOTIFY_MEDIA_SOURCE: APP_COMMAND_SOURCE }, 12_000);
  if (result.status !== 0) return { ok: false, verified: false, message: (result.stderr || result.stdout || "Windows Spotify media API error").trim() };
  return { ok: true, verified: true, message: "OK" };
}

export const spotify = {
  async search(query: string): Promise<SpotifyActionResult> {
    const clean = query.trim().slice(0, 180);
    if (!clean) return { ok: false, message: localText({ fr: "La recherche Spotify est vide.", en: "The Spotify search is empty." }) };
    const launched = await launchApplication("spotify");
    if (!launched.ok || !launched.verified) {
      return {
        ok: false,
        verified: false,
        message: localText({
          fr: "Spotify Desktop doit être installé et lancé pour rechercher et lire un titre sans passer par un LLM.",
          en: "Spotify Desktop must be installed and running to search and play a track without using an LLM."
        })
      };
    }

    const previousClipboard = clipboard.readText();
    clipboard.writeText(clean);
    try {
      // Deterministic desktop automation: focus the already-verified Spotify
      // process, focus search, paste the exact query and activate the first
      // result. No LLM/Hermes request is involved in this path.
      const script = [
        "$w = New-Object -ComObject WScript.Shell",
        "if (-not $w.AppActivate('Spotify')) { exit 7 }",
        "Start-Sleep -Milliseconds 250",
        "$w.SendKeys('^l')",
        "Start-Sleep -Milliseconds 180",
        "$w.SendKeys('^v')",
        "Start-Sleep -Milliseconds 180",
        "$w.SendKeys('{ENTER}')",
        "Start-Sleep -Milliseconds 1400",
        "$w.SendKeys('{ENTER}')",
        "Write-Output 'OK'"
      ].join("; ");
      const result = runWindowsPowerShell(script, {}, 12_000);
      if (result.status !== 0 || !spotifyProcessRunning()) {
        return { ok: false, verified: false, message: (result.stderr || result.stdout || "Spotify UI automation failed").trim() };
      }
      return {
        ok: true,
        verified: true,
        message: localText({
          fr: `La recherche « ${clean} » a été envoyée au processus Spotify vérifié et la commande de lecture du premier résultat a été déclenchée localement.`,
          en: `The search “${clean}” was sent to the verified Spotify process and the local first-result playback command was triggered.`,
          es: `La búsqueda «${clean}» se envió al proceso Spotify verificado y se activó localmente la reproducción del primer resultado.`,
          de: `Die Suche „${clean}“ wurde an den überprüften Spotify-Prozess gesendet und die lokale Wiedergabe des ersten Ergebnisses ausgelöst.`,
          it: `La ricerca «${clean}» è stata inviata al processo Spotify verificato ed è stato attivato localmente il primo risultato.`,
          pt: `A pesquisa “${clean}” foi enviada ao processo Spotify verificado e a reprodução local do primeiro resultado foi acionada.`
        })
      };
    } finally {
      clipboard.writeText(previousClipboard);
    }
  },

  async play(): Promise<SpotifyActionResult> {
    const result = sendSpotifyAppCommand(APPCOMMAND_MEDIA_PLAY);
    return result.ok
      ? { ...result, message: localText({ fr: "Commande Reprendre envoyée à la fenêtre Spotify vérifiée.", en: "Play/resume command sent to the verified Spotify window." }) }
      : result;
  },

  async pause(): Promise<SpotifyActionResult> {
    const result = sendSpotifyAppCommand(APPCOMMAND_MEDIA_PAUSE);
    return result.ok
      ? { ...result, message: localText({ fr: "Commande Pause envoyée à la fenêtre Spotify vérifiée.", en: "Pause command sent to the verified Spotify window." }) }
      : result;
  },

  async next(): Promise<SpotifyActionResult> {
    const result = sendSpotifyAppCommand(APPCOMMAND_MEDIA_NEXTTRACK);
    return result.ok
      ? { ...result, message: localText({ fr: "Commande Titre suivant envoyée à la fenêtre Spotify vérifiée.", en: "Next-track command sent to the verified Spotify window." }) }
      : result;
  },

  async previous(): Promise<SpotifyActionResult> {
    const result = sendSpotifyAppCommand(APPCOMMAND_MEDIA_PREVIOUSTRACK);
    return result.ok
      ? { ...result, message: localText({ fr: "Commande Titre précédent envoyée à la fenêtre Spotify vérifiée.", en: "Previous-track command sent to the verified Spotify window." }) }
      : result;
  }
};
