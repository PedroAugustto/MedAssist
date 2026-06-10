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
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import Card from "../../components/Card";
import FloatingActionButton from "../../components/FloatingActionButton";
import {
  deleteMedication,
  listMedications,
  Medication,
  updateMedication,
} from "../../services/database";
import { useAccessibilitySettings } from "../../services/accessibilitySettings";
import { userFriendlyErrorMessage } from "../../services/errorMessages";

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
  const { scaleFont } = useAccessibilitySettings();
  const styles = useMemo(() => createStyles(scaleFont), [scaleFont]);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);
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
      onPreviewImage={(uri) => setPreviewImageUri(uri)}
      onEdit={() => openEdit(item)}
      onDelete={() => confirmDelete(item)}
    />
  );

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
  onPreviewImage: (uri: string) => void;
  onEdit: () => void;
  onDelete: () => void;
};

function MedicineCard({
  item,
  styles,
  onPreviewImage,
  onEdit,
  onDelete,
}: MedicineCardProps) {
  const [imageError, setImageError] = useState(false);
  const shouldShowImage = item.foto_uri && !imageError;

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
        <Text style={styles.title}>{item.nome_comercial}</Text>
        <Text style={styles.subtitle}>
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
        <Pressable style={styles.actionButton} onPress={onEdit}>
          <MaterialCommunityIcons name="pencil" size={22} color="#0F172A" />
        </Pressable>
        <Pressable style={styles.actionButtonDanger} onPress={onDelete}>
          <MaterialCommunityIcons name="trash-can" size={22} color="#B91C1C" />
        </Pressable>
      </View>
    </Card>
  );
}

type FormFieldProps = {
  styles: ReturnType<typeof createStyles>;
  label: string;
  value: string;
  onChangeText: (value: string) => void;
};

function FormField({ styles, label, value, onChangeText }: FormFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor="#64748B"
      />
    </View>
  );
}

const createStyles = (scaleFont: (size: number) => number) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    padding: 16,
    paddingTop: 50,
  },
  screenTitle: {
    fontSize: scaleFont(24),
    fontWeight: "bold",
    color: "#000000",
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
    color: "#475569",
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
    color: "#111827",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: scaleFont(16),
    color: "#475569",
    marginBottom: 5,
  },
  dosage: {
    fontSize: scaleFont(16),
    color: "#334155",
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
    backgroundColor: "#F1F5F9",
  },
  actionButtonDanger: {
    width: 42,
    height: 42,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEE2E2",
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
  modalBackdrop: {
    flex: 1,
    justifyContent: "center",
    padding: 18,
    backgroundColor: "#00000080",
  },
  modalPanel: {
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
    borderColor: "#CBD5E1",
  },
  statusOptionActive: {
    borderColor: "#007AFF",
    backgroundColor: "#007AFF",
  },
  statusOptionText: {
    fontSize: scaleFont(14),
    fontWeight: "700",
    color: "#334155",
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
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
  },
  secondaryButtonText: {
    fontSize: scaleFont(17),
    fontWeight: "700",
    color: "#0F172A",
  },
  });
