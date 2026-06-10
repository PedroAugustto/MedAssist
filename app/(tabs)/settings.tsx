import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import Slider from "@react-native-community/slider";
import { useFocusEffect } from "expo-router";
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

import {
  getUserProfile,
  saveUserProfile,
  UserProfile,
} from "../../services/database";
import { userFriendlyErrorMessage } from "../../services/errorMessages";
import { useAccessibilitySettings } from "../../services/accessibilitySettings";

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
  gestante: Boolean(profile.gestante),
  lactante: Boolean(profile.lactante),
  alergias: profile.alergias || "",
  condicoes_saude: profile.condicoes_saude || "",
  usa_outros_medicamentos: profile.usa_outros_medicamentos || "",
  observacoes_clinicas: profile.observacoes_clinicas || "",
  tamanho_fonte: String(profile.tamanho_fonte ?? 2),
  modo_contraste: Boolean(profile.modo_contraste),
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

export default function SettingsScreen() {
  const [userId, setUserId] = useState("user-001");
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showBirthDatePicker, setShowBirthDatePicker] = useState(false);
  const { refreshSettings, scaleFont } = useAccessibilitySettings();
  const styles = useMemo(() => createStyles(scaleFont), [scaleFont]);

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
        ? {
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
    const velocidadeLeitura = clamp(parseNumber(form.velocidade_leitura) || 1, 0.1, 2);
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
        gestante: form.gestante ? 1 : 0,
        lactante: form.lactante ? 1 : 0,
        alergias: form.alergias || null,
        condicoes_saude: form.condicoes_saude || null,
        usa_outros_medicamentos: form.usa_outros_medicamentos || null,
        observacoes_clinicas: form.observacoes_clinicas || null,
        tamanho_fonte: tamanhoFonte,
        modo_contraste: form.modo_contraste ? 1 : 0,
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
            style={[
              styles.segment,
              form.sexo === sexo && styles.segmentActive,
            ]}
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
        onChangeText={(value) =>
          updateForm("usa_outros_medicamentos", value)
        }
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
        onChange={(value) =>
          updateForm("velocidade_leitura", value.toFixed(1))
        }
      />
      <SwitchRow
        label="Modo contraste"
        value={form.modo_contraste}
        onValueChange={(value) => updateForm("modo_contraste", value)}
      />

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
  const { scaleFont } = useAccessibilitySettings();
  const styles = useMemo(() => createStyles(scaleFont), [scaleFont]);

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
  const { scaleFont } = useAccessibilitySettings();
  const styles = useMemo(() => createStyles(scaleFont), [scaleFont]);

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
        placeholderTextColor="#64748B"
      />
    </View>
  );
}

function SectionTitle({ title }: { title: string }) {
  const { scaleFont } = useAccessibilitySettings();
  const styles = useMemo(() => createStyles(scaleFont), [scaleFont]);

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
  const { scaleFont } = useAccessibilitySettings();
  const styles = useMemo(() => createStyles(scaleFont), [scaleFont]);
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
        minimumTrackTintColor="#007AFF"
        maximumTrackTintColor="#CBD5E1"
        thumbTintColor="#007AFF"
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
  const { scaleFont } = useAccessibilitySettings();
  const styles = useMemo(() => createStyles(scaleFont), [scaleFont]);

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
        minimumTrackTintColor="#007AFF"
        maximumTrackTintColor="#CBD5E1"
        thumbTintColor="#007AFF"
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
  const { scaleFont } = useAccessibilitySettings();
  const styles = useMemo(() => createStyles(scaleFont), [scaleFont]);

  return (
    <View style={styles.switchRow}>
      <Text style={styles.switchLabel}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

const createStyles = (scaleFont: (size: number) => number) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
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
    backgroundColor: "#FFFFFF",
  },
  loadingText: {
    marginTop: 12,
    fontSize: scaleFont(16),
    color: "#475569",
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
    color: "#0F172A",
  },
  subtitle: {
    marginTop: 4,
    fontSize: scaleFont(16),
    lineHeight: 23,
    color: "#475569",
  },
  sectionTitle: {
    marginTop: 18,
    marginBottom: 6,
    fontSize: scaleFont(20),
    fontWeight: "800",
    color: "#0F172A",
  },
  field: {
    flex: 1,
    marginTop: 12,
  },
  fieldLabel: {
    fontSize: scaleFont(16),
    fontWeight: "700",
    color: "#0F172A",
    marginBottom: 6,
  },
  input: {
    minHeight: 54,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    paddingHorizontal: 14,
    fontSize: scaleFont(17),
    color: "#0F172A",
    backgroundColor: "#FFFFFF",
  },
  dateInput: {
    minHeight: 54,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
  },
  dateInputText: {
    fontSize: scaleFont(17),
    color: "#0F172A",
  },
  placeholderText: {
    color: "#64748B",
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
    borderColor: "#CBD5E1",
    borderRadius: 8,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  segmentActive: {
    borderColor: "#007AFF",
    backgroundColor: "#007AFF",
  },
  segmentText: {
    fontSize: scaleFont(15),
    fontWeight: "700",
    color: "#334155",
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
    backgroundColor: "#F8FAFC",
  },
  sliderGroup: {
    marginTop: 14,
    padding: 14,
    borderRadius: 8,
    backgroundColor: "#F8FAFC",
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
    color: "#007AFF",
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
    color: "#64748B",
  },
  sliderOptionTextActive: {
    color: "#007AFF",
  },
  sliderExtremes: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  switchLabel: {
    fontSize: scaleFont(17),
    fontWeight: "700",
    color: "#0F172A",
  },
  saveButton: {
    minHeight: 56,
    marginTop: 24,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#007AFF",
  },
  saveButtonText: {
    fontSize: scaleFont(18),
    fontWeight: "800",
    color: "#FFFFFF",
  },
  });
