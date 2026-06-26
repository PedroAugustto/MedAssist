import { GoogleGenAI } from "@google/genai";

import {
  DEFAULT_USER_ID,
  findMedicationById,
  getMedicationLeafletByMedicationId,
  getUserProfile,
  listMedications,
  listMedicationLeafletChunks,
  Medication,
  MedicationLeaflet,
  MedicationLeafletChunk,
  MedicationLeafletSourceType,
  saveMedicationLeaflet,
} from "./database";

const MODEL_NAME = "gemini-2.5-flash";
const API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || "";
const groundedAI = new GoogleGenAI({ apiKey: API_KEY });
const LEAFLET_LOG_PREFIX = "[LeafletSearch]";

const TRUSTED_LEAFLET_HOSTS = [
  "consultas.anvisa.gov.br",
  "anvisa.gov.br",
  "gov.br",
  "saude.gov.br",
  "pfizer.com.br",
  "eurofarma.com.br",
  "ems.com.br",
  "ache.com.br",
  "medley.com.br",
  "sanofi.com.br",
  "bayer.com.br",
  "novartis.com.br",
  "roche.com.br",
  "bulas.med.br",
  "consultaremedios.com.br",
];

type LeafletSearchJson = {
  titulo?: string | null;
  fonte_nome?: string | null;
  fonte_url?: string | null;
  markdown?: string | null;
  status?: "baixada" | "nao_encontrada" | "erro";
};

export type SavedMedicationLeafletResult = {
  status: "baixada" | "nao_encontrada" | "erro";
  bulaId: string | null;
  fonteNome: string | null;
  fonteUrl: string | null;
};

export type MedicationLeafletRagContext = {
  medication: Medication;
  leaflet: Pick<
    MedicationLeaflet,
    "titulo" | "fonte_nome" | "fonte_url" | "status" | "baixado_em"
  >;
  chunks: MedicationLeafletChunk[];
};

export type LeafletDosageSuggestion = {
  frequencia_horas: number | null;
  duracao_dias: number | null;
  observacoes: string;
  fonte_nome: string;
  fonte_url: string;
  trechos: MedicationLeafletChunk[];
  trechos_recomendados: MedicationLeafletChunk[];
  alertas_seguranca: MedicationLeafletSafetyAlert[];
  menciona_dose_por_peso: boolean;
};

export type MedicationLeafletSafetyAlert = {
  nivel: "alto" | "atencao";
  titulo: string;
  motivo: string;
  dado_usuario_relacionado: string;
  trecho_bula: string;
};

const normalizeText = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

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

const parseLeafletJson = (text: string): LeafletSearchJson =>
  JSON.parse(cleanJsonText(text));

const previewText = (text: string | null | undefined, maxLength = 500) => {
  if (!text) {
    return "";
  }

  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const logLeafletSearch = (message: string, data?: unknown) => {
  if (data === undefined) {
    console.log(`${LEAFLET_LOG_PREFIX} ${message}`);
    return;
  }

  console.log(`${LEAFLET_LOG_PREFIX} ${message}`, data);
};

const warnLeafletSearch = (message: string, data?: unknown) => {
  if (data === undefined) {
    console.warn(`${LEAFLET_LOG_PREFIX} ${message}`);
    return;
  }

  console.warn(`${LEAFLET_LOG_PREFIX} ${message}`, data);
};

const getHostname = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

const isTrustedLeafletSource = (url: string) => {
  const host = getHostname(url);

  return TRUSTED_LEAFLET_HOSTS.some(
    (trustedHost) => host === trustedHost || host.endsWith(`.${trustedHost}`),
  );
};

const hostnameFromSourceTitle = (title: string) => {
  const normalized = title.trim().toLowerCase().replace(/^www\./, "");

  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(normalized) ? normalized : "";
};

const sourceIdentityHost = (source: { titulo: string; url: string }) => {
  const urlHost = getHostname(source.url);

  if (urlHost === "vertexaisearch.cloud.google.com") {
    return hostnameFromSourceTitle(source.titulo) || urlHost;
  }

  return urlHost || hostnameFromSourceTitle(source.titulo);
};

const isTrustedLeafletSourceCandidate = (source: {
  titulo: string;
  url: string;
}) => {
  const host = sourceIdentityHost(source);

  return TRUSTED_LEAFLET_HOSTS.some(
    (trustedHost) => host === trustedHost || host.endsWith(`.${trustedHost}`),
  );
};

const sourceTypeFromHost = (host: string): MedicationLeafletSourceType => {
  if (host.includes("anvisa") || host.endsWith("gov.br")) {
    return "anvisa";
  }

  if (host.includes("bula") || host.includes("consultaremedios")) {
    return "bula";
  }

  return host ? "laboratorio" : "outra";
};

const hashText = (text: string) => {
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash).toString(16);
};

const medicationSearchLabel = (medication: Medication) =>
  [
    medication.nome_comercial,
    medication.principio_ativo ? `(${medication.principio_ativo})` : null,
    medication.dosagem,
  ]
    .filter(Boolean)
    .join(" ");

const buildLeafletPrompt = (medication: Medication) => `
Busque UMA fonte brasileira confiavel de bula para este medicamento:
- nome comercial: ${medication.nome_comercial}
- principio ativo: ${medication.principio_ativo || "nao informado"}
- dosagem/apresentacao: ${medication.dosagem || "nao informada"}

Priorize nesta ordem:
1. Bulario Eletronico/Consultas da Anvisa.
2. Site oficial do laboratorio.
3. Pagina que reproduza bula oficial, como Consulta Remedios ou BulasMed.

Escolha a primeira fonte confiavel encontrada. Se houver varias opcoes confiaveis, use a primeira.
Nao use blogs, foruns, redes sociais ou paginas sem fonte de bula.
Nao transcreva a bula inteira.
Nao explique seu processo.

Retorne um Markdown CURTO, com no maximo 900 palavras no total, fiel a fonte consultada.
Use exatamente estas secoes:
- Identificacao
- Para que serve
- Quando nao devo usar
- Advertencias e cuidados
- Interacoes medicamentosas
- Reacoes adversas
- Como usar

Para cada secao, escreva 1 a 3 frases. Nao invente informacoes.
Se a fonte nao trouxer uma secao, escreva "Nao encontrado na fonte consultada."

Retorne apenas JSON valido, sem markdown externo, sem comentarios e sem texto antes/depois:
{
  "titulo": string,
  "fonte_nome": string,
  "fonte_url": string,
  "markdown": string,
  "status": "baixada" | "nao_encontrada" | "erro"
}
`;

const extractGroundedSources = (response: any) =>
  response.candidates?.[0]?.groundingMetadata?.groundingChunks
    ?.map((chunk: any) => chunk.web)
    .filter((source: any) => Boolean(source?.uri))
    .map((source: any) => ({
      titulo: normalizeText(source?.title) || "Fonte consultada",
      url: normalizeText(source?.uri) || "",
    })) || [];

const summarizeGroundingMetadata = (response: any) => {
  const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
  const chunks = groundingMetadata?.groundingChunks || [];
  const supports = groundingMetadata?.groundingSupports || [];

  return {
    metadataKeys: groundingMetadata ? Object.keys(groundingMetadata) : [],
    webSearchQueries: groundingMetadata?.webSearchQueries || [],
    searchEntryPoint: groundingMetadata?.searchEntryPoint
      ? {
          keys: Object.keys(groundingMetadata.searchEntryPoint),
          renderedContentPreview: previewText(
            groundingMetadata.searchEntryPoint.renderedContent,
            500,
          ),
        }
      : null,
    groundingChunks: chunks.slice(0, 8).map((chunk: any, index: number) => ({
      index,
      chunkKeys: Object.keys(chunk || {}),
      webKeys: chunk?.web ? Object.keys(chunk.web) : [],
      web: chunk?.web
        ? {
            title: chunk.web.title,
            uri: chunk.web.uri,
            domain: chunk.web.domain,
            host: chunk.web.uri ? getHostname(chunk.web.uri) : "",
            sourceIdentityHost: chunk.web.uri
              ? sourceIdentityHost({
                  titulo: normalizeText(chunk.web.title) || "",
                  url: normalizeText(chunk.web.uri) || "",
                })
              : "",
          }
        : null,
    })),
    groundingSupports: supports.slice(0, 5).map((support: any) => ({
      keys: Object.keys(support || {}),
      groundingChunkIndices: support?.groundingChunkIndices,
      segment: support?.segment,
    })),
  };
};

const firstTrustedSource = (
  parsed: LeafletSearchJson,
  groundedSources: Array<{ titulo: string; url: string }>,
) => {
  const parsedSource = {
    titulo:
      normalizeText(parsed.fonte_nome) ||
      normalizeText(parsed.titulo) ||
      "Fonte consultada",
    url: normalizeText(parsed.fonte_url) || "",
  };
  const candidates = [
    ...(parsedSource.url ? [parsedSource] : []),
    ...groundedSources,
  ];

  return (
    candidates.find((source) => isTrustedLeafletSourceCandidate(source)) ||
    candidates[0] ||
    null
  );
};

const markdownToChunks = (markdown: string) => {
  const chunks: Array<{ secao: string; texto: string }> = [];
  const sections = markdown.split(/\n(?=#{1,6}\s+)/g);

  for (const section of sections) {
    const trimmed = section.trim();

    if (!trimmed) {
      continue;
    }

    const title = trimmed.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim() || "Bula";
    const text = trimmed.replace(/^#{1,6}\s+.+$/m, "").trim() || trimmed;

    if (text) {
      chunks.push({
        secao: title,
        texto: text.slice(0, 1600),
      });
    }
  }

  return chunks.length > 0
    ? chunks
    : [
        {
          secao: "Bula",
          texto: markdown.slice(0, 1600),
        },
      ];
};

const saveLeafletSearchFailure = async (
  medication: Medication,
  status: "nao_encontrada" | "erro",
  message: string,
) => {
  warnLeafletSearch("Salvando falha da busca de bula.", {
    medicamentoId: medication.id,
    medicamento: medicationSearchLabel(medication),
    status,
    mensagem: previewText(message, 300),
  });

  const bulaId = await saveMedicationLeaflet({
    medicamento_id: medication.id,
    usuario_id: medication.usuario_id,
    titulo: `Resumo de bula de ${medicationSearchLabel(medication)}`,
    fonte_nome:
      status === "erro" ? "Erro ao buscar bula" : "Fonte nao encontrada",
    fonte_url: "",
    fonte_tipo: "outra",
    markdown: message,
    hash_conteudo: hashText(message),
    status,
    chunks: [],
  });

  return {
    status,
    bulaId,
    fonteNome: null,
    fonteUrl: null,
  };
};

export const fetchAndSaveMedicationLeaflet = async (
  medicamentoId: string,
): Promise<SavedMedicationLeafletResult> => {
  logLeafletSearch("Iniciando busca de bula.", { medicamentoId });
  const medication = await findMedicationById(medicamentoId);

  if (!medication) {
    warnLeafletSearch("Medicamento nao encontrado no banco.", {
      medicamentoId,
    });
    throw new Error("Medicamento nao encontrado para buscar bula.");
  }

  logLeafletSearch("Medicamento encontrado para busca.", {
    medicamentoId: medication.id,
    nomeComercial: medication.nome_comercial,
    principioAtivo: medication.principio_ativo,
    dosagem: medication.dosagem,
    temGeminiKey: Boolean(API_KEY),
  });

  try {
    if (!API_KEY) {
      throw new Error("Chave do Gemini nao configurada no .env.");
    }

    const prompt = buildLeafletPrompt(medication);
    logLeafletSearch("Enviando prompt ao Gemini.", {
      model: MODEL_NAME,
      promptPreview: previewText(prompt, 700),
    });

    const response = await groundedAI.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction:
          "Voce e o MedAssist. Busque uma fonte brasileira confiavel de bula e retorne somente JSON valido. Seja breve, fiel a fonte e nunca invente.",
        temperature: 0,
        maxOutputTokens: 5000,
        tools: [{ googleSearch: {} }],
      },
    });
    logLeafletSearch("Resposta bruta recebida do Gemini.", {
      textPreview: previewText(response.text, 900),
      candidatesCount: response.candidates?.length || 0,
      finishReason: response.candidates?.[0]?.finishReason,
    });
    logLeafletSearch(
      "Grounding metadata detalhado da busca de bula.",
      summarizeGroundingMetadata(response),
    );

    let parsed: LeafletSearchJson;
    try {
      parsed = parseLeafletJson(response.text || "{}");
    } catch (parseError) {
      warnLeafletSearch("Falha ao interpretar JSON retornado pelo Gemini.", {
        erro:
          parseError instanceof Error
            ? parseError.message
            : "Erro desconhecido ao interpretar JSON.",
        textPreview: previewText(response.text, 900),
      });

      return saveLeafletSearchFailure(
        medication,
        "erro",
        "Erro ao interpretar resposta da busca de bula.",
      );
    }

    const groundedSources = extractGroundedSources(response);
    const source = firstTrustedSource(parsed, groundedSources);
    const markdown = normalizeText(parsed.markdown);
    const hasTrustedSource = source
      ? isTrustedLeafletSourceCandidate(source)
      : false;
    const parsedHost = parsed.fonte_url ? getHostname(parsed.fonte_url) : "";
    const selectedHost = source ? sourceIdentityHost(source) : "";

    logLeafletSearch("Resultado interpretado da busca.", {
      parsedStatus: parsed.status,
      parsedFonteNome: parsed.fonte_nome,
      parsedFonteUrl: parsed.fonte_url,
      parsedHost,
      markdownLength: markdown?.length || 0,
      groundedSourcesCount: groundedSources.length,
      groundedSources: groundedSources
        .slice(0, 5)
        .map((item: { titulo: string; url: string }) => ({
          titulo: item.titulo,
          url: item.url,
          host: sourceIdentityHost(item),
          urlHost: getHostname(item.url),
          confiavel: isTrustedLeafletSourceCandidate(item),
        })),
      selectedSource: source
        ? {
            titulo: source.titulo,
            url: source.url,
            host: selectedHost,
            urlHost: getHostname(source.url),
            confiavel: hasTrustedSource,
          }
        : null,
    });

    if (!source || !markdown || !hasTrustedSource) {
      warnLeafletSearch("Busca rejeitada antes de salvar como baixada.", {
        temFonte: Boolean(source),
        temMarkdown: Boolean(markdown),
        fonteConfiavel: hasTrustedSource,
        selectedHost,
      });

      return saveLeafletSearchFailure(
        medication,
        "nao_encontrada",
        markdown ||
          "Resumo de bula nao encontrado em fonte confiavel. Tente novamente mais tarde.",
      );
    }

    const sourceUrl = source.url;
    const sourceName =
      source.titulo || normalizeText(parsed.fonte_nome) || "Fonte da bula";
    const title =
      normalizeText(parsed.titulo) ||
      `Resumo de bula de ${medicationSearchLabel(medication)}`;
    const chunks = markdownToChunks(markdown);
    const sourceType = sourceTypeFromHost(selectedHost);

    logLeafletSearch("Salvando bula encontrada.", {
      medicamentoId: medication.id,
      titulo: title,
      sourceName,
      sourceUrl,
      sourceHost: selectedHost,
      sourceType,
      markdownLength: markdown.length,
      chunksCount: chunks.length,
    });

    const bulaId = await saveMedicationLeaflet({
      medicamento_id: medication.id,
      usuario_id: medication.usuario_id,
      titulo: title,
      fonte_nome: sourceName,
      fonte_url: sourceUrl,
      fonte_tipo: sourceType,
      markdown,
      hash_conteudo: hashText(markdown),
      status: "baixada",
      chunks,
    });

    logLeafletSearch("Bula salva com sucesso.", {
      medicamentoId: medication.id,
      bulaId,
      fonteNome: sourceName,
      fonteUrl: sourceUrl,
    });

    return {
      status: "baixada",
      bulaId,
      fonteNome: sourceName,
      fonteUrl: sourceUrl,
    };
  } catch (error) {
    warnLeafletSearch("Erro inesperado na busca de bula.", {
      medicamentoId: medication.id,
      erro: error instanceof Error ? error.message : String(error),
    });

    return saveLeafletSearchFailure(
      medication,
      "erro",
      error instanceof Error
        ? `Erro ao buscar resumo de bula: ${error.message}`
        : "Erro ao buscar resumo de bula.",
    );
  }
};

const normalizeForSearch = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const scoreChunk = (question: string, chunk: MedicationLeafletChunk) => {
  const normalizedQuestion = normalizeForSearch(question);
  const normalizedText = normalizeForSearch(`${chunk.secao} ${chunk.texto}`);
  const words = normalizedQuestion
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4);

  return words.reduce(
    (score, word) => score + (normalizedText.includes(word) ? 1 : 0),
    0,
  );
};

const parseFrequencyHours = (text: string) => {
  const normalized = normalizeForSearch(text);
  const hourMatch = normalized.match(/(?:a cada|de|em)\s+(\d{1,2})\s+horas?/);

  if (hourMatch) {
    const hours = Number(hourMatch[1]);
    return Number.isFinite(hours) && hours > 0 ? hours : null;
  }

  const timesPerDayMatch = normalized.match(/(\d{1,2})\s+vez(?:es)?\s+ao\s+dia/);

  if (timesPerDayMatch) {
    const timesPerDay = Number(timesPerDayMatch[1]);
    return Number.isFinite(timesPerDay) && timesPerDay > 0
      ? Math.round(24 / timesPerDay)
      : null;
  }

  return null;
};

const parseDurationDays = (text: string) => {
  const normalized = normalizeForSearch(text);
  const durationMatch = normalized.match(
    /(?:por|durante)\s+(\d{1,3})\s+dias?/,
  );

  if (!durationMatch) {
    return null;
  }

  const days = Number(durationMatch[1]);
  return Number.isFinite(days) && days > 0 ? days : null;
};

const mentionsWeightBasedDose = (text: string) => {
  const normalized = normalizeForSearch(text);

  return (
    normalized.includes("mg/kg") ||
    normalized.includes("mg por kg") ||
    normalized.includes("por kg") ||
    normalized.includes("peso corporal")
  );
};

const splitProfileTerms = (value: string | null | undefined) =>
  (value || "")
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3);

const calculateAge = (isoDate: string | null) => {
  if (!isoDate) {
    return null;
  }

  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }

  const today = new Date();
  let age = today.getFullYear() - year;
  const hadBirthday =
    today.getMonth() + 1 > month ||
    (today.getMonth() + 1 === month && today.getDate() >= day);

  if (!hadBirthday) {
    age -= 1;
  }

  return age >= 0 && age <= 130 ? age : null;
};

const firstMatchingTerm = (text: string, terms: string[]) => {
  const normalizedText = normalizeForSearch(text);

  return terms.find((term) => {
    const normalizedTerm = normalizeForSearch(term);
    return normalizedTerm.length >= 3 && normalizedText.includes(normalizedTerm);
  });
};

const findProfileRelevantChunks = (
  chunks: MedicationLeafletChunk[],
  profileTerms: string[],
) =>
  chunks
    .map((chunk) => {
      const normalizedSection = normalizeForSearch(chunk.secao);
      const normalizedText = normalizeForSearch(`${chunk.secao} ${chunk.texto}`);
      const profileScore = profileTerms.reduce(
        (score, term) =>
          score + (normalizedText.includes(normalizeForSearch(term)) ? 2 : 0),
        0,
      );
      const sectionScore =
        normalizedSection.includes("como usar") ||
        normalizedSection.includes("posologia")
          ? 2
          : normalizedSection.includes("advertencia") ||
              normalizedSection.includes("cuidados") ||
              normalizedSection.includes("quando nao")
            ? 3
            : 0;

      return {
        chunk,
        score: profileScore + sectionScore,
      };
    })
    .filter((item) => item.score > 0)
    .sort((first, second) => second.score - first.score)
    .slice(0, 4)
    .map((item) => item.chunk);

const buildSafetyAlerts = ({
  chunks,
  medication,
  profile,
}: {
  chunks: MedicationLeafletChunk[];
  medication: Medication;
  profile: Awaited<ReturnType<typeof getUserProfile>>;
}) => {
  const alerts: MedicationLeafletSafetyAlert[] = [];
  const safetyChunks = chunks.filter((chunk) => {
    const section = normalizeForSearch(chunk.secao);

    return (
      section.includes("quando nao") ||
      section.includes("advertencia") ||
      section.includes("cuidados") ||
      section.includes("interaco")
    );
  });
  const searchableChunks = safetyChunks.length > 0 ? safetyChunks : chunks;
  const addAlert = (
    alert: Omit<MedicationLeafletSafetyAlert, "trecho_bula">,
    chunk: MedicationLeafletChunk,
  ) => {
    if (
      alerts.some(
        (existing) =>
          existing.titulo === alert.titulo &&
          existing.dado_usuario_relacionado === alert.dado_usuario_relacionado,
      )
    ) {
      return;
    }

    alerts.push({
      ...alert,
      trecho_bula: `${chunk.secao}: ${chunk.texto.slice(0, 420)}`,
    });
  };

  const allergyTerms = [
    ...splitProfileTerms(profile.alergias),
    medication.principio_ativo || "",
    medication.nome_comercial,
  ].filter(Boolean);

  for (const chunk of searchableChunks) {
    const matchedAllergy = firstMatchingTerm(chunk.texto, allergyTerms);
    const normalizedChunk = normalizeForSearch(`${chunk.secao} ${chunk.texto}`);

    if (
      matchedAllergy &&
      (normalizedChunk.includes("alerg") ||
        normalizedChunk.includes("hipersensibilidade") ||
        normalizedChunk.includes("nao deve"))
    ) {
      addAlert(
        {
          nivel: "alto",
          titulo: "Possivel alerta de alergia",
          motivo:
            "O resumo da bula menciona alergia, hipersensibilidade ou restricao relacionada a um termo cadastrado.",
          dado_usuario_relacionado: `Alergia/medicamento relacionado: ${matchedAllergy}`,
        },
        chunk,
      );
    }

    if (profile.gestante && normalizedChunk.includes("gestan")) {
      addAlert(
        {
          nivel: "alto",
          titulo: "Atencao para gestacao",
          motivo:
            "O resumo da bula menciona cuidados ou restricoes para gestantes.",
          dado_usuario_relacionado: "Usuario marcado como gestante.",
        },
        chunk,
      );
    }

    if (
      profile.lactante &&
      (normalizedChunk.includes("lacta") || normalizedChunk.includes("amament"))
    ) {
      addAlert(
        {
          nivel: "alto",
          titulo: "Atencao para amamentacao",
          motivo:
            "O resumo da bula menciona cuidados ou restricoes durante amamentacao.",
          dado_usuario_relacionado: "Usuario marcado como lactante.",
        },
        chunk,
      );
    }

    const condition = firstMatchingTerm(
      chunk.texto,
      splitProfileTerms(profile.condicoes_saude),
    );
    if (condition) {
      addAlert(
        {
          nivel: "atencao",
          titulo: "Possivel cuidado por condicao de saude",
          motivo:
            "O resumo da bula menciona uma condicao parecida com uma condicao cadastrada.",
          dado_usuario_relacionado: `Condicao cadastrada: ${condition}`,
        },
        chunk,
      );
    }
  }

  return alerts.slice(0, 4);
};

export const getMedicationLeafletSafetyReview = async (
  medicamentoId: string,
) => {
  const [leaflet, chunks, medication, profile] = await Promise.all([
    getMedicationLeafletByMedicationId(medicamentoId),
    listMedicationLeafletChunks(medicamentoId),
    findMedicationById(medicamentoId),
    getUserProfile(),
  ]);

  if (!leaflet || leaflet.status !== "baixada" || !medication) {
    return null;
  }

  const age = calculateAge(profile.data_nascimento);
  const profileTerms = [
    ...splitProfileTerms(profile.alergias),
    ...splitProfileTerms(profile.condicoes_saude),
    profile.gestante ? "gestante gravidez" : "",
    profile.lactante ? "lactante amamentacao" : "",
    age !== null && age < 12 ? "crianca pediatrico infantil" : "",
    age !== null && age >= 60 ? "idoso idosos" : "",
    profile.peso_kg ? "peso kg mg/kg" : "",
  ].filter(Boolean);

  return {
    alertas: buildSafetyAlerts({ chunks, medication, profile }),
    trechos_recomendados: findProfileRelevantChunks(chunks, profileTerms),
  };
};

export const getMedicationLeafletDosageSuggestion = async (
  medicamentoId: string,
): Promise<LeafletDosageSuggestion | null> => {
  const [leaflet, chunks, medication, profile] = await Promise.all([
    getMedicationLeafletByMedicationId(medicamentoId),
    listMedicationLeafletChunks(medicamentoId),
    findMedicationById(medicamentoId),
    getUserProfile(),
  ]);

  if (!leaflet || leaflet.status !== "baixada" || !medication) {
    return null;
  }

  const relevantChunks = chunks.filter((chunk) => {
    const section = normalizeForSearch(chunk.secao);

    return (
      section.includes("como usar") ||
      section.includes("posologia") ||
      section.includes("advertencia") ||
      section.includes("cuidados")
    );
  });
  const selectedChunks =
    relevantChunks.length > 0 ? relevantChunks : chunks.slice(0, 4);
  const selectedText = selectedChunks
    .map((chunk) => `${chunk.secao}\n${chunk.texto}`)
    .join("\n\n");
  const age = calculateAge(profile.data_nascimento);
  const profileTerms = [
    ...splitProfileTerms(profile.alergias),
    ...splitProfileTerms(profile.condicoes_saude),
    profile.gestante ? "gestante gravidez" : "",
    profile.lactante ? "lactante amamentacao" : "",
    age !== null && age < 12 ? "crianca pediatrico infantil" : "",
    age !== null && age >= 60 ? "idoso idosos" : "",
    profile.peso_kg ? "peso kg mg/kg" : "",
  ].filter(Boolean);
  const profileRecommendedChunks = findProfileRelevantChunks(chunks, profileTerms);
  const safetyAlerts = buildSafetyAlerts({ chunks, medication, profile });
  const mencionaDosePorPeso = mentionsWeightBasedDose(selectedText);
  const frequencyHours = mencionaDosePorPeso
    ? null
    : parseFrequencyHours(selectedText);
  const durationDays = parseDurationDays(selectedText);
  const observations = [
    selectedChunks.length > 0
      ? "Consultei o resumo da bula salvo localmente para este medicamento."
      : "Nao encontrei trecho claro de posologia no resumo salvo.",
    frequencyHours
      ? `Frequencia sugerida pela bula: a cada ${frequencyHours} horas.`
      : "Nao preenchi frequencia porque ela nao estava clara no resumo salvo.",
    durationDays
      ? `Duracao encontrada na bula: ${durationDays} dias.`
      : "Nao preenchi duracao porque geralmente depende da receita e da indicacao.",
    mencionaDosePorPeso
      ? `A bula menciona dose por peso. Peso cadastrado: ${profile.peso_kg ? `${profile.peso_kg} kg` : "nao informado"}. Nao calculei dose automaticamente.`
      : null,
    profileRecommendedChunks.length > 0
      ? "Separei abaixo os trechos da bula mais relevantes para os dados cadastrados do usuario."
      : null,
    safetyAlerts.length > 0
      ? "Atenção: encontrei possiveis alertas de seguranca relacionados aos dados cadastrados."
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    frequencia_horas: frequencyHours,
    duracao_dias: durationDays,
    observacoes: observations,
    fonte_nome: leaflet.fonte_nome,
    fonte_url: leaflet.fonte_url,
    trechos: selectedChunks.slice(0, 4),
    trechos_recomendados: profileRecommendedChunks,
    alertas_seguranca: safetyAlerts,
    menciona_dose_por_peso: mencionaDosePorPeso,
  };
};

export const buildLeafletRagContextForQuestion = async ({
  question,
  usuarioId = DEFAULT_USER_ID,
}: {
  question: string;
  usuarioId?: string;
}): Promise<MedicationLeafletRagContext | null> => {
  const medications = await listMedications(usuarioId);
  const activeMedications = medications.filter(
    (medication) => medication.status_tratamento === "ativo",
  );
  const normalizedQuestion = normalizeForSearch(question);
  const mentionedMedication = activeMedications.find((medication) => {
    const name = normalizeForSearch(medication.nome_comercial);
    const principle = medication.principio_ativo
      ? normalizeForSearch(medication.principio_ativo)
      : "";

    return (
      (name.length >= 4 && normalizedQuestion.includes(name)) ||
      (principle.length >= 4 && normalizedQuestion.includes(principle))
    );
  });

  if (!mentionedMedication) {
    return null;
  }

  const leaflet = await getMedicationLeafletByMedicationId(
    mentionedMedication.id,
  );

  if (!leaflet || leaflet.status !== "baixada") {
    return null;
  }

  const chunks = await listMedicationLeafletChunks(mentionedMedication.id);
  const rankedChunks = chunks
    .map((chunk) => ({
      chunk,
      score: scoreChunk(question, chunk),
    }))
    .sort((first, second) => second.score - first.score)
    .slice(0, 5)
    .map((item) => item.chunk);

  return {
    medication: mentionedMedication,
    leaflet,
    chunks: rankedChunks.length > 0 ? rankedChunks : chunks.slice(0, 5),
  };
};
