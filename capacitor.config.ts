import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.moneyflow.app',
  appName: 'MoneyFlow',
  webDir: 'dist',
  ios: { contentInset: 'never', backgroundColor: '#F3F4F1' }
};

export default config;
