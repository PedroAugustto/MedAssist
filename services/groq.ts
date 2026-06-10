import {
  DEFAULT_USER_ID,
  getUserProfile,
  listMedications,
} from "./database";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_TRANSCRIPTION_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL_NAME = "llama-3.3-70b-versatile";
const TRANSCRIPTION_MODEL_NAME = "whisper-large-v3-turbo";
const MAX_HISTORY_MESSAGES = 12;
const MAX_COMPLETION_TOKENS = 260;

const systemInstruction = `
Voce e o MedAssist, um assistente de saude amigavel para idosos.
Responda em portugues do Brasil, com frases curtas, simples e acolhedoras.
Responda de forma resumida, geralmente em 2 a 4 frases.
Nao comece toda resposta chamando o usuario pelo nome.
Nao termine toda resposta com aviso generico para consultar medico ou farmaceutico, pois esse aviso ja aparece fixo na tela.
Nao diagnostique, nao prescreva medicamentos e nao ajuste doses.
Oriente procurar medico ou farmaceutico apenas quando houver duvida especifica de uso, risco de alergia, interacao, gravidez, amamentacao, crianca, idoso fragil, dose, efeito adverso importante ou informacao insuficiente.
Para sintomas graves, como falta de ar, dor no peito, desmaio, confusao intensa, reacao alergica forte ou piora rapida, oriente procurar atendimento imediato.
Voce recebe do app apenas os medicamentos cadastrados como ativos. Se o usuario perguntar sobre medicamentos pausados, finalizados, antigos ou removidos, explique que o chat nao tem acesso a esses registros e peca para o usuario informar o nome do medicamento.
Se nao tiver certeza, diga isso com clareza.
`.trim();

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type UserHealthContext = {
  nomePreferido?: string;
  idade?: number;
  pesoKg?: number;
  alturaCm?: number;
  sexo?: string;
  gestante?: boolean;
  lactante?: boolean;
  alergias?: string[];
  condicoesSaude?: string[];
  medicamentosInformados?: string[];
  medicamentosCadastradosAtivos?: string[];
  observacoesClinicas?: string;
};

type GroqMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type GroqChatCompletion = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

type GroqTranscription = {
  text?: string;
  error?: {
    message?: string;
  };
};

const compactText = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed || undefined;
};

const splitTextList = (value: string | null | undefined) => {
  const text = compactText(value);

  if (!text) {
    return undefined;
  }

  const items = text
    .split(/[;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length > 0 ? items : [text];
};

const uniqueValues = (values: string[]) =>
  values.filter(
    (value, index, list) =>
      list.findIndex(
        (item) => item.trim().toLowerCase() === value.trim().toLowerCase(),
      ) === index,
  );

const calculateAge = (birthDate: string | null) => {
  if (!birthDate) {
    return undefined;
  }

  const [year, month, day] = birthDate.split("-").map(Number);
  if (!year || !month || !day) {
    return undefined;
  }

  const today = new Date();
  let age = today.getFullYear() - year;
  const hadBirthdayThisYear =
    today.getMonth() + 1 > month ||
    (today.getMonth() + 1 === month && today.getDate() >= day);

  if (!hadBirthdayThisYear) {
    age -= 1;
  }

  return age >= 0 && age <= 130 ? age : undefined;
};

const firstName = (name: string) => compactText(name)?.split(/\s+/)[0];

const removeEmptyFields = <T extends Record<string, unknown>>(input: T) =>
  Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (value === undefined || value === null || value === "") {
        return false;
      }

      if (Array.isArray(value)) {
        return value.length > 0;
      }

      return true;
    }),
  ) as Partial<T>;

export const buildUserHealthContext = async (
  usuarioId: string = DEFAULT_USER_ID,
): Promise<UserHealthContext> => {
  const [profile, medications] = await Promise.all([
    getUserProfile(usuarioId),
    listMedications(usuarioId),
  ]);
  const activeMedications = medications
    .filter((medication) => medication.status_tratamento === "ativo")
    .map((medication) =>
      [
        medication.nome_comercial,
        medication.dosagem,
        medication.principio_ativo
          ? `(${medication.principio_ativo})`
          : undefined,
      ]
        .filter(Boolean)
        .join(" "),
    );
  const medicamentosInformados = splitTextList(
    profile.usa_outros_medicamentos,
  );

  return removeEmptyFields({
    nomePreferido: firstName(profile.nome),
    idade: calculateAge(profile.data_nascimento),
    pesoKg: profile.peso_kg ?? undefined,
    alturaCm: profile.altura_cm ?? undefined,
    sexo:
      profile.sexo && profile.sexo !== "nao_informado"
        ? profile.sexo
        : undefined,
    gestante: Boolean(profile.gestante) || undefined,
    lactante: Boolean(profile.lactante) || undefined,
    alergias: splitTextList(profile.alergias),
    condicoesSaude: splitTextList(profile.condicoes_saude),
    medicamentosInformados: medicamentosInformados
      ? uniqueValues(medicamentosInformados)
      : undefined,
    medicamentosCadastradosAtivos:
      activeMedications.length > 0 ? uniqueValues(activeMedications) : undefined,
    observacoesClinicas: compactText(profile.observacoes_clinicas),
  });
};

const buildContextMessage = (context: UserHealthContext): GroqMessage => ({
  role: "system",
  content: `
Contexto atual do usuario fornecido pelo app:
${JSON.stringify(context)}

Use esse contexto apenas para adaptar alertas gerais de seguranca.
O campo medicamentosCadastradosAtivos contem somente medicamentos ativos no app.
Voce nao tem acesso a medicamentos pausados ou finalizados, a menos que o usuario informe esses dados na conversa.
Nao trate esses dados como diagnostico completo.
`.trim(),
});

const toGroqHistory = (messages: ChatMessage[]): GroqMessage[] =>
  messages
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }))
    .filter((message) => message.content);

export const generateGroqChatResponse = async ({
  messages,
  usuarioId = DEFAULT_USER_ID,
}: {
  messages: ChatMessage[];
  usuarioId?: string;
}): Promise<string> => {
  const apiKey = process.env.EXPO_PUBLIC_GROQ_API_KEY || "";

  if (!apiKey) {
    throw new Error("Chave da Groq nao configurada no .env.");
  }

  const userContext = await buildUserHealthContext(usuarioId);
  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [
        { role: "system", content: systemInstruction },
        buildContextMessage(userContext),
        ...toGroqHistory(messages),
      ],
      temperature: 0.4,
      top_p: 0.9,
      max_completion_tokens: MAX_COMPLETION_TOKENS,
    }),
  });
  const data = (await response.json()) as GroqChatCompletion;

  if (!response.ok) {
    throw new Error(
      data.error?.message || "Nao foi possivel conversar com o MedAssist.",
    );
  }

  const content = data.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("A resposta do MedAssist veio vazia.");
  }

  return content;
};

const getAudioFileMetadata = (uri: string) => {
  const cleanUri = uri.split("?")[0];
  const extension = cleanUri.match(/\.[a-zA-Z0-9]+$/)?.[0]?.toLowerCase() || ".m4a";

  const mimeByExtension: Record<string, string> = {
    ".m4a": "audio/m4a",
    ".mp4": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".mpeg": "audio/mpeg",
    ".mpga": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".webm": "audio/webm",
    ".flac": "audio/flac",
  };

  return {
    name: `medassist-audio${extension}`,
    type: mimeByExtension[extension] || "audio/m4a",
  };
};

export const transcribeAudioWithGroq = async (
  audioUri: string,
  medicationVocabulary: string[] = [],
) => {
  const apiKey = process.env.EXPO_PUBLIC_GROQ_API_KEY || "";

  if (!apiKey) {
    throw new Error("Chave da Groq nao configurada no .env.");
  }

  const fileMetadata = getAudioFileMetadata(audioUri);
  const formData = new FormData();

  formData.append("model", TRANSCRIPTION_MODEL_NAME);
  formData.append("language", "pt");
  formData.append("temperature", "0");
  const medicationHint =
    medicationVocabulary.length > 0
      ? ` Medicamentos ativos do usuario: ${medicationVocabulary.join(", ")}. Se a fala parecer com algum desses nomes, transcreva usando o nome correto.`
      : "";
  formData.append(
    "prompt",
    `Transcreva uma pergunta curta em portugues do Brasil sobre saude, remedios ou rotina de medicamentos. Preserve nomes de medicamentos quando possivel.${medicationHint}`,
  );
  formData.append("file", {
    uri: audioUri,
    name: fileMetadata.name,
    type: fileMetadata.type,
  } as any);

  const response = await fetch(GROQ_TRANSCRIPTION_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });
  const data = (await response.json()) as GroqTranscription;

  if (!response.ok) {
    throw new Error(
      data.error?.message || "Nao foi possivel transcrever o audio.",
    );
  }

  const text = data.text?.trim();

  if (!text) {
    throw new Error("Nao consegui identificar fala no audio.");
  }

  return text;
};
