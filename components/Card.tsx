import React from "react";
import { StyleSheet, View, ViewStyle } from "react-native";

interface CardProps {
  theme?: "default" | "secondary";
  children: React.ReactNode;
  style?: ViewStyle;
}

export default function Card({ theme = "default", children, style }: CardProps) {
  const themeStyles = theme === "secondary" ? styles.cardSecondary : styles.cardDefault;

  return (
    <View style={[themeStyles, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  cardDefault: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  cardSecondary: {
    backgroundColor: "#007AFF",
    borderRadius: 28,
    padding: 24,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
});
