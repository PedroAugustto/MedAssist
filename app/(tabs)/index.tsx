import FontAwesome from "@expo/vector-icons/FontAwesome";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { router, useFocusEffect } from "expo-router";
import * as Speech from "expo-speech";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  SectionList,
  SectionListData,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import Card from "../../components/Card";
import FloatingActionButton from "../../components/FloatingActionButton";
import { useAccessibilitySettings } from "../../services/accessibilitySettings";
import {
  createDosePlanForMedication,
  deleteDose,
  DoseHistoryWithMedication,
  listDoseHistory,
  listMedications,
  Medication,
} from "../../services/database";
import { userFriendlyErrorMessage } from "../../services/errorMessages";
import { generateSingleResponse } from "../../services/gemini";

type Dose = DoseHistoryWithMedication;
type DoseSection = {
  title: string;
  data: Dose[];
};

type DoseForm = {
  medicamento_id: string;
  horario_inicio: string;
  frequencia_horas: string;
  duracao_dias: string;
};

const toDatetimeLocalValue = (date: Date) => date.toISOString().slice(0, 16);

const getLocalDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatDateTitle = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return date.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const formatDateBr = (dateValue: string) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "dd/mm/aaaa";
  }

  return date.toLocaleDateString("pt-BR");
};

const formatTimeBr = (dateValue: string) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }

  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const mergeDatePart = (currentValue: string, selectedDate: Date) => {
  const currentDate = new Date(currentValue);
  const baseDate = Number.isNaN(currentDate.getTime()) ? new Date() : currentDate;
  const nextDate = new Date(baseDate);

  nextDate.setFullYear(selectedDate.getFullYear());
  nextDate.setMonth(selectedDate.getMonth());
  nextDate.setDate(selectedDate.getDate());

  return toDatetimeLocalValue(nextDate);
};

const mergeTimePart = (currentValue: string, selectedDate: Date) => {
  const currentDate = new Date(currentValue);
  const baseDate = Number.isNaN(currentDate.getTime()) ? new Date() : currentDate;
  const nextDate = new Date(baseDate);

  nextDate.setHours(selectedDate.getHours());
  nextDate.setMinutes(selectedDate.getMinutes());
  nextDate.setSeconds(0);
  nextDate.setMilliseconds(0);

  return toDatetimeLocalValue(nextDate);
};

const numberOrNull = (value: string) => {
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const emptyDoseForm = (): DoseForm => ({
  medicamento_id: "",
  horario_inicio: toDatetimeLocalValue(new Date()),
  frequencia_horas: "",
  duracao_dias: "",
});

const getDoseDisplayStatus = (dose: Dose, now: Date) => {
  const scheduledTime = new Date(dose.horario_agendado);

  if (dose.status === "pendente" && scheduledTime < now) {
    return "atrasado";
  }

  return dose.status;
};

export default function DosesScreen() {
  const [isPlaying, setIsPlaying] = useState(false);
  const sectionListRef = useRef<SectionList<Dose, DoseSection>>(null);
  const hasFocusedToday = useRef(false);
  const { scaleFont, speechRate } = useAccessibilitySettings();
  const styles = useMemo(() => createStyles(scaleFont), [scaleFont]);
  const [doses, setDoses] = useState<Dose[]>([]);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDoseModalVisible, setIsDoseModalVisible] = useState(false);
  const [isSavingDosePlan, setIsSavingDosePlan] = useState(false);
  const [doseForm, setDoseForm] = useState<DoseForm>(emptyDoseForm);
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [doseRecords, medicationRecords] = await Promise.all([
        listDoseHistory(),
        listMedications(),
      ]);
      const activeMedications = medicationRecords.filter(
        (medication) => medication.status_tratamento === "ativo",
      );

      setDoses(doseRecords);
      setMedications(activeMedications);
      setDoseForm((current) => ({
        ...current,
        medicamento_id:
          current.medicamento_id || activeMedications[0]?.id || "",
      }));
      hasFocusedToday.current = false;
    } catch (error: any) {
      Alert.alert(
        "Nao foi possivel carregar doses",
        userFriendlyErrorMessage(error, "Tente abrir a tela novamente."),
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const today = getLocalDateKey(new Date());
  const sections = useMemo<DoseSection[]>(() => {
    const grouped = doses
      .slice()
      .sort(
        (first, second) =>
          new Date(first.horario_agendado).getTime() -
          new Date(second.horario_agendado).getTime(),
      )
      .reduce<Record<string, Dose[]>>((accumulator, dose) => {
        const dateKey = getLocalDateKey(new Date(dose.horario_agendado));
        accumulator[dateKey] = accumulator[dateKey] || [];
        accumulator[dateKey].push(dose);
        return accumulator;
      }, {});

    return Object.keys(grouped)
      .sort()
      .map((dateKey) => ({
        title: dateKey,
        data: grouped[dateKey],
      }));
  }, [doses]);
  const todaySectionIndex = Math.max(
    0,
    sections.findIndex((section) => section.title >= today),
  );
  const todayDoses =
    sections.find((section) => section.title === today)?.data || [];
  const now = new Date();
  const pendingDoses = todayDoses.filter(
    (dose) => getDoseDisplayStatus(dose, now) === "pendente",
  );
  const lateDoses = todayDoses.filter(
    (dose) => getDoseDisplayStatus(dose, now) === "atrasado",
  );
  const takenDoses = todayDoses.filter(
    (dose) => getDoseDisplayStatus(dose, now) === "tomado",
  );
  const nextPending = pendingDoses.length > 0 ? pendingDoses[0] : null;

  const pingTest = async () => {
    try {
      const startTime = Date.now();
      const response = await generateSingleResponse("Responda apenas: pong");
      const duration = (Date.now() - startTime) / 1000;

      Alert.alert(
        "Conexao bem-sucedida",
        `Resposta: ${response}\nTempo: ${duration.toFixed(2)}s`,
      );
    } catch (error: any) {
      Alert.alert(
        "Falha na conexao",
        error.message || "Verifique sua internet e a chave da API.",
      );
    }
  };

  const openDoseModal = () => {
    if (medications.length === 0) {
      Alert.alert(
        "Nenhum medicamento ativo",
        "Cadastre ou reative um medicamento na aba Medicamentos antes de criar doses.",
        [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Ir para Medicamentos",
            onPress: () => router.push("/inventory" as any),
          },
        ],
      );
      return;
    }

    setDoseForm({
      ...emptyDoseForm(),
      medicamento_id: medications[0].id,
    });
    setIsDoseModalVisible(true);
  };

  const saveDosePlan = async () => {
    const frequenciaHoras = numberOrNull(doseForm.frequencia_horas);
    const duracaoDias = numberOrNull(doseForm.duracao_dias);
    const horarioInicio = new Date(doseForm.horario_inicio);

    if (!doseForm.medicamento_id) {
      Alert.alert("Selecione um medicamento", "Escolha um remedio da lista.");
      return;
    }

    if (!frequenciaHoras || !duracaoDias) {
      Alert.alert(
        "Dados incompletos",
        "Informe a frequencia em horas e a duracao em dias.",
      );
      return;
    }

    if (Number.isNaN(horarioInicio.getTime())) {
      Alert.alert("Horario invalido", "Selecione data e hora de inicio.");
      return;
    }

    try {
      setIsSavingDosePlan(true);
      const result = await createDosePlanForMedication({
        medicamento_id: doseForm.medicamento_id,
        horario_inicio: horarioInicio.toISOString(),
        frequencia_horas: frequenciaHoras,
        duracao_dias: duracaoDias,
      });

      setIsDoseModalVisible(false);
      await loadData();
      Alert.alert(
        "Doses criadas",
        `${result.dosesCriadas} dose${result.dosesCriadas === 1 ? "" : "s"} foram registradas.`,
      );
    } catch (error: any) {
      Alert.alert(
        "Nao foi possivel criar doses",
        error.message && !String(error.message).includes("NullPointer")
          ? error.message
          : "Confira o medicamento, a frequencia e a duracao, depois tente novamente.",
      );
    } finally {
      setIsSavingDosePlan(false);
    }
  };

  const focusToday = (animated = false) => {
    if (sections.length === 0) {
      return;
    }

    sectionListRef.current?.scrollToLocation({
      sectionIndex: todaySectionIndex,
      itemIndex: 0,
      animated,
      viewOffset: 16,
    });
  };

  const speakSummary = () => {
    if (isPlaying) {
      Speech.stop();
      setIsPlaying(false);
      return;
    }

    const pendingCount = pendingDoses.length;
    const lateCount = lateDoses.length;
    const takenCount = takenDoses.length;
    let summary = `Resumo do dia. Voce tem ${pendingCount} dose${pendingCount !== 1 ? "s" : ""} pendente${pendingCount !== 1 ? "s" : ""}, ${lateCount} atrasada${lateCount !== 1 ? "s" : ""} e ${takenCount} tomada${takenCount !== 1 ? "s" : ""}.`;

    if (nextPending) {
      const time = new Date(nextPending.horario_agendado).toLocaleTimeString(
        "pt-BR",
        {
          hour: "2-digit",
          minute: "2-digit",
        },
      );
      summary += ` Proxima dose: ${nextPending.nome_comercial} as ${time}.`;
    } else {
      summary += " Nao ha doses pendentes de medicamentos ativos para hoje.";
    }

    setIsPlaying(true);
    Speech.speak(summary, {
      language: "pt-BR",
      pitch: 1,
      rate: speechRate,
      onDone: () => setIsPlaying(false),
    });
  };

  const confirmDeleteDose = (dose: Dose) => {
    const time = new Date(dose.horario_agendado).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });

    Alert.alert(
      "Excluir dose",
      `Deseja excluir a dose de ${dose.nome_comercial} das ${time}?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteDose(dose.id);
              await loadData();
            } catch (error) {
              Alert.alert(
                "Nao foi possivel excluir",
                userFriendlyErrorMessage(
                  error,
                  "Tente excluir a dose novamente.",
                ),
              );
            }
          },
        },
      ],
    );
  };

  const renderDose = ({ item }: { item: Dose }) => {
    const time = new Date(item.horario_agendado).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const status = getDoseDisplayStatus(item, new Date());
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
              <Text style={styles.doseText}>{item.nome_comercial}</Text>
              <Text style={styles.doseDosage}>
                {item.dosagem || "Dosagem nao informada"}
              </Text>
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
            <View style={styles.doseActions}>
              <Text style={styles.doseTime}>{time}</Text>
              <Pressable
                style={styles.deleteDoseButton}
                onPress={() => confirmDeleteDose(item)}
                accessibilityLabel="Excluir dose"
              >
                <FontAwesome name="trash-o" size={20} color="#B91C1C" />
              </Pressable>
            </View>
          </View>
        </View>
      </Card>
    );
  };

  const renderSectionHeader = ({
    section,
  }: {
    section: SectionListData<Dose, DoseSection>;
  }) => {
    const isToday = section.title === today;

    return (
      <View style={styles.dayHeader}>
        <Text style={styles.dayTitle}>{formatDateTitle(section.title)}</Text>
        {isToday ? (
          <View style={styles.todayBadge}>
            <Text style={styles.todayBadgeText}>Hoje</Text>
          </View>
        ) : null}
      </View>
    );
  };

  const renderHeader = () => (
    <>
      <View style={styles.headerSection}>
        <Text style={styles.sectionLabel}>Agenda</Text>
        <Text style={styles.pageTitle}>Doses</Text>
        <Text style={styles.subtitle}>
          Acompanhe todas as doses registradas por dia.
        </Text>
      </View>

      <Card theme="secondary" style={styles.highlightCardWrapper}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.cardLabel}>Proxima Dose</Text>
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
            ? nextPending.nome_comercial
            : "Nenhuma dose pendente hoje"}
        </Text>
        <Text style={styles.cardBody}>
          {nextPending
            ? "Tome no horario indicado para manter o tratamento em dia."
            : "Nao ha doses pendentes registradas para hoje."}
        </Text>
        <View style={styles.cardActions}>
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
              {isPlaying ? "Pausar audio" : "Ouvir resumo"}
            </Text>
          </Pressable>
        </View>
      </Card>

      <Text style={styles.timelineHeader}>Todos os dias</Text>
    </>
  );

  return (
    <View style={styles.container}>
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Carregando doses</Text>
        </View>
      ) : (
        <SectionList
          ref={sectionListRef}
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderDose}
          renderSectionHeader={renderSectionHeader}
          contentContainerStyle={styles.contentContainer}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <FontAwesome name="calendar-plus-o" size={38} color="#2563EB" />
              <Text style={styles.emptyTitle}>Nenhuma dose cadastrada</Text>
              <Text style={styles.emptyText}>
                Use o botao de adicionar para criar doses de um medicamento ja
                cadastrado.
              </Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListFooterComponent={<View style={{ height: 32 }} />}
          stickySectionHeadersEnabled={false}
          onContentSizeChange={() => {
            if (!hasFocusedToday.current) {
              hasFocusedToday.current = true;
              requestAnimationFrame(() => focusToday(false));
            }
          }}
          onScrollToIndexFailed={() => {
            setTimeout(() => focusToday(false), 250);
          }}
        />
      )}
      <DosePlanModal
        visible={isDoseModalVisible}
        medications={medications}
        form={doseForm}
        styles={styles}
        isSaving={isSavingDosePlan}
        showStartDatePicker={showStartDatePicker}
        showStartTimePicker={showStartTimePicker}
        onClose={() => setIsDoseModalVisible(false)}
        onSave={saveDosePlan}
        onChangeForm={(field, value) =>
          setDoseForm((current) => ({ ...current, [field]: value }))
        }
        onShowDatePicker={() => setShowStartDatePicker(true)}
        onShowTimePicker={() => setShowStartTimePicker(true)}
        onDateChange={(event, selectedDate) => {
          setShowStartDatePicker(false);
          if (event.type !== "dismissed" && selectedDate) {
            setDoseForm((current) => ({
              ...current,
              horario_inicio: mergeDatePart(
                current.horario_inicio,
                selectedDate,
              ),
            }));
          }
        }}
        onTimeChange={(event, selectedDate) => {
          setShowStartTimePicker(false);
          if (event.type !== "dismissed" && selectedDate) {
            setDoseForm((current) => ({
              ...current,
              horario_inicio: mergeTimePart(
                current.horario_inicio,
                selectedDate,
              ),
            }));
          }
        }}
      />
      <FloatingActionButton onPress={openDoseModal} />
    </View>
  );
}

type DosePlanModalProps = {
  visible: boolean;
  medications: Medication[];
  form: DoseForm;
  styles: ReturnType<typeof createStyles>;
  isSaving: boolean;
  showStartDatePicker: boolean;
  showStartTimePicker: boolean;
  onClose: () => void;
  onSave: () => void;
  onChangeForm: (field: keyof DoseForm, value: string) => void;
  onShowDatePicker: () => void;
  onShowTimePicker: () => void;
  onDateChange: (
    event: DateTimePickerEvent,
    selectedDate?: Date,
  ) => void;
  onTimeChange: (
    event: DateTimePickerEvent,
    selectedDate?: Date,
  ) => void;
};

function DosePlanModal({
  visible,
  medications,
  form,
  styles,
  isSaving,
  showStartDatePicker,
  showStartTimePicker,
  onClose,
  onSave,
  onChangeForm,
  onShowDatePicker,
  onShowTimePicker,
  onDateChange,
  onTimeChange,
}: DosePlanModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalPanel}>
          <Text style={styles.modalTitle}>Cadastrar doses</Text>
          <Text style={styles.modalHelp}>
            Selecione um medicamento ja cadastrado e informe como as doses devem
            ser geradas.
          </Text>

          <Text style={styles.fieldLabel}>Medicamento</Text>
          <ScrollView style={styles.medicationOptionsScroll}>
          <View style={styles.medicationOptions}>
            {medications.map((medication) => {
              const isSelected = form.medicamento_id === medication.id;

              return (
                <Pressable
                  key={medication.id}
                  style={[
                    styles.medicationOption,
                    isSelected && styles.medicationOptionActive,
                  ]}
                  onPress={() => onChangeForm("medicamento_id", medication.id)}
                >
                  <Text
                    style={[
                      styles.medicationOptionTitle,
                      isSelected && styles.medicationOptionTitleActive,
                    ]}
                  >
                    {medication.nome_comercial}
                  </Text>
                  <Text
                    style={[
                      styles.medicationOptionSubtitle,
                      isSelected && styles.medicationOptionSubtitleActive,
                    ]}
                  >
                    {medication.dosagem || "Dosagem nao informada"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          </ScrollView>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Horario inicial</Text>
            <View style={styles.dateTimeRow}>
              <Pressable style={styles.dateInput} onPress={onShowDatePicker}>
                <Text style={styles.dateInputText}>
                  {formatDateBr(form.horario_inicio)}
                </Text>
                <FontAwesome name="calendar" size={20} color="#007AFF" />
              </Pressable>
              <Pressable style={styles.timeInput} onPress={onShowTimePicker}>
                <Text style={styles.dateInputText}>
                  {formatTimeBr(form.horario_inicio)}
                </Text>
                <FontAwesome name="clock-o" size={20} color="#007AFF" />
              </Pressable>
            </View>
          </View>

          {showStartDatePicker ? (
            <DateTimePicker
              value={new Date(form.horario_inicio)}
              mode="date"
              display="calendar"
              onChange={onDateChange}
            />
          ) : null}
          {showStartTimePicker ? (
            <DateTimePicker
              value={new Date(form.horario_inicio)}
              mode="time"
              display="default"
              is24Hour
              onChange={onTimeChange}
            />
          ) : null}

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Frequencia em horas</Text>
            <TextInput
              style={styles.input}
              value={form.frequencia_horas}
              onChangeText={(value) => onChangeForm("frequencia_horas", value)}
              keyboardType="numeric"
              placeholder="Ex.: 8"
              placeholderTextColor="#64748B"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Duracao em dias</Text>
            <TextInput
              style={styles.input}
              value={form.duracao_dias}
              onChangeText={(value) => onChangeForm("duracao_dias", value)}
              keyboardType="numeric"
              placeholder="Ex.: 7"
              placeholderTextColor="#64748B"
            />
          </View>

          <Text style={styles.warningText}>
            Confira esses dados com a receita ou orientacao profissional antes
            de criar os alarmes.
          </Text>

          <View style={styles.modalActions}>
            <Pressable style={styles.secondaryButton} onPress={onClose}>
              <Text style={styles.secondaryButtonText}>Cancelar</Text>
            </Pressable>
            <Pressable
              style={styles.primaryButton}
              onPress={onSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>Criar doses</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (scaleFont: (size: number) => number) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: "#FFFFFF",
    },
    contentContainer: {
      backgroundColor: "#FFFFFF",
      paddingHorizontal: 16,
      paddingTop: 50,
    },
    loadingContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    loadingText: {
      marginTop: 12,
      fontSize: scaleFont(16),
      color: "#475569",
    },
    headerSection: {
      marginBottom: 20,
    },
    sectionLabel: {
      fontSize: scaleFont(18),
      color: "#1F2937",
      marginBottom: 4,
      fontWeight: "600",
    },
    pageTitle: {
      fontSize: scaleFont(32),
      fontWeight: "bold",
      color: "#000000",
      marginBottom: 8,
    },
    subtitle: {
      fontSize: scaleFont(18),
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
      fontSize: scaleFont(16),
      color: "#FFFFFF",
      fontWeight: "700",
    },
    cardTime: {
      fontSize: scaleFont(26),
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
      fontSize: scaleFont(18),
      color: "#007AFF",
      fontWeight: "900",
    },
    cardTitle: {
      fontSize: scaleFont(26),
      color: "#FFFFFF",
      fontWeight: "bold",
      marginBottom: 12,
    },
    cardBody: {
      fontSize: scaleFont(18),
      color: "#FFFFFF",
      marginBottom: 18,
      lineHeight: 26,
    },
    cardActions: {
      gap: 12,
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
      fontSize: scaleFont(18),
      fontWeight: "700",
    },
    listenButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 12,
      paddingHorizontal: 16,
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
      fontSize: scaleFont(16),
      fontWeight: "600",
      marginLeft: 8,
    },
    listenButtonTextActive: {
      color: "#FFFFFF",
    },
    timelineHeader: {
      fontSize: scaleFont(20),
      fontWeight: "bold",
      color: "#000000",
      marginBottom: 12,
    },
    dayHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 14,
      marginBottom: 10,
      paddingTop: 4,
    },
    dayTitle: {
      flex: 1,
      fontSize: scaleFont(18),
      fontWeight: "800",
      color: "#0F172A",
      textTransform: "capitalize",
    },
    todayBadge: {
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 5,
      backgroundColor: "#DBEAFE",
    },
    todayBadgeText: {
      fontSize: scaleFont(13),
      fontWeight: "800",
      color: "#1D4ED8",
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
      fontSize: scaleFont(16),
      fontWeight: "700",
      color: "#334155",
    },
    doseActions: {
      alignItems: "flex-end",
      gap: 8,
    },
    deleteDoseButton: {
      width: 40,
      height: 40,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#FEE2E2",
    },
    doseText: {
      fontSize: scaleFont(18),
      fontWeight: "700",
      color: "#0F172A",
      marginBottom: 3,
    },
    doseDosage: {
      fontSize: scaleFont(15),
      color: "#64748B",
      marginBottom: 8,
    },
    doseStatus: {
      fontSize: scaleFont(14),
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
    emptyState: {
      alignItems: "center",
      paddingHorizontal: 24,
      paddingVertical: 36,
    },
    emptyTitle: {
      marginTop: 14,
      fontSize: scaleFont(22),
      fontWeight: "800",
      color: "#0F172A",
      textAlign: "center",
    },
    emptyText: {
      marginTop: 8,
      fontSize: scaleFont(17),
      lineHeight: 24,
      color: "#475569",
      textAlign: "center",
    },
    modalBackdrop: {
      flex: 1,
      justifyContent: "center",
      padding: 18,
      backgroundColor: "#00000080",
    },
    modalPanel: {
      maxHeight: "92%",
      borderRadius: 8,
      padding: 18,
      backgroundColor: "#FFFFFF",
    },
    modalTitle: {
      fontSize: scaleFont(24),
      fontWeight: "800",
      color: "#0F172A",
      marginBottom: 8,
    },
    modalHelp: {
      fontSize: scaleFont(16),
      lineHeight: 23,
      color: "#475569",
      marginBottom: 14,
    },
    field: {
      marginTop: 12,
    },
    fieldLabel: {
      fontSize: scaleFont(16),
      fontWeight: "700",
      color: "#0F172A",
      marginBottom: 6,
    },
    input: {
      minHeight: 52,
      borderWidth: 1,
      borderColor: "#CBD5E1",
      borderRadius: 8,
      paddingHorizontal: 12,
      fontSize: scaleFont(17),
      color: "#0F172A",
      backgroundColor: "#FFFFFF",
    },
    medicationOptionsScroll: {
      maxHeight: 190,
      marginBottom: 4,
    },
    medicationOptions: {
      gap: 8,
      marginBottom: 4,
    },
    medicationOption: {
      borderWidth: 1,
      borderColor: "#CBD5E1",
      borderRadius: 8,
      padding: 12,
      backgroundColor: "#FFFFFF",
    },
    medicationOptionActive: {
      borderColor: "#007AFF",
      backgroundColor: "#EFF6FF",
    },
    medicationOptionTitle: {
      fontSize: scaleFont(17),
      fontWeight: "800",
      color: "#0F172A",
    },
    medicationOptionTitleActive: {
      color: "#1D4ED8",
    },
    medicationOptionSubtitle: {
      marginTop: 3,
      fontSize: scaleFont(15),
      color: "#475569",
    },
    medicationOptionSubtitleActive: {
      color: "#1E40AF",
    },
    dateTimeRow: {
      flexDirection: "row",
      gap: 10,
    },
    dateInput: {
      flex: 1.35,
      minHeight: 52,
      borderWidth: 1,
      borderColor: "#CBD5E1",
      borderRadius: 8,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: "#FFFFFF",
    },
    timeInput: {
      flex: 1,
      minHeight: 52,
      borderWidth: 1,
      borderColor: "#CBD5E1",
      borderRadius: 8,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: "#FFFFFF",
    },
    dateInputText: {
      fontSize: scaleFont(17),
      fontWeight: "700",
      color: "#0F172A",
    },
    warningText: {
      marginTop: 14,
      fontSize: scaleFont(15),
      lineHeight: 22,
      color: "#92400E",
    },
    modalActions: {
      flexDirection: "row",
      gap: 10,
      marginTop: 18,
    },
    primaryButton: {
      flex: 1,
      minHeight: 52,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#007AFF",
    },
    primaryButtonText: {
      fontSize: scaleFont(17),
      fontWeight: "800",
      color: "#FFFFFF",
    },
    secondaryButton: {
      flex: 1,
      minHeight: 52,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: "#CBD5E1",
      backgroundColor: "#FFFFFF",
    },
    secondaryButtonText: {
      fontSize: scaleFont(17),
      fontWeight: "700",
      color: "#0F172A",
    },
  });
