# 🎯 How the Sampling Functionality Works in Model Context Protocol

> 🌐 **Available Languages** / **Idiomas disponibles**: [🇪🇸 Español](README.md) | [🇺🇸 English](README.en.md)

Hello developer 👋🏻! In this repository you have an example of how Sampling works in Model Context Protocol. So you can perfectly understand how you can use it and what it brings to your MCP Servers. If you want to see it in action, here's the video related to this repo:

[![What is sampling in model context protocol](https://github.com/user-attachments/assets/1a8b25f6-8234-471d-8ea3-17c622ac7ce6)](https://youtu.be/7LARYKzChMQ)

## 🤔 How does Sampling work in MCP?

*Sampling* in MCP is a powerful feature that allows the tools/prompts of your MCP servers to request the client to generate content using their own LLM models. Instead of the MCP server having to integrate directly with AI providers, it delegates this responsibility to the client.

### 🔄 Complete Sampling Flow

The sampling process in MCP follows this flow:

1. **The client calls an MCP tool** (e.g. `summarize`) with specific parameters.
2. **The tool uses `extra.sendRequest`** to send a `sampling/createMessage` type request to the client.
3. **The client processes the sampling request** using its available LLM models.
4. **The client returns the generated content** to the MCP tool.
5. **The tool processes the response** and returns it to the original client.

### ⭐ Advantages of Sampling

- **No external dependencies**: The MCP server doesn't need API keys or integrations with AI providers.
- **Client flexibility**: The client can choose the most suitable LLM model for each task.
- **Efficiency**: Avoids redundant calls to external APIs.
- **Security**: LLM credentials and configurations remain on the client.

### 💡 Practical Example

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
        costPriority: 0.5,      // Balance cost and performance
        intelligencePriority: 0.5, // Balance intelligence and performance  
        speedPriority: 0.5,     // Prioritize speed
      },
    },
  },
  CreateMessageResultSchema
);
```

### 🔧 Correct Sampling Implementation

Unlike incorrect implementations that could cause circular dependencies, the correct implementation uses the `sampling/createMessage` method through `extra.sendRequest`. That is, you should not try to send a message directly from the server instance, but it should be sent from the MCP client session. For this you can use the `extra` parameter that the tool receives.

```typescript
 async function (
      { text },
      extra: RequestHandlerExtra<any, any>
    ): Promise<CallToolResult> {
```

## 🚀 Usage

### 🔧 Start the server

```bash
npm install
npm run build
npm start
```

### 🛠️ Visual Studio Code Configuration

This repository already includes the necessary configuration so you can configure this MCP Server in Visual Studio Code. It can be found in the `.vscode/mcp.json` file. So once the project is started you just have to click `Start` inside the `mcp.json` file 🤓.

---

## 📺 Subscribe to my YouTube channel!

If you found this content useful and want to learn more about Model Context Protocol, artificial intelligence and development, don't forget to subscribe to my YouTube channel! This way you'll stay up to date with new tutorials, practical examples and tech world news.  
[👉 Subscribe here](https://www.youtube.com/@returngis) and activate the bell so you don't miss anything.

---

See you soon 👋🏻!