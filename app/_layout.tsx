import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { AccessibilitySettingsProvider } from '@/services/accessibilitySettings';
import { initializeDatabase } from '@/services/database';
import {
  addDoseNotificationResponseListener,
  configureMedicationNotifications,
} from '@/services/notifications';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  useEffect(() => {
    initializeDatabase().catch((databaseError) => {
      console.error('Erro ao inicializar o banco SQLite:', databaseError);
    });
    configureMedicationNotifications().catch((notificationError) => {
      console.error('Erro ao configurar notificacoes:', notificationError);
    });
  }, []);

  useEffect(() => {
    let subscription: { remove: () => void } | undefined;

    addDoseNotificationResponseListener((doseId) => {
      router.push({
        pathname: '/',
        params: { doseId },
      } as any);
    })
      .then((listener) => {
        subscription = listener;
      })
      .catch((notificationError) => {
        console.error('Erro ao observar toque em notificacao:', notificationError);
      });

    return () => {
      subscription?.remove();
    };
  }, []);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <AccessibilitySettingsProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        </Stack>
      </ThemeProvider>
    </AccessibilitySettingsProvider>
  );
}
