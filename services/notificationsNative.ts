import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

const DOSE_CHANNEL_ID = "dose-reminders";

export const configureMedicationNotifications = async () => {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(DOSE_CHANNEL_ID, {
      name: "Lembretes de doses",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#007AFF",
    });
  }
};

const ensureNotificationPermission = async () => {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) {
    return true;
  }

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
};

type ScheduleDoseNotificationInput = {
  medicamentoId: string;
  doseId: string;
  nomeComercial: string;
  dosagem: string | null;
  horarioAgendado: string;
};

export const scheduleDoseNotification = async ({
  medicamentoId,
  doseId,
  nomeComercial,
  dosagem,
  horarioAgendado,
}: ScheduleDoseNotificationInput) => {
  const scheduledDate = new Date(horarioAgendado);
  if (Number.isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
    return null;
  }

  try {
    const hasPermission = await ensureNotificationPermission();
    if (!hasPermission) {
      return null;
    }

    return await Notifications.scheduleNotificationAsync({
      content: {
        title: "Hora de tomar o medicamento",
        body: `${nomeComercial}${dosagem ? ` - ${dosagem}` : ""}`,
        sound: true,
        data: {
          doseId,
          medicamentoId,
          horarioAgendado,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: scheduledDate,
        channelId: DOSE_CHANNEL_ID,
      },
    });
  } catch (error) {
    console.warn("Nao foi possivel agendar notificacao da dose:", error);
    return null;
  }
};

export const cancelDoseNotifications = async (notificationIds: string[]) => {
  const uniqueIds = Array.from(new Set(notificationIds.filter(Boolean)));

  await Promise.allSettled(
    uniqueIds.map((notificationId) =>
      Notifications.cancelScheduledNotificationAsync(notificationId),
    ),
  );
};
