import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import Slider from "@react-native-community/slider";
import { File, Paths } from "expo-file-system";
import { useFocusEffect } from "expo-router";
import * as Sharing from "expo-sharing";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAccessibilitySettings } from "../../services/accessibilitySettings";
import {
  DoseHistoryWithMedication,
  getUserProfile,
  listAllDoseHistory,
  saveUserProfile,
  UserProfile,
} from "../../services/database";
import { userFriendlyErrorMessage } from "../../services/errorMessages";

type SettingsForm = {
  nome: string;
  data_nascimento: string;
  peso_kg: string;
  altura_cm: string;
  sexo: UserProfile["sexo"];
  gestante: boolean;
  lactante: boolean;
  alergias: string;
  condicoes_saude: string;
  usa_outros_medicamentos: string;
  observacoes_clinicas: string;
  tamanho_fonte: string;
  modo_contraste: boolean;
  tema_escuro: boolean;
  velocidade_leitura: string;
};

const sexoOptions: UserProfile["sexo"][] = [
  "nao_informado",
  "masculino",
  "feminino",
  "outro",
];

const sexoLabels: Record<UserProfile["sexo"], string> = {
  nao_informado: "Nao informado",
  masculino: "Masculino",
  feminino: "Feminino",
  outro: "Outro",
};

const profileToForm = (profile: UserProfile): SettingsForm => ({
  nome: profile.nome,
  data_nascimento: profile.data_nascimento || "",
  peso_kg: profile.peso_kg ? String(profile.peso_kg) : "",
  altura_cm: profile.altura_cm ? String(profile.altura_cm) : "",
  sexo: profile.sexo,
  gestante: profile.sexo === "masculino" ? false : Boolean(profile.gestante),
  lactante: profile.sexo === "masculino" ? false : Boolean(profile.lactante),
  alergias: profile.alergias || "",
  condicoes_saude: profile.condicoes_saude || "",
  usa_outros_medicamentos: profile.usa_outros_medicamentos || "",
  observacoes_clinicas: profile.observacoes_clinicas || "",
  tamanho_fonte: String(profile.tamanho_fonte ?? 2),
  modo_contraste: Boolean(profile.modo_contraste),
  tema_escuro: Boolean(profile.tema_escuro),
  velocidade_leitura: String(profile.velocidade_leitura ?? 1),
});

const parseNumber = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};

const parseInteger = (value: string, fallback: number) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const formatDateBr = (isoDate: string) => {
  if (!isoDate) {
    return "";
  }

  const [year, month, day] = isoDate.split("-");
  return year && month && day ? `${day}/${month}/${year}` : "";
};

const dateFromIsoDate = (isoDate: string) => {
  if (!isoDate) {
    return new Date();
  }

  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
};

const toIsoDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const csvEscape = (value: unknown) => {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

const formatCsvDateTime = (value: string | null) => {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const buildDoseHistoryCsv = (
  doses: DoseHistoryWithMedication[],
  userName: string,
) => {
  const metadataRows = [
    ["usuario", userName || "Usuario MedAssist"],
    ["exportado_em", formatCsvDateTime(new Date().toISOString())],
    [],
  ];
  const headers = [
    "medicamento",
    "dosagem",
    "status",
    "horario_agendado",
    "horario_tomado",
    "observacao",
  ];
  const rows = doses.map((dose) => [
    dose.nome_comercial,
    dose.dosagem || "",
    dose.status === "tomado" ? "Tomada" : "Atrasada/nao registrada",
    formatCsvDateTime(dose.horario_agendado),
    formatCsvDateTime(dose.horario_tomado),
    dose.status === "tomado"
      ? "Dose registrada como tomada."
      : "Dose passada sem registro de tomada.",
  ]);

  return [...metadataRows, headers, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
};

export default function SettingsScreen() {
  const [userId, setUserId] = useState("user-001");
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isExportingDoseHistory, setIsExportingDoseHistory] = useState(false);
  const [showBirthDatePicker, setShowBirthDatePicker] = useState(false);
  const { refreshSettings, scaleFont, colors } = useAccessibilitySettings();
  const styles = useMemo(() => createStyles(scaleFont, colors), [scaleFont, colors]);

  const loadProfile = useCallback(async () => {
    try {
      setIsLoading(true);
      const profile = await getUserProfile();
      setUserId(profile.id);
      setForm(profileToForm(profile));
    } catch (error: any) {
      Alert.alert(
        "Nao foi possivel carregar",
        userFriendlyErrorMessage(
          error,
          "Tente abrir as configuracoes novamente.",
        ),
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile]),
  );

  const updateForm = <K extends keyof SettingsForm>(
    field: K,
    value: SettingsForm[K],
  ) => {
    setForm((current) =>
      current
        ? field === "sexo" && value === "masculino"
          ? {
              ...current,
              sexo: value as UserProfile["sexo"],
              gestante: false,
              lactante: false,
            }
          : {
              ...current,
              [field]: value,
            }
        : current,
    );
  };

  const handleSave = async () => {
    if (!form) {
      return;
    }

    if (!form.nome.trim()) {
      Alert.alert("Nome obrigatorio", "Informe o nome do usuario.");
      return;
    }

    const pesoKg = parseNumber(form.peso_kg);
    const alturaCm = parseNumber(form.altura_cm);
    const velocidadeLeitura = clamp(
      parseNumber(form.velocidade_leitura) || 1,
      0.1,
      2,
    );
    const tamanhoFonte = clamp(parseInteger(form.tamanho_fonte, 2), 1, 3);

    try {
      setIsSaving(true);
      await saveUserProfile({
        id: userId,
        nome: form.nome,
        data_nascimento: form.data_nascimento || null,
        peso_kg: pesoKg,
        altura_cm: alturaCm,
        sexo: form.sexo,
        gestante: form.sexo === "masculino" ? 0 : form.gestante ? 1 : 0,
        lactante: form.sexo === "masculino" ? 0 : form.lactante ? 1 : 0,
        alergias: form.alergias || null,
        condicoes_saude: form.condicoes_saude || null,
        usa_outros_medicamentos: form.usa_outros_medicamentos || null,
        observacoes_clinicas: form.observacoes_clinicas || null,
        tamanho_fonte: tamanhoFonte,
        modo_contraste: form.modo_contraste ? 1 : 0,
        tema_escuro: form.tema_escuro ? 1 : 0,
        velocidade_leitura: velocidadeLeitura,
      });
      await refreshSettings();
      Alert.alert("Configuracoes salvas", "Dados do usuario atualizados.");
      await loadProfile();
    } catch (error: any) {
      Alert.alert(
        "Nao foi possivel salvar",
        error.message || "Tente novamente em instantes.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const exportDoseHistoryCsv = async () => {
    try {
      setIsExportingDoseHistory(true);
      const now = new Date();
      const doses = (await listAllDoseHistory(userId)).filter((dose) => {
        const scheduledDate = new Date(dose.horario_agendado);

        return (
          dose.status === "tomado" ||
          (!Number.isNaN(scheduledDate.getTime()) && scheduledDate < now)
        );
      });

      if (doses.length === 0) {
        Alert.alert(
          "Sem historico",
          "Ainda nao ha doses tomadas ou atrasadas para exportar.",
        );
        return;
      }

      const csv = buildDoseHistoryCsv(doses, form?.nome || "");
      const file = new File(Paths.cache, "historico_doses_medassist.csv");

      file.create({ overwrite: true });
      file.write(csv);

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert(
          "Compartilhamento indisponivel",
          "Nao foi possivel abrir o compartilhamento neste dispositivo.",
        );
        return;
      }

      await Sharing.shareAsync(file.uri, {
        mimeType: "text/csv",
        dialogTitle: "Exportar historico de doses",
        UTI: "public.comma-separated-values-text",
      });
    } catch (error) {
      Alert.alert(
        "Nao foi possivel exportar",
        userFriendlyErrorMessage(error, "Tente exportar novamente."),
      );
    } finally {
      setIsExportingDoseHistory(false);
    }
  };

  if (isLoading || !form) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Carregando configuracoes</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <MaterialCommunityIcons name="account-cog" size={34} color="#007AFF" />
        <View style={styles.headerTextGroup}>
          <Text style={styles.screenTitle}>Configuracoes</Text>
          <Text style={styles.subtitle}>
            Dados usados para acessibilidade e alertas de cuidado.
          </Text>
        </View>
      </View>

      <SectionTitle title="Perfil" />
      <FormField
        label="Nome"
        value={form.nome}
        onChangeText={(value) => updateForm("nome", value)}
      />
      <DateField
        label="Data de nascimento"
        value={form.data_nascimento}
        onPress={() => setShowBirthDatePicker(true)}
      />
      {showBirthDatePicker ? (
        <DateTimePicker
          value={dateFromIsoDate(form.data_nascimento)}
          mode="date"
          display="calendar"
          onChange={(event: DateTimePickerEvent, selectedDate?: Date) => {
            setShowBirthDatePicker(false);
            if (event.type !== "dismissed" && selectedDate) {
              updateForm("data_nascimento", toIsoDate(selectedDate));
            }
          }}
        />
      ) : null}
      <View style={styles.twoColumns}>
        <FormField
          label="Peso (kg)"
          value={form.peso_kg}
          onChangeText={(value) => updateForm("peso_kg", value)}
          keyboardType="numeric"
        />
        <FormField
          label="Altura (cm)"
          value={form.altura_cm}
          onChangeText={(value) => updateForm("altura_cm", value)}
          keyboardType="numeric"
        />
      </View>

      <Text style={styles.fieldLabel}>Sexo</Text>
      <View style={styles.segmentGroup}>
        {sexoOptions.map((sexo) => (
          <Pressable
            key={sexo}
            style={[styles.segment, form.sexo === sexo && styles.segmentActive]}
            onPress={() => updateForm("sexo", sexo)}
          >
            <Text
              style={[
                styles.segmentText,
                form.sexo === sexo && styles.segmentTextActive,
              ]}
            >
              {sexoLabels[sexo]}
            </Text>
          </Pressable>
        ))}
      </View>

      <SectionTitle title="Cuidados" />
      {form.sexo !== "masculino" ? (
        <>
          <SwitchRow
            label="Gestante"
            value={form.gestante}
            onValueChange={(value) => updateForm("gestante", value)}
          />
          <SwitchRow
            label="Lactante"
            value={form.lactante}
            onValueChange={(value) => updateForm("lactante", value)}
          />
        </>
      ) : null}
      <FormField
        label="Alergias"
        value={form.alergias}
        onChangeText={(value) => updateForm("alergias", value)}
        multiline
      />
      <FormField
        label="Condicoes de saude"
        value={form.condicoes_saude}
        onChangeText={(value) => updateForm("condicoes_saude", value)}
        multiline
      />
      <FormField
        label="Outros medicamentos em uso"
        value={form.usa_outros_medicamentos}
        onChangeText={(value) => updateForm("usa_outros_medicamentos", value)}
        multiline
      />
      <FormField
        label="Observacoes clinicas"
        value={form.observacoes_clinicas}
        onChangeText={(value) => updateForm("observacoes_clinicas", value)}
        multiline
      />

      <SectionTitle title="Acessibilidade" />
      <DiscreteSlider
        label="Tamanho da fonte"
        value={parseInteger(form.tamanho_fonte, 2)}
        options={[
          { label: "Pequeno", value: 1 },
          { label: "Medio", value: 2 },
          { label: "Grande", value: 3 },
        ]}
        onChange={(value) => updateForm("tamanho_fonte", String(value))}
      />
      <ContinuousSlider
        label="Velocidade de leitura"
        value={clamp(parseNumber(form.velocidade_leitura) || 1, 0.1, 2)}
        min={0.1}
        max={2}
        step={0.1}
        onChange={(value) => updateForm("velocidade_leitura", value.toFixed(1))}
      />
      <SwitchRow
        label="Tema escuro"
        value={form.tema_escuro}
        onValueChange={(value) => updateForm("tema_escuro", value)}
      />

      <SectionTitle title="Dados" />
      <Pressable
        style={styles.exportButton}
        onPress={exportDoseHistoryCsv}
        disabled={isExportingDoseHistory}
      >
        {isExportingDoseHistory ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <>
            <MaterialCommunityIcons
              name="file-delimited-outline"
              size={22}
              color="#FFFFFF"
            />
            <Text style={styles.exportButtonText}>
              Exportar historico de doses CSV
            </Text>
          </>
        )}
      </Pressable>

      <Pressable
        style={styles.saveButton}
        onPress={handleSave}
        disabled={isSaving}
      >
        {isSaving ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.saveButtonText}>Salvar configuracoes</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

type FormFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric";
  multiline?: boolean;
};

type DateFieldProps = {
  label: string;
  value: string;
  onPress: () => void;
};

function DateField({ label, value, onPress }: DateFieldProps) {
  const { scaleFont, colors } = useAccessibilitySettings();
  const styles = useMemo(() => createStyles(scaleFont, colors), [scaleFont, colors]);

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable style={styles.dateInput} onPress={onPress}>
        <Text style={[styles.dateInputText, !value && styles.placeholderText]}>
          {value ? formatDateBr(value) : "dd/mm/aaaa"}
        </Text>
        <MaterialCommunityIcons name="calendar" size={22} color="#007AFF" />
      </Pressable>
    </View>
  );
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = "default",
  multiline = false,
}: FormFieldProps) {
  const { scaleFont, colors } = useAccessibilitySettings();
  const styles = useMemo(() => createStyles(scaleFont, colors), [scaleFont, colors]);

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.multilineInput]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        placeholderTextColor={colors.textMuted}
      />
    </View>
  );
}

function SectionTitle({ title }: { title: string }) {
  const { scaleFont, colors } = useAccessibilitySettings();
  const styles = useMemo(() => createStyles(scaleFont, colors), [scaleFont, colors]);

  return <Text style={styles.sectionTitle}>{title}</Text>;
}

type DiscreteSliderProps = {
  label: string;
  value: number;
  options: Array<{ label: string; value: number }>;
  onChange: (value: number) => void;
};

function DiscreteSlider({
  label,
  value,
  options,
  onChange,
}: DiscreteSliderProps) {
  const { scaleFont, colors } = useAccessibilitySettings();
  const styles = useMemo(() => createStyles(scaleFont, colors), [scaleFont, colors]);
  const currentIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  return (
    <View style={styles.sliderGroup}>
      <View style={styles.sliderHeader}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.sliderValue}>{options[currentIndex]?.label}</Text>
      </View>
      <Slider
        value={currentIndex}
        minimumValue={0}
        maximumValue={options.length - 1}
        step={1}
        minimumTrackTintColor={colors.primary}
        maximumTrackTintColor={colors.border}
        thumbTintColor={colors.primary}
        onValueChange={(sliderValue) => {
          const nextOption = options[Math.round(sliderValue)];
          if (nextOption) {
            onChange(nextOption.value);
          }
        }}
      />
      <View style={styles.sliderOptions}>
        {options.map((option) => (
          <Pressable
            key={option.value}
            style={styles.sliderOption}
            onPress={() => onChange(option.value)}
          >
            <Text
              style={[
                styles.sliderOptionText,
                option.value === value && styles.sliderOptionTextActive,
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

type ContinuousSliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
};

function ContinuousSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: ContinuousSliderProps) {
  const { scaleFont, colors } = useAccessibilitySettings();
  const styles = useMemo(() => createStyles(scaleFont, colors), [scaleFont, colors]);

  return (
    <View style={styles.sliderGroup}>
      <View style={styles.sliderHeader}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.sliderValue}>{value.toFixed(1)}x</Text>
      </View>
      <Slider
        value={value}
        minimumValue={min}
        maximumValue={max}
        step={step}
        minimumTrackTintColor={colors.primary}
        maximumTrackTintColor={colors.border}
        thumbTintColor={colors.primary}
        onValueChange={(sliderValue) =>
          onChange(Number(clamp(sliderValue, min, max).toFixed(1)))
        }
      />
      <View style={styles.sliderExtremes}>
        <Text style={styles.sliderOptionText}>0.1x</Text>
        <Text style={styles.sliderOptionText}>2.0x</Text>
      </View>
    </View>
  );
}

type SwitchRowProps = {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
};

function SwitchRow({ label, value, onValueChange }: SwitchRowProps) {
  const { scaleFont, colors } = useAccessibilitySettings();
  const styles = useMemo(() => createStyles(scaleFont, colors), [scaleFont, colors]);

  return (
    <View style={styles.switchRow}>
      <Text style={styles.switchLabel}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} />
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
    content: {
      padding: 16,
      paddingTop: 50,
      paddingBottom: 34,
    },
    loadingContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.background,
    },
    loadingText: {
      marginTop: 12,
      fontSize: scaleFont(16),
      color: colors.textMuted,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 22,
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
      marginTop: 4,
      fontSize: scaleFont(16),
      lineHeight: 23,
      color: colors.textMuted,
    },
    sectionTitle: {
      marginTop: 18,
      marginBottom: 6,
      fontSize: scaleFont(20),
      fontWeight: "800",
      color: colors.text,
    },
    field: {
      flex: 1,
      marginTop: 12,
    },
    fieldLabel: {
      fontSize: scaleFont(16),
      fontWeight: "700",
      color: colors.text,
      marginBottom: 6,
    },
    input: {
      minHeight: 54,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 14,
      fontSize: scaleFont(17),
      color: colors.text,
      backgroundColor: colors.surface,
    },
    dateInput: {
      minHeight: 54,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.surface,
    },
    dateInputText: {
      fontSize: scaleFont(17),
      color: colors.text,
    },
    placeholderText: {
      color: colors.textMuted,
    },
    multilineInput: {
      minHeight: 92,
      paddingTop: 12,
    },
    twoColumns: {
      flexDirection: "row",
      gap: 12,
    },
    segmentGroup: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 4,
    },
    segment: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      justifyContent: "center",
      paddingHorizontal: 12,
    },
    segmentActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primary,
    },
    segmentText: {
      fontSize: scaleFont(15),
      fontWeight: "700",
      color: colors.textMuted,
    },
    segmentTextActive: {
      color: "#FFFFFF",
    },
    switchRow: {
      minHeight: 58,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 10,
      paddingHorizontal: 14,
      borderRadius: 8,
      backgroundColor: colors.surfaceMuted,
    },
    sliderGroup: {
      marginTop: 14,
      padding: 14,
      borderRadius: 8,
      backgroundColor: colors.surfaceMuted,
    },
    sliderHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    sliderValue: {
      fontSize: scaleFont(16),
      fontWeight: "800",
      color: colors.primary,
    },
    sliderOptions: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 8,
    },
    sliderOption: {
      minHeight: 34,
      justifyContent: "center",
    },
    sliderOptionText: {
      fontSize: scaleFont(14),
      fontWeight: "700",
      color: colors.textMuted,
    },
    sliderOptionTextActive: {
      color: colors.primary,
    },
    sliderExtremes: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 4,
    },
    switchLabel: {
      fontSize: scaleFont(17),
      fontWeight: "700",
      color: colors.text,
    },
    exportButton: {
      minHeight: 54,
      marginTop: 12,
      borderRadius: 8,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingHorizontal: 16,
      backgroundColor: "#0F766E",
    },
    exportButtonText: {
      flexShrink: 1,
      fontSize: scaleFont(17),
      fontWeight: "800",
      color: "#FFFFFF",
      textAlign: "center",
    },
    saveButton: {
      minHeight: 56,
      marginTop: 24,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.primary,
    },
    saveButtonText: {
      fontSize: scaleFont(18),
      fontWeight: "800",
      color: "#FFFFFF",
    },
  });
