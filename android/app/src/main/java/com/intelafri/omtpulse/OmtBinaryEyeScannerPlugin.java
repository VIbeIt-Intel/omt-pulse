package com.intelafri.omtpulse;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

/** Launches Binary Eye (ZXing SCAN intent) and returns PDF417 scan bytes/text. */
@CapacitorPlugin(name = "OmtBinaryEyeScanner")
public class OmtBinaryEyeScannerPlugin extends Plugin {

    private static final String SCAN_ACTION = "com.google.zxing.client.android.SCAN";
    private static final String BINARY_EYE_PACKAGE = "de.markusfisch.android.binaryeye";
    private static final String SCAN_FORMATS = "SCAN_FORMATS";
    private static final String SCAN_RESULT = "SCAN_RESULT";
    private static final String SCAN_RESULT_BYTES = "SCAN_RESULT_BYTES";
    private static final String SCAN_RESULT_BYTE_SEGMENTS = "SCAN_RESULT_BYTE_SEGMENTS";
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

        if (intent.resolveActivity(getContext().getPackageManager()) == null) {
            call.reject("Binary Eye cannot handle scan requests", "not_installed");
            return;
        }

        call.setKeepAlive(true);

        try {
            startActivityForResult(call, intent, "handleScanResult");
        } catch (ActivityNotFoundException e) {
            call.reject("Binary Eye is not installed", "not_installed", e);
        }
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
            ret.put("textLength", text.length());
            if (looksLikeHex(text)) {
                ret.put("hex", text.replaceAll("\\s+", ""));
            }
            byte[] latin1 = latin1BytesFromText(text);
            if (latin1 != null) {
                ret.put(
                        "latin1TextBase64",
                        android.util.Base64.encodeToString(latin1, android.util.Base64.NO_WRAP));
            }
        }

        byte[] merged = mergeScanBytes(data);
        if (merged != null && merged.length > 0) {
            ret.put(
                    "bytesBase64",
                    android.util.Base64.encodeToString(merged, android.util.Base64.NO_WRAP));
            ret.put("bytesLength", merged.length);
        }

        String format = data.getStringExtra(SCAN_RESULT_FORMAT);
        if (format != null) {
            ret.put("format", format);
        }

        if (!ret.has("text") && !ret.has("bytesBase64") && !ret.has("latin1TextBase64")) {
            call.reject("Empty scan result", "no_result");
            return;
        }

        call.resolve(ret);
    }

    private static boolean looksLikeHex(String text) {
        String cleaned = text.replaceAll("\\s+", "");
        return cleaned.length() >= 1400
                && cleaned.length() % 2 == 0
                && cleaned.matches("(?i)[0-9a-f]+");
    }

    private static byte[] latin1BytesFromText(String text) {
        if (text.length() < 700) {
            return null;
        }
        int len = Math.min(text.length(), 720);
        byte[] out = new byte[720];
        for (int i = 0; i < len; i++) {
            out[i] = (byte) (text.charAt(i) & 0xff);
        }
        return out;
    }

    private byte[] mergeScanBytes(Intent data) {
        byte[] direct = data.getByteArrayExtra(SCAN_RESULT_BYTES);
        if (direct != null && direct.length > 0) {
            return direct;
        }

        ArrayList<byte[]> segments = readByteSegments(data);
        if (segments != null && !segments.isEmpty()) {
            int total = 0;
            for (byte[] segment : segments) {
                if (segment != null) {
                    total += segment.length;
                }
            }
            if (total > 0) {
                byte[] merged = new byte[total];
                int offset = 0;
                for (byte[] segment : segments) {
                    if (segment == null || segment.length == 0) {
                        continue;
                    }
                    System.arraycopy(segment, 0, merged, offset, segment.length);
                    offset += segment.length;
                }
                return merged;
            }
        }

        if (textLooksBinary(data.getStringExtra(SCAN_RESULT))) {
            String text = data.getStringExtra(SCAN_RESULT);
            return text.getBytes(StandardCharsets.ISO_8859_1);
        }

        return null;
    }

    @SuppressWarnings("unchecked")
    private ArrayList<byte[]> readByteSegments(Intent data) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                return data.getSerializableExtra(SCAN_RESULT_BYTE_SEGMENTS, ArrayList.class);
            }
            return (ArrayList<byte[]>) data.getSerializableExtra(SCAN_RESULT_BYTE_SEGMENTS);
        } catch (Exception e) {
            return null;
        }
    }

    private static boolean textLooksBinary(String text) {
        return text != null && text.length() >= 700;
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
