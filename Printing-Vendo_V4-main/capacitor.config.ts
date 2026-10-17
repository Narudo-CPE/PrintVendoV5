import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.printpoint.kiosk',
  appName: 'PrintPoint Kiosk',
  webDir: 'dist',
  server: {
    cleartext: true,
  },
};

export default config;
