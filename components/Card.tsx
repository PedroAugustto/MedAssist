import React from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import { useAccessibilitySettings } from "@/services/accessibilitySettings";

interface CardProps {
  theme?: "default" | "secondary";
  children: React.ReactNode;
  style?: ViewStyle;
}

export default function Card({ theme = "default", children, style }: CardProps) {
  const { colors } = useAccessibilitySettings();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const themeStyles =
    theme === "secondary" ? styles.cardSecondary : styles.cardDefault;

  return (
    <View style={[themeStyles, style]}>
      {children}
    </View>
  );
}

const createStyles = (
  colors: ReturnType<typeof useAccessibilitySettings>["colors"],
) =>
  StyleSheet.create({
  cardDefault: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  cardSecondary: {
    backgroundColor: colors.primary,
    borderRadius: 28,
    padding: 24,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  });
