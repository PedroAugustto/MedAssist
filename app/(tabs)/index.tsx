import FontAwesome from "@expo/vector-icons/FontAwesome";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import * as Speech from "expo-speech";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
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
  markDoseAsTaken,
  Medication,
} from "../../services/database";
import { userFriendlyErrorMessage } from "../../services/errorMessages";
import { generateSingleResponse } from "../../services/gemini";
import {
  getMedicationLeafletDosageSuggestion,
  LeafletDosageSuggestion,
  MedicationLeafletSafetyAlert,
} from "../../services/leaflets";

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

const padDatePart = (value: number) => String(value).padStart(2, "0");

const toDatetimeLocalValue = (date: Date) => {
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hours = padDatePart(date.getHours());
  const minutes = padDatePart(date.getMinutes());

  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const toLocalIsoWithTimezone = (date: Date) => {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = padDatePart(Math.floor(absoluteOffset / 60));
  const offsetRemainingMinutes = padDatePart(absoluteOffset % 60);

  return `${toDatetimeLocalValue(date)}:00${sign}${offsetHours}:${offsetRemainingMinutes}`;
};

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
  const baseDate = Number.isNaN(currentDate.getTime())
    ? new Date()
    : currentDate;
  const nextDate = new Date(baseDate);

  nextDate.setFullYear(selectedDate.getFullYear());
  nextDate.setMonth(selectedDate.getMonth());
  nextDate.setDate(selectedDate.getDate());

  return toDatetimeLocalValue(nextDate);
};

const mergeTimePart = (currentValue: string, selectedDate: Date) => {
  const currentDate = new Date(currentValue);
  const baseDate = Number.isNaN(currentDate.getTime())
    ? new Date()
    : currentDate;
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
  const params = useLocalSearchParams<{ doseId?: string }>();
  const sectionListRef = useRef<SectionList<Dose, DoseSection>>(null);
  const hasFocusedToday = useRef(false);
  const handledNotificationDoseId = useRef<string | null>(null);
  const { scaleFont, speechRate, colors } = useAccessibilitySettings();
  const styles = useMemo(
    () => createStyles(scaleFont, colors),
    [scaleFont, colors],
  );
  const [doses, setDoses] = useState<Dose[]>([]);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDoseModalVisible, setIsDoseModalVisible] = useState(false);
  const [selectedDose, setSelectedDose] = useState<Dose | null>(null);
  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);
  const [selectedDoseTakenTime, setSelectedDoseTakenTime] = useState(
    toDatetimeLocalValue(new Date()),
  );
  const [isTakenTimeModalVisible, setIsTakenTimeModalVisible] = useState(false);
  const [showDoseTakenDatePicker, setShowDoseTakenDatePicker] = useState(false);
  const [showDoseTakenTimePicker, setShowDoseTakenTimePicker] = useState(false);
  const [isMarkingDoseAsTaken, setIsMarkingDoseAsTaken] = useState(false);
  const [isSavingDosePlan, setIsSavingDosePlan] = useState(false);
  const [isCheckingLeafletDosage, setIsCheckingLeafletDosage] = useState(false);
  const [leafletDosageSuggestion, setLeafletDosageSuggestion] =
    useState<LeafletDosageSuggestion | null>(null);
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

  useEffect(() => {
    if (!selectedDose) {
      return;
    }

    const refreshedDose = doses.find((dose) => dose.id === selectedDose.id);
    if (refreshedDose) {
      setSelectedDose(refreshedDose);
    }
  }, [doses, selectedDose]);

  useEffect(() => {
    const doseId = Array.isArray(params.doseId)
      ? params.doseId[0]
      : params.doseId;

    if (!doseId || handledNotificationDoseId.current === doseId) {
      return;
    }

    const dose = doses.find((item) => item.id === doseId);
    if (!dose) {
      return;
    }

    handledNotificationDoseId.current = doseId;
    openSelectedDose(dose);
  }, [doses, params.doseId]);

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
    setLeafletDosageSuggestion(null);
    setIsDoseModalVisible(true);
  };

  const checkLeafletDosage = async () => {
    if (!doseForm.medicamento_id) {
      Alert.alert("Selecione um medicamento", "Escolha um remedio da lista.");
      return;
    }

    try {
      setIsCheckingLeafletDosage(true);
      const suggestion = await getMedicationLeafletDosageSuggestion(
        doseForm.medicamento_id,
      );

      if (!suggestion) {
        Alert.alert(
          "Bula nao encontrada",
          "Nao encontrei um resumo de bula salvo para este medicamento.",
        );
        return;
      }

      setLeafletDosageSuggestion(suggestion);
      setDoseForm((current) => ({
        ...current,
        frequencia_horas: suggestion.frequencia_horas
          ? String(suggestion.frequencia_horas)
          : current.frequencia_horas,
        duracao_dias: suggestion.duracao_dias
          ? String(suggestion.duracao_dias)
          : current.duracao_dias,
      }));
    } catch (error) {
      Alert.alert(
        "Nao foi possivel consultar a bula",
        userFriendlyErrorMessage(error, "Tente novamente em instantes."),
      );
    } finally {
      setIsCheckingLeafletDosage(false);
    }
  };

  const saveDosePlan = async (skipSafetyConfirmation = false) => {
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

    if (
      !skipSafetyConfirmation &&
      leafletDosageSuggestion?.alertas_seguranca.length
    ) {
      Alert.alert(
        "Possivel risco identificado",
        "A bula salva tem alertas relacionados aos dados cadastrados. Antes de criar as doses, confirme com um medico ou farmaceutico.",
        [
          { text: "Voltar", style: "cancel" },
          {
            text: "Continuar mesmo assim",
            style: "destructive",
            onPress: () => saveDosePlan(true),
          },
        ],
      );
      return;
    }

    try {
      setIsSavingDosePlan(true);
      const result = await createDosePlanForMedication({
        medicamento_id: doseForm.medicamento_id,
        horario_inicio: toLocalIsoWithTimezone(horarioInicio),
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

  const closeSelectedDose = () => {
    setSelectedDose(null);
    setIsTakenTimeModalVisible(false);
    setShowDoseTakenDatePicker(false);
    setShowDoseTakenTimePicker(false);
    handledNotificationDoseId.current = null;
    router.setParams({ doseId: "" } as any);
  };

  const openSelectedDose = (dose: Dose) => {
    setSelectedDose(dose);
    setSelectedDoseTakenTime(
      toDatetimeLocalValue(new Date(dose.horario_agendado)),
    );
  };

  const handleMarkSelectedDoseAsTaken = async (horarioTomado?: string) => {
    if (!selectedDose) {
      return;
    }

    try {
      setIsMarkingDoseAsTaken(true);
      await markDoseAsTaken(selectedDose.id, horarioTomado);
      await loadData();
      closeSelectedDose();
      Alert.alert("Dose registrada", "A dose foi marcada como tomada.");
    } catch (error) {
      Alert.alert(
        "Nao foi possivel registrar",
        userFriendlyErrorMessage(error, "Tente marcar a dose novamente."),
      );
    } finally {
      setIsMarkingDoseAsTaken(false);
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
      <Pressable
        onPress={() => openSelectedDose(item)}
        accessibilityRole="button"
        accessibilityLabel={`Abrir dose de ${item.nome_comercial}`}
      >
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
      </Pressable>
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
            <Text style={styles.cardLabel}>Proxima dose de hoje:</Text>
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
              onPress={() => openSelectedDose(nextPending)}
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
              color={isPlaying ? "#FFFFFF" : colors.text}
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
      <DoseDetailsModal
        visible={Boolean(selectedDose)}
        dose={selectedDose}
        styles={styles}
        isSaving={isMarkingDoseAsTaken}
        onClose={closeSelectedDose}
        onPreviewImage={(uri) => setPreviewImageUri(uri)}
        onMarkAsTakenNow={() => handleMarkSelectedDoseAsTaken()}
        onOpenTakenTimeModal={() => setIsTakenTimeModalVisible(true)}
      />
      <Modal
        visible={Boolean(previewImageUri)}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewImageUri(null)}
      >
        <View style={styles.imagePreviewBackdrop}>
          <Pressable
            style={styles.imagePreviewClose}
            onPress={() => setPreviewImageUri(null)}
          >
            <FontAwesome name="close" size={26} color="#FFFFFF" />
          </Pressable>
          {previewImageUri ? (
            <Image source={{ uri: previewImageUri }} style={styles.previewImage} />
          ) : null}
        </View>
      </Modal>
      <DoseTakenTimeModal
        visible={isTakenTimeModalVisible}
        takenTime={selectedDoseTakenTime}
        styles={styles}
        isSaving={isMarkingDoseAsTaken}
        onClose={() => setIsTakenTimeModalVisible(false)}
        onMarkAsTakenAtSelectedTime={() =>
          handleMarkSelectedDoseAsTaken(
            toLocalIsoWithTimezone(new Date(selectedDoseTakenTime)),
          )
        }
        showTakenDatePicker={showDoseTakenDatePicker}
        showTakenTimePicker={showDoseTakenTimePicker}
        onShowTakenDatePicker={() => setShowDoseTakenDatePicker(true)}
        onShowTakenTimePicker={() => setShowDoseTakenTimePicker(true)}
        onTakenDateChange={(event, selectedDate) => {
          setShowDoseTakenDatePicker(false);
          if (event.type !== "dismissed" && selectedDate) {
            setSelectedDoseTakenTime((current) =>
              mergeDatePart(current, selectedDate),
            );
          }
        }}
        onTakenTimeChange={(event, selectedDate) => {
          setShowDoseTakenTimePicker(false);
          if (event.type !== "dismissed" && selectedDate) {
            setSelectedDoseTakenTime((current) =>
              mergeTimePart(current, selectedDate),
            );
          }
        }}
      />
      <DosePlanModal
        visible={isDoseModalVisible}
        medications={medications}
        form={doseForm}
        styles={styles}
        isSaving={isSavingDosePlan}
        isCheckingLeafletDosage={isCheckingLeafletDosage}
        leafletDosageSuggestion={leafletDosageSuggestion}
        showStartDatePicker={showStartDatePicker}
        showStartTimePicker={showStartTimePicker}
        onClose={() => setIsDoseModalVisible(false)}
        onSave={() => saveDosePlan()}
        onCheckLeafletDosage={checkLeafletDosage}
        onChangeForm={(field, value) =>
          setDoseForm((current) => {
            if (field === "medicamento_id") {
              setLeafletDosageSuggestion(null);
            }

            return { ...current, [field]: value };
          })
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
  isCheckingLeafletDosage: boolean;
  leafletDosageSuggestion: LeafletDosageSuggestion | null;
  showStartDatePicker: boolean;
  showStartTimePicker: boolean;
  onClose: () => void;
  onSave: () => void;
  onCheckLeafletDosage: () => void;
  onChangeForm: (field: keyof DoseForm, value: string) => void;
  onShowDatePicker: () => void;
  onShowTimePicker: () => void;
  onDateChange: (event: DateTimePickerEvent, selectedDate?: Date) => void;
  onTimeChange: (event: DateTimePickerEvent, selectedDate?: Date) => void;
};

type DoseDetailsModalProps = {
  visible: boolean;
  dose: Dose | null;
  styles: ReturnType<typeof createStyles>;
  isSaving: boolean;
  onClose: () => void;
  onPreviewImage: (uri: string) => void;
  onMarkAsTakenNow: () => void;
  onOpenTakenTimeModal: () => void;
};

type DoseTakenTimeModalProps = {
  visible: boolean;
  takenTime: string;
  styles: ReturnType<typeof createStyles>;
  isSaving: boolean;
  onClose: () => void;
  onMarkAsTakenAtSelectedTime: () => void;
  showTakenDatePicker: boolean;
  showTakenTimePicker: boolean;
  onShowTakenDatePicker: () => void;
  onShowTakenTimePicker: () => void;
  onTakenDateChange: (event: DateTimePickerEvent, selectedDate?: Date) => void;
  onTakenTimeChange: (event: DateTimePickerEvent, selectedDate?: Date) => void;
};

function DoseDetailsModal({
  visible,
  dose,
  styles,
  isSaving,
  onClose,
  onPreviewImage,
  onMarkAsTakenNow,
  onOpenTakenTimeModal,
}: DoseDetailsModalProps) {
  const status = dose ? getDoseDisplayStatus(dose, new Date()) : "pendente";
  const statusLabel =
    status === "tomado"
      ? "Tomada"
      : status === "pendente"
        ? "Pendente"
        : "Atrasada";
  const scheduledDate = dose ? new Date(dose.horario_agendado) : null;
  const takenDate = dose?.horario_tomado ? new Date(dose.horario_tomado) : null;
  const canMarkAsTaken = dose?.status !== "tomado";
  const [isInfoExpanded, setIsInfoExpanded] = useState(false);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalPanel}>
          <Text style={styles.modalTitle}>Detalhes da dose</Text>
          <Text style={styles.modalHelp}>
            Confira a dose antes de registrar como tomada.
          </Text>

          <Pressable
            style={styles.doseImageFrame}
            onPress={() => {
              if (dose?.foto_uri) {
                onPreviewImage(dose.foto_uri);
              }
            }}
            disabled={!dose?.foto_uri}
            accessibilityLabel="Abrir imagem do medicamento"
          >
            {dose?.foto_uri ? (
              <Image
                source={{ uri: dose.foto_uri }}
                style={styles.doseImage}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.doseImageFallback}>
                <FontAwesome name="medkit" size={42} color="#FFFFFF" />
              </View>
            )}
          </Pressable>

          <View style={styles.doseInfoSection}>
            <Pressable
              style={styles.doseInfoHeader}
              onPress={() => setIsInfoExpanded((current) => !current)}
            >
              <Text style={styles.doseInfoTitle}>Informacoes da dose</Text>
              <FontAwesome
                name={isInfoExpanded ? "chevron-up" : "chevron-down"}
                size={18}
                color="#007AFF"
              />
            </Pressable>

            {isInfoExpanded ? (
              <View style={styles.doseInfoBulletList}>
                <DoseInfoBullet
                  styles={styles}
                  label="Medicamento"
                  value={dose?.nome_comercial || "Medicamento"}
                />
                <DoseInfoBullet
                  styles={styles}
                  label="Dosagem"
                  value={dose?.dosagem || "Dosagem nao informada"}
                />
                <DoseInfoBullet
                  styles={styles}
                  label="Data"
                  value={
                    scheduledDate && !Number.isNaN(scheduledDate.getTime())
                      ? scheduledDate.toLocaleDateString("pt-BR")
                      : "Data nao informada"
                  }
                />
                <DoseInfoBullet
                  styles={styles}
                  label="Horario"
                  value={
                    scheduledDate && !Number.isNaN(scheduledDate.getTime())
                      ? scheduledDate.toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "Horario nao informado"
                  }
                />
                <DoseInfoBullet
                  styles={styles}
                  label="Status"
                  value={statusLabel}
                />
                {takenDate && !Number.isNaN(takenDate.getTime()) ? (
                  <DoseInfoBullet
                    styles={styles}
                    label="Tomada em"
                    value={takenDate.toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  />
                ) : null}
              </View>
            ) : null}
          </View>

          {canMarkAsTaken ? (
            <Pressable
              style={[
                styles.fullWidthPrimaryButton,
                isSaving && styles.disabledButton,
              ]}
              onPress={onOpenTakenTimeModal}
              disabled={isSaving}
            >
              <Text style={styles.primaryButtonText}>
                Tomei em outro horario
              </Text>
            </Pressable>
          ) : null}

          <View style={styles.modalActions}>
            <Pressable style={styles.secondaryButton} onPress={onClose}>
              <Text style={styles.secondaryButtonText}>Fechar</Text>
            </Pressable>
            <Pressable
              style={[
                styles.primaryButton,
                !canMarkAsTaken && styles.disabledButton,
              ]}
              onPress={onMarkAsTakenNow}
              disabled={!canMarkAsTaken || isSaving}
            >
              {isSaving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {canMarkAsTaken ? "Tomei agora" : "Ja registrada"}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DoseTakenTimeModal({
  visible,
  takenTime,
  styles,
  isSaving,
  onClose,
  onMarkAsTakenAtSelectedTime,
  showTakenDatePicker,
  showTakenTimePicker,
  onShowTakenDatePicker,
  onShowTakenTimePicker,
  onTakenDateChange,
  onTakenTimeChange,
}: DoseTakenTimeModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalPanel}>
          <Text style={styles.modalTitle}>Quando voce tomou?</Text>
          <Text style={styles.modalHelp}>
            Selecione a data e o horario em que a dose foi tomada.
          </Text>

          <View style={styles.takenTimeBox}>
            <View style={styles.dateTimeRow}>
              <Pressable
                style={styles.dateInput}
                onPress={onShowTakenDatePicker}
              >
                <Text style={styles.dateInputText}>
                  {formatDateBr(takenTime)}
                </Text>
                <FontAwesome name="calendar" size={20} color="#007AFF" />
              </Pressable>
              <Pressable
                style={styles.timeInput}
                onPress={onShowTakenTimePicker}
              >
                <Text style={styles.dateInputText}>
                  {formatTimeBr(takenTime)}
                </Text>
                <FontAwesome name="clock-o" size={20} color="#007AFF" />
              </Pressable>
            </View>
            {showTakenDatePicker ? (
              <DateTimePicker
                value={new Date(takenTime)}
                mode="date"
                display="calendar"
                onChange={onTakenDateChange}
              />
            ) : null}
            {showTakenTimePicker ? (
              <DateTimePicker
                value={new Date(takenTime)}
                mode="time"
                display="default"
                is24Hour
                onChange={onTakenTimeChange}
              />
            ) : null}
          </View>

          <View style={styles.modalActions}>
            <Pressable style={styles.secondaryButton} onPress={onClose}>
              <Text style={styles.secondaryButtonText}>Voltar</Text>
            </Pressable>
            <Pressable
              style={styles.primaryButton}
              onPress={onMarkAsTakenAtSelectedTime}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>Confirmar</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DoseInfoBullet({
  styles,
  label,
  value,
}: {
  styles: ReturnType<typeof createStyles>;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.doseInfoBulletRow}>
      <Text style={styles.doseInfoBulletMark}>•</Text>
      <Text style={styles.doseInfoBulletText}>
        <Text style={styles.doseInfoBulletLabel}>{label}: </Text>
        {value}
      </Text>
    </View>
  );
}

function DosePlanModal({
  visible,
  medications,
  form,
  styles,
  isSaving,
  isCheckingLeafletDosage,
  leafletDosageSuggestion,
  showStartDatePicker,
  showStartTimePicker,
  onClose,
  onSave,
  onCheckLeafletDosage,
  onChangeForm,
  onShowDatePicker,
  onShowTimePicker,
  onDateChange,
  onTimeChange,
}: DosePlanModalProps) {
  const [isMedicationSelectOpen, setIsMedicationSelectOpen] = useState(false);
  const [expandedLeafletSections, setExpandedLeafletSections] = useState<
    Record<string, boolean>
  >({});
  const selectedMedication = medications.find(
    (medication) => medication.id === form.medicamento_id,
  );

  React.useEffect(() => {
    if (!visible) {
      setIsMedicationSelectOpen(false);
    }
  }, [visible]);

  React.useEffect(() => {
    if (!leafletDosageSuggestion) {
      setExpandedLeafletSections({});
      return;
    }

    const hasSafetyAlerts =
      leafletDosageSuggestion.alertas_seguranca.length > 0;

    setExpandedLeafletSections({
      safety: hasSafetyAlerts,
      summary: false,
      recommended: false,
      dosage: false,
    });
  }, [leafletDosageSuggestion]);

  const toggleLeafletSection = (sectionId: string) => {
    setExpandedLeafletSections((currentSections) => ({
      ...currentSections,
      [sectionId]: !currentSections[sectionId],
    }));
  };

  return (
    <>
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalPanel}>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            <Text style={styles.modalTitle}>Cadastrar doses</Text>

          <View style={styles.medicationSelectWrapper}>
            <Text style={styles.fieldLabel}>Medicamento</Text>
            <Pressable
              style={styles.medicationSelect}
              onPress={() => setIsMedicationSelectOpen(true)}
            >
              <View style={styles.medicationSelectTextGroup}>
                <Text style={styles.medicationSelectTitle}>
                  {selectedMedication?.nome_comercial ||
                    "Selecione um medicamento"}
                </Text>
                <Text style={styles.medicationSelectSubtitle}>
                  {selectedMedication?.dosagem || "Dosagem nao informada"}
                </Text>
              </View>
              <FontAwesome
                name={isMedicationSelectOpen ? "chevron-up" : "chevron-down"}
                size={18}
                color="#007AFF"
              />
            </Pressable>
          </View>

          <Pressable
            style={styles.leafletSearchButton}
            onPress={onCheckLeafletDosage}
            disabled={isCheckingLeafletDosage || !form.medicamento_id}
          >
            {isCheckingLeafletDosage ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <FontAwesome name="book" size={18} color="#FFFFFF" />
                <Text style={styles.leafletSearchButtonText}>
                  Ver posologia na bula salva
                </Text>
              </>
            )}
          </Pressable>

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

          {leafletDosageSuggestion ? (
            <View style={styles.leafletSuggestionBox}>
              <Text style={styles.leafletSuggestionTitle}>
                Consulta da bula salva
              </Text>
              {leafletDosageSuggestion.alertas_seguranca.length > 0 ? (
                <CollapsibleLeafletDoseSection
                  title="Atencao: possivel risco identificado"
                  expanded={Boolean(expandedLeafletSections.safety)}
                  onToggle={() => toggleLeafletSection("safety")}
                  styles={styles}
                  tone="danger"
                >
                  {leafletDosageSuggestion.alertas_seguranca.map((alert) => (
                    <SafetyAlertItem
                      key={`${alert.titulo}-${alert.dado_usuario_relacionado}`}
                      alert={alert}
                      styles={styles}
                    />
                  ))}
                </CollapsibleLeafletDoseSection>
              ) : null}
              <CollapsibleLeafletDoseSection
                title="Resumo da consulta"
                expanded={Boolean(expandedLeafletSections.summary)}
                onToggle={() => toggleLeafletSection("summary")}
                styles={styles}
              >
                <Text style={styles.leafletSuggestionText}>
                  {leafletDosageSuggestion.observacoes}
                </Text>
              </CollapsibleLeafletDoseSection>
              {leafletDosageSuggestion.trechos_recomendados.length > 0 ? (
                <CollapsibleLeafletDoseSection
                  title="Trechos mais relevantes para o usuario"
                  expanded={Boolean(expandedLeafletSections.recommended)}
                  onToggle={() => toggleLeafletSection("recommended")}
                  styles={styles}
                >
                  {leafletDosageSuggestion.trechos_recomendados
                    .slice(0, 3)
                    .map((chunk) => (
                      <View key={chunk.id} style={styles.leafletChunkBox}>
                        <Text style={styles.leafletChunkTitle}>
                          {chunk.secao}
                        </Text>
                        <Text style={styles.leafletChunkText}>
                          {chunk.texto}
                        </Text>
                      </View>
                    ))}
                </CollapsibleLeafletDoseSection>
              ) : null}
              <CollapsibleLeafletDoseSection
                title="Trechos consultados"
                expanded={Boolean(expandedLeafletSections.dosage)}
                onToggle={() => toggleLeafletSection("dosage")}
                styles={styles}
              >
                {leafletDosageSuggestion.trechos.slice(0, 2).map((chunk) => (
                  <View key={chunk.id} style={styles.leafletChunkBox}>
                    <Text style={styles.leafletChunkTitle}>{chunk.secao}</Text>
                    <Text style={styles.leafletChunkText}>{chunk.texto}</Text>
                  </View>
                ))}
              </CollapsibleLeafletDoseSection>
              <Text style={styles.leafletSourceText}>
                Fonte:{" "}
                <Text
                  style={styles.leafletSourceLink}
                  onPress={() =>
                    leafletDosageSuggestion.fonte_url &&
                    Linking.openURL(leafletDosageSuggestion.fonte_url).catch(
                      () => Alert.alert("Não foi possível abrir a fonte"),
                    )
                  }
                >
                  {leafletDosageSuggestion.fonte_nome}
                </Text>
              </Text>
            </View>
          ) : null}

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
          </ScrollView>
        </View>
      </View>
    </Modal>
    <Modal
      visible={visible && isMedicationSelectOpen}
      transparent
      animationType="fade"
      onRequestClose={() => setIsMedicationSelectOpen(false)}
    >
      <View style={styles.selectModalBackdrop}>
        <Pressable
          style={styles.selectModalDismissArea}
          onPress={() => setIsMedicationSelectOpen(false)}
        />
        <View style={styles.selectModalPanel}>
          <View style={styles.selectModalHeader}>
            <Text style={styles.selectModalTitle}>Selecionar medicamento</Text>
            <Pressable
              style={styles.selectModalCloseButton}
              onPress={() => setIsMedicationSelectOpen(false)}
            >
              <FontAwesome name="times" size={20} color="#007AFF" />
            </Pressable>
          </View>
          <ScrollView
            style={styles.selectModalOptionsScroll}
            contentContainerStyle={styles.selectModalOptions}
            keyboardShouldPersistTaps="handled"
          >
            {medications.map((medication) => {
              const isSelected = form.medicamento_id === medication.id;

              return (
                <Pressable
                  key={medication.id}
                  style={[
                    styles.medicationOption,
                    isSelected && styles.medicationOptionActive,
                  ]}
                  onPress={() => {
                    onChangeForm("medicamento_id", medication.id);
                    setIsMedicationSelectOpen(false);
                  }}
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
          </ScrollView>
        </View>
      </View>
    </Modal>
    </>
  );
}

function CollapsibleLeafletDoseSection({
  title,
  expanded,
  onToggle,
  styles,
  children,
  tone = "default",
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  styles: ReturnType<typeof createStyles>;
  children: React.ReactNode;
  tone?: "default" | "danger";
}) {
  const isDanger = tone === "danger";

  return (
    <View
      style={[
        styles.leafletCollapsibleSection,
        isDanger && styles.leafletCollapsibleSectionDanger,
      ]}
    >
      <Pressable
        style={[
          styles.leafletCollapsibleHeader,
          isDanger && styles.leafletCollapsibleHeaderDanger,
        ]}
        onPress={onToggle}
      >
        <Text
          style={[
            styles.leafletCollapsibleTitle,
            isDanger && styles.leafletCollapsibleTitleDanger,
          ]}
        >
          {title}
        </Text>
        <FontAwesome
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={isDanger ? "#991B1B" : "#0F766E"}
        />
      </Pressable>
      {expanded ? (
        <View
          style={[
            styles.leafletCollapsibleBody,
            isDanger && styles.leafletCollapsibleBodyDanger,
          ]}
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}

function SafetyAlertItem({
  alert,
  styles,
}: {
  alert: MedicationLeafletSafetyAlert;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.safetyAlertItem}>
      <Text style={styles.safetyAlertItemTitle}>{alert.titulo}</Text>
      <Text style={styles.safetyAlertText}>{alert.motivo}</Text>
      <Text style={styles.safetyAlertText}>
        {alert.dado_usuario_relacionado}
      </Text>
      <Text style={styles.safetyAlertQuote}>{alert.trecho_bula}</Text>
    </View>
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
    },
    contentContainer: {
      backgroundColor: colors.background,
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
      color: colors.textMuted,
    },
    headerSection: {
      marginBottom: 20,
    },
    sectionLabel: {
      fontSize: scaleFont(18),
      color: colors.textMuted,
      marginBottom: 4,
      fontWeight: "600",
    },
    pageTitle: {
      fontSize: scaleFont(32),
      fontWeight: "bold",
      color: colors.text,
      marginBottom: 8,
    },
    subtitle: {
      fontSize: scaleFont(18),
      color: colors.textMuted,
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
      backgroundColor: colors.surface,
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
      color: colors.text,
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
      color: colors.text,
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
      color: colors.textMuted,
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
      color: colors.text,
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
      color: colors.text,
      textAlign: "center",
    },
    emptyText: {
      marginTop: 8,
      fontSize: scaleFont(17),
      lineHeight: 24,
      color: colors.textMuted,
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
      backgroundColor: colors.surface,
    },
    modalScroll: {
      flexGrow: 0,
    },
    modalScrollContent: {
      paddingBottom: 4,
    },
    modalTitle: {
      fontSize: scaleFont(24),
      fontWeight: "800",
      color: colors.text,
      marginBottom: 8,
    },
    modalHelp: {
      fontSize: scaleFont(16),
      lineHeight: 23,
      color: colors.textMuted,
      marginBottom: 14,
    },
    imagePreviewBackdrop: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 16,
      backgroundColor: "#000000E6",
    },
    imagePreviewClose: {
      position: "absolute",
      top: 50,
      right: 18,
      zIndex: 1,
      width: 46,
      height: 46,
      borderRadius: 23,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#00000099",
    },
    previewImage: {
      width: "100%",
      height: "78%",
      resizeMode: "contain",
    },
    doseImageFrame: {
      height: 170,
      marginBottom: 14,
      borderRadius: 8,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
    },
    doseImage: {
      width: "100%",
      height: "100%",
    },
    doseImageFallback: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#2563EB",
    },
    doseInfoSection: {
      marginBottom: 14,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
      backgroundColor: colors.surface,
    },
    doseInfoHeader: {
      minHeight: 54,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      backgroundColor: colors.surface,
    },
    doseInfoTitle: {
      flex: 1,
      fontSize: scaleFont(18),
      lineHeight: 24,
      fontWeight: "900",
      color: colors.text,
    },
    doseInfoBulletList: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingHorizontal: 14,
      paddingTop: 12,
      paddingBottom: 4,
      backgroundColor: colors.surfaceMuted,
    },
    doseInfoBulletRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      marginBottom: 10,
    },
    doseInfoBulletMark: {
      width: 14,
      fontSize: scaleFont(18),
      lineHeight: 24,
      fontWeight: "900",
      color: colors.primary,
    },
    doseInfoBulletText: {
      flex: 1,
      fontSize: scaleFont(16),
      lineHeight: 24,
      color: colors.textMuted,
    },
    doseInfoBulletLabel: {
      fontWeight: "900",
      color: colors.text,
    },
    takenTimeBox: {
      marginTop: 14,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      backgroundColor: colors.surface,
    },
    field: {
      marginTop: 12,
    },
    fieldLabel: {
      fontSize: scaleFont(16),
      fontWeight: "700",
      color: colors.text,
      marginBottom: 6,
    },
    input: {
      minHeight: 52,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      fontSize: scaleFont(17),
      color: colors.text,
      backgroundColor: colors.surface,
    },
    medicationSelectWrapper: {
      position: "relative",
      zIndex: 20,
      elevation: 20,
      marginBottom: 4,
    },
    medicationSelect: {
      minHeight: 58,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      backgroundColor: colors.surface,
    },
    medicationSelectTextGroup: {
      flex: 1,
    },
    medicationSelectTitle: {
      fontSize: scaleFont(17),
      fontWeight: "800",
      color: colors.text,
    },
    medicationSelectSubtitle: {
      marginTop: 3,
      fontSize: scaleFont(15),
      color: colors.textMuted,
    },
    selectModalBackdrop: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: "rgba(15, 23, 42, 0.48)",
    },
    selectModalDismissArea: {
      flex: 1,
    },
    selectModalPanel: {
      maxHeight: "72%",
      borderTopLeftRadius: 8,
      borderTopRightRadius: 8,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 18,
      backgroundColor: colors.background,
    },
    selectModalHeader: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 8,
    },
    selectModalTitle: {
      flex: 1,
      fontSize: scaleFont(19),
      fontWeight: "900",
      color: colors.text,
    },
    selectModalCloseButton: {
      width: 44,
      height: 44,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    selectModalOptionsScroll: {
      maxHeight: 420,
    },
    selectModalOptions: {
      gap: 8,
      paddingBottom: 8,
    },
    medicationOption: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      padding: 12,
      backgroundColor: colors.surface,
    },
    medicationOptionActive: {
      borderColor: "#007AFF",
      backgroundColor: "#EFF6FF",
    },
    medicationOptionTitle: {
      fontSize: scaleFont(17),
      fontWeight: "800",
      color: colors.text,
    },
    medicationOptionTitleActive: {
      color: "#1D4ED8",
    },
    medicationOptionSubtitle: {
      marginTop: 3,
      fontSize: scaleFont(15),
      color: colors.textMuted,
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
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.surface,
    },
    timeInput: {
      flex: 1,
      minHeight: 52,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.surface,
    },
    dateInputText: {
      fontSize: scaleFont(17),
      fontWeight: "700",
      color: colors.text,
    },
    warningText: {
      marginTop: 14,
      fontSize: scaleFont(15),
      lineHeight: 22,
      color: "#92400E",
    },
    leafletSearchButton: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      marginTop: 12,
      borderRadius: 8,
      paddingHorizontal: 14,
      backgroundColor: "#0F766E",
    },
    leafletSearchButtonText: {
      flexShrink: 1,
      fontSize: scaleFont(16),
      fontWeight: "800",
      color: "#FFFFFF",
      textAlign: "center",
    },
    leafletSuggestionBox: {
      marginTop: 14,
      borderRadius: 8,
      padding: 12,
      backgroundColor: "#ECFDF5",
      borderWidth: 1,
      borderColor: "#A7F3D0",
    },
    leafletSuggestionTitle: {
      fontSize: scaleFont(17),
      fontWeight: "800",
      color: "#065F46",
      marginBottom: 6,
    },
    leafletSuggestionText: {
      fontSize: scaleFont(15),
      lineHeight: 22,
      color: "#064E3B",
    },
    leafletCollapsibleSection: {
      marginTop: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: "#A7F3D0",
      overflow: "hidden",
      backgroundColor: colors.surface,
    },
    leafletCollapsibleSectionDanger: {
      borderColor: "#FCA5A5",
      backgroundColor: "#FEF2F2",
    },
    leafletCollapsibleHeader: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.surface,
    },
    leafletCollapsibleHeaderDanger: {
      backgroundColor: "#FEF2F2",
    },
    leafletCollapsibleTitle: {
      flex: 1,
      fontSize: scaleFont(15),
      fontWeight: "900",
      color: "#0F766E",
    },
    leafletCollapsibleTitleDanger: {
      color: "#991B1B",
    },
    leafletCollapsibleBody: {
      borderTopWidth: 1,
      borderTopColor: "#CCFBF1",
      padding: 12,
      backgroundColor: colors.surface,
    },
    leafletCollapsibleBodyDanger: {
      borderTopColor: "#FECACA",
      backgroundColor: "#FEF2F2",
    },
    safetyAlertBox: {
      marginTop: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: "#FCA5A5",
      padding: 12,
      backgroundColor: "#FEF2F2",
    },
    safetyAlertTitle: {
      fontSize: scaleFont(17),
      fontWeight: "900",
      color: "#991B1B",
      marginBottom: 8,
    },
    safetyAlertItem: {
      borderTopWidth: 1,
      borderTopColor: "#FECACA",
      paddingTop: 8,
      marginTop: 8,
    },
    safetyAlertItemTitle: {
      fontSize: scaleFont(15),
      fontWeight: "900",
      color: "#7F1D1D",
      marginBottom: 4,
    },
    safetyAlertText: {
      fontSize: scaleFont(14),
      lineHeight: 20,
      color: "#991B1B",
    },
    safetyAlertQuote: {
      marginTop: 6,
      fontSize: scaleFont(13),
      lineHeight: 19,
      color: "#7F1D1D",
      fontStyle: "italic",
    },
    recommendedChunksBox: {
      marginTop: 12,
    },
    recommendedChunksTitle: {
      fontSize: scaleFont(16),
      fontWeight: "900",
      color: "#065F46",
    },
    leafletSourceLink: {
      color: "#0F76EF",
      textDecorationLine: "underline",
    },
    leafletChunkBox: {
      marginTop: 10,
      borderRadius: 8,
      padding: 10,
      backgroundColor: colors.surface,
    },
    leafletChunkTitle: {
      fontSize: scaleFont(15),
      fontWeight: "800",
      color: "#0F766E",
      marginBottom: 4,
    },
    leafletChunkText: {
      fontSize: scaleFont(14),
      lineHeight: 20,
      color: colors.text,
    },
    leafletSourceText: {
      marginTop: 10,
      fontSize: scaleFont(13),
      lineHeight: 18,
      color: "#047857",
      fontWeight: "700",
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
    disabledButton: {
      opacity: 0.55,
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
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    secondaryButtonText: {
      fontSize: scaleFont(17),
      fontWeight: "700",
      color: colors.text,
    },
    fullWidthPrimaryButton: {
      minHeight: 52,
      marginTop: 10,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#007AFF",
    },
  });
