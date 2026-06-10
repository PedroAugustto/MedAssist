import FontAwesome from "@expo/vector-icons/FontAwesome";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  identifyMedicationFromImage,
  MedicationSuggestion,
  searchMedicationDosageWithGrounding,
} from "@/services/gemini";
import {
  findMedicationByCommercialName,
  saveMedicationRegistration,
} from "@/services/database";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAccessibilitySettings } from "@/services/accessibilitySettings";

type FormState = {
  nome_comercial: string;
  principio_ativo: string;
  dosagem: string;
  frequencia_horas: string;
  duracao_dias: string;
  horario_inicio: string;
  criar_doses: boolean;
};

const toDatetimeLocalValue = (date: Date) => date.toISOString().slice(0, 16);

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
  const normalized = value.trim().replace(",", ".");
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const suggestionToForm = (suggestion: MedicationSuggestion): FormState => ({
  nome_comercial: suggestion.nome_comercial || "",
  principio_ativo: suggestion.principio_ativo || "",
  dosagem: suggestion.dosagem || "",
  frequencia_horas: suggestion.frequencia_horas
    ? String(suggestion.frequencia_horas)
    : "",
  duracao_dias: suggestion.duracao_dias ? String(suggestion.duracao_dias) : "",
  horario_inicio: toDatetimeLocalValue(new Date()),
  criar_doses: true,
});

const emptyForm: FormState = {
  nome_comercial: "",
  principio_ativo: "",
  dosagem: "",
  frequencia_horas: "",
  duracao_dias: "",
  horario_inicio: toDatetimeLocalValue(new Date()),
  criar_doses: true,
};

const manualSuggestion: MedicationSuggestion = {
  nome_comercial: null,
  principio_ativo: null,
  dosagem: null,
  frequencia_horas: null,
  duracao_dias: null,
  observacoes: null,
  fontes: [],
  confianca: 0,
  rawResponse: "",
};

export default function NewMedicationScreen() {
  const cameraRef = useRef<CameraView>(null);
  const { scaleFont } = useAccessibilitySettings();
  const styles = useMemo(() => createStyles(scaleFont), [scaleFont]);
  const [permission, requestPermission] = useCameraPermissions();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<MedicationSuggestion | null>(
    null,
  );
  const [form, setForm] = useState<FormState>(emptyForm);
  const [isTakingPhoto, setIsTakingPhoto] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSearchingDosage, setIsSearchingDosage] = useState(false);
  const [isPickingImage, setIsPickingImage] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isManualEntry, setIsManualEntry] = useState(false);
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);

  const updateForm = (field: keyof FormState, value: string | boolean) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const takePhoto = async () => {
    if (!cameraRef.current || isTakingPhoto) {
      return;
    }

    try {
      setIsTakingPhoto(true);
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.75,
      });

      setPhotoUri(photo.uri);
      setPhotoBase64(photo.base64 || null);
    } catch (error: any) {
      Alert.alert(
        "Nao foi possivel tirar a foto",
        error.message || "Tente novamente com a caixa bem iluminada.",
      );
    } finally {
      setIsTakingPhoto(false);
    }
  };

  const retakePhoto = () => {
    setPhotoUri(null);
    setPhotoBase64(null);
    setSuggestion(null);
    setForm(emptyForm);
    setIsManualEntry(false);
  };

  const pickImage = async () => {
    try {
      setIsPickingImage(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        base64: true,
        quality: 0.75,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets[0];
      setPhotoUri(asset.uri);
      setPhotoBase64(asset.base64 || null);
      setSuggestion(null);
      setForm(emptyForm);
      setIsManualEntry(false);
    } catch (error: any) {
      Alert.alert(
        "Nao foi possivel abrir a galeria",
        error.message || "Tente novamente em instantes.",
      );
    } finally {
      setIsPickingImage(false);
    }
  };

  const analyzePhoto = async () => {
    if (!photoBase64) {
      Alert.alert("Foto sem dados", "Tire a foto novamente para analisar.");
      return;
    }

    try {
      setIsAnalyzing(true);
      const result = await identifyMedicationFromImage(photoBase64);
      setSuggestion(result);
      setForm(suggestionToForm(result));
      setIsManualEntry(false);
    } catch (error: any) {
      Alert.alert(
        "Analise indisponivel",
        error.message ||
          "Nao conseguimos identificar o medicamento agora. Voce pode preencher manualmente.",
      );
      setForm(emptyForm);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const searchDosage = async () => {
    if (!form.nome_comercial.trim() && !form.principio_ativo.trim()) {
      Alert.alert(
        "Informe o medicamento",
        "Confirme pelo menos o nome comercial ou o principio ativo antes da busca.",
      );
      return;
    }

    try {
      setIsSearchingDosage(true);
      const result = await searchMedicationDosageWithGrounding({
        nome_comercial: form.nome_comercial,
        principio_ativo: form.principio_ativo,
        dosagem: form.dosagem,
      });

      setForm((current) => ({
        ...current,
        frequencia_horas: result.frequencia_horas
          ? String(result.frequencia_horas)
          : current.frequencia_horas,
        duracao_dias: result.duracao_dias
          ? String(result.duracao_dias)
          : current.duracao_dias,
      }));
      setSuggestion((current) => ({
        nome_comercial: current?.nome_comercial || form.nome_comercial || null,
        principio_ativo:
          current?.principio_ativo || form.principio_ativo || null,
        dosagem: current?.dosagem || form.dosagem || null,
        frequencia_horas: result.frequencia_horas,
        duracao_dias: result.duracao_dias,
        observacoes: result.observacoes,
        fontes: result.fontes,
        confianca: result.confianca,
        rawResponse: result.rawResponse,
      }));
    } catch (error: any) {
      Alert.alert(
        "Nao foi possivel retornar a posologia",
        "A busca em fontes confiaveis falhou. Voce pode preencher a frequencia e a duracao manualmente ou salvar sem criar doses.",
      );
    } finally {
      setIsSearchingDosage(false);
    }
  };

  const fillManually = () => {
    setSuggestion(manualSuggestion);
    setForm(emptyForm);
    setIsManualEntry(true);
  };


  const saveMedication = async (
    skipDuplicateCheck = false,
    skipDosagePrompt = false,
  ) => {
    if (!form.nome_comercial.trim()) {
      Alert.alert("Nome obrigatorio", "Informe o nome comercial do remedio.");
      return;
    }

    const frequenciaHoras = numberOrNull(form.frequencia_horas);
    const duracaoDias = numberOrNull(form.duracao_dias);
    const missingDosage = !frequenciaHoras || !duracaoDias;

    if (missingDosage && !skipDosagePrompt) {
      Alert.alert(
        "Posologia nao informada",
        "Deseja buscar a posologia em fontes confiaveis?",
        [
          {
            text: "Nao",
            style: "cancel",
            onPress: () => {
              if (form.criar_doses) {
                Alert.alert(
                  "Posologia obrigatoria",
                  "Para criar doses, informe frequencia em horas e duracao em dias.",
                );
                return;
              }

              saveMedication(skipDuplicateCheck, true);
            },
          },
          {
            text: "Buscar",
            onPress: () => {
              searchDosage();
            },
          },
        ],
      );
      return;
    }

    if (form.criar_doses && missingDosage) {
      Alert.alert(
        "Posologia obrigatoria",
        "Para criar doses, informe frequencia em horas e duracao em dias.",
      );
      return;
    }

    const horarioInicio = new Date(form.horario_inicio);
    if (Number.isNaN(horarioInicio.getTime())) {
      Alert.alert(
        "Horario invalido",
        "Use o formato AAAA-MM-DDTHH:mm, por exemplo 2026-05-28T08:00.",
      );
      return;
    }

    try {
      setIsSaving(true);
      if (!skipDuplicateCheck) {
        const duplicate = await findMedicationByCommercialName(
          form.nome_comercial,
        );

        if (duplicate) {
          setIsSaving(false);
          Alert.alert(
            "Medicamento ja cadastrado",
            `${duplicate.nome_comercial} ja existe na sua lista. Deseja cadastrar mesmo assim?`,
            [
              { text: "Cancelar", style: "cancel" },
              {
                text: "Cadastrar mesmo assim",
                onPress: () => saveMedication(true, skipDosagePrompt),
              },
            ],
          );
          return;
        }
      }

      await saveMedicationRegistration({
        nome_comercial: form.nome_comercial,
        principio_ativo: form.principio_ativo || null,
        dosagem: form.dosagem || null,
        foto_uri: photoUri,
        horario_inicio: horarioInicio.toISOString(),
        frequencia_horas: frequenciaHoras,
        duracao_dias: duracaoDias,
        criar_doses: form.criar_doses,
        identificacao_ia: suggestion && !isManualEntry
          ? {
              resposta_json: suggestion.rawResponse,
              confianca: suggestion.confianca,
            }
          : undefined,
      });

      Alert.alert(
        "Medicamento salvo",
        "As informacoes foram registradas. Confira sempre com a receita ou um profissional de saude.",
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (error: any) {
      Alert.alert(
        "Nao foi possivel salvar",
        error.message && !String(error.message).includes("NullPointer")
          ? error.message
          : "Confira o medicamento, a frequencia e a duracao, depois tente novamente.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (!permission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <LoadingOverlay
          visible={isPickingImage}
          title="Abrindo imagem"
          message="Preparando a foto selecionada."
        />
        <FontAwesome name="camera" size={42} color="#007AFF" />
        <Text style={styles.permissionTitle}>Permitir camera</Text>
        <Text style={styles.permissionText}>
          A camera sera usada para fotografar a caixa do medicamento e sugerir o
          cadastro.
        </Text>
        <Pressable style={styles.primaryButton} onPress={requestPermission}>
          <Text style={styles.primaryButtonText}>Permitir acesso</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={pickImage}>
          <Text style={styles.secondaryButtonText}>Escolher imagem</Text>
        </Pressable>
      </View>
    );
  }

  if (!photoUri) {
    return (
      <View style={styles.cameraContainer}>
        <LoadingOverlay
          visible={isPickingImage}
          title="Abrindo imagem"
          message="Preparando a foto selecionada."
        />
        <CameraView ref={cameraRef} style={styles.camera} facing="back" />
        <View style={styles.cameraOverlay}>
          <View style={styles.cameraTopBar}>
            <Pressable style={styles.iconButton} onPress={() => router.back()}>
              <FontAwesome name="chevron-left" size={20} color="#FFFFFF" />
            </Pressable>
            <Text style={styles.cameraTitle}>Novo medicamento</Text>
            <View style={styles.iconButtonPlaceholder} />
          </View>

          <View style={styles.guideWrapper}>
            <View style={styles.guideBox} />
            <Text style={styles.guideText}>
              Posicione a frente da caixa dentro do quadrado
            </Text>
          </View>

          <Pressable
            style={styles.captureButton}
            onPress={takePhoto}
            disabled={isTakingPhoto}
          >
            {isTakingPhoto ? (
              <ActivityIndicator color="#007AFF" />
            ) : (
              <View style={styles.captureInner} />
            )}
          </Pressable>
          <Pressable style={styles.galleryButton} onPress={pickImage}>
            <FontAwesome name="image" size={18} color="#FFFFFF" />
            <Text style={styles.galleryButtonText}>Galeria</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!suggestion) {
    return (
      <View style={styles.previewContainer}>
        <LoadingOverlay
          visible={isAnalyzing}
          title="Lendo embalagem"
          message="Extraindo nome, principio ativo e dosagem pela imagem."
        />
        <Image source={{ uri: photoUri }} style={styles.previewImage} />
        <View style={styles.previewActions}>
          <Text style={styles.previewTitle}>Foto capturada</Text>
          <Text style={styles.warningText}>
            Voce pode analisar a embalagem com IA ou preencher os dados
            manualmente sem internet.
          </Text>
          <Pressable
            style={styles.primaryButton}
            onPress={analyzePhoto}
            disabled={isAnalyzing}
          >
            {isAnalyzing ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Analisar com IA</Text>
            )}
          </Pressable>
          <Pressable
            style={styles.secondaryButton}
            onPress={fillManually}
          >
            <Text style={styles.secondaryButtonText}>
              Preencher manualmente
            </Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={retakePhoto}>
            <Text style={styles.secondaryButtonText}>Tirar outra foto</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.formScreen} contentContainerStyle={styles.form}>
      <LoadingOverlay
        visible={isSaving || isSearchingDosage}
        title={
          isSearchingDosage
            ? "Buscando fontes confiaveis"
            : "Salvando medicamento"
        }
        message={
          isSearchingDosage
            ? "Consultando bula e posologia com ancoragem na Web."
            : "Criando cadastro, plano e doses."
        }
      />
      <Image source={{ uri: photoUri }} style={styles.formImage} />
      <Text style={styles.formTitle}>Confirmar medicamento</Text>
      <Text style={styles.warningText}>
        Revise tudo antes de salvar. Este app sugere informacoes, mas nao
        substitui receita, bula ou orientacao profissional.
      </Text>

      <FormField
        label="Nome comercial"
        value={form.nome_comercial}
        onChangeText={(value) => updateForm("nome_comercial", value)}
      />
      <FormField
        label="Principio ativo"
        value={form.principio_ativo}
        onChangeText={(value) => updateForm("principio_ativo", value)}
      />
      <FormField
        label="Dosagem"
        value={form.dosagem}
        onChangeText={(value) => updateForm("dosagem", value)}
      />
      <Pressable
        style={styles.sourceSearchButton}
        onPress={searchDosage}
        disabled={isSearchingDosage}
      >
        <FontAwesome name="search" size={18} color="#FFFFFF" />
        <Text style={styles.sourceSearchButtonText}>
          Buscar posologia em fontes confiaveis
        </Text>
      </Pressable>
      <DateTimeField
        label="Horario inicial"
        value={form.horario_inicio}
        onDatePress={() => setShowStartDatePicker(true)}
        onTimePress={() => setShowStartTimePicker(true)}
      />
      {showStartDatePicker ? (
        <DateTimePicker
          value={new Date(form.horario_inicio)}
          mode="date"
          display="calendar"
          onChange={(event: DateTimePickerEvent, selectedDate?: Date) => {
            setShowStartDatePicker(false);
            if (event.type !== "dismissed" && selectedDate) {
              updateForm(
                "horario_inicio",
                mergeDatePart(form.horario_inicio, selectedDate),
              );
            }
          }}
        />
      ) : null}
      {showStartTimePicker ? (
        <DateTimePicker
          value={new Date(form.horario_inicio)}
          mode="time"
          display="default"
          is24Hour
          onChange={(event: DateTimePickerEvent, selectedDate?: Date) => {
            setShowStartTimePicker(false);
            if (event.type !== "dismissed" && selectedDate) {
              updateForm(
                "horario_inicio",
                mergeTimePart(form.horario_inicio, selectedDate),
              );
            }
          }}
        />
      ) : null}
      <FormField
        label="Frequencia em horas"
        value={form.frequencia_horas}
        onChangeText={(value) => updateForm("frequencia_horas", value)}
        keyboardType="numeric"
      />
      <FormField
        label="Duracao em dias"
        value={form.duracao_dias}
        onChangeText={(value) => updateForm("duracao_dias", value)}
        keyboardType="numeric"
      />

      <View style={styles.switchRow}>
        <View style={styles.switchTextGroup}>
          <Text style={styles.switchLabel}>Criar doses automaticamente</Text>
          <Text style={styles.switchHelp}>
            Usa horario inicial, frequencia e duracao confirmados acima.
          </Text>
        </View>
        <Switch
          value={form.criar_doses}
          onValueChange={(value) => updateForm("criar_doses", value)}
        />
      </View>

      {suggestion.observacoes ? (
        <View style={styles.noteBox}>
          <Text style={styles.noteTitle}>Observacoes da IA</Text>
          <Text style={styles.noteText}>{suggestion.observacoes}</Text>
        </View>
      ) : null}

      {suggestion.fontes.length > 0 ? (
        <View style={styles.noteBox}>
          <Text style={styles.noteTitle}>Fontes consultadas</Text>
          {suggestion.fontes.slice(0, 4).map((source) => (
            <Text key={source.url} style={styles.sourceText}>
              {source.titulo}
            </Text>
          ))}
        </View>
      ) : null}

      <Pressable
        style={styles.primaryButton}
        onPress={() => saveMedication()}
        disabled={isSaving}
      >
        {isSaving ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.primaryButtonText}>Salvar medicamento</Text>
        )}
      </Pressable>
      <Pressable style={styles.secondaryButton} onPress={retakePhoto}>
        <Text style={styles.secondaryButtonText}>Recomecar</Text>
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
};

type DateTimeFieldProps = {
  label: string;
  value: string;
  onDatePress: () => void;
  onTimePress: () => void;
};

function DateTimeField({
  label,
  value,
  onDatePress,
  onTimePress,
}: DateTimeFieldProps) {
  const { scaleFont } = useAccessibilitySettings();
  const styles = useMemo(() => createStyles(scaleFont), [scaleFont]);

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.dateTimeRow}>
        <Pressable style={styles.dateInput} onPress={onDatePress}>
          <Text style={styles.dateInputText}>{formatDateBr(value)}</Text>
          <FontAwesome name="calendar" size={20} color="#007AFF" />
        </Pressable>
        <Pressable style={styles.timeInput} onPress={onTimePress}>
          <Text style={styles.dateInputText}>{formatTimeBr(value)}</Text>
          <FontAwesome name="clock-o" size={20} color="#007AFF" />
        </Pressable>
      </View>
    </View>
  );
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = "default",
}: FormFieldProps) {
  const { scaleFont } = useAccessibilitySettings();
  const styles = useMemo(() => createStyles(scaleFont), [scaleFont]);

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        placeholderTextColor="#64748B"
      />
    </View>
  );
}

const createStyles = (scaleFont: (size: number) => number) =>
  StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  permissionContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#FFFFFF",
  },
  permissionTitle: {
    marginTop: 16,
    fontSize: scaleFont(26),
    fontWeight: "800",
    color: "#0F172A",
  },
  permissionText: {
    marginTop: 10,
    marginBottom: 24,
    fontSize: scaleFont(18),
    lineHeight: 26,
    textAlign: "center",
    color: "#334155",
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: "#000000",
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
    padding: 20,
    paddingTop: 54,
    paddingBottom: 34,
  },
  cameraTopBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#00000088",
  },
  iconButtonPlaceholder: {
    width: 44,
    height: 44,
  },
  cameraTitle: {
    fontSize: scaleFont(20),
    fontWeight: "800",
    color: "#FFFFFF",
  },
  guideWrapper: {
    alignItems: "center",
  },
  guideBox: {
    width: 260,
    height: 260,
    borderWidth: 3,
    borderRadius: 8,
    borderColor: "#FFFFFF",
    backgroundColor: "#00000011",
  },
  guideText: {
    maxWidth: 280,
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    overflow: "hidden",
    textAlign: "center",
    fontSize: scaleFont(17),
    fontWeight: "700",
    color: "#FFFFFF",
    backgroundColor: "#00000088",
  },
  captureButton: {
    alignSelf: "center",
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  captureInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 3,
    borderColor: "#007AFF",
  },
  galleryButton: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 48,
    borderRadius: 8,
    paddingHorizontal: 16,
    backgroundColor: "#00000099",
  },
  galleryButtonText: {
    fontSize: scaleFont(16),
    fontWeight: "800",
    color: "#FFFFFF",
  },
  previewContainer: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  previewImage: {
    flex: 1,
    width: "100%",
  },
  previewActions: {
    padding: 20,
    gap: 12,
  },
  previewTitle: {
    fontSize: scaleFont(26),
    fontWeight: "800",
    color: "#0F172A",
  },
  formScreen: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  form: {
    padding: 18,
    paddingTop: 54,
    paddingBottom: 34,
  },
  formImage: {
    width: "100%",
    height: 190,
    borderRadius: 8,
    marginBottom: 18,
    backgroundColor: "#E2E8F0",
  },
  formTitle: {
    fontSize: scaleFont(28),
    fontWeight: "800",
    color: "#0F172A",
    marginBottom: 10,
  },
  warningText: {
    fontSize: scaleFont(16),
    lineHeight: 23,
    color: "#475569",
    marginBottom: 12,
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
  sourceSearchButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 54,
    marginTop: 16,
    borderRadius: 8,
    paddingHorizontal: 14,
    backgroundColor: "#0B6623",
  },
  sourceSearchButtonText: {
    flexShrink: 1,
    fontSize: scaleFont(17),
    fontWeight: "800",
    color: "#FFFFFF",
    textAlign: "center",
  },
  input: {
    minHeight: 54,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    paddingHorizontal: 14,
    fontSize: scaleFont(18),
    color: "#0F172A",
    backgroundColor: "#FFFFFF",
  },
  dateTimeRow: {
    flexDirection: "row",
    gap: 10,
  },
  dateInput: {
    flex: 1,
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
  timeInput: {
    width: 118,
    minHeight: 54,
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
    color: "#0F172A",
    fontWeight: "700",
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 18,
    padding: 14,
    borderRadius: 8,
    backgroundColor: "#F8FAFC",
  },
  switchTextGroup: {
    flex: 1,
  },
  switchLabel: {
    fontSize: scaleFont(17),
    fontWeight: "800",
    color: "#0F172A",
  },
  switchHelp: {
    marginTop: 4,
    fontSize: scaleFont(14),
    lineHeight: 20,
    color: "#475569",
  },
  noteBox: {
    marginTop: 16,
    padding: 14,
    borderRadius: 8,
    backgroundColor: "#EFF6FF",
  },
  noteTitle: {
    fontSize: scaleFont(16),
    fontWeight: "800",
    color: "#1D4ED8",
    marginBottom: 6,
  },
  noteText: {
    fontSize: scaleFont(15),
    lineHeight: 22,
    color: "#1E3A8A",
  },
  sourceText: {
    fontSize: scaleFont(14),
    lineHeight: 20,
    color: "#1E3A8A",
  },
  primaryButton: {
    minHeight: 56,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    backgroundColor: "#007AFF",
  },
  primaryButtonText: {
    fontSize: scaleFont(18),
    fontWeight: "800",
    color: "#FFFFFF",
  },
  secondaryButton: {
    minHeight: 54,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
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
