const { Client, GatewayIntentBits } = require('discord.js');

const TOKEN = process.env.TOKEN;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.on("clientReady", () => {
  console.log("Bot 已上线：" + client.user.tag);
});

client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;
    if (!message.content.startsWith("+")) return;

    const categoryName = message.channel.parent?.name || "";

// 拆 Company 和 Team
const parts = categoryName.split("|");

const companyName = parts[0]?.trim();
const teamName = parts[1]?.trim() || categoryName;

// 防呆
if (!companyName || !teamName) {
  await message.reply("❌ 分類格式錯誤，請用：公司 | 組名");
  return;
}

    if (!teamName) {
      await message.reply("❌ 這個 receipt 群沒有放在分類下面，無法自動識別組別");
      return;
    }

    const match = message.content.match(/^\+(\d+)\s+(\S+)\s+(.+)$/);

    if (!match) {
      await message.reply("❌ 格式錯誤，請用：+3000 LV1 XIAOYI");
      return;
    }

    const amount = match[1];
    const member = match[2];
    const source = match[3].trim();
    const reporter = message.member?.displayName || message.author.username;

    console.log(
      "[組別]", teamName,
      "| [頻道]", message.channel.name,
      "| [發送者]", reporter,
      "| [內容]", message.content
    );

   const payload = {
  company: companyName,
  team: teamName,
  member: member,
  amount: Number(amount),
  source: source,
  msgId: message.id,
  reporter: message.member?.displayName || message.author.username
};

    console.log("PAYLOAD:", payload);
    
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (result.ok && result.duplicate) {
      await message.reply("⚠️ 這筆訊息已經記錄過了，沒有重複入賬");
    } else if (result.ok) {
      await message.reply("✅ 已記錄：RM " + Number(amount).toLocaleString("en-US") + " | " + member + " | " + source + " | " + teamName);
    } else {
      console.log(result);
      await message.reply("❌ 寫入失敗，請檢查 Apps Script");
    }

  } catch (error) {
    console.error(error);
    await message.reply("❌ 系統錯誤，請檢查終端");
  }
});

client.login(TOKEN);
