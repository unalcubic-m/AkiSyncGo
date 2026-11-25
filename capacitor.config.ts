import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.akisync.offline',
  appName: 'AkiSync Go',
  webDir: 'dist-android',
  loggingBehavior: 'none',
  server: { androidScheme: 'https' },
  android: {
    allowMixedContent: false,
    adjustMarginsForEdgeToEdge: 'disable',
    webContentsDebuggingEnabled: false,
  },
};

export default config;
