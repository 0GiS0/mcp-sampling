/**
 * 📝 MCP (Model Context Protocol) usando Low-Level Server
 * 
 * Este ejemplo muestra cómo implementar un servidor MCP
 * utilizando el Low-Level Server de Model Context Protocol (MCP).
 * El objetivo principal es demostrar cómo funciona el Sampling.
 * 
 */
import express, { Request, Response } from "express";
import * as dotenv from "dotenv";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";

import { randomUUID } from "node:crypto";

dotenv.config();
import { google } from "googleapis";

// Configura las credenciales de la API de YouTube
if (!process.env.YOUTUBE_API_KEY) {
  throw new Error("YOUTUBE_API_KEY environment variable is not set");
}

const youtube = google.youtube({
  version: "v3",
  auth: process.env.YOUTUBE_API_KEY,
});

/**
 * Tipo para un video de YouTube.
 */
type YouTubeVideo = { title: string; description: string, url: string };

/**
 * Almacenamiento en memoria de videos de YouTube.
 * En una app real, esto sería una base de datos.
 */
const videos: { [id: string]: YouTubeVideo } = {
};

// 🚀 Inicializa la app Express
const app = express();
app.use(express.json());

// Mapa de transports por sesión
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

// 🛠️ Crea el servidor MCP con capacidades de recursos, herramientas y prompts
const server = new Server(
  {
    name: "mcp-sampling",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
      prompts: {},
      // sampling: {}
    },
  }
);

/**
 * 📋 Handler para listar notas como recursos MCP.
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: Object.entries(videos).map(([id, video]) => ({
      uri: `video:///${id}`,
      mimeType: "text/plain",
      name: video.title,
      description: video.description,
      metadata: {
        url: video.url,
      },
    })),
  };
});

/**
 * 📖 Handler para leer el contenido de una nota.
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const url = new URL(request.params.uri);
  const id = url.pathname.replace(/^\//, "");
  const video = videos[id];

  if (!video) {
    throw new Error(`Video ${id} not found`);
  }

  return {
    contents: [
      {
        uri: request.params.uri,
        mimeType: "text/plain",
        text: video.description,
      },
    ],
  };
});

/**
 * 🛠️ Handler para listar herramientas disponibles (solo "create_note").
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_videos",
        description: "Search for YouTube videos",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query",
            },
          },
          required: ["query"],
        },
      }
    ],
  };
});

/**
 * 📝 Handler para la herramienta "search_videos".
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "search_videos": {
      const query = String(request.params.arguments?.query);
      if (!query) {
        throw new Error("Query is required");
      }

      console.log(`🔍 Buscando videos de YouTube con query: ${query}`)

      const res = await youtube.search.list({
        part: ['snippet'],
        q: query,
        type: ['video'],
        maxResults: 5,
        order: 'relevance',
      }, {});

      // Muestra una tabla más compacta en consola, truncando los textos largos
      console.table(
        res.data.items?.map((item) => ({
          Title: (item.snippet?.title ?? "").slice(0, 40) + ((item.snippet?.title?.length ?? 0) > 40 ? "..." : ""),
          Channel: (item.snippet?.channelTitle ?? "").slice(0, 20) + ((item.snippet?.channelTitle?.length ?? 0) > 20 ? "..." : ""),
          PublishedAt: item.snippet?.publishedAt,
        }))
      );

      // Sampling call
      let formattedResults = "";
    
      console.log("🧠 Ok, llamando a un modelo de los que me permita el cliente para consultar a un LLM por el mejor vídeo");

      // try {

        let response = await server.createMessage({
          messages: [
            {
              role: "user",
              content: {
          type: "text",
          text: `Can you choose the best result for the query "${query}"? Here are the results:\n\n` +
            res.data.items?.map((item) => {
              return `**Title:** ${item.snippet?.title}\n` +
                `**Description:** ${item.snippet?.description}\n` +
                `**Thumbnail:** ![Thumbnail](${item.snippet?.thumbnails?.default?.url})\n` +
                `**Channel:** ${item.snippet?.channelTitle}\n` +
                `**Published At:** ${item.snippet?.publishedAt}\n` +
                `**Link:** [Watch Video](https://www.youtube.com/watch?v=${item.id?.videoId})\n`;
              }).join("\n\n"),
            },
          },
          ],
          systemPrompt:
          `You are an expert assistant at choosing the best YouTube search result.
          Your task is to select the most relevant result and present it clearly and concisely.
          Add emojis to each key point to make them more engaging.
          Make sure the format is easy to read and understand.`,
          maxTokens: 100,
          temperature: 0.7,
          includeContext: "none", // Include the current server context
          modelPreferences: {
            speedPriority: 1,
            costPriority: 1
          }

        });


        formattedResults = response.content.text as string;

        console.log("📜 Resultados formateados:", response.content.text);
        console.log("🧠 Modelo usado:", response.model);

      // } catch (error) {
      //   console.error("❌ Error al llamar al modelo:", error);
      //   throw new Error("Error calling the model");
      // }      

      return {
        content: [
          {
            type: "text",
            text: formattedResults.length > 0
              ? `# Search results for "${query}"\n\n${formattedResults}`
              : `No results found for "${query}". Please try a different query.`,
          }
        ]
      };
    }

    default:
      throw new Error("Unknown tool");
  }
});

/**
 * 💡 Handler para listar prompts disponibles (solo "summarize_notes").
 */
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: "summarize_notes",
        description: "Summarize all notes",
      },
    ],
  };
});

/**
 * 🧠 Handler para el prompt "summarize_notes".
 */
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name !== "summarize_notes") {
    throw new Error("Unknown prompt");
  }

  const embeddedVideos = Object.entries(videos).map(([id, video]) => ({
    type: "resource" as const,
    resource: {
      uri: `video:///${id}`,
      mimeType: "text/plain",
      text: video.title,
    },
  }));

  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Please summarize the following notes:",
        },
      },
      ...embeddedVideos.map((video) => ({
        role: "user" as const,
        content: video,
      })),
      {
        role: "user",
        content: {
          type: "text",
          text: "Provide a concise summary of all the notes above.",
        },
      },
    ],
  };
});

/**************** Fin de la configuración del servidor MCP ****************/

/**
 * Endpoint principal MCP (POST).
 */
app.post("/mcp", async (req, res) => {
  console.log("📨 Recibida petición MCP POST");
  console.log("📦 Cuerpo de la petición:", req.body);

  try {
    // Busca sessionId en cabecera
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    console.log(`🔑 Procesando para session ID: ${sessionId}`);

    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      console.log(`🔄 Reutilizando transport para sesión ${sessionId}`);
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      console.log("🆕 Sin session ID, inicializando nuevo transport");

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          transports[sessionId] = transport;
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) {
          delete transports[transport.sessionId];
        }
      };

      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: req?.body?.id,
      });
      return;
    }

    // Maneja la petición con el transport correspondiente
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("❌ Error manejando petición MCP:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: req?.body?.id,
      });
      return;
    }
  }
});

/**
 * Endpoint GET para SSE streams (usado por MCP para eventos).
 */
app.get("/mcp", async (req: Request, res: Response) => {
  console.error("📥 Recibida petición MCP GET");
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: No valid session ID provided",
      },
      id: req?.body?.id,
    });
    return;
  }

  const lastEventId = req.headers["last-event-id"] as string | undefined;
  if (lastEventId) {
    console.error(`🔁 Cliente reconectando con Last-Event-ID: ${lastEventId}`);
  } else {
    console.error(`🌐 Estableciendo nuevo SSE para sesión ${sessionId}`);
  }

  const transport = transports[sessionId];
  await transport!.handleRequest(req, res);
});

/**
 * Endpoint DELETE para terminar sesión MCP.
 */
app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: No valid session ID provided",
      },
      id: req?.body?.id,
    });
    return;
  }

  console.error(
    `🗑️ Recibida petición de terminación de sesión para ${sessionId}`
  );

  try {
    const transport = transports[sessionId];
    await transport!.handleRequest(req, res);
  } catch (error) {
    console.error("❌ Error al terminar sesión:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Error handling session termination",
        },
        id: req?.body?.id,
      });
      return;
    }
  }
});

/**
 * 🚦 Inicia el servidor Express.
 */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`📡 MCP Streamable HTTP Server escuchando en puerto ${PORT}`);
});

/**
 * 🛑 Maneja el apagado del servidor y limpia recursos.
 */
process.on("SIGINT", async () => {
  console.log("🛑 Apagando servidor...");

  // Cierra todos los transports activos
  for (const sessionId in transports) {
    try {
      console.log(`🔒 Cerrando transport para sesión ${sessionId}`);
      await transports[sessionId].close();
      delete transports[sessionId];
    } catch (error) {
      console.error(`❌ Error cerrando transport para sesión ${sessionId}:`, error);
    }
  }

  console.error("✅ Apagado completo");
  process.exit(0);
});
