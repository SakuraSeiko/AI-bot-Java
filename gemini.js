const { GoogleGenerativeAI } = require('@google/generative-ai');

const tools = [
  {
    functionDeclarations: [
      {
        name: "walkTo",
        description: "Walk to specific X, Y, Z coordinates in the world.",
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
        description: "Walk directly to a specific player.",
        parameters: {
          type: "OBJECT",
          properties: {
            targetUsername: { type: "STRING", description: "Username of the target player." }
          },
          required: ["targetUsername"]
        }
      },
      {
        name: "digBlock",
        description: "Mine/dig the block located at the given X, Y, Z coordinates.",
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
        name: "chatMessage",
        description: "Send a chat message to the in-game server.",
        parameters: {
          type: "OBJECT",
          properties: {
            message: { type: "STRING", description: "Text message to send" }
          },
          required: ["message"]
        }
      }
    ]
  }
];

let model = null;

function initGemini() {
  if (process.env.GEMINI_API_KEY) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      tools: tools
    });
  }
}

async function analyzeMessage(username, message, botPos) {
  if (!model) return null;

  const prompt = `You are an autonomous Minecraft companion bot named Alice. 
Current location: X:${Math.round(botPos.x)}, Y:${Math.round(botPos.y)}, Z:${Math.round(botPos.z)}.
Player ${username} said: "${message}". 
If action (walk, follow, dig, speak) is required, call the appropriate tool. Otherwise reply concisely.`;

  try {
    const result = await model.generateContent(prompt);
    const call = result.response.functionCalls();

    if (call && call.length > 0) {
      return { type: 'function', action: call[0] };
    }
    return { type: 'text', text: result.response.text() };
  } catch (err) {
    console.error('[GEMINI ERROR]', err.message || err);
    return null;
  }
}

module.exports = { initGemini, analyzeMessage };