import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import React, { useState } from "react";
import { FlatList, Image, StyleSheet, Text, View } from "react-native";

import Card from "../../components/Card";
import db from "../../db.json";

export default function InventoryScreen() {
  const MedicineItem = ({ item }: { item: any }) => {
    const [imageError, setImageError] = useState(false);

    return (
      <Card theme="default" style={styles.medicineCard}>
        <View style={styles.cardIconWrapper}>
          {!imageError ? (
            <Image
              source={{ uri: item.foto_uri }}
              style={styles.image}
              onError={() => setImageError(true)}
            />
          ) : (
            <MaterialCommunityIcons name="pill" size={24} color="#ffffff" />
          )}
        </View>
        <View style={styles.cardContent}>
          <Text style={styles.title}>{item.nome_comercial}</Text>
          <Text style={styles.subtitle}>{item.dosagem}</Text>
          <Text style={styles.quantity}>
            Quantidade: {item.estoque_atual}/{item.estoque_total}
          </Text>
        </View>
      </Card>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.screenTitle}>Meus Remédios</Text>
      <FlatList
        data={db.medicamentos}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MedicineItem item={item} />}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    padding: 16,
    paddingTop: 50,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#000000",
    marginBottom: 16,
  },
  listContent: {
    paddingBottom: 24,
  },
  medicineCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
  },
  cardIconWrapper: {
    width: 54,
    height: 54,
    borderRadius: 28,
    backgroundColor: "#2563EB",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  image: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  cardContent: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: "#475569",
    marginBottom: 6,
  },
  quantity: {
    fontSize: 16,
    color: "#334155",
  },
  separator: {
    height: 12,
  },
});
