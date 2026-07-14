import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.intelafri.omtpulse',
  appName: 'OMT Pulse',
  webDir: 'dist/public',
  server: {
    // Live shell from production so web fixes ship without every APK rebuild.
    // Cold-start with no network cannot load this URL — show bundled offline page.
    url: 'https://omtpulse.com/login',
    cleartext: false,
    errorPath: 'offline.html',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
  },
};

export default config;
