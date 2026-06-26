import FontAwesome from "@expo/vector-icons/FontAwesome";
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
  Text,
  TextInput,
  View,
} from "react-native";

import {
  identifyMedicationFromImage,
  MedicationSuggestion,
} from "@/services/gemini";
import {
  identifyMedicationFromOcrText,
  MedicationOcrSuggestion,
} from "@/services/groq";
import {
  findMedicationByCommercialName,
  saveMedication as saveMedicationRecord,
} from "@/services/database";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAccessibilitySettings } from "@/services/accessibilitySettings";
import {
  fetchAndSaveMedicationLeaflet,
  getMedicationLeafletSafetyReview,
} from "@/services/leaflets";
import { extractTextFromMedicationImage } from "@/services/ocr";

const ENABLE_GEMINI_IMAGE_FALLBACK = false;

type FormState = {
  nome_comercial: string;
  principio_ativo: string;
  dosagem: string;
};

const suggestionToForm = (suggestion: MedicationOcrSuggestion): FormState => ({
  nome_comercial: suggestion.nome_comercial || suggestion.principio_ativo || "",
  principio_ativo: suggestion.principio_ativo || "",
  dosagem: suggestion.dosagem || "",
});

const emptyForm: FormState = {
  nome_comercial: "",
  principio_ativo: "",
  dosagem: "",
};

const manualSuggestion: MedicationOcrSuggestion = {
  medicamento_detectado: true,
  nome_comercial: null,
  principio_ativo: null,
  dosagem: null,
  observacoes: null,
  confianca: 0,
  campos: {
    nome_comercial: "nao_encontrado",
    principio_ativo: "nao_encontrado",
    dosagem: "nao_encontrado",
  },
  rawResponse: "",
};

const geminiSuggestionToOcrSuggestion = (
  suggestion: MedicationSuggestion,
): MedicationOcrSuggestion => ({
  medicamento_detectado: Boolean(
    suggestion.nome_comercial || suggestion.principio_ativo,
  ),
  nome_comercial: suggestion.nome_comercial,
  principio_ativo: suggestion.principio_ativo,
  dosagem: suggestion.dosagem,
  observacoes: suggestion.observacoes,
  confianca: suggestion.confianca,
  campos: {
    nome_comercial: suggestion.nome_comercial
      ? "extraido_da_embalagem"
      : "nao_encontrado",
    principio_ativo: suggestion.principio_ativo
      ? "extraido_da_embalagem"
      : "nao_encontrado",
    dosagem: suggestion.dosagem ? "extraido_da_embalagem" : "nao_encontrado",
  },
  rawResponse: suggestion.rawResponse,
});

const fieldOriginLabel = (
  origin: MedicationOcrSuggestion["campos"]["nome_comercial"],
) => {
  if (origin === "extraido_da_embalagem") {
    return "extraido da embalagem";
  }

  if (origin === "inferido_pela_ia") {
    return "inferido pela IA";
  }

  return "nao encontrado";
};

export default function NewMedicationScreen() {
  const cameraRef = useRef<CameraView>(null);
  const { scaleFont, colors } = useAccessibilitySettings();
  const styles = useMemo(
    () => createStyles(scaleFont, colors),
    [scaleFont, colors],
  );
  const [permission, requestPermission] = useCameraPermissions();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<MedicationOcrSuggestion | null>(
    null,
  );
  const [ocrText, setOcrText] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [isTakingPhoto, setIsTakingPhoto] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPickingImage, setIsPickingImage] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isFetchingLeaflet, setIsFetchingLeaflet] = useState(false);
  const [isManualEntry, setIsManualEntry] = useState(false);

  const updateForm = (field: keyof FormState, value: string) => {
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
    setOcrText("");
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
      setOcrText("");
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
    if (!photoUri) {
      Alert.alert("Foto sem dados", "Tire a foto novamente para analisar.");
      return;
    }

    try {
      setIsAnalyzing(true);
      const ocrResult = await extractTextFromMedicationImage(photoUri);
      setOcrText(ocrResult.text);
      const result = await identifyMedicationFromOcrText(ocrResult.text);

      if (
        !result.medicamento_detectado ||
        (!result.nome_comercial && !result.principio_ativo)
      ) {
        Alert.alert(
          "Medicamento nao identificado",
          result.observacoes ||
            "Nao consegui identificar um medicamento nessa imagem. Tente outra foto ou preencha manualmente.",
        );
        setSuggestion(null);
        setForm(emptyForm);
        return;
      }

      setSuggestion(result);
      setForm(suggestionToForm(result));
      setIsManualEntry(false);
    } catch (error: any) {
      if (ENABLE_GEMINI_IMAGE_FALLBACK && photoBase64) {
        try {
          const fallbackResult = await identifyMedicationFromImage(photoBase64);
          const normalizedFallback =
            geminiSuggestionToOcrSuggestion(fallbackResult);

          if (
            !normalizedFallback.medicamento_detectado ||
            (!normalizedFallback.nome_comercial &&
              !normalizedFallback.principio_ativo)
          ) {
            throw new Error(
              "Nao consegui identificar um medicamento nessa imagem.",
            );
          }

          setSuggestion(normalizedFallback);
          setForm(suggestionToForm(normalizedFallback));
          setIsManualEntry(false);
          return;
        } catch (fallbackError: any) {
          Alert.alert(
            "Analise indisponivel",
            fallbackError.message ||
              "Nao conseguimos identificar o medicamento agora. Voce pode preencher manualmente.",
          );
          setForm(emptyForm);
          return;
        }
      }

      Alert.alert(
        "Analise indisponivel",
        error.message ||
          "Nao consegui ler o texto da embalagem. Tente outra foto com mais luz ou preencha manualmente.",
      );
      setForm(emptyForm);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const fillManually = () => {
    setSuggestion(manualSuggestion);
    setOcrText("");
    setForm(emptyForm);
    setIsManualEntry(true);
  };

  const saveMedication = async (skipDuplicateCheck = false) => {
    const displayName =
      form.nome_comercial.trim() || form.principio_ativo.trim();

    if (!displayName) {
      Alert.alert(
        "Nome obrigatorio",
        "Informe o nome comercial ou o principio ativo do remedio.",
      );
      return;
    }

    try {
      setIsSaving(true);
      if (!skipDuplicateCheck) {
        const duplicate = await findMedicationByCommercialName(
          displayName,
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
                onPress: () => saveMedication(true),
              },
            ],
          );
          return;
        }
      }

      const registration = await saveMedicationRecord({
        nome_comercial: displayName,
        principio_ativo: form.principio_ativo || null,
        dosagem: form.dosagem || null,
        foto_uri: photoUri,
        identificacao_ia: suggestion && !isManualEntry
          ? {
              resposta_json: suggestion.rawResponse,
              confianca: suggestion.confianca,
            }
          : undefined,
      });

      setIsFetchingLeaflet(true);
      const leafletResult = await fetchAndSaveMedicationLeaflet(
        registration.medicamentoId,
      );
      const safetyReview =
        leafletResult.status === "baixada"
          ? await getMedicationLeafletSafetyReview(registration.medicamentoId)
          : null;
      const leafletMessage =
        leafletResult.status === "baixada"
          ? `Resumo da bula salvo localmente. Fonte: ${leafletResult.fonteNome || "fonte confiavel"}.`
          : "Medicamento salvo, mas nao encontrei uma fonte confiavel de bula agora.";

      if (safetyReview?.alertas.length) {
        Alert.alert(
          "Possivel risco identificado",
          `${leafletMessage}\n\n${safetyReview.alertas
            .map(
              (alert) =>
                `${alert.titulo}: ${alert.dado_usuario_relacionado}`,
            )
            .join("\n")}\n\nAntes de usar ou criar doses, confirme com um medico ou farmaceutico.`,
          [
            { text: "Voltar", style: "cancel" },
            {
              text: "Continuar mesmo assim",
              style: "destructive",
              onPress: () => router.back(),
            },
          ],
        );
        return;
      }

      Alert.alert(
        "Medicamento salvo",
        `${leafletMessage} Confira sempre com a receita ou um profissional de saude.`,
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (error: any) {
      Alert.alert(
        "Nao foi possivel salvar",
        error.message && !String(error.message).includes("NullPointer")
          ? error.message
          : "Confira os dados do medicamento e tente novamente.",
      );
    } finally {
      setIsFetchingLeaflet(false);
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
          title="Lendo texto da embalagem"
          message="Usando OCR e IA para preencher nome, principio ativo e dosagem."
        />
        <Image source={{ uri: photoUri }} style={styles.previewImage} />
        <View style={styles.previewActions}>
          <Text style={styles.previewTitle}>Foto capturada</Text>
          <Text style={styles.warningText}>
            Voce pode ler o texto da embalagem por OCR ou preencher os dados
            manualmente.
          </Text>
          <Pressable
            style={styles.primaryButton}
            onPress={analyzePhoto}
            disabled={isAnalyzing}
          >
            {isAnalyzing ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Ler texto da embalagem</Text>
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
        visible={isSaving || isFetchingLeaflet}
        title={
          isFetchingLeaflet
              ? "Salvando resumo da bula"
            : "Salvando medicamento"
        }
        message={
          isFetchingLeaflet
              ? "Buscando fonte confiavel e preparando resumo para o chat."
            : "Criando cadastro do medicamento."
        }
      />
      <Image source={{ uri: photoUri }} style={styles.formImage} />
      <Text style={styles.formTitle}>Confirmar medicamento</Text>
      <Text style={styles.warningText}>
        Revise tudo antes de salvar. Este app sugere informacoes, mas nao
        substitui receita, bula ou orientacao profissional.
      </Text>

      <FormField
        label="Nome comercial ou principio ativo"
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

      {suggestion.observacoes ? (
        <View style={styles.noteBox}>
          <Text style={styles.noteTitle}>Observacoes da IA</Text>
          <Text style={styles.noteText}>{suggestion.observacoes}</Text>
        </View>
      ) : null}

      {!isManualEntry ? (
        <View style={styles.noteBox}>
          <Text style={styles.noteTitle}>Origem dos campos</Text>
          <Text style={styles.sourceText}>
            Nome comercial: {fieldOriginLabel(suggestion.campos.nome_comercial)}
          </Text>
          <Text style={styles.sourceText}>
            Principio ativo:{" "}
            {fieldOriginLabel(suggestion.campos.principio_ativo)}
          </Text>
          <Text style={styles.sourceText}>
            Dosagem: {fieldOriginLabel(suggestion.campos.dosagem)}
          </Text>
          <Text style={styles.sourceText}>
            Confianca: {Math.round(suggestion.confianca * 100)}%
          </Text>
        </View>
      ) : null}

      {ocrText ? (
        <View style={styles.noteBox}>
          <Text style={styles.noteTitle}>Texto lido da embalagem</Text>
          <Text style={styles.noteText}>{ocrText}</Text>
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

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = "default",
}: FormFieldProps) {
  const { scaleFont, colors } = useAccessibilitySettings();
  const styles = useMemo(
    () => createStyles(scaleFont, colors),
    [scaleFont, colors],
  );

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        placeholderTextColor={colors.textMuted}
      />
    </View>
  );
}

const createStyles = (
  scaleFont: (size: number) => number,
  colors: ReturnType<typeof useAccessibilitySettings>["colors"],
) =>
  StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  permissionContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: colors.background,
  },
  permissionTitle: {
    marginTop: 16,
    fontSize: scaleFont(26),
    fontWeight: "800",
    color: colors.text,
  },
  permissionText: {
    marginTop: 10,
    marginBottom: 24,
    fontSize: scaleFont(18),
    lineHeight: 26,
    textAlign: "center",
    color: colors.textMuted,
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
    backgroundColor: colors.background,
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
    color: colors.text,
  },
  formScreen: {
    flex: 1,
    backgroundColor: colors.surface,
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
    color: colors.text,
    marginBottom: 10,
  },
  warningText: {
    fontSize: scaleFont(16),
    lineHeight: 23,
    color: colors.textMuted,
    marginBottom: 12,
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
    minHeight: 54,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    fontSize: scaleFont(18),
    color: colors.text,
    backgroundColor: colors.surface,
  },
  noteBox: {
    marginTop: 16,
    padding: 14,
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
  },
  noteTitle: {
    fontSize: scaleFont(16),
    fontWeight: "800",
    color: colors.text,
    marginBottom: 6,
  },
  noteText: {
    fontSize: scaleFont(15),
    lineHeight: 22,
    color: colors.textMuted,
  },
  sourceText: {
    fontSize: scaleFont(14),
    lineHeight: 20,
    color: colors.textMuted,
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
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryButtonText: {
    fontSize: scaleFont(17),
    fontWeight: "700",
    color: colors.text,
  },
  });
