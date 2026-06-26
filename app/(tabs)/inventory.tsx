import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import Card from "../../components/Card";
import FloatingActionButton from "../../components/FloatingActionButton";
import {
  deleteMedication,
  getMedicationLeafletByMedicationId,
  listMedicationLeafletChunks,
  listMedications,
  Medication,
  MedicationLeaflet,
  MedicationLeafletChunk,
  updateMedication,
} from "../../services/database";
import { useAccessibilitySettings } from "../../services/accessibilitySettings";
import { userFriendlyErrorMessage } from "../../services/errorMessages";
import { fetchAndSaveMedicationLeaflet } from "../../services/leaflets";

type EditForm = {
  nome_comercial: string;
  principio_ativo: string;
  dosagem: string;
  status_tratamento: "ativo" | "pausado" | "finalizado";
};

const statusOptions: EditForm["status_tratamento"][] = [
  "ativo",
  "pausado",
  "finalizado",
];

const statusStyles = {
  ativo: {
    label: "Ativo",
    textColor: "#0B6623",
    backgroundColor: "#DCFCE7",
  },
  pausado: {
    label: "Pausado",
    textColor: "#92400E",
    backgroundColor: "#FEF3C7",
  },
  finalizado: {
    label: "Finalizado",
    textColor: "#1D4ED8",
    backgroundColor: "#DBEAFE",
  },
};

export default function InventoryScreen() {
  const { scaleFont, colors } = useAccessibilitySettings();
  const styles = useMemo(
    () => createStyles(scaleFont, colors),
    [scaleFont, colors],
  );
  const [medications, setMedications] = useState<Medication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingLeaflet, setIsLoadingLeaflet] = useState(false);
  const [isSearchingLeaflet, setIsSearchingLeaflet] = useState(false);
  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);
  const [leafletMedication, setLeafletMedication] =
    useState<Medication | null>(null);
  const [leaflet, setLeaflet] = useState<MedicationLeaflet | null>(null);
  const [leafletChunks, setLeafletChunks] = useState<MedicationLeafletChunk[]>(
    [],
  );
  const [expandedLeafletSections, setExpandedLeafletSections] = useState<
    Record<string, boolean>
  >({});
  const [editingMedication, setEditingMedication] =
    useState<Medication | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    nome_comercial: "",
    principio_ativo: "",
    dosagem: "",
    status_tratamento: "ativo",
  });

  const loadMedications = useCallback(async () => {
    try {
      setIsLoading(true);
      const records = await listMedications();
      setMedications(records);
    } catch (error: any) {
      Alert.alert(
        "Nao foi possivel carregar",
        userFriendlyErrorMessage(error, "Tente abrir a lista novamente."),
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadMedications();
    }, [loadMedications]),
  );

  const openEdit = (medication: Medication) => {
    setEditingMedication(medication);
    setEditForm({
      nome_comercial: medication.nome_comercial,
      principio_ativo: medication.principio_ativo || "",
      dosagem: medication.dosagem || "",
      status_tratamento: medication.status_tratamento,
    });
  };

  const closeEdit = () => {
    setEditingMedication(null);
  };

  const closeLeaflet = () => {
    setLeafletMedication(null);
    setLeaflet(null);
    setLeafletChunks([]);
    setExpandedLeafletSections({});
  };

  const openLeaflet = async (medication: Medication) => {
    try {
      setIsLoadingLeaflet(true);
      const [savedLeaflet, chunks] = await Promise.all([
        getMedicationLeafletByMedicationId(medication.id),
        listMedicationLeafletChunks(medication.id),
      ]);

      setLeafletMedication(medication);
      setLeaflet(savedLeaflet);
      setLeafletChunks(savedLeaflet?.status === "baixada" ? chunks : []);
      const displayChunks =
        chunks.length === 1 && /^#{1,6}\s+/m.test(chunks[0].texto)
          ? markdownToDisplayChunks(chunks[0].texto, chunks[0])
          : chunks;
      setExpandedLeafletSections(
        displayChunks.reduce<Record<string, boolean>>(
          (accumulator, chunk, index) => {
            accumulator[chunk.id] = index === 0;
            return accumulator;
          },
          {},
        ),
      );
    } catch (error) {
      Alert.alert(
        "Nao foi possivel abrir a bula",
        userFriendlyErrorMessage(error, "Tente novamente em instantes."),
      );
    } finally {
      setIsLoadingLeaflet(false);
    }
  };

  const searchLeaflet = async () => {
    if (!leafletMedication) {
      return;
    }

    try {
      setIsSearchingLeaflet(true);
      const result = await fetchAndSaveMedicationLeaflet(leafletMedication.id);
      const [savedLeaflet, chunks] = await Promise.all([
        getMedicationLeafletByMedicationId(leafletMedication.id),
        listMedicationLeafletChunks(leafletMedication.id),
      ]);

      setLeaflet(savedLeaflet);
      setLeafletChunks(savedLeaflet?.status === "baixada" ? chunks : []);
      const displayChunks =
        chunks.length === 1 && /^#{1,6}\s+/m.test(chunks[0].texto)
          ? markdownToDisplayChunks(chunks[0].texto, chunks[0])
          : chunks;
      setExpandedLeafletSections(
        displayChunks.reduce<Record<string, boolean>>(
          (accumulator, chunk, index) => {
            accumulator[chunk.id] = index === 0;
            return accumulator;
          },
          {},
        ),
      );

      if (result.status !== "baixada") {
        Alert.alert(
          "Bula nao encontrada",
          "Nao encontrei uma fonte confiavel de bula para este medicamento agora. Voce pode tentar novamente mais tarde.",
        );
      }
    } catch (error) {
      Alert.alert(
        "Nao foi possivel buscar a bula",
        userFriendlyErrorMessage(error, "Verifique a conexao e tente novamente."),
      );
    } finally {
      setIsSearchingLeaflet(false);
    }
  };

  const saveEdit = async () => {
    if (!editingMedication) {
      return;
    }

    if (!editForm.nome_comercial.trim()) {
      Alert.alert("Nome obrigatorio", "Informe o nome comercial.");
      return;
    }

    try {
      setIsSaving(true);
      await updateMedication({
        id: editingMedication.id,
        nome_comercial: editForm.nome_comercial,
        principio_ativo: editForm.principio_ativo || null,
        dosagem: editForm.dosagem || null,
        status_tratamento: editForm.status_tratamento,
      });
      closeEdit();
      await loadMedications();
    } catch (error: any) {
      Alert.alert(
        "Nao foi possivel salvar",
        error.message || "Tente novamente em instantes.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDelete = (medication: Medication) => {
    Alert.alert(
      "Excluir medicamento",
      `Deseja excluir ${medication.nome_comercial}? As doses e planos relacionados tambem serao removidos.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteMedication(medication.id);
              await loadMedications();
            } catch (error: any) {
              Alert.alert(
                "Nao foi possivel excluir",
                error.message || "Tente novamente em instantes.",
              );
            }
          },
        },
      ],
    );
  };

  const MedicineItem = ({ item }: { item: Medication }) => (
    <MedicineCard
      item={item}
      styles={styles}
      colors={colors}
      onPreviewImage={(uri) => setPreviewImageUri(uri)}
      onViewLeaflet={() => openLeaflet(item)}
      onEdit={() => openEdit(item)}
      onDelete={() => confirmDelete(item)}
    />
  );
  const hasReadableLeaflet =
    leaflet?.status === "baixada" &&
    (leafletChunks.length > 0 || Boolean(leaflet.markdown));
  const displayLeafletChunks =
    leafletChunks.length === 1 && /^#{1,6}\s+/m.test(leafletChunks[0].texto)
      ? markdownToDisplayChunks(leafletChunks[0].texto, leafletChunks[0])
      : leafletChunks;
  const toggleLeafletSection = (sectionId: string) => {
    setExpandedLeafletSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  };

  return (
    <View style={styles.container}>
      <Text style={styles.screenTitle}>Meus Remedios</Text>
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Carregando medicamentos</Text>
        </View>
      ) : (
        <FlatList
          data={medications}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MedicineItem item={item} />}
          contentContainerStyle={[
            styles.listContent,
            medications.length === 0 && styles.emptyListContent,
          ]}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <MaterialCommunityIcons
                name="pill"
                size={42}
                color="#2563EB"
              />
              <Text style={styles.emptyTitle}>Nenhum remedio cadastrado</Text>
              <Text style={styles.emptyText}>
                Use o botao de adicionar nesta tela para cadastrar pela camera
                ou galeria.
              </Text>
            </View>
          }
        />
      )}

      <FloatingActionButton
        onPress={() => router.push("/medicamento/novo" as any)}
      />

      {isLoadingLeaflet || isSearchingLeaflet ? (
        <View style={styles.loadingLeafletBadge}>
          <ActivityIndicator color="#007AFF" />
          <Text style={styles.loadingLeafletText}>
            {isSearchingLeaflet ? "Buscando bula" : "Abrindo bula"}
          </Text>
        </View>
      ) : null}

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
            <MaterialCommunityIcons name="close" size={26} color="#FFFFFF" />
          </Pressable>
          {previewImageUri ? (
            <Image source={{ uri: previewImageUri }} style={styles.previewImage} />
          ) : null}
        </View>
      </Modal>

      <Modal
        visible={Boolean(leafletMedication)}
        transparent
        animationType="fade"
        onRequestClose={closeLeaflet}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.leafletPanel}>
            <View style={styles.leafletHeader}>
              <View style={styles.leafletTitleGroup}>
                <Text style={styles.leafletKicker}>Resumo da bula</Text>
                <Text style={styles.leafletTitle}>
                  {leafletMedication?.nome_comercial}
                </Text>
                <Text style={styles.leafletSubtitle}>
                  {leaflet?.fonte_nome || "Fonte nao informada"}
                </Text>
              </View>
              <Pressable
                style={styles.leafletCloseButton}
                onPress={closeLeaflet}
                accessibilityLabel="Fechar bula"
              >
                <MaterialCommunityIcons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>

            <ScrollView style={styles.leafletScroll}>
              {hasReadableLeaflet && displayLeafletChunks.length > 0 ? (
                displayLeafletChunks.map((chunk) => (
                  <LeafletSection
                    key={chunk.id}
                    chunk={chunk}
                    expanded={Boolean(expandedLeafletSections[chunk.id])}
                    styles={styles}
                    colors={colors}
                    onToggle={() => toggleLeafletSection(chunk.id)}
                  />
                ))
              ) : hasReadableLeaflet ? (
                <LeafletSection
                  chunk={{
                    id: "markdown",
                    bula_id: leaflet?.id || "",
                    medicamento_id: leaflet?.medicamento_id || "",
                    secao: "Resumo",
                    texto: leaflet?.markdown || "",
                    ordem: 0,
                  }}
                  expanded={Boolean(expandedLeafletSections.markdown ?? true)}
                  styles={styles}
                  colors={colors}
                  onToggle={() => toggleLeafletSection("markdown")}
                />
              ) : (
                <View style={styles.leafletEmptyState}>
                  <MaterialCommunityIcons
                    name="file-search-outline"
                    size={42}
                    color="#0369A1"
                  />
                  <Text style={styles.leafletEmptyTitle}>
                    Bula ainda nao salva
                  </Text>
                  <Text style={styles.leafletEmptyText}>
                    Este medicamento nao tem um resumo de bula armazenado no
                    banco local. Voce pode tentar buscar uma fonte confiavel
                    agora.
                  </Text>
                  <Pressable
                    style={styles.leafletSearchButton}
                    onPress={searchLeaflet}
                    disabled={isSearchingLeaflet}
                  >
                    {isSearchingLeaflet ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <>
                        <MaterialCommunityIcons
                          name="cloud-search-outline"
                          size={22}
                          color="#FFFFFF"
                        />
                        <Text style={styles.leafletSearchButtonText}>
                          Tentar buscar bula
                        </Text>
                      </>
                    )}
                  </Pressable>
                </View>
              )}
            </ScrollView>

            {hasReadableLeaflet ? (
              <View style={styles.leafletFooter}>
                <Text style={styles.leafletFooterText}>
                  Fonte: {leaflet?.fonte_nome || "Fonte nao informada"}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(editingMedication)}
        transparent
        animationType="fade"
        onRequestClose={closeEdit}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalPanel}>
            <Text style={styles.modalTitle}>Editar medicamento</Text>
            <FormField
              styles={styles}
              colors={colors}
              label="Nome comercial"
              value={editForm.nome_comercial}
              onChangeText={(value) =>
                setEditForm((current) => ({
                  ...current,
                  nome_comercial: value,
                }))
              }
            />
            <FormField
              styles={styles}
              colors={colors}
              label="Principio ativo"
              value={editForm.principio_ativo}
              onChangeText={(value) =>
                setEditForm((current) => ({
                  ...current,
                  principio_ativo: value,
                }))
              }
            />
            <FormField
              styles={styles}
              colors={colors}
              label="Dosagem"
              value={editForm.dosagem}
              onChangeText={(value) =>
                setEditForm((current) => ({ ...current, dosagem: value }))
              }
            />
            <Text style={styles.fieldLabel}>Status</Text>
            <View style={styles.statusOptions}>
              {statusOptions.map((status) => (
                <Pressable
                  key={status}
                  style={[
                    styles.statusOption,
                    editForm.status_tratamento === status &&
                      styles.statusOptionActive,
                  ]}
                  onPress={() =>
                    setEditForm((current) => ({
                      ...current,
                      status_tratamento: status,
                    }))
                  }
                >
                  <Text
                    style={[
                      styles.statusOptionText,
                      editForm.status_tratamento === status &&
                        styles.statusOptionTextActive,
                    ]}
                  >
                    {status}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.modalActions}>
              <Pressable style={styles.secondaryButton} onPress={closeEdit}>
                <Text style={styles.secondaryButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={styles.primaryButton}
                onPress={saveEdit}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>Salvar</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

type MedicineCardProps = {
  item: Medication;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useAccessibilitySettings>["colors"];
  onPreviewImage: (uri: string) => void;
  onViewLeaflet: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

function MedicineCard({
  item,
  styles,
  colors,
  onPreviewImage,
  onViewLeaflet,
  onEdit,
  onDelete,
}: MedicineCardProps) {
  const [imageError, setImageError] = useState(false);
  const [isActionMenuVisible, setIsActionMenuVisible] = useState(false);
  const shouldShowImage = item.foto_uri && !imageError;
  const handleMenuAction = (action: () => void) => {
    setIsActionMenuVisible(false);
    action();
  };

  return (
    <Card theme="default" style={styles.medicineCard}>
      <Pressable
        style={styles.cardIconWrapper}
        onPress={() => {
          if (item.foto_uri) {
            onPreviewImage(item.foto_uri);
          }
        }}
        disabled={!item.foto_uri}
      >
        {shouldShowImage ? (
          <Image
            source={{ uri: item.foto_uri || "" }}
            style={styles.image}
            onError={() => setImageError(true)}
          />
        ) : (
          <MaterialCommunityIcons name="pill" size={24} color="#ffffff" />
        )}
      </Pressable>
      <View style={styles.cardContent}>
        <Text
          style={styles.title}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.72}
        >
          {item.nome_comercial}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1} ellipsizeMode="tail">
          {item.principio_ativo || "Principio ativo nao informado"}
        </Text>
        <Text style={styles.dosage}>{item.dosagem || "Dosagem nao informada"}</Text>
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor:
                statusStyles[item.status_tratamento].backgroundColor,
            },
          ]}
        >
          <Text
            style={[
              styles.statusText,
              { color: statusStyles[item.status_tratamento].textColor },
            ]}
          >
            {statusStyles[item.status_tratamento].label}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable
          style={styles.actionButton}
          onPress={() => setIsActionMenuVisible(true)}
          accessibilityLabel={`Abrir menu de ${item.nome_comercial}`}
        >
          <MaterialCommunityIcons
            name="dots-vertical"
            size={24}
            color={colors.text}
          />
        </Pressable>
      </View>
      <Modal
        visible={isActionMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsActionMenuVisible(false)}
      >
        <Pressable
          style={styles.actionMenuBackdrop}
          onPress={() => setIsActionMenuVisible(false)}
        >
          <View style={styles.actionMenuPanel}>
            <Text style={styles.actionMenuTitle} numberOfLines={1}>
              {item.nome_comercial}
            </Text>
            <Pressable
              style={styles.actionMenuItem}
              onPress={() => handleMenuAction(onViewLeaflet)}
            >
              <MaterialCommunityIcons
                name="book-open-page-variant"
                size={22}
                color="#047857"
              />
              <Text style={styles.actionMenuItemText}>Ver bula</Text>
            </Pressable>
            <Pressable
              style={styles.actionMenuItem}
              onPress={() => handleMenuAction(onEdit)}
            >
              <MaterialCommunityIcons name="pencil" size={22} color={colors.text} />
              <Text style={styles.actionMenuItemText}>Editar</Text>
            </Pressable>
            <Pressable
              style={styles.actionMenuItem}
              onPress={() => handleMenuAction(onDelete)}
            >
              <MaterialCommunityIcons
                name="trash-can"
                size={22}
                color="#B91C1C"
              />
              <Text style={[styles.actionMenuItemText, styles.dangerText]}>
                Excluir
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </Card>
  );
}

const markdownToDisplayChunks = (
  markdown: string,
  baseChunk: MedicationLeafletChunk,
) => {
  const sections = markdown.split(/\n(?=#{1,6}\s+)/g);
  const chunks = sections
    .map((section, index) => {
      const trimmed = section.trim();

      if (!trimmed) {
        return null;
      }

      const title =
        trimmed.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim() || baseChunk.secao;
      const text = trimmed.replace(/^#{1,6}\s+.+$/m, "").trim() || trimmed;

      return {
        ...baseChunk,
        id: `${baseChunk.id}-section-${index}`,
        secao: title,
        texto: text,
        ordem: index,
      };
    })
    .filter(Boolean) as MedicationLeafletChunk[];

  return chunks.length > 0 ? chunks : [baseChunk];
};

const textToBulletPoints = (text: string) => {
  const normalized = text
    .replace(/^[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return ["Nao encontrado na fonte consultada."];
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return sentences.length > 0 ? sentences : [normalized];
};

type LeafletSectionProps = {
  chunk: MedicationLeafletChunk;
  expanded: boolean;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useAccessibilitySettings>["colors"];
  onToggle: () => void;
};

function LeafletSection({
  chunk,
  expanded,
  styles,
  colors,
  onToggle,
}: LeafletSectionProps) {
  const bullets = textToBulletPoints(chunk.texto);

  return (
    <View style={styles.leafletSection}>
      <Pressable style={styles.leafletSectionHeader} onPress={onToggle}>
        <Text style={styles.leafletSectionTitle} numberOfLines={2}>
          {chunk.secao}
        </Text>
        <MaterialCommunityIcons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={24}
          color={colors.text}
        />
      </Pressable>
      {expanded ? (
        <View style={styles.leafletBulletList}>
          {bullets.map((bullet, index) => (
            <View key={`${chunk.id}-${index}`} style={styles.leafletBulletRow}>
              <Text style={styles.leafletBulletMark}>•</Text>
              <Text style={styles.leafletSectionText}>{bullet}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

type FormFieldProps = {
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useAccessibilitySettings>["colors"];
  label: string;
  value: string;
  onChangeText: (value: string) => void;
};

function FormField({
  styles,
  colors,
  label,
  value,
  onChangeText,
}: FormFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
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
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 16,
    paddingTop: 50,
  },
  screenTitle: {
    fontSize: scaleFont(24),
    fontWeight: "bold",
    color: colors.text,
    marginBottom: 16,
  },
  listContent: {
    paddingBottom: 24,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: "center",
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
  medicineCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
  },
  cardIconWrapper: {
    width: 54,
    height: 54,
    borderRadius: 28,
    backgroundColor: "#2563EB",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  image: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  cardContent: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: scaleFont(20),
    fontWeight: "700",
    color: colors.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: scaleFont(16),
    color: colors.textMuted,
    marginBottom: 5,
  },
  dosage: {
    fontSize: scaleFont(16),
    color: colors.textMuted,
    marginBottom: 5,
  },
  statusBadge: {
    alignSelf: "flex-start",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusText: {
    fontSize: scaleFont(14),
    fontWeight: "800",
  },
  actions: {
    flexDirection: "row",
    gap: 8,
    marginLeft: 8,
  },
  actionButton: {
    width: 42,
    height: 42,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
  },
  actionMenuBackdrop: {
    flex: 1,
    justifyContent: "center",
    padding: 22,
    backgroundColor: "#00000066",
  },
  actionMenuPanel: {
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: colors.surface,
  },
  actionMenuTitle: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    fontSize: scaleFont(18),
    fontWeight: "900",
    color: colors.text,
  },
  actionMenuItem: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  actionMenuItemText: {
    flex: 1,
    fontSize: scaleFont(17),
    fontWeight: "800",
    color: colors.text,
  },
  dangerText: {
    color: "#B91C1C",
  },
  separator: {
    height: 12,
  },
  emptyState: {
    alignItems: "center",
    paddingHorizontal: 24,
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
  loadingLeafletBadge: {
    position: "absolute",
    top: 14,
    alignSelf: "center",
    zIndex: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#0F172A",
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  loadingLeafletText: {
    fontSize: scaleFont(14),
    fontWeight: "800",
    color: "#FFFFFF",
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "center",
    padding: 18,
    backgroundColor: "#00000080",
  },
  leafletPanel: {
    maxHeight: "88%",
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: colors.background,
  },
  leafletHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  leafletTitleGroup: {
    flex: 1,
  },
  leafletKicker: {
    fontSize: scaleFont(13),
    fontWeight: "800",
    color: "#0369A1",
    textTransform: "uppercase",
  },
  leafletTitle: {
    marginTop: 4,
    fontSize: scaleFont(24),
    lineHeight: 30,
    fontWeight: "900",
    color: colors.text,
  },
  leafletSubtitle: {
    marginTop: 4,
    fontSize: scaleFont(15),
    lineHeight: 21,
    color: colors.textMuted,
  },
  leafletCloseButton: {
    width: 42,
    height: 42,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
  },
  leafletScroll: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  leafletSection: {
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    backgroundColor: colors.surface,
  },
  leafletSectionHeader: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.surface,
  },
  leafletSectionTitle: {
    flex: 1,
    fontSize: scaleFont(18),
    lineHeight: 24,
    fontWeight: "900",
    color: colors.text,
  },
  leafletBulletList: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: colors.surfaceMuted,
  },
  leafletBulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 10,
  },
  leafletBulletMark: {
    width: 14,
    fontSize: scaleFont(18),
    lineHeight: 24,
    fontWeight: "900",
    color: "#0369A1",
  },
  leafletSectionText: {
    flex: 1,
    fontSize: scaleFont(16),
    lineHeight: 24,
    color: colors.textMuted,
  },
  leafletEmptyState: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 18,
    paddingVertical: 24,
    backgroundColor: colors.surface,
  },
  leafletEmptyTitle: {
    marginTop: 12,
    fontSize: scaleFont(20),
    lineHeight: 26,
    fontWeight: "900",
    color: colors.text,
    textAlign: "center",
  },
  leafletEmptyText: {
    marginTop: 8,
    fontSize: scaleFont(16),
    lineHeight: 24,
    color: colors.textMuted,
    textAlign: "center",
  },
  leafletSearchButton: {
    minHeight: 52,
    marginTop: 18,
    borderRadius: 8,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    alignSelf: "stretch",
    backgroundColor: "#007AFF",
  },
  leafletSearchButtonText: {
    flexShrink: 1,
    fontSize: scaleFont(16),
    lineHeight: 22,
    fontWeight: "900",
    color: "#FFFFFF",
    textAlign: "center",
  },
  leafletFooter: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  leafletFooterText: {
    fontSize: scaleFont(13),
    lineHeight: 18,
    color: colors.textMuted,
  },
  modalPanel: {
    borderRadius: 8,
    padding: 18,
    backgroundColor: colors.surface,
  },
  modalTitle: {
    fontSize: scaleFont(24),
    fontWeight: "800",
    color: colors.text,
    marginBottom: 8,
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
  statusOptions: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 18,
  },
  statusOption: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusOptionActive: {
    borderColor: "#007AFF",
    backgroundColor: "#007AFF",
  },
  statusOptionText: {
    fontSize: scaleFont(14),
    fontWeight: "700",
    color: colors.textMuted,
  },
  statusOptionTextActive: {
    color: "#FFFFFF",
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
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
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryButtonText: {
    fontSize: scaleFont(17),
    fontWeight: "700",
    color: colors.text,
  },
  });
