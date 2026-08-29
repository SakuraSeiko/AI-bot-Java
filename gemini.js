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
          description: "Rodzaj akcji: mine (znajdź i wykop blok, np. oak_log, stone, dirt), follow (chodź za graczem), toss_item (wyrzuć), equip (załóż), eat (zjedz), stop (zatrzymaj), chat_only (tylko gadaj)."
        },
        target: {
          type: "STRING",
          description: "Nazwa bloku (np. oak_log, stone, dirt) lub przedmiotu."
        },
        sayInChat: {
          type: "STRING",
          description: "Wypowiedź Alice na czacie po polsku podczas wykonywania tej akcji."
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
2. Jeśli gracz każe Ci iść za sobą, wybierz action="follow".
3. Jeśli gracz każe Ci kopać/zbierać (np. drewno, kamień, ziemię), wybierz action="mine" i podaj dokładną angielską nazwę bloku w target (np. oak_log, stone, dirt).
4. Tekst, który Alice mówi na czacie, zawsze wpisuj do pola sayInChat.`;

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
