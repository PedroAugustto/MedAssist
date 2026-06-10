export const userFriendlyErrorMessage = (
  error: unknown,
  fallback: string,
) => {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";

  if (!message || message.includes("NullPointer")) {
    return fallback;
  }

  return message;
};
