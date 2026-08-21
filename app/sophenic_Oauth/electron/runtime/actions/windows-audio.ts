import { runWindowsPowerShell } from "./windows-powershell";
import { localText } from "../localization";

export type WindowsAudioState = { volume: number; muted: boolean };
export type WindowsAudioResult = { ok: boolean; message: string; state?: WindowsAudioState };

const CORE_AUDIO_SOURCE = String.raw`
using System;
using System.Runtime.InteropServices;
namespace SophenicAudio {
  public enum EDataFlow { eRender, eCapture, eAll, EDataFlow_enum_count }
  public enum ERole { eConsole, eMultimedia, eCommunications, ERole_enum_count }
  [Flags] public enum CLSCTX : uint { INPROC_SERVER = 0x1, INPROC_HANDLER = 0x2, LOCAL_SERVER = 0x4, REMOTE_SERVER = 0x10, ALL = 0x17 }

  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  public class MMDeviceEnumeratorComObject { }

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(EDataFlow dataFlow, uint dwStateMask, IntPtr ppDevices);
    [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppEndpoint);
    [PreserveSig] int GetDevice(string pwstrId, out IMMDevice ppDevice);
    [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr pClient);
    [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr pClient);
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, CLSCTX dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    [PreserveSig] int OpenPropertyStore(int stgmAccess, IntPtr ppProperties);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
    [PreserveSig] int GetState(out int pdwState);
  }

  [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioEndpointVolume {
    [PreserveSig] int RegisterControlChangeNotify(IntPtr pNotify);
    [PreserveSig] int UnregisterControlChangeNotify(IntPtr pNotify);
    [PreserveSig] int GetChannelCount(out uint pnChannelCount);
    [PreserveSig] int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
    [PreserveSig] int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
    [PreserveSig] int GetMasterVolumeLevel(out float pfLevelDB);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float pfLevel);
    [PreserveSig] int SetChannelVolumeLevel(uint nChannel, float fLevelDB, Guid pguidEventContext);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, Guid pguidEventContext);
    [PreserveSig] int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
    [PreserveSig] int GetMute(out bool pbMute);
    [PreserveSig] int GetVolumeStepInfo(out uint pnStep, out uint pnStepCount);
    [PreserveSig] int VolumeStepUp(Guid pguidEventContext);
    [PreserveSig] int VolumeStepDown(Guid pguidEventContext);
    [PreserveSig] int QueryHardwareSupport(out uint pdwHardwareSupportMask);
    [PreserveSig] int GetVolumeRange(out float pflVolumeMindB, out float pflVolumeMaxdB, out float pflVolumeIncrementdB);
  }

  public static class Audio {
    private static IAudioEndpointVolume Endpoint() {
      IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
      IMMDevice device;
      Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out device));
      Guid iid = typeof(IAudioEndpointVolume).GUID;
      object endpoint;
      Marshal.ThrowExceptionForHR(device.Activate(ref iid, CLSCTX.ALL, IntPtr.Zero, out endpoint));
      return (IAudioEndpointVolume)endpoint;
    }
    public static int GetVolume() {
      float value;
      Marshal.ThrowExceptionForHR(Endpoint().GetMasterVolumeLevelScalar(out value));
      return Math.Max(0, Math.Min(100, (int)Math.Round(value * 100.0f)));
    }
    public static bool GetMute() {
      bool muted;
      Marshal.ThrowExceptionForHR(Endpoint().GetMute(out muted));
      return muted;
    }
    public static void SetVolume(int value) {
      float scalar = Math.Max(0, Math.Min(100, value)) / 100.0f;
      Marshal.ThrowExceptionForHR(Endpoint().SetMasterVolumeLevelScalar(scalar, Guid.Empty));
    }
    public static void SetMute(bool muted) {
      Marshal.ThrowExceptionForHR(Endpoint().SetMute(muted, Guid.Empty));
    }
  }
}`;

function stateScript(extra = ""): string {
  return `$src=$env:SOPHENIC_AUDIO_SOURCE; Add-Type -TypeDefinition $src -Language CSharp -ErrorAction Stop; ${extra} $v=[SophenicAudio.Audio]::GetVolume(); $m=[SophenicAudio.Audio]::GetMute(); @{volume=$v;muted=$m} | ConvertTo-Json -Compress`;
}

function runState(extra = ""): WindowsAudioState {
  if (process.platform !== "win32") throw new Error("Windows audio is only available on Windows.");
  const result = runWindowsPowerShell(stateScript(extra), { SOPHENIC_AUDIO_SOURCE: CORE_AUDIO_SOURCE }, 18_000);
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "Windows Core Audio error").trim());
  const parsed = JSON.parse(result.stdout.trim()) as { volume?: unknown; muted?: unknown };
  return { volume: Math.max(0, Math.min(100, Number(parsed.volume) || 0)), muted: Boolean(parsed.muted) };
}

function stateMessage(state: WindowsAudioState): string {
  const muteSuffix = state.muted
    ? localText({ fr: " Le son est coupé.", en: " Sound is muted.", es: " El sonido está silenciado.", de: " Der Ton ist stummgeschaltet.", it: " L'audio è disattivato.", pt: " O som está silenciado." })
    : "";
  return localText({
    fr: `Le volume Windows est à ${state.volume} %.${muteSuffix}`,
    en: `Windows volume is at ${state.volume}%.${muteSuffix}`,
    es: `El volumen de Windows está al ${state.volume} %.${muteSuffix}`,
    de: `Die Windows-Lautstärke beträgt ${state.volume} %.${muteSuffix}`,
    it: `Il volume di Windows è al ${state.volume}%.${muteSuffix}`,
    pt: `O volume do Windows está em ${state.volume}%.${muteSuffix}`
  });
}

export function getWindowsVolume(): WindowsAudioResult {
  try {
    const state = runState();
    return { ok: true, state, message: stateMessage(state) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function setWindowsVolume(level: number): WindowsAudioResult {
  const clean = Math.max(0, Math.min(100, Math.round(level)));
  try {
    const state = runState(`[SophenicAudio.Audio]::SetVolume(${clean});`);
    return { ok: true, state, message: stateMessage(state) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function changeWindowsVolume(delta: number): WindowsAudioResult {
  try {
    const before = runState();
    return setWindowsVolume(before.volume + Math.round(delta));
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function setWindowsMute(muted: boolean): WindowsAudioResult {
  try {
    const state = runState(`[SophenicAudio.Audio]::SetMute($${muted ? "true" : "false"});`);
    return { ok: true, state, message: stateMessage(state) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
