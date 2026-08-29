const { GoogleGenAI } = require('@google/genai');

const tools = [
  {
    name: "interactWithWorld",
    description: "Execute a sequence of physical actions in the game world and speak in chat.",
    parameters: {
      type: "OBJECT",
      properties: {
        actions: {
          type: "ARRAY",
          description: "List of actions to execute sequentially in a single turn.",
          items: {
            type: "OBJECT",
            properties: {
              action: {
                type: "STRING",
                enum: ["mine", "follow", "toss_item", "equip", "eat", "stop", "chat_only"],
                description: "Action type: mine (dig block/blocks), follow (walk to player), toss_item (drop item), equip (hold/wear item), eat (consume food), stop (halt pathfinding), chat_only (talk only)."
              },
              target: {
                type: "STRING",
                description: "Target block name (e.g. oak_log, stone, coal_ore) or item name."
              },
              count: {
                type: "NUMBER",
                description: "Amount of items to mine or drop, if specified by player."
              }
            },
            required: ["action"]
          }
        },
        sayInChat: {
          type: "STRING",
          description: "Alice's chat message in Polish spoken while starting the action sequence."
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

CURRENT STATUS:
- Position: X:${worldContext.pos.x}, Y:${worldContext.pos.y}, Z:${worldContext.pos.z}
- Health: ${worldContext.health}/20 | Food: ${worldContext.food}/20
- Inventory: ${worldContext.inventory.join(', ') || 'empty'}
- Nearby blocks: ${worldContext.nearbyBlocks.join(', ') || 'none'}

RULES:
1. Always use the interactWithWorld tool.
2. If the player requests a complex task (e.g. "come to me and drop coal"), define a sequence in actions: [{action: "follow"}, {action: "toss_item", target: "coal"}].
3. For mining tasks (e.g. coal, wood), set action="mine" and target to the appropriate block (use coal_ore for coal, oak_log for wood, etc.).
4. Always respond in natural Polish in sayInChat.
5. Consider the conversation history and previous context. If the sender is "System", it is an internal task execution report – reply naturally in sayInChat informing the player of the outcome.`;

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
