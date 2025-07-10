# 🎯 Cómo funciona la funcionalidad Sampling en Model Context Protocol

¡Hola developer 👋🏻! En este repositorio tienes un ejemplo de cómo funciona el Sampling en Model Context Protocol. Para que puedas entender perfectamente cómo puedes usarlo y qué te aporta dentro de tus MCP Servers. Si quieres verlo en acción, aquí tienes el vídeo relacionado con este repo:

[![Qué es el sampling en model context protocol](https://github.com/user-attachments/assets/1a8b25f6-8234-471d-8ea3-17c622ac7ce6)](https://youtu.be/7LARYKzChMQ)

## 🤔 ¿Cómo funciona el Sampling en MCP?

El *sampling* en MCP es una característica poderosa que permite que las tools/prompts de tus servidores MCP soliciten al cliente que genere contenido usando sus propios modelos LLM. En lugar de que el servidor MCP tenga que integrar directamente con proveedores de IA, delega esta responsabilidad al cliente.

### 🔄 Flujo completo del Sampling

El proceso de sampling en MCP sigue este flujo:

1. **El cliente llama a una herramienta MCP** (ej. `summarize`) con parámetros específicos.
2. **La herramienta utiliza `extra.sendRequest`** para enviar una solicitud de tipo `sampling/createMessage` al cliente.
3. **El cliente procesa la solicitud de sampling** usando sus modelos LLM disponibles.
4. **El cliente devuelve el contenido generado** a la herramienta MCP.
5. **La herramienta procesa la respuesta** y la devuelve al cliente original.

### ⭐ Ventajas del Sampling

- **Sin dependencias externas**: El servidor MCP no necesita API keys ni integraciones con proveedores de IA.
- **Flexibilidad del cliente**: El cliente puede elegir el modelo LLM más adecuado para cada tarea.
- **Eficiencia**: Evita llamadas redundantes a APIs externas.
- **Seguridad**: Las credenciales y configuraciones del LLM permanecen en el cliente.

### 💡 Ejemplo práctico

```typescript
const result = await extra.sendRequest(
  {
    method: "sampling/createMessage",
    params: {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please summarize the following text concisely:\n\n${text}`,
          },
        },
      ],
      maxTokens: 500,
      modelPreferences: {
        costPriority: 0.5,      // Balance costo y rendimiento
        intelligencePriority: 0.5, // Balance inteligencia y rendimiento  
        speedPriority: 0.5,     // Priorizar velocidad
      },
    },
  },
  CreateMessageResultSchema
);
```

### 🔧 Implementación correcta del Sampling

A diferencia de implementaciones incorrectas que podrían causar dependencias circulares, la implementación correcta utiliza el método `sampling/createMessage` a través de `extra.sendRequest`. Es decir, no se debe intentar enviar un mensaje directamente desde la instancia del servidor, sino que debe enviarse desde la sesión del cliente MCP. Para ello puedes usar el parámetro `extra` que recibe la tool.


```typescript
 async function (
      { text },
      extra: RequestHandlerExtra<any, any>
    ): Promise<CallToolResult> {
```


## 🚀 Uso

### 🔧 Iniciar el servidor

```bash
npm install
npm run build
npm start
```

### 🛠️ Configuración para Visual Studio Code

Este repositorio ya incluye la configuración necesaria para que puedas configurar este MCP Server en Visual Studio Code. La misma se encuentra en el archivo `.vscode/mcp.json`. Por lo que una vez arrancado el proyecto solo tienes que hacer clic en `Start` dentro del archivo `mcp.json` 🤓.


---

## 📺 ¡Suscríbete a mi canal de YouTube!

Si te ha resultado útil este contenido y quieres aprender más sobre Model Context Protocol, inteligencia artificial y desarrollo, ¡no olvides suscribirte a mi canal de YouTube! Así estarás al tanto de nuevos tutoriales, ejemplos prácticos y novedades del mundo tech.  
[👉 Suscríbete aquí](https://www.youtube.com/@returngis) y activa la campanita para no perderte nada.

---


¡Nos vemos 👋🏻!
