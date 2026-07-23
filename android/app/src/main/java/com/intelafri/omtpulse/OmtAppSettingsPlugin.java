package com.intelafri.omtpulse;

import android.Manifest;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Opens Android system settings from the WebView, requests RECORD_AUDIO, and
 * routes WebRTC / LiveKit radio audio through the loudspeaker.
 */
@CapacitorPlugin(
    name = "OmtAppSettings",
    permissions = {
        @Permission(
            alias = "microphone",
            strings = { Manifest.permission.RECORD_AUDIO }
        )
    }
)
public class OmtAppSettingsPlugin extends Plugin {

    /** True when system Location (GPS / network) is enabled — not app permission. */
    @PluginMethod
    public void isLocationEnabled(PluginCall call) {
        try {
            LocationManager lm =
                    (LocationManager) getContext().getSystemService(android.content.Context.LOCATION_SERVICE);
            boolean enabled;
            if (lm == null) {
                enabled = false;
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                enabled = lm.isLocationEnabled();
            } else {
                enabled =
                        lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
                                || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
            }
            JSObject ret = new JSObject();
            ret.put("enabled", enabled);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to read location enabled state", e);
        }
    }

    @PluginMethod
    public void openAppDetails(PluginCall call) {
        try {
            Intent intent =
                    new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to open app settings", e);
        }
    }

    @PluginMethod
    public void checkMicrophone(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("recordAudio", permissionToString(getPermissionState("microphone")));
        call.resolve(ret);
    }

    /**
     * Shows the Android system microphone permission dialog (once per install unless
     * previously denied permanently — then openAppDetails is required).
     */
    @PluginMethod
    public void requestMicrophone(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("recordAudio", "granted");
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
    }

    @PermissionCallback
    public void microphonePermissionCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("recordAudio", permissionToString(getPermissionState("microphone")));
        call.resolve(ret);
    }

    private static String permissionToString(PermissionState state) {
        if (state == null) return "prompt";
        if (state == PermissionState.GRANTED) return "granted";
        if (state == PermissionState.DENIED) return "denied";
        return "prompt";
    }

    /**
     * Route LiveKit / WebRTC audio to the loudspeaker (not the earpiece).
     * Call with enabled=true while radio is connected; false on teardown.
     */
    @PluginMethod
    public void setRadioAudioSession(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled", false);
        getActivity().runOnUiThread(() -> {
            try {
                applyRadioAudioSession(Boolean.TRUE.equals(enabled));
                JSObject ret = new JSObject();
                ret.put("enabled", Boolean.TRUE.equals(enabled));
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to configure radio audio session", e);
            }
        });
    }

    private void applyRadioAudioSession(boolean enabled) {
        Context ctx = getContext();
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;

        if (enabled) {
            am.requestAudioFocus(
                    null,
                    AudioManager.STREAM_VOICE_CALL,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
            am.setMode(AudioManager.MODE_IN_COMMUNICATION);
            routeToBuiltinSpeaker(am);
        } else {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                am.clearCommunicationDevice();
            } else {
                //noinspection deprecation
                am.setSpeakerphoneOn(false);
            }
            am.setMode(AudioManager.MODE_NORMAL);
            am.abandonAudioFocus(null);
        }
    }

    private static void routeToBuiltinSpeaker(AudioManager am) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AudioDeviceInfo[] devices = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
            AudioDeviceInfo speaker = null;
            for (AudioDeviceInfo device : devices) {
                if (device.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                    speaker = device;
                    break;
                }
            }
            if (speaker != null) {
                am.setCommunicationDevice(speaker);
                return;
            }
        }
        //noinspection deprecation
        am.setSpeakerphoneOn(true);
    }

    @PluginMethod
    public void openLocationSources(PluginCall call) {
        Exception last = null;

        // 1) Standard location sources screen
        try {
            Intent intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (canHandle(intent)) {
                getActivity().startActivity(intent);
                call.resolve();
                return;
            }
        } catch (Exception e) {
            last = e;
        }

        // 2) Explicit Settings package (helps some OEMs / WebView fallthrough)
        try {
            Intent intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
            intent.setPackage("com.android.settings");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (canHandle(intent)) {
                getActivity().startActivity(intent);
                call.resolve();
                return;
            }
        } catch (Exception e) {
            last = e;
        }

        // 3) Known Location settings activity names (AOSP / Samsung One UI)
        String[][] components = new String[][] {
            { "com.android.settings", "com.android.settings.Settings$LocationSettingsActivity" },
            { "com.android.settings", "com.android.settings.location.LocationSettings" },
            { "com.samsung.android.lool", "com.samsung.android.sm.security.LocationActivity" },
        };
        for (String[] c : components) {
            try {
                Intent intent = new Intent();
                intent.setComponent(new ComponentName(c[0], c[1]));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                if (canHandle(intent)) {
                    getActivity().startActivity(intent);
                    call.resolve();
                    return;
                }
            } catch (Exception e) {
                last = e;
            }
        }

        // Do NOT fall back to ACTION_SETTINGS — that dumps users on the root Settings tree.
        call.reject(
                "Failed to open location settings",
                last != null ? last : new Exception("No location settings activity"));
    }

    private boolean canHandle(Intent intent) {
        PackageManager pm = getContext().getPackageManager();
        return intent.resolveActivity(pm) != null;
    }
}
