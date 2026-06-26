import React, { useMemo } from "react";
import { ActivityIndicator, Modal, StyleSheet, Text, View } from "react-native";
import { useAccessibilitySettings } from "@/services/accessibilitySettings";

type LoadingOverlayProps = {
  visible: boolean;
  title?: string;
  message?: string;
};

export default function LoadingOverlay({
  visible,
  title = "Carregando",
  message = "Aguarde um instante.",
}: LoadingOverlayProps) {
  const { scaleFont, colors } = useAccessibilitySettings();
  const styles = useMemo(
    () => createStyles(scaleFont, colors),
    [scaleFont, colors],
  );

  return (
    <Modal transparent visible={visible} animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.panel}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (
  scaleFont: (size: number) => number,
  colors: ReturnType<typeof useAccessibilitySettings>["colors"],
) =>
  StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#00000080",
  },
  panel: {
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
    borderRadius: 8,
    padding: 24,
    backgroundColor: colors.surface,
  },
  title: {
    marginTop: 16,
    fontSize: scaleFont(22),
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
  },
  message: {
    marginTop: 8,
    fontSize: scaleFont(16),
    lineHeight: 23,
    color: colors.textMuted,
    textAlign: "center",
  },
  });
