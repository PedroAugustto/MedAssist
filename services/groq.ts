import {
  DEFAULT_USER_ID,
  getUserProfile,
  listMedications,
} from "./database";
import { buildLeafletRagContextForQuestion } from "./leaflets";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_TRANSCRIPTION_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL_NAME = "llama-3.3-70b-versatile";
const TRANSCRIPTION_MODEL_NAME = "whisper-large-v3-turbo";
const MAX_HISTORY_MESSAGES = 12;
const MAX_COMPLETION_TOKENS = 260;
const MEDICATION_OCR_MAX_COMPLETION_TOKENS = 700;

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

export type MedicationFieldOrigin =
  | "extraido_da_embalagem"
  | "inferido_pela_ia"
  | "nao_encontrado";

export type MedicationOcrSuggestion = {
  medicamento_detectado: boolean;
  nome_comercial: string | null;
  principio_ativo: string | null;
  dosagem: string | null;
  observacoes: string | null;
  confianca: number;
  campos: {
    nome_comercial: MedicationFieldOrigin;
    principio_ativo: MedicationFieldOrigin;
    dosagem: MedicationFieldOrigin;
  };
  rawResponse: string;
};

const emptyMedicationOcrSuggestion = (
  rawResponse: string,
  observacoes = "Nao foi possivel identificar um medicamento no texto lido.",
): MedicationOcrSuggestion => ({
  medicamento_detectado: false,
  nome_comercial: null,
  principio_ativo: null,
  dosagem: null,
  observacoes,
  confianca: 0,
  campos: {
    nome_comercial: "nao_encontrado",
    principio_ativo: "nao_encontrado",
    dosagem: "nao_encontrado",
  },
  rawResponse,
});

const compactText = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed || undefined;
};

const normalizeForMatching = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const cleanJsonText = (text: string) => {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  return start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
};

const parseJsonObject = (text: string) => JSON.parse(cleanJsonText(text));

const normalizeConfidence = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
};

const normalizeFieldOrigin = (value: unknown): MedicationFieldOrigin =>
  value === "extraido_da_embalagem" ||
  value === "inferido_pela_ia" ||
  value === "nao_encontrado"
    ? value
    : "nao_encontrado";

const normalizeMedicationOcrSuggestion = (
  parsed: any,
  rawResponse: string,
): MedicationOcrSuggestion => {
  const nomeComercial = compactText(parsed?.nome_comercial) || null;
  const principioAtivo = compactText(parsed?.principio_ativo) || null;
  const dosagem = compactText(parsed?.dosagem) || null;
  const detected =
    typeof parsed?.medicamento_detectado === "boolean"
      ? parsed.medicamento_detectado
      : Boolean(nomeComercial || principioAtivo);

  return {
    medicamento_detectado: detected,
    nome_comercial: nomeComercial,
    principio_ativo: principioAtivo,
    dosagem,
    observacoes: compactText(parsed?.observacoes) || null,
    confianca: normalizeConfidence(parsed?.confianca),
    campos: {
      nome_comercial: normalizeFieldOrigin(parsed?.campos?.nome_comercial),
      principio_ativo: normalizeFieldOrigin(parsed?.campos?.principio_ativo),
      dosagem: normalizeFieldOrigin(parsed?.campos?.dosagem),
    },
    rawResponse,
  };
};

const buildMedicationOcrPrompt = (ocrText: string) => `
Voce recebe texto extraido por OCR de uma embalagem de medicamento.
Sua tarefa e identificar os dados usados no cadastro do app.

Texto OCR:
${ocrText}

Retorne somente JSON valido, sem markdown e sem explicacoes fora do JSON.
Nao retorne posologia, frequencia, duracao ou fontes.
Se o texto tiver apenas o nome comercial do medicamento, tente completar principio_ativo e dosagem com seu conhecimento geral, mas marque o campo como "inferido_pela_ia".
Se for um medicamento generico e nao houver nome comercial claro, use null em nome_comercial, preencha principio_ativo com o principio ativo identificado e marque medicamento_detectado true.
Se nao houver medicamento claro no texto, use medicamento_detectado false.
Campos inferidos devem ser citados em observacoes para o usuario revisar.

Formato obrigatorio:
{
  "medicamento_detectado": boolean,
  "nome_comercial": string | null,
  "principio_ativo": string | null,
  "dosagem": string | null,
  "observacoes": string | null,
  "confianca": number,
  "campos": {
    "nome_comercial": "extraido_da_embalagem" | "inferido_pela_ia" | "nao_encontrado",
    "principio_ativo": "extraido_da_embalagem" | "inferido_pela_ia" | "nao_encontrado",
    "dosagem": "extraido_da_embalagem" | "inferido_pela_ia" | "nao_encontrado"
  }
}
`.trim();

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

const findMentionedActiveMedication = async ({
  question,
  usuarioId,
}: {
  question: string;
  usuarioId: string;
}) => {
  const medications = await listMedications(usuarioId);
  const normalizedQuestion = normalizeForMatching(question);

  return (
    medications
      .filter((medication) => medication.status_tratamento === "ativo")
      .find((medication) => {
        const name = normalizeForMatching(medication.nome_comercial);
        const principle = medication.principio_ativo
          ? normalizeForMatching(medication.principio_ativo)
          : "";

        return (
          (name.length >= 4 && normalizedQuestion.includes(name)) ||
          (principle.length >= 4 && normalizedQuestion.includes(principle))
        );
      }) || null
  );
};

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

Sempre avalie se os dados cadastrados do usuario sao relevantes para a pergunta.
Quando forem relevantes, use idade, peso, alergias, condicoes de saude, gestacao/lactacao e medicamentos ativos para adaptar cuidados, alertas e ressalvas, mesmo que o usuario nao diga "considerando meus dados".
Se algum dado cadastrado influenciar a resposta, mencione isso de forma breve e natural.
Se os dados nao forem relevantes, nao mencione o contexto cadastrado.
O campo medicamentosCadastradosAtivos contem somente medicamentos ativos no app.
Voce nao tem acesso a medicamentos pausados ou finalizados, a menos que o usuario informe esses dados na conversa.
Nao trate esses dados como diagnostico completo.
Nao prescreva, nao ajuste dose e nao substitua orientacao profissional.
`.trim(),
});

type LeafletAnswerMode = "rag" | "general";

const buildLeafletContextMessage = async ({
  messages,
  usuarioId,
}: {
  messages: ChatMessage[];
  usuarioId: string;
}): Promise<{ message: GroqMessage; mode: LeafletAnswerMode } | null> => {
  const lastUserMessage = messages
    .slice()
    .reverse()
    .find((message) => message.role === "user");

  if (!lastUserMessage) {
    return null;
  }

  const [ragContext, mentionedMedication] = await Promise.all([
    buildLeafletRagContextForQuestion({
      question: lastUserMessage.content,
      usuarioId,
    }),
    findMentionedActiveMedication({
      question: lastUserMessage.content,
      usuarioId,
    }),
  ]);

  if (!mentionedMedication) {
    return null;
  }

  if (!ragContext) {
    return {
      mode: "general",
      message: {
        role: "system",
        content: `
Voce deve priorizar responder duvidas sobre medicamentos usando o resumo da bula salvo no app.
Para esta pergunta, o app nao conseguiu encontrar trechos relevantes no resumo da bula salvo.
Responda usando seu conhecimento geral, mas a PRIMEIRA frase da resposta deve ser exatamente:
"Nao consegui extrair essa informacao do resumo da bula salvo, entao vou responder com conhecimento geral."
Depois responda de forma curta e cuidadosa.
Nao diga que consultou a bula.
`.trim(),
      },
    };
  }

  return {
    mode: "rag",
    message: {
      role: "system",
      content: `
Trechos do resumo estruturado da bula salvo localmente para o medicamento ${ragContext.medication.nome_comercial}.
Fonte usada para o resumo: ${ragContext.leaflet.fonte_nome}
URL da fonte: ${ragContext.leaflet.fonte_url}
Resumo salvo em: ${ragContext.leaflet.baixado_em}

Responda preferencialmente e prioritariamente com base nestes trechos do resumo da bula salvo.
Se qualquer trecho responder a pergunta, use somente as informacoes dos trechos, NAO use o aviso de conhecimento geral, e inclua no final:
"Fonte: resumo da bula salvo no app."
Se os trechos nao forem suficientes para responder, a PRIMEIRA frase da resposta deve ser exatamente:
"Nao consegui extrair essa informacao do resumo da bula salvo, entao vou responder com conhecimento geral."
Nesse caso, depois dessa frase, voce pode responder com conhecimento geral de forma curta e cuidadosa.
Nunca diga que uma informacao veio da bula se ela nao estiver nos trechos.

Trechos:
${ragContext.chunks
  .map(
    (chunk, index) => `
[Trecho ${index + 1} - ${chunk.secao}]
${chunk.texto}
`.trim(),
  )
  .join("\n\n")}
`.trim(),
    },
  };
};

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
  const leafletContext = await buildLeafletContextMessage({
    messages,
    usuarioId,
  });
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
        ...(leafletContext ? [leafletContext.message] : []),
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

  if (
    leafletContext?.mode === "rag" &&
    content.startsWith(
      "Nao consegui extrair essa informacao do resumo da bula salvo",
    ) &&
    content.includes("Fonte: resumo da bula salvo no app")
  ) {
    return content
      .replace(
        /^Nao consegui extrair essa informacao do resumo da bula salvo, entao vou responder com conhecimento geral\.\s*/i,
        "",
      )
      .trim();
  }

  if (
    leafletContext?.mode === "general" &&
    !content.startsWith(
      "Nao consegui extrair essa informacao do resumo da bula salvo",
    )
  ) {
    return `Nao consegui extrair essa informacao do resumo da bula salvo, entao vou responder com conhecimento geral.\n\n${content}`;
  }

  return content;
};

export const identifyMedicationFromOcrText = async (
  ocrText: string,
): Promise<MedicationOcrSuggestion> => {
  const apiKey = process.env.EXPO_PUBLIC_GROQ_API_KEY || "";
  const text = ocrText.trim();

  if (!apiKey) {
    throw new Error("Chave da Groq nao configurada no .env.");
  }

  if (text.length < 4) {
    return emptyMedicationOcrSuggestion(
      "{}",
      "Nao consegui ler texto suficiente da embalagem.",
    );
  }

  console.log("[MedicationOCR] Enviando texto OCR para Groq.", {
    textLength: text.length,
    textPreview: text.slice(0, 700),
  });

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [
        {
          role: "system",
          content:
            "Voce estrutura texto OCR de embalagens de medicamentos em JSON para cadastro. Seja conservador, mas pode inferir campos comuns quando so o nome comercial estiver claro. Nunca retorne posologia.",
        },
        {
          role: "user",
          content: buildMedicationOcrPrompt(text),
        },
      ],
      temperature: 0,
      top_p: 0.9,
      max_completion_tokens: MEDICATION_OCR_MAX_COMPLETION_TOKENS,
      response_format: { type: "json_object" },
    }),
  });
  const data = (await response.json()) as GroqChatCompletion;

  if (!response.ok) {
    throw new Error(
      data.error?.message || "Nao foi possivel interpretar o texto da embalagem.",
    );
  }

  const rawResponse = data.choices?.[0]?.message?.content?.trim() || "{}";
  console.log("[MedicationOCR] Resposta do Groq para OCR.", {
    rawResponse,
  });

  try {
    const parsed = parseJsonObject(rawResponse);
    const suggestion = normalizeMedicationOcrSuggestion(parsed, rawResponse);

    console.log("[MedicationOCR] Sugestao normalizada.", {
      medicamentoDetectado: suggestion.medicamento_detectado,
      nomeComercial: suggestion.nome_comercial,
      principioAtivo: suggestion.principio_ativo,
      dosagem: suggestion.dosagem,
      confianca: suggestion.confianca,
      campos: suggestion.campos,
    });

    return suggestion;
  } catch (error) {
    console.warn("[MedicationOCR] Falha ao interpretar JSON do Groq.", {
      erro: error instanceof Error ? error.message : String(error),
      rawResponse,
    });

    return emptyMedicationOcrSuggestion(
      rawResponse,
      "Nao consegui interpretar a resposta da IA. Tente outra foto ou preencha manualmente.",
    );
  }
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
