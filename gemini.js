const { GoogleGenAI } = require('@google/genai');

const tools = [
  {
    name: "interactWithWorld",
    description: "Execute game actions via low-level gamepad controller and talk in chat.",
    parameters: {
      type: "OBJECT",
      properties: {
        actions: {
          type: "ARRAY",
          description: "Sequence of controller actions.",
          items: {
            type: "OBJECT",
            properties: {
              action: {
                type: "STRING",
                enum: [
                  "mine",
                  "follow",
                  "toss_item",
                  "equip",
                  "eat",
                  "stop",
                  "chat_only",
                  "place",
                  "attack",
                  "craft",
                  "sleep",
                  "pickup"
                ],
                description: "Action type."
              },
              target: {
                type: "STRING",
                description: "Target item/block/mob name."
              },
              count: {
                type: "NUMBER",
                description: "Item count."
              }
            },
            required: ["action"]
          }
        },
        sayInChat: {
          type: "STRING",
          description: "Chat message spoken in Polish."
        }
      },
      required: ["actions"]
    }
  }
];

let ai = null;

function initGemini() {
  if (process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
}

async function analyzeMessage(username, message, worldContext, chatHistory = []) {
  if (!ai) return null;

  const systemInstruction = `You are Alice – an autonomous AI companion in Minecraft.

WORLD CONTEXT:
- Pos: X:${worldContext.pos.x}, Y:${worldContext.pos.y}, Z:${worldContext.pos.z}
- Health: ${worldContext.health}/20 | Food: ${worldContext.food}/20
- Inventory: ${worldContext.inventory.join(', ') || 'empty'}
- Equipment: ${worldContext.equipment.join(', ') || 'none'}
- Nearby Blocks: ${worldContext.nearbyBlocks.join(', ') || 'none'}
- Nearby Mobs/Players: ${worldContext.nearbyEntities.join(', ') || 'none'}
- Nearby Items: ${worldContext.nearbyItems.join(', ') || 'none'}

RULES:
1. Always return interactWithWorld.
2. For placing blocks, ensure you specify target block name (e.g. "crafting_table", "white_bed", "oak_planks").
3. Speak in natural Polish in sayInChat.`;

  const contents = chatHistory.map(entry => ({
    role: entry.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: `${entry.sender}: ${entry.text}` }]
  }));

  contents.push({
    role: 'user',
    parts: [{ text: `${username}: ${message}` }]
  });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        tools: [{ functionDeclarations: tools }]
      }
    });

    const calls = response.functionCalls;
    if (calls && calls.length > 0) {
      return { type: 'function', action: calls[0] };
    }
    
    return { type: 'text', text: response.text };
  } catch (err) {
    console.error('[GEMINI ERROR]', err.message || err);
    return null;
  }
}

module.exports = { initGemini, analyzeMessage };
