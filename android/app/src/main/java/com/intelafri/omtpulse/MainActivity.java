package com.intelafri.omtpulse;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebSettings;
import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.util.LinkedHashSet;
import java.util.Set;

public class MainActivity extends BridgeActivity {
    private static final int WEB_MEDIA_PERMISSION_REQUEST = 1001;
    private PermissionRequest pendingWebPermissionRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(OmtAppSettingsPlugin.class);
        registerPlugin(OmtBinaryEyeScannerPlugin.class);
        super.onCreate(savedInstanceState);

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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            settings.setAlgorithmicDarkeningAllowed(false);
        } else if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            WebSettingsCompat.setForceDark(settings, WebSettingsCompat.FORCE_DARK_OFF);
        }

        // Bridge WebView getUserMedia (voice notes, camera) to Android runtime permissions.
        // Must run in onStart — Capacitor may replace the WebChromeClient during bridge init.
        installMediaPermissionWebChromeClient();
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
                String[] needed = androidPermissionsForWebRequest(request);
                if (needed.length == 0) {
                    request.grant(request.getResources());
                    return;
                }
                for (String permission : needed) {
                    if (ContextCompat.checkSelfPermission(MainActivity.this, permission)
                            != PackageManager.PERMISSION_GRANTED) {
                        pendingWebPermissionRequest = request;
                        ActivityCompat.requestPermissions(
                                MainActivity.this, needed, WEB_MEDIA_PERMISSION_REQUEST);
                        return;
                    }
                }
                request.grant(request.getResources());
            }
        });
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
    public void onRequestPermissionsResult(
            int requestCode,
            @NonNull String[] permissions,
            @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != WEB_MEDIA_PERMISSION_REQUEST || pendingWebPermissionRequest == null) {
            return;
        }
        boolean allGranted = grantResults.length > 0;
        for (int result : grantResults) {
            if (result != PackageManager.PERMISSION_GRANTED) {
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
}
