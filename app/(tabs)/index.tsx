import FontAwesome from "@expo/vector-icons/FontAwesome";
import * as Speech from "expo-speech";
import React, { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import Card from "../../components/Card";
import db from "../../db.json";

export default function HojeScreen() {
  const [isPlaying, setIsPlaying] = useState(false);
  
  const today = "2026-05-14";
  const todayDoses = db.historico_doses.filter((dose) =>
    dose.horario_agendado.startsWith(today),
  );

  const pendingDoses = todayDoses.filter((dose) => dose.status === "pendente");
  const takenDoses = todayDoses.filter((dose) => dose.status === "tomado");
  const nextPending = pendingDoses.length > 0 ? pendingDoses[0] : null;

  const speakSummary = () => {
    if (isPlaying) {
      Speech.stop();
      setIsPlaying(false);
      return;
    }

    const takenCount = takenDoses.length;
    const pendingCount = pendingDoses.length;
    let summary = `Resumo do dia. Você tomou ${takenCount} dose${takenCount !== 1 ? "s" : ""} e tem ${pendingCount} pendente${pendingCount !== 1 ? "s" : ""}.`;

    if (nextPending) {
      const med = db.medicamentos.find(
        (m) => m.id === nextPending.medicamento_id,
      );
      const time = new Date(nextPending.horario_agendado).toLocaleTimeString(
        "pt-BR",
        {
          hour: "2-digit",
          minute: "2-digit",
        },
      );
      summary += ` Próxima dose: ${med?.nome_comercial} às ${time}.`;
    } else {
      summary += " Todas as doses foram tomadas.";
    }

    setIsPlaying(true);
    Speech.speak(summary, {
      language: "pt-BR",
      pitch: 1,
      rate: 0.8,
      onDone: () => setIsPlaying(false),
    });
  };

  const renderDose = ({ item }: { item: any }) => {
    const med = db.medicamentos.find((m) => m.id === item.medicamento_id);
    const time = new Date(item.horario_agendado).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const now = new Date();
    const scheduledTime = new Date(item.horario_agendado);
    let status = item.status;
    if (item.status === "pendente" && scheduledTime < now) {
      status = "atrasado";
    }
    const iconName =
      status === "tomado"
        ? "check"
        : status === "pendente"
          ? "clock-o"
          : "exclamation-triangle";
    const iconColor =
      status === "tomado"
        ? "#0B6623"
        : status === "pendente"
          ? "#D97706"
          : "#DC2626";
    const iconBackground =
      status === "tomado"
        ? "#DCFCE7"
        : status === "pendente"
          ? "#FCEFC3"
          : "#FECACA";
    const statusLabel =
      status === "tomado"
        ? "Tomado"
        : status === "pendente"
          ? "Pendente"
          : "Atrasado";

    return (
      <Card theme="default" style={styles.timelineItemCard}>
        <View
          style={[
            styles.timelineStatusIcon,
            { backgroundColor: iconBackground },
          ]}
        >
          <FontAwesome name={iconName} size={18} color={iconColor} />
        </View>
        <View style={styles.timelineCardWrapper}>
          <View style={styles.timelineCardHeader}>
            <View style={styles.timelineTextGroup}>
              <Text style={styles.doseText}>{med?.nome_comercial}</Text>
              <Text style={styles.doseDosage}>{med?.dosagem}</Text>
              <Text
                style={[
                  styles.doseStatus,
                  status === "tomado"
                    ? styles.statusTaken
                    : status === "pendente"
                      ? styles.statusPending
                      : styles.statusLate,
                ]}
              >
                {statusLabel}
              </Text>
            </View>
            <Text style={styles.doseTime}>{time}</Text>
          </View>
        </View>
      </Card>
    );
  };

  const renderHeader = () => (
    <>
      <View style={styles.headerSection}>
        <Text style={styles.sectionLabel}>Agenda</Text>
        <Text style={styles.pageTitle}>Hoje</Text>
        <Text style={styles.subtitle}>
          Fique por dentro das próximas doses.
        </Text>
      </View>

      <Card theme="secondary" style={styles.highlightCardWrapper}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.cardLabel}>Próxima Dose</Text>
            <Text style={styles.cardTime}>
              {nextPending
                ? new Date(nextPending.horario_agendado).toLocaleTimeString(
                    "pt-BR",
                    {
                      hour: "2-digit",
                      minute: "2-digit",
                    },
                  )
                : "--:--"}
            </Text>
          </View>
          <View style={styles.cardIcon}>
            <Text style={styles.cardIconText}>💊</Text>
          </View>
        </View>
        <Text style={styles.cardTitle}>
          {nextPending
            ? db.medicamentos.find((m) => m.id === nextPending.medicamento_id)
                ?.nome_comercial
            : "Nenhuma dose pendente"}
        </Text>
        <Text style={styles.cardBody}>
          {nextPending
            ? "Tome no horário indicado para manter o tratamento em dia."
            : "Todas as doses de hoje foram registradas."}
        </Text>
        {nextPending && (
          <Pressable
            style={styles.button}
            android_ripple={{ color: "#ffffff22" }}
          >
            <Text style={styles.buttonText}>Tomar Agora</Text>
          </Pressable>
        )}
        <Pressable
          style={[
            styles.listenButton,
            isPlaying && styles.listenButtonActive,
          ]}
          onPress={speakSummary}
          android_ripple={{ color: "#00000022" }}
        >
          <FontAwesome
            name={isPlaying ? "pause" : "volume-up"}
            size={20}
            color={isPlaying ? "#FFFFFF" : "#000000"}
          />
          <Text
            style={[
              styles.listenButtonText,
              isPlaying && styles.listenButtonTextActive,
            ]}
          >
            {isPlaying ? "Pausar áudio" : "Ouvir resumo do dia em voz alta"}
          </Text>
        </Pressable>
      </Card>

      <Text style={styles.timelineHeader}>Linha do tempo</Text>
    </>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={todayDoses}
        keyExtractor={(item) => item.id}
        renderItem={renderDose}
        contentContainerStyle={styles.contentContainer}
        ListHeaderComponent={renderHeader}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListFooterComponent={<View style={{ height: 32 }} />}
      />
      <Pressable style={styles.fab} android_ripple={{ color: "#ffffff44" }}>
        <FontAwesome name="plus" size={24} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  contentContainer: {
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    paddingTop: 50,
  },
  headerSection: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 18,
    color: "#1F2937",
    marginBottom: 4,
    fontWeight: "600",
  },
  pageTitle: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#000000",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: "#334155",
    lineHeight: 26,
  },
  highlightCardWrapper: {
    marginBottom: 24,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  cardLabel: {
    fontSize: 16,
    color: "#FFFFFF",
    fontWeight: "700",
  },
  cardTime: {
    fontSize: 26,
    color: "#FFFFFF",
    fontWeight: "800",
  },
  cardIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
  },
  cardIconText: {
    fontSize: 24,
  },
  cardTitle: {
    fontSize: 26,
    color: "#FFFFFF",
    fontWeight: "bold",
    marginBottom: 12,
  },
  cardBody: {
    fontSize: 18,
    color: "#FFFFFF",
    marginBottom: 18,
    lineHeight: 26,
  },
  button: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    minHeight: 54,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  buttonText: {
    color: "#007AFF",
    fontSize: 18,
    fontWeight: "700",
  },
  listenButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#F8FAFC",
  },
  listenButtonActive: {
    backgroundColor: "#007AFF",
    borderColor: "#007AFF",
  },
  listenButtonText: {
    color: "#007AFF",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
  },
  listenButtonTextActive: {
    color: "#FFFFFF",
  },
  timelineHeader: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#000000",
    marginBottom: 12,
  },
  timelineList: {
    paddingBottom: 32,
  },
  timelineItemCard: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  timelineCardWrapper: {
    flex: 1,
  },
  timelineStatusIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  timelineCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  timelineTextGroup: {
    flex: 1,
    paddingRight: 12,
  },
  doseTime: {
    fontSize: 16,
    fontWeight: "700",
    color: "#334155",
  },
  doseText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0F172A",
    marginBottom: 3,
  },
  doseDosage: {
    fontSize: 15,
    color: "#64748B",
    marginBottom: 8,
  },
  doseStatus: {
    fontSize: 14,
    fontWeight: "600",
  },
  statusTaken: {
    color: "#0B6623",
  },
  statusPending: {
    color: "#D97706",
  },
  statusLate: {
    color: "#DC2626",
  },
  separator: {
    height: 1,
    backgroundColor: "#E2E8F0",
    marginVertical: 10,
  },
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
