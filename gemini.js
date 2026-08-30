const { GoogleGenAI } = require('@google/genai');

const tools = [
  {
    name: "interactWithWorld",
    description: "Execute a sequence of physical actions in the game world and optionally speak in chat.",
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
                description: "Action type: mine (dig block), follow (walk to target), toss_item (drop specified amount), equip (hold/wear item), eat (consume food), stop (halt), chat_only (talk without moving), place (put block on ground), attack (fight entity), craft (craft item), sleep (use bed), pickup (walk to dropped items)."
              },
              target: {
                type: "STRING",
                description: "Target identifier: block name (e.g. oak_log), item name (e.g. oak_planks), mob/player name, or 'item' for pickup."
              },
              count: {
                type: "NUMBER",
                description: "Quantity/count for mining, dropping, crafting, or placing."
              }
            },
            required: ["action"]
          }
        },
        sayInChat: {
          type: "STRING",
          description: "Alice's message spoken to players in Minecraft chat. Leave EMPTY during autonomous background ticks unless explicitly addressing a player."
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

CURRENT WORLD CONTEXT:
- Position: X:${worldContext.pos.x}, Y:${worldContext.pos.y}, Z:${worldContext.pos.z}
- Health: ${worldContext.health}/20 | Food: ${worldContext.food}/20
- Inventory: ${worldContext.inventory.join(', ') || 'empty'}
- Equipment: ${worldContext.equipment.join(', ') || 'none'}
- Nearby Blocks: ${worldContext.nearbyBlocks.join(', ') || 'none'}
- Nearby Entities (Mobs/Players): ${worldContext.nearbyEntities.join(', ') || 'none'}
- Nearby Dropped Items: ${worldContext.nearbyItems.join(', ') || 'none'}

EXECUTION RULES:
1. Always call the interactWithWorld tool to respond or take actions.
2. Build sequential action arrays for multi-step goals (e.g. mine wood -> craft planks -> place crafting table).
3. If sender is "System_Autonomous_Tick", you are acting on your own. DO NOT fill sayInChat unless responding directly to a player or an urgent event. Perform background actions silently.
4. If sender is a real player, speak naturally in Polish in sayInChat while performing your actions.
5. If sender is "System", it is an internal status report from your previous action. Use it to update your internal state and decide next steps without duplicate messaging.
6. For simple chat queries without physical work, use action="chat_only".`;

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
