const http = require('http');
const mineflayer = require('mineflayer');
const { pathfinder, movements, goals } = require('mineflayer-pathfinder');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const PORT = process.env.PORT || 3000;

// HTTP server required for Render uptime checks
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Alice AI Bot Service is active.\n');
});

server.listen(PORT, () => {
  console.log(`[SYSTEM] Web server listening on port ${PORT}`);
  initBot();
});

function initBot() {
  if (!process.env.GEMINI_API_KEY) {
    console.error('[ERROR] GEMINI_API_KEY environment variable is missing!');
    return;
  }

  // 1. Tool declarations for Gemini Function Calling
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

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ 
    model: 'gemini-1.5-flash',
    tools: tools
  });

  console.log('[BOT] Connecting to EsnaSeiko.aternos.me:51316...');

  const bot = mineflayer.createBot({
    host: 'EsnaSeiko.aternos.me',
    port: 51316,
    username: 'Alice',
    version: '1.21'
  });

  // Load pathfinder plugin
  bot.loadPlugin(pathfinder);

  // 2. Map actions to Mineflayer executions
  const botActions = {
    async walkTo({ x, y, z }) {
      const defaultMove = new movements(bot);
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new goals.GoalBlock(x, y, z));
      return `Started walking to X:${x} Y:${y} Z:${z}.`;
    },

    async followPlayer({ targetUsername }) {
      const playerEntity = Object.keys(bot.players)
        .find(name => name.includes(targetUsername)) ? bot.players[targetUsername]?.entity : null;

      if (!playerEntity) {
        return `Player ${targetUsername} is not in reach or visible.`;
      }

      const defaultMove = new movements(bot);
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new goals.GoalFollow(playerEntity, 2), true);
      return `Following player ${targetUsername}.`;
    },

    async digBlock({ x, y, z }) {
      const targetBlock = bot.blockAt(bot.vec3(x, y, z));
      if (!targetBlock || targetBlock.name === 'air') {
        return `No block found at X:${x} Y:${y} Z:${z}.`;
      }
      if (!bot.canDigBlock(targetBlock)) {
        return `Cannot mine block ${targetBlock.name}.`;
      }
      try {
        await bot.dig(targetBlock);
        return `Successfully mined block: ${targetBlock.name}.`;
      } catch (err) {
        return `Mining error: ${err.message}`;
      }
    },

    async chatMessage({ message }) {
      bot.chat(message);
      return `Sent to chat: ${message}`;
    }
  };

  bot.on('login', () => {
    console.log('[BOT] Successfully logged in to the server.');
  });

  bot.on('spawn', () => {
    console.log('[BOT] Alice spawned in the world.');
    const defaultMove = new movements(bot);
    bot.pathfinder.setMovements(defaultMove);
  });

  // 3. Handle incoming chat and query Gemini
  bot.on('chat', async (username, message) => {
    if (username === bot.username) return;

    console.log(`[CHAT] ${username}: ${message}`);

    const botPos = bot.entity ? bot.entity.position : { x: 0, y: 0, z: 0 };
    
    const systemPrompt = `You are an autonomous Minecraft companion bot named Alice. 
Your current location is: X:${Math.round(botPos.x)}, Y:${Math.round(botPos.y)}, Z:${Math.round(botPos.z)}.
Player "${username}" said: "${message}". 
Analyze the input. If it requires physical actions (walking, mining, speaking), call the appropriate tool. Keep your execution or text output concise.`;

    try {
      const result = await model.generateContent(systemPrompt);
      const call = result.response.functionCalls();

      if (call && call.length > 0) {
        const action = call[0];
        const actionName = action.name;
        const actionArgs = action.args;

        console.log(`[AI DECISION] Tool call: ${actionName}`, actionArgs);

        if (botActions[actionName]) {
          const status = await botActions[actionName](actionArgs);
          console.log(`[BOT ACTION STATUS] ${status}`);
        }
      } else {
        const replyText = result.response.text();
        if (replyText) {
          bot.chat(replyText.trim());
        }
      }
    } catch (err) {
      console.error('[GEMINI ERROR]', err.message || err);
    }
  });

  bot.on('error', (err) => {
    console.error('[BOT ERROR]', err.message || err);
  });

  bot.on('end', (reason) => {
    console.log(`[BOT] Disconnected (${reason}). Reconnecting in 10 seconds...`);
    setTimeout(initBot, 10000);
  });
}
