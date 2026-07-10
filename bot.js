const { Client, GatewayIntentBits } = require("discord.js");

// ======================================================
// 系统设置
// ======================================================

const TOKEN = process.env.TOKEN;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

if (!TOKEN) {
  throw new Error("缺少 Render 环境变量：TOKEN");
}

if (!APPS_SCRIPT_URL) {
  throw new Error("缺少 Render 环境变量：APPS_SCRIPT_URL");
}

// ======================================================
// Discord Client
// ======================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ======================================================
// 基础工具
// ======================================================

function getReporter(message) {
  return message.member?.displayName || message.author.username;
}

function getCompanyAndTeam(message) {
  const categoryName = message.channel.parent?.name?.trim() || "";
  const separatorIndex = categoryName.indexOf("|");

  if (separatorIndex === -1) {
    return {
      company: "",
      team: ""
    };
  }

  const company = categoryName
    .slice(0, separatorIndex)
    .trim()
    .toUpperCase();

  const team = categoryName
    .slice(separatorIndex + 1)
    .trim();

  return {
    company,
    team
  };
}

function isVoidCommand(content) {
  return ["void", "撤銷", "撤销", "cancel"].includes(
    content.trim().toLowerCase()
  );
}

// ======================================================
// Apps Script API
// ======================================================

async function postToAppsScript(payload) {
  const response = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    redirect: "follow",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify(payload)
  });

  const responseText = await response.text();

  console.log("APPS HTTP STATUS:", response.status);
  console.log("APPS RAW RESPONSE:", responseText.slice(0, 500));

  try {
    return JSON.parse(responseText);
  } catch {
    return {
      ok: false,
      error: "Apps Script 回传的内容不是 JSON",
      raw: responseText.slice(0, 500)
    };
  }
}

// ======================================================
// 撤销入账
// ======================================================

async function resolveVoidTargetMessageId(message) {
  const referencedMessageId = message.reference?.messageId;

  if (!referencedMessageId) {
    return null;
  }

  const repliedMessage = await message.channel.messages.fetch(
    referencedMessageId
  );

  // Reply 原始报数
  if (!repliedMessage.author.bot) {
    return repliedMessage.id;
  }

  // Reply Bot 的「已记录」回覆
  if (repliedMessage.reference?.messageId) {
    return repliedMessage.reference.messageId;
  }

  return null;
}

async function deleteMessageSafely(message) {
  if (!message) return;

  try {
    await message.delete();
  } catch (error) {
    console.error(
      "DELETE MESSAGE FAILED:",
      error?.message || error
    );
  }
}

function deleteMessageLater(message, delay = 2000) {
  setTimeout(() => {
    deleteMessageSafely(message);
  }, delay);
}

async function handleVoid(message) {
  const targetMsgId = await resolveVoidTargetMessageId(message);

  if (!targetMsgId) {
    const replyMessage = await message.reply(
      "❌ 請 Reply 原報數或 Bot 的已記錄訊息，再輸入 void"
    );

    // 輸入錯誤時，只清除 void 指令和錯誤提示
    deleteMessageLater(message, 2000);
    deleteMessageLater(replyMessage, 2000);
    return;
  }

  const operator = getReporter(message);

  const result = await postToAppsScript({
    action: "VOID_ENTRY",
    msgId: targetMsgId,
    operator
  });

  console.log("VOID RESULT:", result);

  // 成功撤銷
  if (result.ok && result.voided) {
    const replyMessage = await message.reply(
      `✅ 已撤銷此筆入賬｜操作人：${operator}\n請重新報正確金額`
    );

    // 先取得原報數
    let originalMessage = null;

    try {
      originalMessage = await message.channel.messages.fetch(targetMsgId);
    } catch (error) {
      console.error(
        "FETCH ORIGINAL MESSAGE FAILED:",
        error?.message || error
      );
    }

    // 立即刪除原報數
    await deleteMessageSafely(originalMessage);

    // 2 秒後刪除 void 和 Bot 的已撤銷提示
    deleteMessageLater(message, 2000);
    deleteMessageLater(replyMessage, 2000);
    return;
  }

  // 已經撤銷過
  if (result.ok && result.alreadyVoided) {
    const replyMessage = await message.reply(
      "⚠️ 此筆已經撤銷過了"
    );

    // 2 秒後刪除 void 和警告
    deleteMessageLater(message, 2000);
    deleteMessageLater(replyMessage, 2000);
    return;
  }

  // 找不到入賬
  if (result.error === "MsgID not found") {
    const replyMessage = await message.reply(
      "❌ 找不到這筆入賬，請確認你 Reply 的是原報數或 Bot 的已記錄訊息"
    );

    deleteMessageLater(message, 3000);
    deleteMessageLater(replyMessage, 3000);
    return;
  }

  console.error("VOID FAILED:", result);

  const replyMessage = await message.reply(
    "❌ 撤銷失敗，請管理員檢查 Render Logs"
  );

  deleteMessageLater(message, 3000);
  deleteMessageLater(replyMessage, 3000);
}
// ======================================================
// 报数格式验证
// ======================================================

function parseReceipt(content) {
  if (content.includes("\n")) {
    return {
      ok: false,
      error: "❌ 格式錯誤，請只寫一行：+2300 LV39 XIAOYI"
    };
  }

  /*
   * 正确格式：
   * +2300 LV39 XIAOYI
   * +500 LT3 96
   * +1200.50 MMC1 XIAO YI
   */
  const match = content.match(
    /^\+(\d+(?:\.\d{1,2})?)\s+((?:LV|LT|MMC)\d+)\s+([A-Za-z0-9 ]+)$/i
  );

  if (!match) {
    return {
      ok: false,
      error: "❌ 格式錯誤，請用：+2300 LV39 XIAOYI"
    };
  }

  const amount = Number(match[1]);
  const member = match[2].toUpperCase();
  const source = match[3].trim().toUpperCase();

  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      ok: false,
      error: "❌ 金額錯誤，請確認金額大於 0"
    };
  }

  return {
    ok: true,
    amount,
    member,
    source
  };
}

// ======================================================
// 正常入账
// ======================================================

async function handleReceipt(message) {
  const content = message.content.trim();
  const parsed = parseReceipt(content);

  if (!parsed.ok) {
    await message.reply(parsed.error);
    return;
  }

  const { company, team } = getCompanyAndTeam(message);

  if (!company || !team) {
    await message.reply(
      "❌ Discord 分類格式錯誤，請使用：公司 | 組名"
    );
    return;
  }

  const reporter = getReporter(message);

  const payload = {
    company,
    team,
    member: parsed.member,
    amount: parsed.amount,
    source: parsed.source,
    msgId: message.id,
    reporter
  };

  console.log("RECEIPT PAYLOAD:", payload);

  const result = await postToAppsScript(payload);

  console.log("RECEIPT RESULT:", result);

  // 同一个 Discord MsgID 已经处理过，安静忽略
  if (result.ok && result.duplicate) {
    return;
  }

  if (result.ok) {
    await message.reply(
      `✅ 已記錄：RM ${parsed.amount.toLocaleString("en-US")} | ` +
      `${parsed.member} | ${parsed.source} | ${team}`
    );
    return;
  }

  console.error("RECEIPT FAILED:", result);
  await message.reply("❌ 寫入失敗，請管理員檢查 Render Logs");
}

// ======================================================
// Discord Events
// ======================================================

client.once("clientReady", () => {
  console.log(`Bot 已上线：${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;

    const content = message.content.trim();

    if (isVoidCommand(content)) {
      await handleVoid(message);
      return;
    }

    if (!content.startsWith("+")) {
      return;
    }

    await handleReceipt(message);

  } catch (error) {
    console.error("MESSAGE CREATE ERROR:", error);

    await message.reply(
      "❌ 系統錯誤，請管理員檢查 Render Logs"
    ).catch(() => {});
  }
});

client.on("messageUpdate", async (oldMessage, newMessage) => {
  try {
    if (newMessage.author?.bot) return;

    const newContent = newMessage.content?.trim() || "";

    if (!newContent.startsWith("+")) {
      return;
    }

    await newMessage.reply(
      "⚠️ 已入賬報數不接受 Edit 修改。\n" +
      "若資料錯誤，請 Reply 原報數輸入 void 撤銷，再重新報正確資料。"
    );

  } catch (error) {
    console.error("MESSAGE UPDATE ERROR:", error);
  }
});

// ======================================================
// Login
// ======================================================

client.login(TOKEN);
