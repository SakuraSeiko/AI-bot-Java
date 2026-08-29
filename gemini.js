const { GoogleGenAI } = require('@google/genai');

const tools = [
  {
    name: "interactWithWorld",
    description: "Wykonaj fizyczną akcję w świecie gry na podstawie analizy sytuacji i otoczenia.",
    parameters: {
      type: "OBJECT",
      properties: {
        action: {
          type: "STRING",
          enum: ["mine", "follow", "toss_item", "equip", "eat", "stop"],
          description: "Rodzaj akcji: mine (zbieraj/kop blok), follow (podążaj za graczem), toss_item (wyrzuć przedmiot graczowi), equip (założ zbroję/weź do ręki), eat (zjedz jedzenie z ekwipunku), stop (zatrzymaj się)"
        },
        target: {
          type: "STRING",
          description: "Nazwa bloku (np. oak_planks, oak_log, dirt) lub przedmiotu z ekwipunku."
        }
      },
      required: ["action"]
    }
  },
  {
    name: "chatMessage",
    description: "Wypowiedz się na czacie gry w sposób naturalny.",
    parameters: {
      type: "OBJECT",
      properties: {
        message: { type: "STRING", description: "Wypowiedź po polsku." }
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

async function analyzeMessage(username, message, worldContext) {
  if (!ai) return null;

  const systemInstruction = `Jesteś Alice – autonomiczną towarzyszką AI w grze Minecraft.
Posiadasz pełną świadomość swojego otoczenia, stanu fizycznego oraz ekwipunku.

AKTUALNY STAN ALICE:
- Pozycja: X:${worldContext.pos.x}, Y:${worldContext.pos.y}, Z:${worldContext.pos.z}
- Zdrowie: ${worldContext.health}/20 | Głód: ${worldContext.food}/20
- Ekwipunek: ${worldContext.inventory.join(', ') || 'pusty'}
- Założone przedmioty: ${worldContext.equipment.join(', ') || 'brak'}
- Wykryte bloki w pobliżu: ${worldContext.nearbyBlocks.join(', ') || 'brak'}

ZASADY AUTONOMII:
1. Sama analizuj intencję gracza ${username} oraz swój obecny stan.
2. Gdy gracz każe Ci coś wykopać, ściąć lub pozbierać deski/drewno/bloki, użyj action="mine" z dokładną nazwą bloku (np. oak_planks, oak_log, dirt).
3. Gdy zrobisz zadanie lub gracz chce przedmiot, użyj action="toss_item" z nazwą tego przedmiotu.
4. Sama dbaj o swoje zdrowie i głód – jeśli masz jedzenie w kieszeni i jesteś głodna, zjedz je (action="eat").
5. Jeśli znajdziesz pancerz lub broń, sama zdecyduj o ich założeniu (action="equip").
6. Używaj chatMessage do naturalnej rozmowy z graczem.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: [
        { role: 'user', parts: [{ text: `${username} mówi: "${message}"` }] }
      ],
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
