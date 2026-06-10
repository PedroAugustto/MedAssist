import * as SQLite from "expo-sqlite";

import {
  cancelDoseNotifications,
  scheduleDoseNotification,
} from "./notifications";

const DATABASE_NAME = "medassist.db";
export const DEFAULT_USER_ID = "user-001";

export type UserProfile = {
  id: string;
  nome: string;
  data_nascimento: string | null;
  peso_kg: number | null;
  altura_cm: number | null;
  sexo: "masculino" | "feminino" | "outro" | "nao_informado";
  gestante: number;
  lactante: number;
  alergias: string | null;
  condicoes_saude: string | null;
  usa_outros_medicamentos: string | null;
  observacoes_clinicas: string | null;
  tamanho_fonte: number;
  modo_contraste: number;
  velocidade_leitura: number;
};

export type UserProfileInput = Omit<UserProfile, "id"> & {
  id?: string;
};

export type MedicationRegistrationInput = {
  usuario_id?: string;
  nome_comercial: string;
  principio_ativo: string | null;
  dosagem: string | null;
  foto_uri: string | null;
  horario_inicio: string;
  frequencia_horas: number | null;
  duracao_dias: number | null;
  criar_doses: boolean;
  notificacao_ativa?: boolean;
  identificacao_ia?: {
    resposta_json: string;
    confianca: number | null;
  };
};

export type Medication = {
  id: string;
  usuario_id: string;
  nome_comercial: string;
  principio_ativo: string | null;
  dosagem: string | null;
  foto_uri: string | null;
  status_tratamento: "ativo" | "pausado" | "finalizado";
  criado_em: string;
};

export type MedicationUpdateInput = {
  id: string;
  nome_comercial: string;
  principio_ativo: string | null;
  dosagem: string | null;
  status_tratamento: "ativo" | "pausado" | "finalizado";
};

export type DoseHistoryWithMedication = {
  id: string;
  plano_dose_id: string | null;
  medicamento_id: string;
  horario_agendado: string;
  status: "pendente" | "tomado";
  horario_tomado: string | null;
  notificacao_id: string | null;
  nome_comercial: string;
  dosagem: string | null;
};

export type ChatHistoryMessage = {
  id: string;
  usuario_id: string;
  role: "user" | "model";
  text: string;
  criado_em: string;
};

export type DosePlanInput = {
  medicamento_id: string;
  horario_inicio: string;
  frequencia_horas: number;
  duracao_dias: number;
  criar_alarmes?: boolean;
  notificacao_ativa?: boolean;
};

export const openDatabase = () => SQLite.openDatabaseAsync(DATABASE_NAME);

let databaseInitializationPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const createId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

type SqlParam = string | number;

const normalizeSqlParam = (value: unknown): SqlParam => {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : "";
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  return String(value);
};

const normalizeSqlParams = (params: unknown[]) =>
  params.map(normalizeSqlParam);

const runAsync = (
  db: SQLite.SQLiteDatabase,
  statement: string,
  params: unknown[] = [],
) => db.runAsync(statement, normalizeSqlParams(params));

const getAllAsync = <T>(
  db: SQLite.SQLiteDatabase,
  statement: string,
  params: unknown[] = [],
) => db.getAllAsync<T>(statement, normalizeSqlParams(params));

const getFirstAsync = <T>(
  db: SQLite.SQLiteDatabase,
  statement: string,
  params: unknown[] = [],
) => db.getFirstAsync<T>(statement, normalizeSqlParams(params));

const ensureColumn = async (
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  definition: string,
) => {
  const columns = await getAllAsync<{ name: string }>(
    db,
    `PRAGMA table_info(${table});`,
  );
  const exists = columns.some((item) => item.name === column);

  if (!exists) {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
};

const createInitializedDatabase = async () => {
  const db = await openDatabase();

  await db.execAsync(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS Usuarios (
      id TEXT PRIMARY KEY NOT NULL,
      nome TEXT NOT NULL,
      data_nascimento TEXT,
      peso_kg REAL,
      altura_cm REAL,
      sexo TEXT DEFAULT 'nao_informado',
      gestante INTEGER DEFAULT 0,
      lactante INTEGER DEFAULT 0,
      alergias TEXT,
      condicoes_saude TEXT,
      usa_outros_medicamentos TEXT,
      observacoes_clinicas TEXT,
      tamanho_fonte INTEGER DEFAULT 2,
      modo_contraste INTEGER DEFAULT 0,
      velocidade_leitura REAL DEFAULT 1.0,
      CHECK (sexo IN ('masculino', 'feminino', 'outro', 'nao_informado'))
    );

    CREATE TABLE IF NOT EXISTS Medicamentos (
      id TEXT PRIMARY KEY NOT NULL,
      usuario_id TEXT NOT NULL,
      nome_comercial TEXT NOT NULL,
      principio_ativo TEXT,
      dosagem TEXT,
      foto_uri TEXT,
      status_tratamento TEXT DEFAULT 'ativo',
      criado_em TEXT NOT NULL,
      FOREIGN KEY (usuario_id) REFERENCES Usuarios(id) ON DELETE CASCADE,
      CHECK (status_tratamento IN ('ativo', 'pausado', 'finalizado'))
    );

    CREATE TABLE IF NOT EXISTS Planos_doses (
      id TEXT PRIMARY KEY NOT NULL,
      medicamento_id TEXT NOT NULL,
      horario_inicio TEXT NOT NULL,
      frequencia_horas INTEGER NOT NULL,
      duracao_dias INTEGER,
      criar_alarmes INTEGER DEFAULT 1,
      notificacao_ativa INTEGER DEFAULT 1,
      criado_em TEXT NOT NULL,
      FOREIGN KEY (medicamento_id) REFERENCES Medicamentos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS Historico_doses (
      id TEXT PRIMARY KEY NOT NULL,
      plano_dose_id TEXT,
      medicamento_id TEXT NOT NULL,
      horario_agendado TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendente',
      horario_tomado TEXT,
      notificacao_id TEXT,
      FOREIGN KEY (plano_dose_id) REFERENCES Planos_doses(id) ON DELETE SET NULL,
      FOREIGN KEY (medicamento_id) REFERENCES Medicamentos(id) ON DELETE CASCADE,
      CHECK (status IN ('pendente', 'tomado')),
      UNIQUE (medicamento_id, horario_agendado)
    );

    CREATE TABLE IF NOT EXISTS Historico_chat (
      id TEXT PRIMARY KEY NOT NULL,
      usuario_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      criado_em TEXT NOT NULL,
      FOREIGN KEY (usuario_id) REFERENCES Usuarios(id) ON DELETE CASCADE,
      CHECK (role IN ('user', 'model'))
    );

    CREATE TABLE IF NOT EXISTS Identificacoes_ia (
      id TEXT PRIMARY KEY NOT NULL,
      usuario_id TEXT NOT NULL,
      medicamento_id TEXT,
      foto_uri TEXT,
      resposta_json TEXT NOT NULL,
      confianca REAL,
      criado_em TEXT NOT NULL,
      FOREIGN KEY (usuario_id) REFERENCES Usuarios(id) ON DELETE CASCADE,
      FOREIGN KEY (medicamento_id) REFERENCES Medicamentos(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_medicamentos_usuario
      ON Medicamentos(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_planos_doses_medicamento
      ON Planos_doses(medicamento_id);
    CREATE INDEX IF NOT EXISTS idx_historico_doses_medicamento_horario
      ON Historico_doses(medicamento_id, horario_agendado);
    CREATE INDEX IF NOT EXISTS idx_historico_chat_usuario_criado
      ON Historico_chat(usuario_id, criado_em);
  `);

  await ensureColumn(db, "Usuarios", "data_nascimento", "TEXT");
  await ensureColumn(db, "Usuarios", "peso_kg", "REAL");
  await ensureColumn(db, "Usuarios", "altura_cm", "REAL");
  await ensureColumn(db, "Usuarios", "sexo", "TEXT DEFAULT 'nao_informado'");
  await ensureColumn(db, "Usuarios", "gestante", "INTEGER DEFAULT 0");
  await ensureColumn(db, "Usuarios", "lactante", "INTEGER DEFAULT 0");
  await ensureColumn(db, "Usuarios", "alergias", "TEXT");
  await ensureColumn(db, "Usuarios", "condicoes_saude", "TEXT");
  await ensureColumn(db, "Usuarios", "usa_outros_medicamentos", "TEXT");
  await ensureColumn(db, "Usuarios", "observacoes_clinicas", "TEXT");
  await ensureColumn(db, "Usuarios", "tamanho_fonte", "INTEGER DEFAULT 2");
  await ensureColumn(db, "Usuarios", "modo_contraste", "INTEGER DEFAULT 0");
  await ensureColumn(db, "Usuarios", "velocidade_leitura", "REAL DEFAULT 1.0");
  await ensureColumn(db, "Historico_doses", "notificacao_id", "TEXT");

  return db;
};

export const initializeDatabase = async () => {
  if (!databaseInitializationPromise) {
    databaseInitializationPromise = createInitializedDatabase().catch(
      (error) => {
        databaseInitializationPromise = null;
        throw error;
      },
    );
  }

  return databaseInitializationPromise;
};

export const generateDoseSchedule = (
  horarioInicio: string,
  frequenciaHoras: number,
  duracaoDias: number,
) => {
  const startDate = new Date(horarioInicio);
  if (
    Number.isNaN(startDate.getTime()) ||
    !Number.isFinite(frequenciaHoras) ||
    !Number.isFinite(duracaoDias) ||
    frequenciaHoras <= 0 ||
    duracaoDias <= 0
  ) {
    return [];
  }

  const totalDoses = Math.ceil((duracaoDias * 24) / frequenciaHoras);

  return Array.from({ length: totalDoses }, (_, index) => {
    const scheduledDate = new Date(
      startDate.getTime() + index * frequenciaHoras * 60 * 60 * 1000,
    );

    return scheduledDate.toISOString();
  });
};

export const saveMedicationRegistration = async (
  input: MedicationRegistrationInput,
) => {
  const db = await initializeDatabase();
  const now = new Date().toISOString();
  const usuarioId = input.usuario_id || DEFAULT_USER_ID;
  const medicamentoId = createId("med");
  const nomeComercial = input.nome_comercial?.trim() || "Medicamento sem nome";
  const planoDoseId =
    input.criar_doses && input.frequencia_horas && input.frequencia_horas > 0
      ? createId("plano")
      : null;

  await db.withTransactionAsync(async () => {
    await runAsync(
      db,
      `INSERT OR IGNORE INTO Usuarios (
        id,
        nome,
        tamanho_fonte,
        modo_contraste,
        velocidade_leitura
      ) VALUES (?, ?, ?, ?, ?);`,
      [usuarioId, "Usuario MedAssist", 2, 0, 1],
    );

    await runAsync(
      db,
      `INSERT INTO Medicamentos (
        id,
        usuario_id,
        nome_comercial,
        principio_ativo,
        dosagem,
        foto_uri,
        status_tratamento,
        criado_em
      ) VALUES (?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?);`,
      [
        medicamentoId,
        usuarioId,
        nomeComercial,
        input.principio_ativo?.trim() || "",
        input.dosagem?.trim() || "",
        input.foto_uri ?? "",
        "ativo",
        now,
      ],
    );

    if (planoDoseId && input.frequencia_horas) {
      await runAsync(
        db,
        `INSERT INTO Planos_doses (
          id,
          medicamento_id,
          horario_inicio,
          frequencia_horas,
          duracao_dias,
          criar_alarmes,
          notificacao_ativa,
          criado_em
        ) VALUES (?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?);`,
        [
          planoDoseId,
          medicamentoId,
          input.horario_inicio,
          input.frequencia_horas,
          input.duracao_dias ?? "",
          input.criar_doses ? 1 : 0,
          input.notificacao_ativa === false ? 0 : 1,
          now,
        ],
      );
    }

    if (
      input.criar_doses &&
      planoDoseId &&
      input.frequencia_horas &&
      input.duracao_dias
    ) {
      const doseDates = generateDoseSchedule(
        input.horario_inicio,
        input.frequencia_horas,
        input.duracao_dias,
      );

      for (const horarioAgendado of doseDates) {
        const doseId = createId("dose");
        const notificacaoId = await scheduleDoseNotification({
          medicamentoId,
          doseId,
          nomeComercial,
          dosagem: input.dosagem,
          horarioAgendado,
        });

        await runAsync(
          db,
          `INSERT OR IGNORE INTO Historico_doses (
            id,
            plano_dose_id,
            medicamento_id,
            horario_agendado,
            status,
            horario_tomado,
            notificacao_id
        ) VALUES (?, ?, ?, ?, ?, NULL, NULLIF(?, ''));`,
        [
          doseId,
          planoDoseId,
          medicamentoId,
          horarioAgendado,
          "pendente",
          notificacaoId ?? "",
        ],
      );
    }
    }

    if (input.identificacao_ia) {
      await runAsync(
        db,
        `INSERT INTO Identificacoes_ia (
          id,
          usuario_id,
          medicamento_id,
          foto_uri,
          resposta_json,
          confianca,
          criado_em
        ) VALUES (?, ?, ?, NULLIF(?, ''), ?, NULLIF(?, ''), ?);`,
        [
          createId("ia"),
          usuarioId,
          medicamentoId,
          input.foto_uri ?? "",
          input.identificacao_ia.resposta_json || "{}",
          input.identificacao_ia.confianca ?? "",
          now,
        ],
      );
    }
  });

  return {
    medicamentoId,
    planoDoseId,
  };
};

export const createDosePlanForMedication = async (input: DosePlanInput) => {
  const medicamentoId = input.medicamento_id?.trim();
  const horarioInicio = new Date(input.horario_inicio);

  if (!medicamentoId) {
    throw new Error("Escolha um medicamento antes de criar doses.");
  }

  if (
    Number.isNaN(horarioInicio.getTime()) ||
    !Number.isFinite(input.frequencia_horas) ||
    !Number.isFinite(input.duracao_dias) ||
    input.frequencia_horas <= 0 ||
    input.duracao_dias <= 0
  ) {
    throw new Error("Informe horario, frequencia e duracao validos.");
  }

  const db = await initializeDatabase();
  const now = new Date().toISOString();
  const planoDoseId = createId("plano");
  const medication = await getFirstAsync<Medication>(
    db,
    `SELECT
      id,
      usuario_id,
      nome_comercial,
      principio_ativo,
      dosagem,
      foto_uri,
      status_tratamento,
      criado_em
    FROM Medicamentos
    WHERE id = ?
    LIMIT 1;`,
    [medicamentoId],
  );

  if (!medication) {
    throw new Error("Medicamento nao encontrado para criar doses.");
  }

  const doseDates = generateDoseSchedule(
    horarioInicio.toISOString(),
    input.frequencia_horas,
    input.duracao_dias,
  );

  if (doseDates.length === 0) {
    throw new Error("Nao foi possivel calcular os horarios das doses.");
  }

  await db.withTransactionAsync(async () => {
    await runAsync(
      db,
      `INSERT INTO Planos_doses (
        id,
        medicamento_id,
        horario_inicio,
        frequencia_horas,
        duracao_dias,
        criar_alarmes,
        notificacao_ativa,
        criado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        planoDoseId,
        medicamentoId,
        horarioInicio.toISOString(),
        input.frequencia_horas,
        input.duracao_dias,
        input.criar_alarmes === false ? 0 : 1,
        input.notificacao_ativa === false ? 0 : 1,
        now,
      ],
    );

    for (const horarioAgendado of doseDates) {
      const doseId = createId("dose");
      const notificacaoId = await scheduleDoseNotification({
        medicamentoId,
        doseId,
        nomeComercial: medication.nome_comercial,
        dosagem: medication.dosagem,
        horarioAgendado,
      });

      await runAsync(
        db,
        `INSERT OR IGNORE INTO Historico_doses (
          id,
          plano_dose_id,
          medicamento_id,
          horario_agendado,
          status,
          horario_tomado,
          notificacao_id
        ) VALUES (?, ?, ?, ?, ?, NULL, NULLIF(?, ''));`,
        [
          doseId,
          planoDoseId,
          medicamentoId,
          horarioAgendado,
          "pendente",
          notificacaoId ?? "",
        ],
      );
    }
  });

  return {
    planoDoseId,
    dosesCriadas: doseDates.length,
  };
};

export const listDoseHistory = async (
  usuarioId: string = DEFAULT_USER_ID,
): Promise<DoseHistoryWithMedication[]> => {
  const db = await initializeDatabase();
  const now = new Date().toISOString();

  return getAllAsync<DoseHistoryWithMedication>(
    db,
    `SELECT
      Historico_doses.id,
      Historico_doses.plano_dose_id,
      Historico_doses.medicamento_id,
      Historico_doses.horario_agendado,
      Historico_doses.status,
      Historico_doses.horario_tomado,
      Historico_doses.notificacao_id,
      Medicamentos.nome_comercial,
      Medicamentos.dosagem
    FROM Historico_doses
    INNER JOIN Medicamentos
      ON Medicamentos.id = Historico_doses.medicamento_id
    WHERE Medicamentos.usuario_id = ?
      AND (
        Historico_doses.status = 'tomado'
        OR Historico_doses.horario_agendado < ?
        OR (
          Medicamentos.status_tratamento = 'ativo'
          AND Historico_doses.status = 'pendente'
        )
      )
    ORDER BY Historico_doses.horario_agendado ASC;`,
    [usuarioId, now],
  );
};

export const listMedications = async (
  usuarioId: string = DEFAULT_USER_ID,
): Promise<Medication[]> => {
  const db = await initializeDatabase();

  return getAllAsync<Medication>(
    db,
    `SELECT
      id,
      usuario_id,
      nome_comercial,
      principio_ativo,
      dosagem,
      foto_uri,
      status_tratamento,
      criado_em
    FROM Medicamentos
    WHERE usuario_id = ?
    ORDER BY criado_em DESC;`,
    [usuarioId],
  );
};

export const listChatHistory = async (
  usuarioId: string = DEFAULT_USER_ID,
  limit: number = 60,
): Promise<ChatHistoryMessage[]> => {
  const db = await initializeDatabase();

  const rows = await getAllAsync<ChatHistoryMessage>(
    db,
    `SELECT
      id,
      usuario_id,
      role,
      text,
      criado_em
    FROM Historico_chat
    WHERE usuario_id = ?
    ORDER BY criado_em DESC
    LIMIT ?;`,
    [usuarioId, limit],
  );

  return rows.reverse();
};

export const saveChatMessage = async ({
  usuario_id = DEFAULT_USER_ID,
  role,
  text,
}: {
  usuario_id?: string;
  role: ChatHistoryMessage["role"];
  text: string;
}) => {
  const db = await initializeDatabase();
  const trimmedText = text.trim();

  if (!trimmedText) {
    return null;
  }

  const message: ChatHistoryMessage = {
    id: createId("chat"),
    usuario_id,
    role,
    text: trimmedText,
    criado_em: new Date().toISOString(),
  };

  await runAsync(
    db,
    `INSERT OR IGNORE INTO Usuarios (
      id,
      nome,
      tamanho_fonte,
      modo_contraste,
      velocidade_leitura
    ) VALUES (?, ?, ?, ?, ?);`,
    [usuario_id, "Usuario MedAssist", 2, 0, 1],
  );

  await runAsync(
    db,
    `INSERT INTO Historico_chat (
      id,
      usuario_id,
      role,
      text,
      criado_em
    ) VALUES (?, ?, ?, ?, ?);`,
    [
      message.id,
      message.usuario_id,
      message.role,
      message.text,
      message.criado_em,
    ],
  );

  return message;
};

export const updateMedication = async (input: MedicationUpdateInput) => {
  const db = await initializeDatabase();
  const nomeComercial = input.nome_comercial?.trim() || "Medicamento sem nome";

  await runAsync(
    db,
    `UPDATE Medicamentos
    SET
      nome_comercial = ?,
      principio_ativo = NULLIF(?, ''),
      dosagem = NULLIF(?, ''),
      status_tratamento = ?
    WHERE id = ?;`,
    [
      nomeComercial,
      input.principio_ativo?.trim() || "",
      input.dosagem?.trim() || "",
      input.status_tratamento || "ativo",
      input.id,
    ],
  );
};

export const findMedicationByCommercialName = async (
  nomeComercial: string,
  usuarioId: string = DEFAULT_USER_ID,
): Promise<Medication | null> => {
  const db = await initializeDatabase();

  const normalizedName = nomeComercial.trim().toLowerCase();
  if (!normalizedName) {
    return null;
  }

  return getFirstAsync<Medication>(
    db,
    `SELECT
      id,
      usuario_id,
      nome_comercial,
      principio_ativo,
      dosagem,
      foto_uri,
      status_tratamento,
      criado_em
    FROM Medicamentos
    WHERE usuario_id = ?
      AND lower(trim(nome_comercial)) = ?
    LIMIT 1;`,
    [usuarioId, normalizedName],
  );
};

export const deleteMedication = async (id: string) => {
  const db = await initializeDatabase();
  const notifications = await getAllAsync<{ notificacao_id: string | null }>(
    db,
    `SELECT notificacao_id
    FROM Historico_doses
    WHERE medicamento_id = ?
      AND status = 'pendente'
      AND NULLIF(notificacao_id, '') IS NOT NULL;`,
    [id],
  );

  await runAsync(db, "PRAGMA foreign_keys = ON;");
  await runAsync(db, "DELETE FROM Medicamentos WHERE id = ?;", [id]);
  await cancelDoseNotifications(
    notifications
      .map((notification) => notification.notificacao_id)
      .filter((notificationId): notificationId is string =>
        Boolean(notificationId),
      ),
  );
};

export const deleteDose = async (id: string) => {
  const db = await initializeDatabase();
  const dose = await getFirstAsync<{ notificacao_id: string | null }>(
    db,
    `SELECT notificacao_id
    FROM Historico_doses
    WHERE id = ?
    LIMIT 1;`,
    [id],
  );

  await runAsync(db, "DELETE FROM Historico_doses WHERE id = ?;", [id]);

  if (dose?.notificacao_id) {
    await cancelDoseNotifications([dose.notificacao_id]);
  }
};

export async function getUserProfile(
  usuarioId: string = DEFAULT_USER_ID,
): Promise<UserProfile> {
  const db = await initializeDatabase();
  const user = await getFirstAsync<UserProfile>(
    db,
    `SELECT
      id,
      nome,
      data_nascimento,
      peso_kg,
      altura_cm,
      sexo,
      gestante,
      lactante,
      alergias,
      condicoes_saude,
      usa_outros_medicamentos,
      observacoes_clinicas,
      tamanho_fonte,
      modo_contraste,
      velocidade_leitura
    FROM Usuarios
    WHERE id = ?
    LIMIT 1;`,
    [usuarioId],
  );

  if (user) {
    return user;
  }

  const defaultUser: UserProfile = {
    id: usuarioId,
    nome: "Usuario MedAssist",
    data_nascimento: null,
    peso_kg: null,
    altura_cm: null,
    sexo: "nao_informado",
    gestante: 0,
    lactante: 0,
    alergias: null,
    condicoes_saude: null,
    usa_outros_medicamentos: null,
    observacoes_clinicas: null,
    tamanho_fonte: 2,
    modo_contraste: 0,
    velocidade_leitura: 1,
  };

  await saveUserProfile(defaultUser);
  return defaultUser;
}

export async function saveUserProfile(input: UserProfileInput) {
  const db = await initializeDatabase();
  const usuarioId = input.id || DEFAULT_USER_ID;
  const nome = input.nome?.trim() || "Usuario MedAssist";
  const sexo = input.sexo || "nao_informado";

  await runAsync(
    db,
    `INSERT OR IGNORE INTO Usuarios (
      id,
      nome,
      tamanho_fonte,
      modo_contraste,
      velocidade_leitura
    ) VALUES (?, ?, ?, ?, ?);`,
    [
      usuarioId,
      nome,
      input.tamanho_fonte ?? 2,
      input.modo_contraste ? 1 : 0,
      input.velocidade_leitura ?? 1,
    ],
  );

  await runAsync(
    db,
    `UPDATE Usuarios
    SET
      nome = ?,
      data_nascimento = NULLIF(?, ''),
      peso_kg = NULLIF(?, ''),
      altura_cm = NULLIF(?, ''),
      sexo = ?,
      gestante = ?,
      lactante = ?,
      alergias = NULLIF(?, ''),
      condicoes_saude = NULLIF(?, ''),
      usa_outros_medicamentos = NULLIF(?, ''),
      observacoes_clinicas = NULLIF(?, ''),
      tamanho_fonte = ?,
      modo_contraste = ?,
      velocidade_leitura = ?
    WHERE id = ?;`,
    [
      nome,
      input.data_nascimento || "",
      input.peso_kg ?? "",
      input.altura_cm ?? "",
      sexo,
      input.gestante ? 1 : 0,
      input.lactante ? 1 : 0,
      input.alergias?.trim() || "",
      input.condicoes_saude?.trim() || "",
      input.usa_outros_medicamentos?.trim() || "",
      input.observacoes_clinicas?.trim() || "",
      input.tamanho_fonte ?? 2,
      input.modo_contraste ? 1 : 0,
      input.velocidade_leitura ?? 1,
      usuarioId,
    ],
  );
}
