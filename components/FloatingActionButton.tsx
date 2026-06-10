import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import React from "react";
import { Pressable, StyleSheet } from "react-native";

type FloatingActionButtonProps = {
  onPress: () => void;
};

export default function FloatingActionButton({
  onPress,
}: FloatingActionButtonProps) {
  return (
    <Pressable
      style={styles.fab}
      onPress={onPress}
      android_ripple={{ color: "#ffffff44" }}
    >
      <MaterialCommunityIcons name="plus" size={28} color="#FFFFFF" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#007AFF",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
