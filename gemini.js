const { GoogleGenAI } = require('@google/genai');

const tools = [
  {
    name: "interactWithWorld",
    description: "Wykonaj fizyczną akcję w świecie gry oraz wypowiedz się na czacie.",
    parameters: {
      type: "OBJECT",
      properties: {
        action: {
          type: "STRING",
          enum: ["mine", "follow", "toss_item", "equip", "eat", "stop", "chat_only"],
          description: "Rodzaj akcji: mine (wykop blok/bloki), follow (chodź za graczem), toss_item (wyrzuć), equip (załóż), eat (zjedz), stop (zatrzymaj), chat_only (tylko gadaj)."
        },
        target: {
          type: "STRING",
          description: "Nazwa bloku (np. oak_log, stone, dirt) lub przedmiotu."
        },
        count: {
          type: "NUMBER",
          description: "Liczba sztuk do wykopania lub wykonania, jeśli gracz podał ilość (np. 10)."
        },
        sayInChat: {
          type: "STRING",
          description: "Wypowiedź Alice na czacie po polsku podczas rozpoczynania akcji."
        }
      },
      required: ["action"]
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

STAN AKTUALNY:
- Pozycja: X:${worldContext.pos.x}, Y:${worldContext.pos.y}, Z:${worldContext.pos.z}
- Zdrowie: ${worldContext.health}/20 | Głód: ${worldContext.food}/20
- Ekwipunek: ${worldContext.inventory.join(', ') || 'pusty'}
- Bloków w pobliżu: ${worldContext.nearbyBlocks.join(', ') || 'brak'}

ZASADY:
1. Zawsze używaj funkcji interactWithWorld.
2. Jeśli gracz prosi o wykopanie/zebranie surowców (np. "zbierz 10 kłód"), wybierz action="mine", target="oak_log" (lub odpowiedni blok) i ustaw count=10. Jeśli nie podał liczby, wybierz rozsądną domyślną ilość (np. 5).
3. Jeśli nadawcą wiadomości jest "System", oznacza to wewnętrzny raport z wykonanej przed chwilą akcji. Ustaw wtedy action="chat_only" i w polu sayInChat odpowiedz graczowi naturalnie własnymi słowami, informując go o wyniku pracy.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: [
        { role: 'user', parts: [{ text: `${username}: ${message}` }] }
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
