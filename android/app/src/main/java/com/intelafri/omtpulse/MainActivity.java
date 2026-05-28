package com.intelafri.omtpulse;

import android.graphics.Color;
import android.os.Bundle;
import android.util.Log;
import com.getcapacitor.BridgeActivity;
import com.google.android.gms.maps.MapsInitializer;
import com.google.android.gms.maps.OnMapsSdkInitializedCallback;

public class MainActivity extends BridgeActivity implements OnMapsSdkInitializedCallback {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Transparent WebView background so @capacitor/google-maps native
        // map view (rendered behind the WebView) is visible through the HTML element.
        this.bridge.getWebView().setBackgroundColor(Color.TRANSPARENT);

        // v73: Force the LATEST (vector) renderer. The Google Maps Android SDK
        // defaults to the LEGACY raster renderer, which silently IGNORES the
        // camera tilt angle - tilt is set internally but the map renders flat.
        // The LATEST vector renderer honors tilt and is required for any 3D
        // perspective view (nav mode 45-degree heading-up tilt). Must be called
        // before any GoogleMap is created.
        MapsInitializer.initialize(getApplicationContext(), MapsInitializer.Renderer.LATEST, this);
    }

    @Override
    public void onMapsSdkInitialized(MapsInitializer.Renderer renderer) {
        switch (renderer) {
            case LATEST:
                Log.d("OMTPatch", "MapsInitializer: LATEST vector renderer active - tilt supported");
                break;
            case LEGACY:
                Log.d("OMTPatch", "MapsInitializer: LEGACY raster renderer fallback - tilt will NOT render");
                break;
        }
    }
}
