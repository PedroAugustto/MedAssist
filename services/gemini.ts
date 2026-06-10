import { createPartFromBase64, GoogleGenAI } from "@google/genai";
import { GenerativeModel, GoogleGenerativeAI } from "@google/generative-ai";

const MODEL_NAME = "gemini-2.5-flash";
const systemInstruction =
  "Voce e o MedAssist, um assistente de saude amigavel para idosos. Responda sempre de forma curta, muito carinhosa, simples, com frases diretas e evite termos medicos complexos.";

const API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || "";
const genAI = new GoogleGenerativeAI(API_KEY);
const groundedAI = new GoogleGenAI({ apiKey: API_KEY });

export type MedicationSource = {
  titulo: string;
  url: string;
  tipo: "oficial" | "bula" | "laboratorio" | "outra";
};

export type MedicationSuggestion = {
  nome_comercial: string | null;
  principio_ativo: string | null;
  dosagem: string | null;
  frequencia_horas: number | null;
  duracao_dias: number | null;
  observacoes: string | null;
  fontes: MedicationSource[];
  confianca: number;
  rawResponse: string;
};

const TRUSTED_SOURCE_HOSTS = [
  "anvisa.gov.br",
  "gov.br",
  "saude.gov.br",
  "consultaremedios.com.br",
  "pfizer.com.br",
  "eurofarma.com.br",
  "ems.com.br",
  "ache.com.br",
  "medley.com.br",
  "sanofi.com.br",
  "bayer.com.br",
  "novartis.com.br",
  "roche.com.br",
];

const medicationIdentificationPrompt = `
Analise apenas a imagem da embalagem do medicamento.

Preencha exatamente estes campos:
- nome_comercial
- principio_ativo
- dosagem
- observacoes
- fontes
- confianca

Regras:
- Extraia apenas informacoes visiveis na embalagem.
- Nao use busca na Web nesta etapa.
- Nao invente posologia.
- Use null para frequencia_horas e duracao_dias, exceto se estiverem claramente visiveis na embalagem.
- fontes deve ser [].
- As informacoes serao revisadas pelo usuario antes da busca de posologia.
- observacoes deve ter no maximo 180 caracteres.

Retorne apenas JSON valido.
O primeiro caractere da resposta deve ser { e o ultimo deve ser }.
Nao use markdown.
Nao escreva explicacoes fora do JSON.

Formato obrigatorio:
{
  "nome_comercial": string | null,
  "principio_ativo": string | null,
  "dosagem": string | null,
  "frequencia_horas": number | null,
  "duracao_dias": number | null,
  "observacoes": string | null,
  "fontes": [
    {
      "titulo": string,
      "url": string,
      "tipo": "oficial" | "bula" | "laboratorio" | "outra"
    }
  ],
  "confianca": number
}
`;

const medicationDosageSearchPrompt = ({
  nomeComercial,
  principioAtivo,
  dosagem,
}: {
  nomeComercial: string;
  principioAtivo: string;
  dosagem: string;
}) => `
Use a ferramenta Google Search para consultar bula e posologia padrao em fontes confiaveis brasileiras.

Medicamento confirmado pelo usuario:
- nome_comercial: ${nomeComercial || "nao informado"}
- principio_ativo: ${principioAtivo || "nao informado"}
- dosagem: ${dosagem || "nao informado"}

Preencha apenas estes campos:
- frequencia_horas
- duracao_dias
- observacoes
- fontes
- confianca

Regras de fonte:
- Priorize fontes brasileiras oficiais ou confiaveis: anvisa.gov.br, gov.br/anvisa, gov.br/saude, sites oficiais de laboratorios farmaceuticos e consultaremedios.com.br apenas quando a pagina reproduzir bula oficial.
- Descarte blogs, foruns, redes sociais, sites de IA de terceiros e paginas sem referencia medica confiavel.

Regras clinicas e de seguranca:
- Nao invente posologia.
- Nao de orientacao medica personalizada.
- Frequencia e duracao variam por paciente, receita, idade, peso, condicoes de saude, alergias, gravidez, amamentacao, funcao renal/hepatica e outros medicamentos em uso.
- Preencha frequencia_horas e duracao_dias somente se houver apoio claro em fonte confiavel.
- Se nao houver fonte confiavel para frequencia ou duracao, use null nesses campos.
- observacoes deve ter no maximo 180 caracteres.
- fontes deve ter no maximo 3 itens.

Retorne apenas JSON valido.
O primeiro caractere da resposta deve ser { e o ultimo deve ser }.
Nao use markdown.
Nao escreva explicacoes fora do JSON.

Formato obrigatorio:
{
  "frequencia_horas": number | null,
  "duracao_dias": number | null,
  "observacoes": string | null,
  "fontes": [
    {
      "titulo": string,
      "url": string,
      "tipo": "oficial" | "bula" | "laboratorio" | "outra"
    }
  ],
  "confianca": number
}
`;

const cleanJsonText = (text: string) => {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start >= 0 && end > start) {
    return cleaned.slice(start, end + 1);
  }

  return cleaned;
};

const escapeControlCharactersInJsonStrings = (jsonText: string) => {
  let result = "";
  let isInsideString = false;
  let isEscaped = false;

  for (const char of jsonText) {
    if (isEscaped) {
      result += char;
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      result += char;
      isEscaped = true;
      continue;
    }

    if (char === '"') {
      isInsideString = !isInsideString;
      result += char;
      continue;
    }

    if (isInsideString) {
      const code = char.charCodeAt(0);

      if (code >= 0 && code <= 0x1f) {
        if (char === "\n") {
          result += "\\n";
        } else if (char === "\r") {
          result += "\\r";
        } else if (char === "\t") {
          result += "\\t";
        } else {
          result += `\\u${code.toString(16).padStart(4, "0")}`;
        }
        continue;
      }
    }

    result += char;
  }

  return result;
};

const parseGeminiJson = (text: string) => {
  const cleaned = cleanJsonText(text);

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    return JSON.parse(escapeControlCharactersInJsonStrings(cleaned));
  }
};

const extractStringField = (text: string, field: string) => {
  const match = text.match(
    new RegExp(`"${field}"\\s*:\\s*"([\\s\\S]*?)(?:"\\s*,\\s*"|"$)`),
  );

  return (
    match?.[1]
      ?.replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .trim() || null
  );
};

const extractNumberField = (text: string, field: string) => {
  const match = text.match(
    new RegExp(`"${field}"\\s*:\\s*(null|-?\\d+(?:\\.\\d+)?)`),
  );

  if (!match || match[1] === "null") {
    return null;
  }

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

const parsePartialMedicationJson = (text: string) => ({
  nome_comercial: extractStringField(text, "nome_comercial"),
  principio_ativo: extractStringField(text, "principio_ativo"),
  dosagem: extractStringField(text, "dosagem"),
  frequencia_horas: extractNumberField(text, "frequencia_horas"),
  duracao_dias: extractNumberField(text, "duracao_dias"),
  observacoes:
    extractStringField(text, "observacoes") ||
    "A resposta da IA foi cortada. Revise os campos manualmente.",
  fontes: [],
  confianca: extractNumberField(text, "confianca") || 0.4,
});

const coerceMedicationTextToJson = async (text: string) => {
  const response = await groundedAI.models.generateContent({
    model: MODEL_NAME,
    contents: `
Converta o texto abaixo para JSON valido no formato exato indicado.
Nao adicione markdown. O primeiro caractere deve ser { e o ultimo deve ser }.
Use null quando a informacao nao existir.

Formato:
{
  "nome_comercial": string | null,
  "principio_ativo": string | null,
  "dosagem": string | null,
  "frequencia_horas": number | null,
  "duracao_dias": number | null,
  "observacoes": string | null,
  "fontes": [
    {
      "titulo": string,
      "url": string,
      "tipo": "oficial" | "bula" | "laboratorio" | "outra"
    }
  ],
  "confianca": number
}

Texto:
${text}
`,
    config: {
      temperature: 0,
      maxOutputTokens: 2000,
      responseMimeType: "application/json",
    },
  });

  return response.text || "{}";
};

const getHostname = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

const isTrustedMedicationSource = (url: string) => {
  const host = getHostname(url);

  return TRUSTED_SOURCE_HOSTS.some(
    (trustedHost) => host === trustedHost || host.endsWith(`.${trustedHost}`),
  );
};

const normalizeNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
};

const normalizeText = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const normalizeSuggestion = (
  parsed: any,
  rawResponse: string,
  groundedSources: MedicationSource[],
): MedicationSuggestion => {
  const responseSources = Array.isArray(parsed.fontes)
    ? parsed.fontes
        .map((source: any) => ({
          titulo: normalizeText(source?.titulo) || "Fonte consultada",
          url: normalizeText(source?.url) || "",
          tipo:
            source?.tipo === "oficial" ||
            source?.tipo === "bula" ||
            source?.tipo === "laboratorio"
              ? source.tipo
              : "outra",
        }))
        .filter((source: MedicationSource) => source.url)
    : [];
  const fontes = [...responseSources, ...groundedSources].filter(
    (source, index, list) =>
      source.url && list.findIndex((item) => item.url === source.url) === index,
  );
  const hasTrustedSource = fontes.some((source) =>
    isTrustedMedicationSource(source.url),
  );
  const observacoes = normalizeText(parsed.observacoes);

  return {
    nome_comercial: normalizeText(parsed.nome_comercial),
    principio_ativo: normalizeText(parsed.principio_ativo),
    dosagem: normalizeText(parsed.dosagem),
    frequencia_horas: hasTrustedSource
      ? normalizeNumber(parsed.frequencia_horas)
      : null,
    duracao_dias: hasTrustedSource
      ? normalizeNumber(parsed.duracao_dias)
      : null,
    observacoes: hasTrustedSource
      ? observacoes
      : [
          observacoes,
          "Frequencia e duracao ficaram em branco por falta de fonte confiavel validada.",
        ]
          .filter(Boolean)
          .join(" "),
    fontes,
    confianca:
      typeof parsed.confianca === "number" && Number.isFinite(parsed.confianca)
        ? Math.max(0, Math.min(1, parsed.confianca))
        : 0,
    rawResponse,
  };
};

export const generateSingleResponse = async (
  prompt: string,
): Promise<string> => {
  try {
    const model: GenerativeModel = genAI.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction,
      generationConfig: {
        temperature: 1,
        topP: 0.95,
        topK: 64,
        maxOutputTokens: 1000,
      },
    });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error: any) {
    console.error(`Erro ao usar o modelo ${MODEL_NAME}:`, error);
    throw new Error(error.message || "Erro na geracao de conteudo");
  }
};

export const identifyMedicationFromImage = async (
  imageBase64: string,
): Promise<MedicationSuggestion> => {
  try {
    const response = await groundedAI.models.generateContent({
      model: MODEL_NAME,
      contents: [
        createPartFromBase64(imageBase64, "image/jpeg"),
        medicationIdentificationPrompt,
      ],
      config: {
        systemInstruction:
          "Voce e o MedAssist, um assistente de medicamentos. Nesta etapa, leia apenas a imagem e nunca invente posologia.",
        temperature: 0.1,
        maxOutputTokens: 1000,
        responseMimeType: "application/json",
      },
    });
    const rawResponse = response.text || "{}";
    let jsonResponse = rawResponse;
    let parsed: any;

    try {
      parsed = parseGeminiJson(jsonResponse);
    } catch (parseError) {
      console.log("Resposta nao JSON do Gemini:", rawResponse);
      try {
        jsonResponse = await coerceMedicationTextToJson(rawResponse);
        parsed = parseGeminiJson(jsonResponse);
      } catch (coerceError) {
        parsed = parsePartialMedicationJson(rawResponse);
        jsonResponse = JSON.stringify(parsed);
      }
    }
    return normalizeSuggestion(parsed, jsonResponse, []);
  } catch (error: any) {
    console.error("Erro ao identificar medicamento com Gemini:", error);
    throw new Error(
      error.message || "Nao foi possivel analisar a imagem do medicamento",
    );
  }
};

export const searchMedicationDosageWithGrounding = async ({
  nome_comercial,
  principio_ativo,
  dosagem,
}: {
  nome_comercial: string;
  principio_ativo: string;
  dosagem: string;
}): Promise<
  Pick<
    MedicationSuggestion,
    | "frequencia_horas"
    | "duracao_dias"
    | "observacoes"
    | "fontes"
    | "confianca"
    | "rawResponse"
  >
> => {
  try {
    const response = await groundedAI.models.generateContent({
      model: MODEL_NAME,
      contents: medicationDosageSearchPrompt({
        nomeComercial: nome_comercial,
        principioAtivo: principio_ativo,
        dosagem,
      }),
      config: {
        systemInstruction:
          "Voce e o MedAssist, um assistente de medicamentos. Use informacoes medicas com cautela, sempre como sugestao revisavel, e priorize fontes confiaveis brasileiras ao usar busca na Web.",
        temperature: 0.2,
        maxOutputTokens: 1400,
        tools: [{ googleSearch: {} }],
      },
    });
    const rawResponse = response.text || "{}";
    let jsonResponse = rawResponse;
    let parsed: any;

    try {
      parsed = parseGeminiJson(jsonResponse);
    } catch (parseError) {
      console.log("Resposta de posologia nao JSON do Gemini:", rawResponse);
      try {
        jsonResponse = await coerceMedicationTextToJson(rawResponse);
        parsed = parseGeminiJson(jsonResponse);
      } catch (coerceError) {
        parsed = parsePartialMedicationJson(rawResponse);
        jsonResponse = JSON.stringify(parsed);
      }
    }

    const groundedSources: MedicationSource[] =
      response.candidates?.[0]?.groundingMetadata?.groundingChunks
        ?.map((chunk) => chunk.web)
        .filter((source) => Boolean(source?.uri))
        .map((source) => ({
          titulo: source?.title || "Fonte consultada",
          url: source?.uri || "",
          tipo: isTrustedMedicationSource(source?.uri || "")
            ? ("oficial" as const)
            : ("outra" as const),
        })) || [];
    const normalized = normalizeSuggestion(
      parsed,
      jsonResponse,
      groundedSources,
    );

    return {
      frequencia_horas: normalized.frequencia_horas,
      duracao_dias: normalized.duracao_dias,
      observacoes: normalized.observacoes,
      fontes: normalized.fontes,
      confianca: normalized.confianca,
      rawResponse: jsonResponse,
    };
  } catch (error: any) {
    console.error("Erro ao buscar posologia com Gemini:", error);
    throw new Error(
      error.message || "Nao foi possivel buscar a posologia do medicamento",
    );
  }
};
