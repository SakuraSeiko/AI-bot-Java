const { GoogleGenAI } = require('@google/genai');

const tools = [
  {
    name: "interactWithWorld",
    description: "Execute a sequence of physical actions in the game world, record internal reasoning, and speak in chat.",
    parameters: {
      type: "OBJECT",
      properties: {
        thought: {
          type: "STRING",
          description: "Alice's internal reasoning, spatial assessment, and decision process. Strictly kept in logs, NEVER sent directly to in-game chat."
        },
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
                  "wake",
                  "pickup"
                ],
                description: "Action type: mine (dig block), follow (walk to player/target), toss_item (drop specified amount of item), equip (hold/wear item), eat (consume food), stop (halt movement), chat_only (talk without physical action), place (put block on ground), attack (hunt/fight entity), craft (craft item via inventory or crafting table), sleep (use bed), wake (stand up from bed), pickup (walk to dropped items on ground)."
              },
              target: {
                type: "STRING",
                description: "Target identifier: block name (e.g. oak_log, coal_ore, bed), item name (e.g. oak_planks, wooden_pickaxe), mob/player name (e.g. sheep, pig, zombie), or 'item' for pickup."
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
          description: "Alice's chat message in natural Polish spoken while initiating the action sequence."
        }
      },
      required: ["thought", "actions"]
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
2. Store your reasoning, plan, and internal state checks inside the 'thought' property.
3. If the player asks you to bring, give, or toss items to them, ALWAYS include a "follow" action BEFORE the "toss_item" action so you walk up to the player first.
4. If missing ingredients or tools for crafting, DO NOT randomly mine player-built blocks or structures. Simply inform the player in 'sayInChat' about the missing items.
5. If the user asks for multi-step tasks (e.g. "pick up wood, craft planks, and give me 5"), build a logical action sequence in the actions array.
6. Available Actions:
   - "mine": Target block name (e.g. oak_log, coal_ore). Set count if requested.
   - "place": Target block item name from inventory to place on ground.
   - "pickup": Walk to and pick up dropped items on the ground.
   - "attack": Hunt or fight nearby mobs/animals (e.g. sheep, pig, cow, zombie).
   - "craft": Craft an item (e.g. oak_planks, sticks, wooden_pickaxe). Set count if requested.
   - "sleep": Find and sleep in a nearby bed.
   - "wake": Stand up / rise from bed.
   - "toss_item": Drop items. ALWAYS specify count if dropping a portion (e.g. target="oak_planks", count=5).
   - "equip": Equip tool, weapon, or armor in main hand or body.
   - "eat": Eat food from inventory.
   - "follow": Walk towards the player.
   - "stop": Cancel current pathing/movement.
   - "chat_only": When only talking without physical actions.
7. Speak in natural, friendly Polish in sayInChat.
8. If the sender is "System", it is an internal action report. Keep 'sayInChat' empty unless you need to communicate a failure or status directly to the player.
9. For simple questions or conversations, use action="chat_only".`;

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
