import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useFocusEffect } from "expo-router";
import * as Speech from "expo-speech";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAccessibilitySettings } from "../../services/accessibilitySettings";
import {
  ChatHistoryMessage,
  clearChatHistory,
  getUserProfile,
  listMedications,
  listChatHistory,
  saveChatMessage,
} from "../../services/database";
import { userFriendlyErrorMessage } from "../../services/errorMessages";
import {
  ChatMessage,
  generateGroqChatResponse,
  transcribeAudioWithGroq,
} from "../../services/groq";

type ChatItem = ChatHistoryMessage | PendingChatMessage;

type PendingChatMessage = {
  id: string;
  usuario_id: string;
  role: "user" | "model";
  text: string;
  criado_em: string;
  pending?: boolean;
};

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "tudo bem";

const normalizeForMedicationMatch = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const levenshteinDistance = (first: string, second: string) => {
  const rows = first.length + 1;
  const columns = second.length + 1;
  const matrix = Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => 0),
  );

  for (let row = 0; row < rows; row += 1) {
    matrix[row][0] = row;
  }

  for (let column = 0; column < columns; column += 1) {
    matrix[0][column] = column;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const cost = first[row - 1] === second[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + cost,
      );
    }
  }

  return matrix[first.length][second.length];
};

const similarityScore = (first: string, second: string) => {
  if (!first || !second) {
    return 0;
  }

  const maxLength = Math.max(first.length, second.length);
  return 1 - levenshteinDistance(first, second) / maxLength;
};

type MedicationMentionResolution = {
  text: string;
  suggestion?: string;
  wasCorrected: boolean;
  needsConfirmation: boolean;
};

const resolveMedicationMention = (
  transcription: string,
  medicationNames: string[],
): MedicationMentionResolution => {
  const tokens = Array.from(transcription.matchAll(/\S+/g)).map((match) => ({
    text: match[0],
    start: match.index || 0,
    end: (match.index || 0) + match[0].length,
  }));
  let bestMatch:
    | {
        medicationName: string;
        score: number;
        start: number;
        end: number;
      }
    | null = null;

  for (const medicationName of medicationNames) {
    const normalizedMedication = normalizeForMedicationMatch(medicationName);

    if (normalizedMedication.length < 4) {
      continue;
    }

    for (let startIndex = 0; startIndex < tokens.length; startIndex += 1) {
      for (
        let endIndex = startIndex;
        endIndex < Math.min(tokens.length, startIndex + 4);
        endIndex += 1
      ) {
        const normalizedWindow = normalizeForMedicationMatch(
          tokens
            .slice(startIndex, endIndex + 1)
            .map((token) => token.text)
            .join(" "),
        );

        if (!normalizedWindow) {
          continue;
        }

        const score = similarityScore(normalizedWindow, normalizedMedication);

        if (!bestMatch || score > bestMatch.score) {
          bestMatch = {
            medicationName,
            score,
            start: tokens[startIndex].start,
            end: tokens[endIndex].end,
          };
        }
      }
    }
  }

  if (!bestMatch || bestMatch.score < 0.58) {
    return {
      text: transcription,
      wasCorrected: false,
      needsConfirmation: false,
    };
  }

  if (bestMatch.score >= 0.76) {
    return {
      text: `${transcription.slice(0, bestMatch.start)}${bestMatch.medicationName}${transcription.slice(bestMatch.end)}`,
      suggestion: bestMatch.medicationName,
      wasCorrected: true,
      needsConfirmation: false,
    };
  }

  return {
    text: transcription,
    suggestion: bestMatch.medicationName,
    wasCorrected: false,
    needsConfirmation: true,
  };
};

const listActiveMedicationNames = async () => {
  const medications = await listMedications();

  return medications
    .filter((medication) => medication.status_tratamento === "ativo")
    .map((medication) => medication.nome_comercial.trim())
    .filter((name, index, list) => name && list.indexOf(name) === index);
};

const toChatMessages = (items: ChatItem[]): ChatMessage[] =>
  items
    .filter((item) => !("pending" in item && item.pending))
    .map((item) => ({
      role: item.role === "model" ? "assistant" : "user",
      content: item.text,
    }));

export default function ChatScreen() {
  const listRef = useRef<FlatList<ChatItem>>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const { scaleFont, speechRate, colors } = useAccessibilitySettings();
  const styles = useMemo(
    () => createStyles(scaleFont, colors),
    [scaleFont, colors],
  );
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [inputText, setInputText] = useState("");
  const [welcomeName, setWelcomeName] = useState("tudo bem");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isRecording = recorderState.isRecording;

  const loadChat = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const [history, profile] = await Promise.all([
        listChatHistory(),
        getUserProfile(),
      ]);

      setMessages(history);
      setWelcomeName(firstName(profile.nome));
    } catch (error) {
      setErrorMessage(
        userFriendlyErrorMessage(error, "Nao foi possivel carregar o chat."),
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadChat();
      return () => {
        Speech.stop();
        if (recorder.isRecording) {
          recorder.stop().catch(() => {});
        }
        setSpeakingMessageId(null);
      };
    }, [loadChat, recorder]),
  );

  const scrollToEnd = () => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  };

  const sendMessage = async (text: string) => {
    const trimmedText = text.trim();

    if (!trimmedText || isSending) {
      return;
    }

    const optimisticUserMessage: PendingChatMessage = {
      id: `pending-user-${Date.now()}`,
      usuario_id: "user-001",
      role: "user",
      text: trimmedText,
      criado_em: new Date().toISOString(),
      pending: true,
    };
    const nextMessages = [...messages, optimisticUserMessage];

    setInputText("");
    setMessages(nextMessages);
    setErrorMessage(null);
    setIsSending(true);
    scrollToEnd();

    try {
      const savedUserMessage = await saveChatMessage({
        role: "user",
        text: trimmedText,
      });
      const persistedMessages = savedUserMessage
        ? [...messages, savedUserMessage]
        : nextMessages;

      setMessages(persistedMessages);

      const responseText = await generateGroqChatResponse({
        messages: toChatMessages(persistedMessages),
      });
      const savedResponse = await saveChatMessage({
        role: "model",
        text: responseText,
      });

      setMessages((current) => [
        ...current.filter((item) => !("pending" in item && item.pending)),
        ...(savedResponse
          ? [savedResponse]
          : [
              {
                id: `pending-model-${Date.now()}`,
                usuario_id: "user-001",
                role: "model" as const,
                text: responseText,
                criado_em: new Date().toISOString(),
              },
            ]),
      ]);
      scrollToEnd();
    } catch (error) {
      setMessages((current) =>
        current.filter((item) => !("pending" in item && item.pending)),
      );
      setErrorMessage(
        userFriendlyErrorMessage(
          error,
          "Nao consegui responder agora. Tente novamente em instantes.",
        ),
      );
    } finally {
      setIsSending(false);
    }
  };

  const startRecording = async () => {
    if (isSending || isTranscribing) {
      return;
    }

    try {
      setErrorMessage(null);
      Speech.stop();
      setSpeakingMessageId(null);

      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        throw new Error("Permita o uso do microfone para gravar sua pergunta.");
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (error) {
      setErrorMessage(
        userFriendlyErrorMessage(
          error,
          "Nao foi possivel iniciar a gravacao.",
        ),
      );
    }
  };

  const stopRecordingAndTranscribe = async () => {
    if (!isRecording || isTranscribing) {
      return;
    }

    try {
      setErrorMessage(null);
      setIsTranscribing(true);
      await recorder.stop();
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      const audioUri = recorder.uri;
      if (!audioUri) {
        throw new Error("Nao encontrei o audio gravado.");
      }

      const medicationNames = await listActiveMedicationNames();
      const transcription = await transcribeAudioWithGroq(
        audioUri,
        medicationNames,
      );
      const resolvedTranscription = resolveMedicationMention(
        transcription,
        medicationNames,
      );

      setInputText((current) =>
        current.trim()
          ? `${current.trim()} ${resolvedTranscription.text}`
          : resolvedTranscription.text,
      );

      if (resolvedTranscription.wasCorrected && resolvedTranscription.suggestion) {
        setErrorMessage(
          `Corrigi o nome do medicamento para "${resolvedTranscription.suggestion}". Confira antes de enviar.`,
        );
      } else if (
        resolvedTranscription.needsConfirmation &&
        resolvedTranscription.suggestion
      ) {
        setErrorMessage(
          `Talvez voce tenha dito "${resolvedTranscription.suggestion}". Confira o texto antes de enviar.`,
        );
      }
    } catch (error) {
      setErrorMessage(
        userFriendlyErrorMessage(
          error,
          "Nao foi possivel transcrever o audio.",
        ),
      );
    } finally {
      setIsTranscribing(false);
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecordingAndTranscribe();
    } else {
      startRecording();
    }
  };

  const toggleSpeakMessage = (message: ChatItem) => {
    if (speakingMessageId === message.id) {
      Speech.stop();
      setSpeakingMessageId(null);
      return;
    }

    Speech.stop();
    setSpeakingMessageId(message.id);
    Speech.speak(message.text, {
      language: "pt-BR",
      rate: speechRate,
      onDone: () => setSpeakingMessageId(null),
      onStopped: () => setSpeakingMessageId(null),
      onError: () => setSpeakingMessageId(null),
    });
  };

  const confirmClearChat = () => {
    if (messages.length === 0 || isSending || isTranscribing || isRecording) {
      return;
    }

    Alert.alert(
      "Limpar conversa",
      "Deseja apagar todo o historico deste chat?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Limpar",
          style: "destructive",
          onPress: async () => {
            try {
              Speech.stop();
              setSpeakingMessageId(null);
              await clearChatHistory();
              setMessages([]);
              setErrorMessage(null);
            } catch (error) {
              setErrorMessage(
                userFriendlyErrorMessage(
                  error,
                  "Nao foi possivel limpar a conversa.",
                ),
              );
            }
          },
        },
      ],
    );
  };

  const renderMessage = ({ item }: { item: ChatItem }) => {
    const isUser = item.role === "user";
    const isSpeaking = speakingMessageId === item.id;

    return (
      <View
        style={[
          styles.messageBubble,
          isUser ? styles.userBubble : styles.assistantBubble,
        ]}
      >
        <Text
          style={[
            styles.messageText,
            isUser ? styles.userMessageText : styles.assistantMessageText,
          ]}
        >
          {item.text}
        </Text>
        {!isUser ? (
          <Pressable
            style={[
              styles.listenButton,
              isSpeaking && styles.listenButtonActive,
            ]}
            onPress={() => toggleSpeakMessage(item)}
            accessibilityLabel={
              isSpeaking ? "Parar leitura da resposta" : "Ler resposta em voz alta"
            }
          >
            <MaterialCommunityIcons
              name={isSpeaking ? "stop" : "volume-high"}
              size={18}
              color={isSpeaking ? "#007AFF" : "#FFFFFF"}
            />
            <Text
              style={[
                styles.listenButtonText,
                isSpeaking && styles.listenButtonTextActive,
              ]}
            >
              {isSpeaking ? "Parar" : "Ouvir"}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
    >
      <View style={styles.header}>
        <MaterialCommunityIcons
          name="message-text-outline"
          size={32}
          color="#007AFF"
        />
        <View style={styles.headerTextGroup}>
          <Text style={styles.screenTitle}>Chat</Text>
          <Text style={styles.subtitle}>Converse com o MedAssist.</Text>
        </View>
        <Pressable
          style={[
            styles.clearChatButton,
            (messages.length === 0 || isSending || isTranscribing || isRecording) &&
              styles.clearChatButtonDisabled,
          ]}
          onPress={confirmClearChat}
          disabled={messages.length === 0 || isSending || isTranscribing || isRecording}
          accessibilityLabel="Limpar conversa"
        >
          <MaterialCommunityIcons
            name="trash-can-outline"
            size={24}
            color="#FFFFFF"
          />
        </Pressable>
      </View>

      <View style={styles.warningBox}>
        <MaterialCommunityIcons
          name="alert-circle-outline"
          size={20}
          color="#92400E"
        />
        <Text style={styles.warningText}>
          As respostas ajudam na orientacao, mas nao substituem medico ou
          farmaceutico. Em duvida, procure um profissional.
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Carregando chat</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={[
            styles.messagesContent,
            messages.length === 0 && styles.emptyMessagesContent,
          ]}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Ola, {welcomeName}!</Text>
              <Text style={styles.emptyText}>
                Como posso ajudar com seus remedios hoje?
              </Text>
            </View>
          }
          ListFooterComponent={
            isSending ? (
              <View style={styles.typingRow}>
                <ActivityIndicator color="#007AFF" />
                <Text style={styles.typingText}>
                  MedAssist esta respondendo...
                </Text>
              </View>
            ) : null
          }
          onContentSizeChange={scrollToEnd}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {errorMessage ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Digite sua pergunta"
          placeholderTextColor={colors.textMuted}
          multiline
          editable={!isSending && !isTranscribing && !isRecording}
          textAlignVertical="center"
        />
        <Pressable
          style={[
            styles.micButton,
            isRecording && styles.micButtonRecording,
            isTranscribing && styles.micButtonDisabled,
          ]}
          onPress={toggleRecording}
          disabled={isSending || isTranscribing}
          accessibilityLabel={
            isRecording ? "Parar gravacao" : "Gravar pergunta por voz"
          }
        >
          {isTranscribing ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <MaterialCommunityIcons
              name={isRecording ? "stop" : "microphone"}
              size={24}
              color="#FFFFFF"
            />
          )}
        </Pressable>
        <Pressable
          style={[
            styles.sendButton,
            (!inputText.trim() || isSending || isTranscribing || isRecording) &&
              styles.sendButtonDisabled,
          ]}
          onPress={() => sendMessage(inputText)}
          disabled={!inputText.trim() || isSending || isTranscribing || isRecording}
          accessibilityLabel="Enviar mensagem"
        >
          <MaterialCommunityIcons name="send" size={24} color="#FFFFFF" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const createStyles = (
  scaleFont: (size: number) => number,
  colors: ReturnType<typeof useAccessibilitySettings>["colors"],
) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      paddingTop: 50,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingBottom: 14,
      borderBottomWidth: 1,
      borderBottomColor: "#E2E8F0",
    },
    headerTextGroup: {
      flex: 1,
      marginLeft: 12,
    },
    screenTitle: {
      fontSize: scaleFont(28),
      fontWeight: "800",
      color: colors.text,
    },
    subtitle: {
      marginTop: 2,
      fontSize: scaleFont(16),
      color: colors.textMuted,
    },
    clearChatButton: {
      width: 44,
      height: 44,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#B91C1C",
    },
    clearChatButtonDisabled: {
      opacity: 0.45,
    },
    loadingContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    loadingText: {
      marginTop: 12,
      fontSize: scaleFont(16),
      color: colors.textMuted,
    },
    messagesContent: {
      padding: 16,
      paddingBottom: 18,
    },
    emptyMessagesContent: {
      flexGrow: 1,
      justifyContent: "center",
    },
    emptyState: {
      alignItems: "center",
      paddingHorizontal: 20,
    },
    emptyTitle: {
      fontSize: scaleFont(24),
      fontWeight: "800",
      color: colors.text,
      textAlign: "center",
    },
    emptyText: {
      marginTop: 8,
      fontSize: scaleFont(18),
      lineHeight: 26,
      color: colors.textMuted,
      textAlign: "center",
    },
    messageBubble: {
      maxWidth: "86%",
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 11,
      marginBottom: 12,
    },
    userBubble: {
      alignSelf: "flex-end",
      backgroundColor: "#007AFF",
    },
    assistantBubble: {
      alignSelf: "flex-start",
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: "#E2E8F0",
    },
    messageText: {
      fontSize: scaleFont(17),
      lineHeight: 24,
    },
    userMessageText: {
      color: "#FFFFFF",
    },
    assistantMessageText: {
      color: colors.text,
    },
    listenButton: {
      alignSelf: "stretch",
      minHeight: 38,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      marginTop: 10,
      borderRadius: 8,
      paddingHorizontal: 10,
      borderWidth: 1,
      borderColor: "#007AFF",
      backgroundColor: "#007AFF",
    },
    listenButtonActive: {
      borderColor: "#007AFF",
      backgroundColor: colors.surface,
    },
    listenButtonText: {
      fontSize: scaleFont(14),
      fontWeight: "800",
      color: "#FFFFFF",
    },
    listenButtonTextActive: {
      color: "#007AFF",
    },
    warningBox: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      marginHorizontal: 16,
      marginTop: 10,
      marginBottom: 8,
      borderRadius: 8,
      padding: 12,
      backgroundColor: "#FEF3C7",
    },
    warningText: {
      flex: 1,
      fontSize: scaleFont(14),
      lineHeight: 20,
      fontWeight: "700",
      color: "#92400E",
    },
    typingRow: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: 10,
      paddingVertical: 8,
    },
    typingText: {
      fontSize: scaleFont(16),
      color: colors.textMuted,
    },
    errorBox: {
      marginHorizontal: 16,
      marginBottom: 10,
      borderRadius: 8,
      padding: 12,
      backgroundColor: "#FEE2E2",
    },
    errorText: {
      fontSize: scaleFont(15),
      lineHeight: 21,
      color: "#991B1B",
      fontWeight: "700",
    },
    inputRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 10,
      padding: 16,
      paddingTop: 0,
      backgroundColor: colors.background,
    },
    input: {
      flex: 1,
      maxHeight: 118,
      minHeight: 54,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: scaleFont(17),
      color: colors.text,
      backgroundColor: colors.surface,
    },
    micButton: {
      width: 54,
      height: 54,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#0F766E",
    },
    micButtonRecording: {
      backgroundColor: "#DC2626",
    },
    micButtonDisabled: {
      backgroundColor: "#94A3B8",
    },
    sendButton: {
      width: 54,
      height: 54,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#007AFF",
    },
    sendButtonDisabled: {
      backgroundColor: "#94A3B8",
    },
  });
