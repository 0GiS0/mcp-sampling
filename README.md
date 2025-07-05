# Cómo crear un servidor MCP usando Low-Level Server y Streameable HTTP 🚀🖥️✨

Este es un servidor MCP basado en TypeScript que implementa un sistema sencillo de notas. Demuestra conceptos clave de MCP proporcionando:

- 📄 Recursos que representan notas de texto con URIs y metadatos
- 🛠️ Herramientas para crear nuevas notas
- 💡 Prompts para generar resúmenes de notas

## Características 🌟

### Mejoras Implementadas 🚀

#### Robustez y Confiabilidad
- ✅ **Manejo de errores mejorado**: Validación completa de entrada y manejo de errores estructurado
- ✅ **Validación de sesiones**: Verificación de formato UUID para session IDs
- ✅ **Limpieza automática**: Limpieza periódica de transports inactivos y cache
- ✅ **Apagado graceful**: Manejo seguro de señales de cierre del servidor

#### Rendimiento y Escalabilidad
- ⚡ **Cache inteligente**: Sistema de cache con TTL para búsquedas de YouTube
- ⚡ **Compresión gzip**: Reducción automática del tamaño de respuestas
- ⚡ **Rate limiting**: Protección contra abuso con límites por IP
- ⚡ **Optimización de memoria**: Monitoreo y gestión de memoria

#### Seguridad
- 🔒 **CORS configurado**: Control de orígenes permitidos
- 🔒 **Validación de Content-Type**: Verificación de tipos de contenido
- 🔒 **Sanitización de entrada**: Validación y limpieza de datos de entrada
- 🔒 **Timeouts configurados**: Prevención de requests colgados

#### Observabilidad
- 📊 **Health check endpoint**: Monitoreo de estado del servidor en `/health`
- 📊 **Métricas detalladas**: Información sobre sesiones, cache y memoria
- 📊 **Logging estructurado**: Registros consistentes y útiles para debugging
- 📊 **Manejo de errores no capturados**: Prevención de crashes inesperados

### Características Originales

### Recursos 📚

- 📑 Lista y accede a notas mediante URIs `note://`
- 🏷️ Cada nota tiene título, contenido y metadatos
- 📝 Tipo MIME de texto plano para acceso sencillo al contenido

### Herramientas 🧰

- ✍️ `create_note` - Crea nuevas notas de texto
  - 🏷️ Requiere título y contenido como parámetros obligatorios
  - 💾 Almacena la nota en el estado del servidor

### Prompts 🧠

- 📝 `summarize_notes` - Genera un resumen de todas las notas almacenadas
  - 📥 Incluye todos los contenidos de las notas como recursos embebidos
  - 📤 Devuelve un prompt estructurado para la resumir con LLM

## Desarrollo 👨‍💻👩‍💻

Instala las dependencias:

```bash
npm install
```

Compila el servidor:

```bash
npm run build
```

Inicia el servidor:

```bash
npm start
```

## Instalación ⚙️

Para usar con Claude Desktop, añade la configuración del servidor:

En MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`  
En Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mcp-low-level-server-streamable-http": {
      "type": "http",
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

### Debugging 🐞🔍

Como los servidores MCP se comunican por stdio, depurar puede ser complicado. Recomendamos usar el [MCP Inspector](https://github.com/modelcontextprotocol/inspector) 🕵️‍♂️, disponible como script de npm:

```bash
npm run inspector
```

El Inspector te dará una URL 🌐 para acceder a herramientas de depuración en tu navegador.
