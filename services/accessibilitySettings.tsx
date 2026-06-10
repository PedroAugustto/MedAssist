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
  scaleFont: (size: number) => number;
  refreshSettings: () => Promise<void>;
};

const AccessibilitySettingsContext =
  createContext<AccessibilitySettingsContextValue>({
    fontSizeSetting: 2,
    fontScale: 1,
    speechRate: 1,
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

  const refreshSettings = useCallback(async () => {
    const profile = await getUserProfile();
    setFontSizeSetting(clamp(profile.tamanho_fonte || 2, 1, 3));
    setSpeechRate(clamp(profile.velocidade_leitura || 1, 0.1, 2));
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
      scaleFont: (size: number) => Math.round(size * fontScale),
      refreshSettings,
    };
  }, [fontSizeSetting, refreshSettings, speechRate]);

  return (
    <AccessibilitySettingsContext.Provider value={value}>
      {children}
    </AccessibilitySettingsContext.Provider>
  );
}

export const useAccessibilitySettings = () =>
  useContext(AccessibilitySettingsContext);
