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
import cors from "cors";
import compression from "compression";

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
interface YouTubeVideo {
  title: string;
  description: string;
  url: string;
}

/**
 * Interfaz para manejar errores de manera consistente.
 */
interface MCPError {
  code: number;
  message: string;
  data?: any;
}

/**
 * Interfaz para las respuestas de error JSON-RPC.
 */
interface JSONRPCErrorResponse {
  jsonrpc: "2.0";
  error: MCPError;
  id?: any;
}

/**
 * Almacenamiento en memoria de videos de YouTube.
 * En una app real, esto sería una base de datos.
 */
const videos: { [id: string]: YouTubeVideo } = {};

/**
 * Cache para las búsquedas de YouTube.
 */
interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number;
}

const searchCache: { [key: string]: CacheEntry } = {};
const CACHE_TTL = 300000; // 5 minutos

/**
 * Función para obtener datos del cache.
 */
function getFromCache(key: string): any | null {
  const entry = searchCache[key];
  if (!entry) return null;
  
  if (Date.now() > entry.timestamp + entry.ttl) {
    delete searchCache[key];
    return null;
  }
  
  return entry.data;
}

/**
 * Función para guardar datos en el cache.
 */
function saveToCache(key: string, data: any, ttl: number = CACHE_TTL): void {
  searchCache[key] = {
    data,
    timestamp: Date.now(),
    ttl
  };
}

/**
 * Función para limpiar el cache de entradas expiradas.
 */
function cleanupCache(): void {
  const now = Date.now();
  let cleaned = 0;
  
  Object.keys(searchCache).forEach(key => {
    const entry = searchCache[key];
    if (now > entry.timestamp + entry.ttl) {
      delete searchCache[key];
      cleaned++;
    }
  });
  
  if (cleaned > 0) {
    console.log(`🧹 Limpiadas ${cleaned} entradas del cache`);
  }
}

/**
 * Simple rate limiting.
 */
interface RateLimitEntry {
  requests: number;
  windowStart: number;
}

const rateLimits: { [ip: string]: RateLimitEntry } = {};
const RATE_LIMIT_WINDOW = 60000; // 1 minuto
const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per minute

/**
 * Función para verificar rate limiting.
 */
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimits[ip];
  
  if (!entry) {
    rateLimits[ip] = { requests: 1, windowStart: now };
    return true;
  }
  
  // Reset window if expired
  if (now - entry.windowStart >= RATE_LIMIT_WINDOW) {
    rateLimits[ip] = { requests: 1, windowStart: now };
    return true;
  }
  
  // Check if under limit
  if (entry.requests < RATE_LIMIT_MAX_REQUESTS) {
    entry.requests++;
    return true;
  }
  
  return false;
}

/**
 * Función para limpiar entradas de rate limiting expiradas.
 */
function cleanupRateLimits(): void {
  const now = Date.now();
  let cleaned = 0;
  
  Object.keys(rateLimits).forEach(ip => {
    const entry = rateLimits[ip];
    if (now - entry.windowStart >= RATE_LIMIT_WINDOW) {
      delete rateLimits[ip];
      cleaned++;
    }
  });
  
  if (cleaned > 0) {
    console.log(`🧹 Limpiadas ${cleaned} entradas de rate limiting`);
  }
}

// 🚀 Inicializa la app Express
const app = express();

// Configuración de middlewares
app.use(compression()); // Compresión gzip

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));

// Rate limiting middleware
app.use((req, res, next) => {
  const clientIP = req.ip || req.socket.remoteAddress || 'unknown';
  
  if (!checkRateLimit(clientIP)) {
    return res.status(429).json(createErrorResponse(
      -32000,
      "Too many requests. Please try again later.",
      null,
      { retryAfter: Math.ceil(RATE_LIMIT_WINDOW / 1000) }
    ));
  }
  
  next();
});

// Middleware para validar Content-Type en requests POST
app.use('/mcp', (req, res, next) => {
  if (req.method === 'POST' && !req.is('application/json')) {
    return res.status(415).json({
      jsonrpc: "2.0",
      error: {
        code: -32600,
        message: "Invalid Content-Type. Expected application/json",
      },
      id: null,
    });
  }
  next();
});

// Mapa de transports por sesión
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

/**
 * Crea una respuesta de error JSON-RPC consistente.
 */
function createErrorResponse(code: number, message: string, id?: any, data?: any): JSONRPCErrorResponse {
  return {
    jsonrpc: "2.0",
    error: {
      code,
      message,
      ...(data && { data }),
    },
    ...(id !== undefined && { id }),
  };
}

/**
 * Valida si un sessionId es válido.
 */
function isValidSessionId(sessionId: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(sessionId);
}

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
      const query = String(request.params.arguments?.query || "").trim();
      if (!query || query.length < 2) {
        throw new Error("Query must be at least 2 characters long");
      }

      if (query.length > 100) {
        throw new Error("Query must be 100 characters or less");
      }

      console.log(`🔍 Buscando videos de YouTube con query: ${query}`);

      // Check cache first
      const cacheKey = `search_${query.toLowerCase()}`;
      const cachedResult = getFromCache(cacheKey);
      
      if (cachedResult) {
        console.log(`💾 Usando resultado del cache para: ${query}`);
        return cachedResult;
      }

      try {
        const res = await youtube.search.list({
          part: ['snippet'],
          q: query,
          type: ['video'],
          maxResults: 5,
          order: 'relevance',
        });

        if (!res.data.items || res.data.items.length === 0) {
          const result = {
            content: [
              {
                type: "text",
                text: `No results found for "${query}". Please try a different query.`,
              }
            ]
          };
          
          // Cache the empty result too
          saveToCache(cacheKey, result, CACHE_TTL);
          return result;
        }

        // Muestra una tabla más compacta en consola, truncando los textos largos
        console.table(
          res.data.items.map((item) => ({
            Title: (item.snippet?.title ?? "").slice(0, 40) + ((item.snippet?.title?.length ?? 0) > 40 ? "..." : ""),
            Channel: (item.snippet?.channelTitle ?? "").slice(0, 20) + ((item.snippet?.channelTitle?.length ?? 0) > 20 ? "..." : ""),
            PublishedAt: item.snippet?.publishedAt,
          }))
        );

        // Sampling call
        let formattedResults = "";
      
        console.log("🧠 Ok, llamando a un modelo de los que me permita el cliente para consultar a un LLM por el mejor vídeo");

        try {
          const response = await server.createMessage({
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: `Can you choose the best result for the query "${query}"? Here are the results:\n\n` +
                    res.data.items.map((item) => {
                      return `**Title:** ${item.snippet?.title || 'Unknown'}\n` +
                        `**Description:** ${item.snippet?.description || 'No description available'}\n` +
                        `**Thumbnail:** ![Thumbnail](${item.snippet?.thumbnails?.default?.url || ''})\n` +
                        `**Channel:** ${item.snippet?.channelTitle || 'Unknown'}\n` +
                        `**Published At:** ${item.snippet?.publishedAt || 'Unknown'}\n` +
                        `**Link:** [Watch Video](https://www.youtube.com/watch?v=${item.id?.videoId || ''})\n`;
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
            includeContext: "none",
            modelPreferences: {
              speedPriority: 1,
              costPriority: 1
            }
          });

          formattedResults = response.content.text as string;

          console.log("📜 Resultados formateados:", response.content.text);
          console.log("🧠 Modelo usado:", response.model);

        } catch (error) {
          console.error("❌ Error al llamar al modelo:", error);
          // Fallback to simple formatting if AI call fails
          formattedResults = res.data.items.map((item, index) => 
            `${index + 1}. **${item.snippet?.title || 'Unknown'}**\n` +
            `   Channel: ${item.snippet?.channelTitle || 'Unknown'}\n` +
            `   Link: https://www.youtube.com/watch?v=${item.id?.videoId || ''}\n`
          ).join("\n");
        }

        const result = {
          content: [
            {
              type: "text",
              text: formattedResults.length > 0
                ? `# Search results for "${query}"\n\n${formattedResults}`
                : `No results found for "${query}". Please try a different query.`,
            }
          ]
        };

        // Cache the result
        saveToCache(cacheKey, result, CACHE_TTL);
        return result;

      } catch (error) {
        console.error("❌ Error searching YouTube:", error);
        throw new Error(`Failed to search YouTube: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
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
  console.log("📦 Cuerpo de la petición:", JSON.stringify(req.body, null, 2));

  // Validar que el cuerpo de la petición existe
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json(createErrorResponse(
      -32600,
      "Invalid Request: Body must be a valid JSON object",
      null
    ));
  }

  try {
    // Busca sessionId en cabecera
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    console.log(`🔑 Procesando para session ID: ${sessionId}`);

    // Validar sessionId si existe
    if (sessionId && !isValidSessionId(sessionId)) {
      return res.status(400).json(createErrorResponse(
        -32000,
        "Invalid session ID format",
        req.body.id
      ));
    }

    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      console.log(`🔄 Reutilizando transport para sesión ${sessionId}`);
      transport = transports[sessionId];
      
      // Verificar que el transport está en buen estado
      if (!transport || transport.sessionId !== sessionId) {
        console.warn(`⚠️ Transport para sesión ${sessionId} no está en buen estado, eliminando...`);
        delete transports[sessionId];
        return res.status(400).json(createErrorResponse(
          -32000,
          "Session expired or invalid",
          req.body.id
        ));
      }
    } else if (!sessionId && isInitializeRequest(req.body)) {
      console.log("🆕 Sin session ID, inicializando nuevo transport");

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          console.log(`✅ Sesión inicializada: ${sessionId}`);
          transports[sessionId] = transport;
        },
      });
      
      transport.onclose = () => {
        if (transport.sessionId) {
          console.log(`🔒 Transport cerrado para sesión ${transport.sessionId}`);
          delete transports[transport.sessionId];
        }
      };

      await server.connect(transport);
    } else {
      return res.status(400).json(createErrorResponse(
        -32000,
        "Bad Request: No valid session ID provided or not an initialize request",
        req.body.id
      ));
    }

    // Maneja la petición con el transport correspondiente
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("❌ Error manejando petición MCP:", error);
    if (!res.headersSent) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return res.status(500).json(createErrorResponse(
        -32603,
        `Internal server error: ${errorMessage}`,
        req.body?.id
      ));
    }
  }
});

/**
 * Endpoint GET para SSE streams (usado por MCP para eventos).
 */
app.get("/mcp", async (req: Request, res: Response) => {
  console.log("📥 Recibida petición MCP GET");
  
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  
  if (!sessionId) {
    return res.status(400).json(createErrorResponse(
      -32000,
      "Bad Request: No session ID provided",
      null
    ));
  }

  if (!isValidSessionId(sessionId)) {
    return res.status(400).json(createErrorResponse(
      -32000,
      "Bad Request: Invalid session ID format",
      null
    ));
  }

  if (!transports[sessionId]) {
    return res.status(400).json(createErrorResponse(
      -32000,
      "Bad Request: Session not found or expired",
      null
    ));
  }

  const lastEventId = req.headers["last-event-id"] as string | undefined;
  if (lastEventId) {
    console.log(`🔁 Cliente reconectando con Last-Event-ID: ${lastEventId}`);
  } else {
    console.log(`🌐 Estableciendo nuevo SSE para sesión ${sessionId}`);
  }

  try {
    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error("❌ Error manejando petición GET:", error);
    if (!res.headersSent) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return res.status(500).json(createErrorResponse(
        -32603,
        `Error handling SSE connection: ${errorMessage}`,
        null
      ));
    }
  }
});

/**
 * Endpoint DELETE para terminar sesión MCP.
 */
app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  
  if (!sessionId) {
    return res.status(400).json(createErrorResponse(
      -32000,
      "Bad Request: No session ID provided",
      req.body?.id
    ));
  }

  if (!isValidSessionId(sessionId)) {
    return res.status(400).json(createErrorResponse(
      -32000,
      "Bad Request: Invalid session ID format",
      req.body?.id
    ));
  }

  if (!transports[sessionId]) {
    return res.status(400).json(createErrorResponse(
      -32000,
      "Bad Request: Session not found or already terminated",
      req.body?.id
    ));
  }

  console.log(`🗑️ Recibida petición de terminación de sesión para ${sessionId}`);

  try {
    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
    
    // Cleanup después de manejar la petición
    setTimeout(() => {
      if (transports[sessionId]) {
        console.log(`🧹 Limpiando transport para sesión ${sessionId}`);
        delete transports[sessionId];
      }
    }, 1000); // Dar tiempo para que la respuesta se envíe
    
  } catch (error) {
    console.error("❌ Error al terminar sesión:", error);
    if (!res.headersSent) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return res.status(500).json(createErrorResponse(
        -32603,
        `Error handling session termination: ${errorMessage}`,
        req.body?.id
      ));
    }
  }
});

/**
 * Health check endpoint.
 */
app.get("/health", (req: Request, res: Response) => {
  const activeSessions = Object.keys(transports).length;
  const cacheEntries = Object.keys(searchCache).length;
  
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    activeSessions,
    cacheEntries,
    uptime: process.uptime(),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
  });
});

/**
 * 🚦 Inicia el servidor Express.
 */
const PORT = process.env.PORT || 3001;
const server_instance = app.listen(PORT, () => {
  console.log(`📡 MCP Streamable HTTP Server escuchando en puerto ${PORT}`);
  console.log(`🏥 Health check disponible en http://localhost:${PORT}/health`);
});

// Configurar timeout para el servidor
server_instance.timeout = 30000; // 30 segundos

/**
 * 🛑 Maneja el apagado del servidor y limpia recursos.
 */
async function gracefulShutdown(signal: string) {
  console.log(`🛑 Recibida señal ${signal}, iniciando apagado graceful...`);

  // Cierra el servidor HTTP
  server_instance.close(() => {
    console.log("🔌 Servidor HTTP cerrado");
  });

  // Cierra todos los transports activos
  const closePromises = Object.entries(transports).map(async ([sessionId, transport]) => {
    try {
      console.log(`🔒 Cerrando transport para sesión ${sessionId}`);
      await transport.close();
      delete transports[sessionId];
    } catch (error) {
      console.error(`❌ Error cerrando transport para sesión ${sessionId}:`, error);
    }
  });

  try {
    await Promise.all(closePromises);
    console.log("✅ Apagado completo");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error durante el apagado:", error);
    process.exit(1);
  }
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// Maneja errores no capturados
process.on("uncaughtException", (error) => {
  console.error("❌ Error no capturado:", error);
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Promise rechazada no manejada:", reason);
  console.error("Promise:", promise);
  gracefulShutdown("unhandledRejection");
});

// Limpieza periódica de transports inactivos y cache
setInterval(() => {
  const now = Date.now();
  let cleanedCount = 0;
  
  Object.entries(transports).forEach(([sessionId, transport]) => {
    // Si el transport no tiene sessionId o está en mal estado, eliminarlo
    if (!transport || !transport.sessionId || transport.sessionId !== sessionId) {
      console.log(`🧹 Limpiando transport inactivo para sesión ${sessionId}`);
      delete transports[sessionId];
      cleanedCount++;
    }
  });
  
  if (cleanedCount > 0) {
    console.log(`🧹 Limpiados ${cleanedCount} transports inactivos`);
  }
  
  // Limpiar cache y rate limits también
  cleanupCache();
  cleanupRateLimits();
}, 300000); // Cada 5 minutos
