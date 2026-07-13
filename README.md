# MedAssist

MedAssist e um aplicativo mobile desenvolvido com Expo e React Native para auxiliar idosos no acompanhamento de medicamentos e em duvidas simples sobre saude.

O app permite cadastrar medicamentos, ler informacoes de embalagens por OCR, consultar resumos de bula em fontes confiaveis, conversar com um assistente por texto ou voz e manter dados de saude do usuario para respostas mais contextualizadas.

## Principais recursos

- Cadastro e gerenciamento de medicamentos.
- Leitura de embalagens com camera e OCR.
- Identificacao de nome comercial, principio ativo e dosagem com IA.
- Busca e resumo de bulas usando fontes confiaveis brasileiras.
- Chat assistivo em portugues do Brasil, com suporte a voz.
- Banco local com SQLite para perfil, medicamentos, historico e resumos de bula.
- Recursos de acessibilidade, como ajuste de fonte, cores e leitura por voz.

## Tecnologias

- Expo
- React Native
- TypeScript
- Expo Router
- Expo SQLite
- Expo Camera
- Expo Audio
- Groq API
- Gemini API

## Requisitos

- Node.js instalado.
- npm instalado.
- Expo CLI, via `npx expo`.
- Um dispositivo ou emulador Android/iOS.

Alguns recursos usam bibliotecas nativas, como camera, audio, SQLite e OCR. Por isso, para testar tudo no dispositivo, pode ser necessario usar um development build do Expo.

## Variaveis de ambiente

Crie um arquivo `.env` na raiz do projeto com as seguintes chaves:

```env
EXPO_PUBLIC_GROQ_API_KEY=sua_chave_da_groq
EXPO_PUBLIC_GEMINI_API_KEY=sua_chave_do_gemini
```

Essas variaveis sao usadas para:

- `EXPO_PUBLIC_GROQ_API_KEY`: chat do assistente, interpretacao de texto OCR e transcricao de audio.
- `EXPO_PUBLIC_GEMINI_API_KEY`: busca e resumo de bulas, alem de recursos de identificacao e consulta com Gemini.

Nao envie o arquivo `.env` para o GitHub. Ele ja esta listado no `.gitignore`.

## Como rodar

Instale as dependencias:

```bash
npm install
```

Inicie o projeto:

```bash
npm start
```

Para abrir em uma plataforma especifica:

```bash
npm run android
npm run ios
npm run web
```

## Observacao importante

O MedAssist nao substitui orientacao medica, farmaceutica ou atendimento de emergencia. As respostas do assistente e os dados extraidos por IA devem ser revisados pelo usuario, principalmente em casos de dose, alergias, interacoes, gravidez, amamentacao ou sintomas graves.
