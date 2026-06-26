import TextRecognition from "@react-native-ml-kit/text-recognition";

const OCR_LOG_PREFIX = "[MedicationOCR]";
const MIN_OCR_TEXT_LENGTH = 4;

export type OcrTextResult = {
  text: string;
  blocksCount: number;
};

const normalizeOcrText = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();

export const extractTextFromMedicationImage = async (
  imageUri: string,
): Promise<OcrTextResult> => {
  console.log(`${OCR_LOG_PREFIX} Iniciando OCR da imagem.`, { imageUri });

  try {
    const result = await TextRecognition.recognize(imageUri);
    const text = normalizeOcrText(result.text || "");

    console.log(`${OCR_LOG_PREFIX} OCR finalizado.`, {
      textLength: text.length,
      blocksCount: result.blocks?.length || 0,
      textPreview: text.slice(0, 500),
    });

    if (text.length < MIN_OCR_TEXT_LENGTH) {
      throw new Error(
        "Nao consegui ler o texto da embalagem. Tente outra foto com mais luz ou preencha manualmente.",
      );
    }

    return {
      text,
      blocksCount: result.blocks?.length || 0,
    };
  } catch (error) {
    console.warn(`${OCR_LOG_PREFIX} Falha ao ler texto da imagem.`, {
      erro: error instanceof Error ? error.message : String(error),
    });

    if (
      error instanceof Error &&
      error.message.includes("doesn't seem to be linked")
    ) {
      throw new Error(
        "OCR nativo nao esta disponivel no Expo Go. Use um development build ou preencha manualmente.",
      );
    }

    throw error instanceof Error
      ? error
      : new Error(
          "Nao consegui ler o texto da embalagem. Tente outra foto ou preencha manualmente.",
        );
  }
};
