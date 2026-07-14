package com.intelafri.omtpulse;

import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Opens Android system settings from the WebView (reliable for location / app permissions). */
@CapacitorPlugin(name = "OmtAppSettings")
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
