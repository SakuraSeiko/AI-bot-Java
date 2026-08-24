const http = require('http');
const mineflayer = require('mineflayer');
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

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  console.log('[BOT] Connecting to EsnaSeiko.aternos.me:51316...');

  // Auto-version detection enabled by omitting 'version' parameter
  const bot = mineflayer.createBot({
    host: 'EsnaSeiko.aternos.me',
    port: 51316,
    username: 'Alice',
    version: '1.20.4'
  });

  bot.on('login', () => {
    console.log('[BOT] Successfully logged in to the server.');
  });

  bot.on('spawn', () => {
    console.log('[BOT] Alice spawned in the world.');
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;

    console.log(`[CHAT] ${username}: ${message}`);

    const prompt = `You are playing Minecraft as an AI companion named Alice. Player ${username} said: "${message}". Respond concisely in 1 short sentence.`;

    model.generateContent(prompt)
      .then((result) => {
        const reply = result.response.text();
        if (reply) {
          bot.chat(reply.trim());
        }
      })
      .catch((err) => {
        console.error('[GEMINI ERROR]', err.message || err);
      });
  });

  bot.on('error', (err) => {
    console.error('[BOT ERROR]', err.message || err);
  });

  bot.on('end', (reason) => {
    console.log(`[BOT] Disconnected (${reason}). Reconnecting in 10 seconds...`);
    setTimeout(initBot, 10000);
  });
}
