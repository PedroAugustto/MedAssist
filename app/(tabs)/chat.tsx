import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

export default function ChatScreen() {
  return (
    <View style={styles.container}>
      <ScrollView style={styles.chatContainer}>
        <View style={styles.messageBubble}>
          <Text style={styles.messageText}>Olá, João! Como posso ajudar?</Text>
        </View>
      </ScrollView>
      <View style={styles.suggestionsContainer}>
        <Pressable style={styles.chip}>
          <Text style={styles.chipText}>Como tomar?</Text>
        </Pressable>
        <Pressable style={styles.chip}>
          <Text style={styles.chipText}>Efeitos colaterais</Text>
        </Pressable>
        <Pressable style={styles.chip}>
          <Text style={styles.chipText}>Posso beber?</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    paddingTop: 50,
  },
  chatContainer: {
    flex: 1,
    padding: 16,
  },
  messageBubble: {
    backgroundColor: "#007AFF",
    padding: 12,
    borderRadius: 16,
    marginBottom: 16,
    alignSelf: "flex-start",
    maxWidth: "80%",
  },
  messageText: {
    fontSize: 18,
    color: "#FFFFFF",
  },
  suggestionsContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    padding: 16,
    backgroundColor: "#F0F0F0",
  },
  chip: {
    backgroundColor: "#007AFF",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    minHeight: 50,
    justifyContent: "center",
  },
  chipText: {
    fontSize: 16,
    color: "#FFFFFF",
  },
});
