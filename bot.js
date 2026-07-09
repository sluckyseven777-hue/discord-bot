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

    const lowerContent = message.content.trim().toLowerCase();

    if (["void", "撤銷", "撤销", "cancel"].includes(lowerContent)) {
  if (!message.reference || !message.reference.messageId) {
    await message.reply("❌ 請 Reply 要撤銷的那一筆報數，再輸入 void");
    return;
  }

  const targetMsgId = message.reference.messageId;
  const operator = message.member?.displayName || message.author.username;

  const response = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      action: "VOID_ENTRY",
      msgId: targetMsgId,
      operator: operator
    })
  });

  const result = await response.json();

  if (result.ok && result.voided) {
    await message.reply("✅ 已撤銷此筆入賬，請重新報正確金額");
  } else if (result.ok && result.alreadyVoided) {
    await message.reply("⚠️ 此筆已經撤銷過了");
  } else {
    await message.reply("❌ 找不到要撤銷的入賬，請確認你 Reply 的是原報數消息");
    console.log(result);
  }

  return;
}
    
    const content = message.content.trim();

    if (!content.startsWith("+")) return;

    // 不允許多行
    if (content.includes("\n")) {
      await message.reply("❌ 格式錯誤，請只寫一行：+xxx LVxx XIAOYI");
      return;
    }

    // 自動讀取 Discord 分類：LV | Rhino Team
    const categoryName = message.channel.parent?.name || "";
    const parts = categoryName.split("|");

    const companyName = parts[0]?.trim();
    const teamName = parts[1]?.trim() || categoryName;

    if (!companyName || !teamName) {
      await message.reply("❌ 分類格式錯誤，請用：公司 | 組名");
      return;
    }

    // 嚴格格式：+金額 成員 來源
    // 例：+9000 LV16 XIAOYI
    const match = content.match(/^\+(\d+(?:\.\d{1,2})?)\s+((?:LV|LT|MMC)\d+)\s+([A-Za-z0-9 ]+)$/i);

    if (!match) {
      await message.reply("❌ 格式錯誤，請用：+xxx LVxx XIAOYI");
      return;
    }

    const amount = Number(match[1]);
    const member = match[2].toUpperCase();
    const source = match[3].trim().toUpperCase();
    const reporter = message.member?.displayName || message.author.username;

    if (!amount || amount <= 0) {
      await message.reply("❌ 金額錯誤，請確認金額大於 0");
      return;
    }

    const payload = {
      company: companyName,
      team: teamName,
      member: member,
      amount: amount,
      source: source,
      msgId: message.id,
      reporter: reporter
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
      await message.reply(
        "✅ 已記錄： RM " +
        amount.toLocaleString("en-US") +
        " | " +
        member +
        " | " +
        source +
        " | " +
        teamName
      );
    } else {
      console.log(result);
      await message.reply("❌ 寫入失敗，請檢查 Apps Script");
    }

  } catch (error) {
    console.error(error);
    await message.reply("❌ 系統錯誤，請檢查終端");
  }
});

client.on("messageUpdate", async (oldMessage, newMessage) => {
  try {
    if (newMessage.author?.bot) return;

    const content = newMessage.content?.trim() || "";

    if (!content.startsWith("+")) return;

    await newMessage.reply("⚠️ 已入賬報數不接受 Edit 修改。若報錯，請 Reply 原報數輸入 void 撤銷，再重新報正確金額。");

  } catch (err) {
    console.error("messageUpdate error:", err);
  }
});

client.login(TOKEN);
