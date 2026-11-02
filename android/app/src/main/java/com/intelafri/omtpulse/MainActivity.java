package com.intelafri.omtpulse;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebSettings;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

public class MainActivity extends BridgeActivity {
    private PermissionRequest pendingWebPermissionRequest;
    private ActivityResultLauncher<String[]> webMediaPermissionLauncher;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(OmtAppSettingsPlugin.class);
        registerPlugin(OmtBinaryEyeScannerPlugin.class);

        // Activity Result API — reliable on modern Android / Capacitor (unlike
        // deprecated onRequestPermissionsResult for WebView getUserMedia bridging).
        webMediaPermissionLauncher =
                registerForActivityResult(
                        new ActivityResultContracts.RequestMultiplePermissions(),
                        this::onWebMediaPermissionsResult);

        OmtMessagingService.ensureAlarmChannels(this);

        super.onCreate(savedInstanceState);

        // Dark window behind the transparent WebView so Live Incident map
        // punch-through never flashes the default Light theme white while the
        // native MapView is warming up.
        getWindow().getDecorView().setBackgroundColor(Color.parseColor("#0A0A0A"));

        // Transparent WebView background so @capacitor/google-maps native
        // map view (rendered behind the WebView) is visible through the HTML element.
        this.bridge.getWebView().setBackgroundColor(Color.TRANSPARENT);

        // Disable Android's force-dark algorithm on the WebView. The app manages
        // its own light/dark theme via ThemeProvider + localStorage ("ob-theme"),
        // so Android's heuristic colour inversion must be switched off — it has
        // no knowledge of the app's theme state and produces inconsistent, broken
        // colours when the device is in system dark mode.
        //
        // Two separate APIs are required for full coverage:
        //   - API 29-32: WebSettingsCompat.setForceDark (deprecated in 33+)
        //   - API 33+  : setAlgorithmicDarkeningAllowed(false) (replaces the above)
        WebSettings settings = this.bridge.getWebView().getSettings();
        // Keep the farmer home the same size on every phone. Samsung's Font size
        // setting otherwise enlarges the tiles and clips Vuur, Misdaad, and Vee.
        settings.setTextZoom(100);
        // Allow LiveKit / WebRTC remote audio without an extra gesture every time.
        settings.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            settings.setAlgorithmicDarkeningAllowed(false);
        } else if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            WebSettingsCompat.setForceDark(settings, WebSettingsCompat.FORCE_DARK_OFF);
        }

        // Bridge WebView getUserMedia (voice notes, camera, LiveKit) to Android runtime permissions.
        // Must run in onStart — Capacitor may replace the WebChromeClient during bridge init.
        installMediaPermissionWebChromeClient();
        handleBinaryEyeReturnIntent(getIntent());
        deliverPushUrl(getIntent());
    }

    private void onWebMediaPermissionsResult(Map<String, Boolean> result) {
        if (pendingWebPermissionRequest == null) return;
        boolean allGranted = !result.isEmpty();
        for (Boolean granted : result.values()) {
            if (granted == null || !granted) {
                allGranted = false;
                break;
            }
        }
        if (allGranted) {
            pendingWebPermissionRequest.grant(pendingWebPermissionRequest.getResources());
        } else {
            pendingWebPermissionRequest.deny();
        }
        pendingWebPermissionRequest = null;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleBinaryEyeReturnIntent(intent);
        deliverPushUrl(intent);
    }

    /** The vuur card writes the map path here. The web app reads it on startup. */
    private void deliverPushUrl(Intent intent) {
        if (intent == null || this.bridge == null || this.bridge.getWebView() == null) return;
        String url = intent.getStringExtra(OmtMessagingService.EXTRA_URL);
        if (url == null || !url.startsWith("/")) return;
        intent.removeExtra(OmtMessagingService.EXTRA_URL);
        String quoted = org.json.JSONObject.quote(url);
        String js = "try{var u=" + quoted + ";"
                + "if(sessionStorage.getItem('omt_push_applied')!==u){"
                + "sessionStorage.setItem('omt_push_applied',u);"
                + "localStorage.setItem('omt_pending_push_url',u);"
                + "sessionStorage.setItem('omt_pending_push_url',u);"
                + "window.dispatchEvent(new CustomEvent('omt:push-deeplink',{detail:{url:u}}));"
                + "}}catch(e){}";
        android.webkit.WebView webView = this.bridge.getWebView();
        webView.evaluateJavascript(js, null);
        for (long delay : new long[] { 700L, 2000L, 4500L }) {
            webView.postDelayed(
                    () -> {
                        if (this.bridge != null && this.bridge.getWebView() != null) {
                            this.bridge.getWebView().evaluateJavascript(js, null);
                        }
                    },
                    delay
            );
        }
    }

    private void handleBinaryEyeReturnIntent(Intent intent) {
        if (intent == null || intent.getData() == null || this.bridge == null) {
            return;
        }
        var pluginHandle = this.bridge.getPlugin("OmtBinaryEyeScanner");
        if (pluginHandle == null) {
            return;
        }
        OmtBinaryEyeScannerPlugin plugin = (OmtBinaryEyeScannerPlugin) pluginHandle.getInstance();
        if (plugin != null) {
            plugin.handleReturnUri(intent.getData());
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        installMediaPermissionWebChromeClient();
    }

    private void installMediaPermissionWebChromeClient() {
        if (this.bridge == null || this.bridge.getWebView() == null) return;
        this.bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> handleWebPermissionRequest(request));
            }
        });
    }

    private void handleWebPermissionRequest(PermissionRequest request) {
        String[] needed = androidPermissionsForWebRequest(request);
        if (needed.length == 0) {
            request.grant(request.getResources());
            return;
        }
        boolean allGranted = true;
        for (String permission : needed) {
            if (ContextCompat.checkSelfPermission(this, permission)
                    != PackageManager.PERMISSION_GRANTED) {
                allGranted = false;
                break;
            }
        }
        if (allGranted) {
            request.grant(request.getResources());
            return;
        }
        pendingWebPermissionRequest = request;
        if (webMediaPermissionLauncher != null) {
            webMediaPermissionLauncher.launch(needed);
        } else {
            request.deny();
            pendingWebPermissionRequest = null;
        }
    }

    private static String[] androidPermissionsForWebRequest(PermissionRequest request) {
        Set<String> perms = new LinkedHashSet<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                perms.add(Manifest.permission.RECORD_AUDIO);
            }
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                perms.add(Manifest.permission.CAMERA);
                perms.add(Manifest.permission.RECORD_AUDIO);
            }
        }
        return perms.toArray(new String[0]);
    }

    @Override
    public void onPause() {
        super.onPause();
        dispatchAppEvent("omt:app-background");
    }

    @Override
    public void onResume() {
        super.onResume();
        dispatchAppEvent("omt:app-foreground");
    }

    /** The radio page keeps running in the background. Tell it the phone has left the app. */
    private void dispatchAppEvent(String name) {
        try {
            if (getBridge() == null || getBridge().getWebView() == null) return;
            getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('" + name + "'))",
                    null
            ));
        } catch (Exception ignored) {
            /* The page is not ready yet. */
        }
    }
}
