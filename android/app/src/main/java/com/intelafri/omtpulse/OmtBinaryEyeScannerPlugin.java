package com.intelafri.omtpulse;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

/**
 * Launches Binary Eye and returns PDF417 scan bytes.
 *
 * <p>Uses a deep link return ({@code omtpulse://binary-eye?hex={RESULT_BYTES}}) so the 720-byte
 * SADL payload arrives as hex — the ZXing SCAN intent often drops or mangles binary {@code
 * SCAN_RESULT_BYTES} / Latin-1 {@code SCAN_RESULT} text.
 */
@CapacitorPlugin(name = "OmtBinaryEyeScanner")
public class OmtBinaryEyeScannerPlugin extends Plugin {

    private static final String SCAN_ACTION = "com.google.zxing.client.android.SCAN";
    private static final String BINARY_EYE_PACKAGE = "de.markusfisch.android.binaryeye";
    private static final String SCAN_FORMATS = "SCAN_FORMATS";
    private static final String SCAN_RESULT = "SCAN_RESULT";
    private static final String SCAN_RESULT_BYTES = "SCAN_RESULT_BYTES";
    private static final String SCAN_RESULT_BYTE_SEGMENTS = "SCAN_RESULT_BYTE_SEGMENTS";
    private static final String SCAN_RESULT_FORMAT = "SCAN_RESULT_FORMAT";

    private static final String RETURN_SCHEME = "omtpulse";
    private static final String RETURN_HOST = "binary-eye";
    private static final String RETURN_HEX_PARAM = "hex";
    private static final String RETURN_FORMAT_PARAM = "fmt";

    /** Binary Eye may take a few seconds to return via deep link after a scan — 450ms was cancelling valid scans. */
    private static final long RESUME_CANCEL_GRACE_MS = 8_000;

    private PluginCall pendingDeepLinkCall;
    private boolean awaitingDeepLinkReturn;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Runnable resumeCancelCheck;

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

        if (pendingDeepLinkCall != null) {
            call.reject("Scan already in progress", "busy");
            return;
        }

        call.setKeepAlive(true);
        pendingDeepLinkCall = call;
        awaitingDeepLinkReturn = true;
        cancelResumeCheck();

        if (launchBinaryEyeDeepLink()) {
            return;
        }

        // Fallback: classic ZXing SCAN intent (older Binary Eye builds).
        Intent intent = new Intent(SCAN_ACTION);
        intent.setPackage(BINARY_EYE_PACKAGE);
        intent.putExtra(SCAN_FORMATS, "PDF_417");

        if (intent.resolveActivity(getContext().getPackageManager()) == null) {
            clearPendingDeepLink(call, "Binary Eye cannot handle scan requests", "not_installed");
            return;
        }

        try {
            startActivityForResult(call, intent, "handleScanResult");
        } catch (ActivityNotFoundException e) {
            clearPendingDeepLink(call, "Binary Eye is not installed", "not_installed");
        }
    }

    /** Called from {@link MainActivity#onNewIntent(Intent)} when Binary Eye returns scan hex. */
    public boolean handleReturnUri(Uri uri) {
        if (uri == null || pendingDeepLinkCall == null) {
            return false;
        }
        if (!RETURN_SCHEME.equals(uri.getScheme()) || !RETURN_HOST.equals(uri.getHost())) {
            return false;
        }

        PluginCall call = pendingDeepLinkCall;
        pendingDeepLinkCall = null;
        awaitingDeepLinkReturn = false;
        cancelResumeCheck();

        JSObject ret = new JSObject();
        String hex = uri.getQueryParameter(RETURN_HEX_PARAM);
        if (hex != null && !hex.isEmpty()) {
            ret.put("hex", hex.replaceAll("\\s+", ""));
        }

        String format = uri.getQueryParameter(RETURN_FORMAT_PARAM);
        if (format != null && !format.isEmpty()) {
            ret.put("format", format);
        }

        byte[] bytes = hexToBytes(hex);
        if (bytes != null && bytes.length > 0) {
            ret.put(
                    "bytesBase64",
                    android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP));
            ret.put("bytesLength", bytes.length);
        }

        if (!ret.has("hex") && !ret.has("bytesBase64")) {
            call.reject("Empty scan result", "no_result");
            return true;
        }

        ret.put("via", "deeplink");
        call.resolve(ret);
        return true;
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (!awaitingDeepLinkReturn || pendingDeepLinkCall == null) {
            return;
        }

        cancelResumeCheck();
        resumeCancelCheck =
                () -> {
                    if (!awaitingDeepLinkReturn || pendingDeepLinkCall == null) {
                        return;
                    }
                    PluginCall call = pendingDeepLinkCall;
                    clearPendingDeepLink(call, "Scan cancelled", "cancelled");
                };
        mainHandler.postDelayed(resumeCancelCheck, RESUME_CANCEL_GRACE_MS);
    }

    @ActivityCallback
    private void handleScanResult(PluginCall call, ActivityResult result) {
        awaitingDeepLinkReturn = false;
        cancelResumeCheck();
        if (call == pendingDeepLinkCall) {
            pendingDeepLinkCall = null;
        }

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

        JSObject ret = buildResultFromScanIntent(data);
        if (ret == null) {
            call.reject("Empty scan result", "no_result");
            return;
        }

        ret.put("via", "intent");
        call.resolve(ret);
    }

    private boolean launchBinaryEyeDeepLink() {
        String returnTemplate =
                RETURN_SCHEME
                        + "://"
                        + RETURN_HOST
                        + "?"
                        + RETURN_HEX_PARAM
                        + "={RESULT_BYTES}&"
                        + RETURN_FORMAT_PARAM
                        + "={FORMAT}";
        String launchUri =
                "binaryeye://scan/?ret=" + Uri.encode(returnTemplate, StandardCharsets.UTF_8.name());

        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(launchUri));
        intent.setPackage(BINARY_EYE_PACKAGE);

        if (intent.resolveActivity(getContext().getPackageManager()) == null) {
            return false;
        }

        try {
            getActivity().startActivity(intent);
            return true;
        } catch (ActivityNotFoundException e) {
            return false;
        }
    }

    private JSObject buildResultFromScanIntent(Intent data) {
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
            return null;
        }

        return ret;
    }

    private void clearPendingDeepLink(PluginCall call, String message, String code) {
        pendingDeepLinkCall = null;
        awaitingDeepLinkReturn = false;
        cancelResumeCheck();
        call.reject(message, code);
    }

    private void cancelResumeCheck() {
        if (resumeCancelCheck != null) {
            mainHandler.removeCallbacks(resumeCancelCheck);
            resumeCancelCheck = null;
        }
    }

    private static byte[] hexToBytes(String hex) {
        if (hex == null) {
            return null;
        }
        String cleaned = hex.replaceAll("\\s+", "");
        if (cleaned.isEmpty() || cleaned.length() % 2 != 0) {
            return null;
        }
        if (!cleaned.matches("(?i)[0-9a-f]+")) {
            return null;
        }
        byte[] out = new byte[cleaned.length() / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(cleaned.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
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
