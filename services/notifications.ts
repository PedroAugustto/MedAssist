import Constants from "expo-constants";

type ScheduleDoseNotificationInput = {
  medicamentoId: string;
  doseId: string;
  nomeComercial: string;
  dosagem: string | null;
  horarioAgendado: string;
};

const canUseNativeNotifications = Constants.appOwnership !== "expo";

const loadNativeNotifications = async () => {
  if (!canUseNativeNotifications) {
    return null;
  }

  return import("./notificationsNative");
};

export const configureMedicationNotifications = async () => {
  const nativeNotifications = await loadNativeNotifications();
  await nativeNotifications?.configureMedicationNotifications();
};

export const scheduleDoseNotification = async (
  input: ScheduleDoseNotificationInput,
) => {
  const nativeNotifications = await loadNativeNotifications();
  if (!nativeNotifications) {
    return null;
  }

  return nativeNotifications.scheduleDoseNotification(input);
};

export const cancelDoseNotifications = async (notificationIds: string[]) => {
  const nativeNotifications = await loadNativeNotifications();
  await nativeNotifications?.cancelDoseNotifications(notificationIds);
};
