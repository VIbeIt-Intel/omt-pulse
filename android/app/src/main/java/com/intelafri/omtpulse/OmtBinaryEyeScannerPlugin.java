package com.intelafri.omtpulse;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Launches Binary Eye (ZXing SCAN intent) and returns PDF417 scan bytes/text. */
@CapacitorPlugin(name = "OmtBinaryEyeScanner")
public class OmtBinaryEyeScannerPlugin extends Plugin {

    private static final String SCAN_ACTION = "com.google.zxing.client.android.SCAN";
    private static final String BINARY_EYE_PACKAGE = "de.markusfisch.android.binaryeye";
    private static final String SCAN_FORMATS = "SCAN_FORMATS";
    private static final String SCAN_RESULT = "SCAN_RESULT";
    private static final String SCAN_RESULT_BYTES = "SCAN_RESULT_BYTES";
    private static final String SCAN_RESULT_FORMAT = "SCAN_RESULT_FORMAT";

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("installed", isBinaryEyeInstalled());
        call.resolve(ret);
    }

    @PluginMethod
    public void scanPdf417(PluginCall call) {
        if (!isBinaryEyeInstalled()) {
            call.reject("Binary Eye is not installed", "not_installed");
            return;
        }

        Intent intent = new Intent(SCAN_ACTION);
        intent.setPackage(BINARY_EYE_PACKAGE);
        intent.putExtra(SCAN_FORMATS, "PDF_417");
        startActivityForResult(call, intent, "handleScanResult");
    }

    @ActivityCallback
    private void handleScanResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }

        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            call.reject("Scan cancelled", "cancelled");
            return;
        }

        if (result.getResultCode() != Activity.RESULT_OK) {
            call.reject("Scan failed", "failed");
            return;
        }

        Intent data = result.getData();
        if (data == null) {
            call.reject("No scan data", "no_result");
            return;
        }

        JSObject ret = new JSObject();
        String text = data.getStringExtra(SCAN_RESULT);
        if (text != null) {
            ret.put("text", text);
        }

        byte[] bytes = data.getByteArrayExtra(SCAN_RESULT_BYTES);
        if (bytes != null && bytes.length > 0) {
            ret.put(
                    "bytesBase64",
                    android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP));
        }

        String format = data.getStringExtra(SCAN_RESULT_FORMAT);
        if (format != null) {
            ret.put("format", format);
        }

        if (!ret.has("text") && !ret.has("bytesBase64")) {
            call.reject("Empty scan result", "no_result");
            return;
        }

        call.resolve(ret);
    }

    private boolean isBinaryEyeInstalled() {
        try {
            getContext().getPackageManager().getPackageInfo(BINARY_EYE_PACKAGE, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }
}
