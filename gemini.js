import { GoogleGenAI } from '@google/genai';

const tools = [
  {
    functionDeclarations: [
      {
        name: "walkTo",
        description: "Walk precisely to specific X, Y, Z coordinates using advanced pathfinding.",
        parameters: {
          type: "OBJECT",
          properties: {
            x: { type: "NUMBER", description: "X coordinate" },
            y: { type: "NUMBER", description: "Y coordinate" },
            z: { type: "NUMBER", description: "Z coordinate" }
          },
          required: ["x", "y", "z"]
        }
      },
      {
        name: "followPlayer",
        description: "Dynamically follow a specific player across the world.",
        parameters: {
          type: "OBJECT",
          properties: {
            targetUsername: { type: "STRING", description: "Username of the target player." }
          },
          required: ["targetUsername"]
        }
      },
      {
        name: "stopEverything",
        description: "Halt all movement, pathfinding, collection, and combat immediately.",
        parameters: { type: "OBJECT", properties: {} }
      },
      {
        name: "lookAtCoords",
        description: "Direct camera view towards specific coordinates.",
        parameters: {
          type: "OBJECT",
          properties: {
            x: { type: "NUMBER" }, y: { type: "NUMBER" }, z: { type: "NUMBER" }
          },
          required: ["x", "y", "z"]
        }
      },
      {
        name: "findAndCollect",
        description: "Automatically find a block type nearby and mine/collect it into inventory.",
        parameters: {
          type: "OBJECT",
          properties: {
            blockName: { type: "STRING", description: "Minecraft block name (e.g. 'oak_log', 'stone', 'iron_ore')" }
          },
          required: ["blockName"]
        }
      },
      {
        name: "attackMob",
        description: "Engage in PvP combat against a nearby mob or entity.",
        parameters: {
          type: "OBJECT",
          properties: {
            mobName: { type: "STRING", description: "Name of the mob (e.g. 'zombie', 'skeleton', 'creeper')" }
          },
          required: ["mobName"]
        }
      },
      {
        name: "listInventory",
        description: "Check current inventory items and quantities.",
        parameters: { type: "OBJECT", properties: {} }
      },
      {
        name: "equipItem",
        description: "Equip an item from inventory to hand or armor slots.",
        parameters: {
          type: "OBJECT",
          properties: {
            itemName: { type: "STRING", description: "Name or part of item name" },
            destination: { type: "STRING", description: "Slot type: 'hand', 'head', 'torso', 'legs', 'feet', 'off-hand'" }
          },
          required: ["itemName"]
        }
      },
      {
        name: "chatMessage",
        description: "Send a chat message to the server.",
        parameters: {
          type: "OBJECT",
          properties: {
            message: { type: "STRING" }
          },
          required: ["message"]
        }
      }
    ]
  }
];

let ai = null;

function initGemini() {
  if (process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
}

async function analyzeMessage(username, message, env) {
  if (!ai) return null;

  const prompt = `You are Alice, an autonomous, fully integrated Minecraft companion bot with access to pathfinding, combat, collection, and survival plugins.
Status -> Pos: X:${Math.round(env.position.x)} Y:${Math.round(env.position.y)} Z:${Math.round(env.position.z)} | HP: ${env.health} | Food: ${env.food}
Inventory: ${env.inventorySummary}
Nearby entities: ${env.nearby}

Player ${username} said: "${message}".
Evaluate what action is needed (movement, collection, combat, inventory management, or chat reply) and call the corresponding tool.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: prompt,
      config: { tools: tools }
    });

    const functionCalls = response.functionCalls;
    if (functionCalls && functionCalls.length > 0) {
      return { type: 'function', action: functionCalls[0] };
    }

    return { type: 'text', text: response.text };
  } catch (err) {
    console.error('[GEMINI ERROR]', err.message || err);
    return null;
  }
}

export { initGemini, analyzeMessage };
