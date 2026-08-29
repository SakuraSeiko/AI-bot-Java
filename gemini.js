const { GoogleGenAI } = require('@google/genai');

const tools = [
  {
    name: "walkTo",
    description: "Navigate safely to specific X, Y, Z coordinates using pathfinding.",
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
    description: "Follow a specific player continuously using pathfinding.",
    parameters: {
      type: "OBJECT",
      properties: {
        targetUsername: { type: "STRING", description: "Username of the target player to follow." }
      },
      required: ["targetUsername"]
    }
  },
  {
    name: "stopMovement",
    description: "Stop moving or following immediately.",
    parameters: {
      type: "OBJECT",
      properties: {}
    }
  },
  {
    name: "digBlock",
    description: "Mine/dig the block located at the specific X, Y, Z coordinates.",
    parameters: {
      type: "OBJECT",
      properties: {
        x: { type: "NUMBER", description: "Block X coordinate" },
        y: { type: "NUMBER", description: "Block Y coordinate" },
        z: { type: "NUMBER", description: "Block Z coordinate" }
      },
      required: ["x", "y", "z"]
    }
  },
  {
    name: "findAndDigBlock",
    description: "Find the nearest block of a specific type (e.g. oak_log, dirt, stone, iron_ore) nearby and go mine it.",
    parameters: {
      type: "OBJECT",
      properties: {
        blockName: { type: "STRING", description: "Technical name of the minecraft block, e.g. oak_log, dirt, stone." }
      },
      required: ["blockName"]
    }
  },
  {
    name: "chatMessage",
    description: "Send a conversational text message to the in-game server chat.",
    parameters: {
      type: "OBJECT",
      properties: {
        message: { type: "STRING", description: "Text message to send in Polish." }
      },
      required: ["message"]
    }
  }
];

let ai = null;

function initGemini() {
  if (process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
}

async function analyzeMessage(username, message, botPos) {
  if (!ai) return null;

  const currentX = Math.floor(botPos.x);
  const currentY = Math.floor(botPos.y);
  const currentZ = Math.floor(botPos.z);
  const blockBelowY = currentY - 1;

  const prompt = `Jesteś autonomiczną towarzyszką AI o imieniu Alice w grze Minecraft.
Twoja aktualna pozycja w świecie: X:${currentX}, Y:${currentY}, Z:${currentZ}.
Blok pod Twoimi stopami znajduje się dokładnie na współrzędnych: X:${currentX}, Y:${blockBelowY}, Z:${currentZ}.

Gracz ${username} powiedział: "${message}".

ZASADY WYBORU NARZĘDZI:
1. Jeśli gracz prosi Cię o podążanie/chodzenie za nim (np. "chodź za mną", "podążaj za mną", "idź do mnie"), MUSISZ wywołać funkcję followPlayer z targetUsername="${username}". NIE UŻYWAJ chatMessage!
2. Jeśli gracz prosi Cię o zatrzymanie się, wywołaj stopMovement.
3. Jeśli gracz prosi Cię o wykopanie bloku pod sobą, wywołaj digBlock z argumentami: x=${currentX}, y=${blockBelowY}, z=${currentZ}.
4. Jeśli gracz prosi o pozbieranie/ścięcie drewna, kamienia lub konkretnego bloku w okolicy, wywołaj findAndDigBlock z odpowiednią nazwą (np. blockName="oak_log" dla drewna, blockName="dirt" dla ziemi).
5. Funkcji chatMessage używaj TYLKO do czystej rozmowy, odpowiadania na pytania lub gdy polecenie nie wymaga wykonania żadnej akcji fizycznej.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: prompt,
      config: {
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
