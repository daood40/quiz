import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Store apps wrap the production web build (VITE_API_BASE must point at the deployed API,
 * and that API's CORS_ORIGIN must include https://localhost and capacitor://localhost).
 */
const config: CapacitorConfig = {
  appId: 'io.github.daood40.quiz',
  appName: 'Quiz Platform',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#f5f6fa',
    adjustMarginsForEdgeToEdge: 'auto',
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#f5f6fa',
    scrollEnabled: true,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#0b1020',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: false,
      style: 'LIGHT',
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_notify',
      iconColor: '#c2410c',
    },
  },
};

export default config;
