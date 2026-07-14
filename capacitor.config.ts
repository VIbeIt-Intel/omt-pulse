import { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.intelafri.omtpulse",
  appName: "OMT Pulse",
  webDir: "dist/public",
  // Bundled shell so the APK opens offline. API calls go to production via
  // client/src/lib/api-base.ts (installNativeApiBaseFetch).
  server: {
    androidScheme: "https",
    cleartext: false,
    errorPath: "offline.html",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
  },
};

export default config;
