import React, {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { getUserProfile } from "./database";

type AccessibilitySettingsContextValue = {
  fontSizeSetting: number;
  fontScale: number;
  speechRate: number;
  isDarkTheme: boolean;
  colors: AppThemeColors;
  scaleFont: (size: number) => number;
  refreshSettings: () => Promise<void>;
};

export type AppThemeColors = {
  background: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  primarySoft: string;
  danger: string;
  warning: string;
  success: string;
  tabBar: string;
};

const lightColors: AppThemeColors = {
  background: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceMuted: "#F8FAFC",
  text: "#0F172A",
  textMuted: "#475569",
  border: "#CBD5E1",
  primary: "#007AFF",
  primarySoft: "#EFF6FF",
  danger: "#DC2626",
  warning: "#92400E",
  success: "#0B6623",
  tabBar: "#FFFFFF",
};

const darkColors: AppThemeColors = {
  background: "#0D1B2A",
  surface: "#132A40",
  surfaceMuted: "#1B354F",
  text: "#F8FAFC",
  textMuted: "#CBD5E1",
  border: "#415A77",
  primary: "#4DA3FF",
  primarySoft: "#1B354F",
  danger: "#F87171",
  warning: "#FBBF24",
  success: "#86EFAC",
  tabBar: "#0D1B2A",
};

const AccessibilitySettingsContext =
  createContext<AccessibilitySettingsContextValue>({
    fontSizeSetting: 2,
    fontScale: 1,
    speechRate: 1,
    isDarkTheme: false,
    colors: lightColors,
    scaleFont: (size) => size,
    refreshSettings: async () => {},
  });

const fontScaleBySetting: Record<number, number> = {
  1: 0.9,
  2: 1,
  3: 1.18,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function AccessibilitySettingsProvider({
  children,
}: PropsWithChildren) {
  const [fontSizeSetting, setFontSizeSetting] = useState(2);
  const [speechRate, setSpeechRate] = useState(1);
  const [isDarkTheme, setIsDarkTheme] = useState(false);

  const refreshSettings = useCallback(async () => {
    const profile = await getUserProfile();
    setFontSizeSetting(clamp(profile.tamanho_fonte || 2, 1, 3));
    setSpeechRate(clamp(profile.velocidade_leitura || 1, 0.1, 2));
    setIsDarkTheme(Boolean(profile.tema_escuro));
  }, []);

  useEffect(() => {
    refreshSettings().catch((error) => {
      console.error("Erro ao carregar configuracoes de acessibilidade:", error);
    });
  }, [refreshSettings]);

  const value = useMemo(() => {
    const fontScale = fontScaleBySetting[fontSizeSetting] || 1;

    return {
      fontSizeSetting,
      fontScale,
      speechRate,
      isDarkTheme,
      colors: isDarkTheme ? darkColors : lightColors,
      scaleFont: (size: number) => Math.round(size * fontScale),
      refreshSettings,
    };
  }, [fontSizeSetting, isDarkTheme, refreshSettings, speechRate]);

  return (
    <AccessibilitySettingsContext.Provider value={value}>
      {children}
    </AccessibilitySettingsContext.Provider>
  );
}

export const useAccessibilitySettings = () =>
  useContext(AccessibilitySettingsContext);
