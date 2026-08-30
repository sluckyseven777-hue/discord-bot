const { Client, GatewayIntentBits } = require("discord.js");

// ======================================================
// Receipt Bot - Multi Service Universal Version
//
// 同一份 bot.js 可以給：
// XiaoYi
// MY124
// YiHui
//
// 每個 Render Service 只需要設定自己的 Environment Variables
// ======================================================


// ======================================================
// 基本設定
// ======================================================

const TOKEN = process.env.TOKEN;
const ALLOWED_ROLE_ID = process.env.ALLOWED_ROLE_ID;


// ======================================================
// 公司設定
//
// 有設定 Channel ID + Apps Script URL 的公司才會啟用
// 沒有設定就自動忽略
// ======================================================

const COMPANY_ENV_CONFIG = [
  {
    company: "LV",
    channelId: process.env.CHANNEL_ID_LV,
    appsScriptUrl: process.env.APPS_SCRIPT_URL_LV
  },
  {
    company: "LT",
    channelId: process.env.CHANNEL_ID_LT,
    appsScriptUrl: process.env.APPS_SCRIPT_URL_LT
  },
  {
    company: "MMC",
    channelId: process.env.CHANNEL_ID_MMC,
    appsScriptUrl: process.env.APPS_SCRIPT_URL_MMC
  },
  {
    company: "鑫宸",
    channelId: process.env.CHANNEL_ID_XC,
    appsScriptUrl: process.env.APPS_SCRIPT_URL_XC
  },
  {
    company: "LU",
    channelId: process.env.CHANNEL_ID_LU,
    appsScriptUrl: process.env.APPS_SCRIPT_URL_LU
  },
  {
    company: "LS",
    channelId: process.env.CHANNEL_ID_LS,
    appsScriptUrl: process.env.APPS_SCRIPT_URL_LS
  }
];


// ======================================================
// 必要環境變數
// ======================================================

if (!TOKEN) {
  throw new Error(
    "缺少 Render 環境變量：TOKEN"
  );
}

if (!ALLOWED_ROLE_ID) {
  throw new Error(
    "缺少 Render 環境變量：ALLOWED_ROLE_ID"
  );
}


// ======================================================
// 建立 Channel Routing
//
// 規則：
//
// Channel + URL 都有
// → 啟用
//
// 兩個都沒有
// → 忽略
//
// 只有其中一個
// → 啟動失敗，避免入錯 Sheet
// ======================================================

const CHANNEL_CONFIG = {};

for (const item of COMPANY_ENV_CONFIG) {

  const channelId =
    String(item.channelId || "").trim();

  const appsScriptUrl =
    String(item.appsScriptUrl || "").trim();


  // 兩個都沒設定
  // 代表這個第三方沒有這家公司
  if (!channelId && !appsScriptUrl) {
    continue;
  }


  // 有 Channel 沒 URL
  if (channelId && !appsScriptUrl) {
    throw new Error(
      `${item.company} 已設定 Channel ID，但缺少 Apps Script URL`
    );
  }


  // 有 URL 沒 Channel
  if (!channelId && appsScriptUrl) {
    throw new Error(
      `${item.company} 已設定 Apps Script URL，但缺少 Channel ID`
    );
  }


  // 防止同一個 Channel 被重複設定
  if (CHANNEL_CONFIG[channelId]) {
    throw new Error(
      `Channel ID 重複設定：${channelId}`
    );
  }


  CHANNEL_CONFIG[channelId] = {
    company: item.company,
    appsScriptUrl
  };
}


// ======================================================
// 至少需要一家公司
// ======================================================

if (
  Object.keys(CHANNEL_CONFIG).length === 0
) {

  throw new Error(
    "沒有任何公司完成 Channel ID + Apps Script URL 設定"
  );
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
// 基礎工具
// ======================================================

function getReporter(message) {

  return (
    message.member?.displayName ||
    message.author.globalName ||
    message.author.username
  );
}


function isVoidCommand(content) {

  return [
    "撤销入款",
    "撤銷入款"
  ].includes(
    content.trim()
  );
}


function formatMoney(value) {

  const num =
    Number(value || 0);

  return num.toLocaleString(
    "en-US",
    {
      minimumFractionDigits:
        Number.isInteger(num)
          ? 0
          : 2,

      maximumFractionDigits: 2
    }
  );
}


function getChannelConfig(channelId) {

  return (
    CHANNEL_CONFIG[channelId] ||
    null
  );
}


// ======================================================
// Apps Script API
// ======================================================

async function postToAppsScript(
  appsScriptUrl,
  payload
) {

  try {

    if (!appsScriptUrl) {

      return {
        ok: false,
        error:
          "Apps Script URL not configured"
      };
    }


    const response =
      await fetch(
        appsScriptUrl,
        {
          method: "POST",

          redirect: "follow",

          headers: {
            "Content-Type":
              "text/plain;charset=utf-8"
          },

          body:
            JSON.stringify(payload)
        }
      );


    const responseText =
      await response.text();


    console.log(
      "APPS HTTP STATUS:",
      response.status
    );


    console.log(
      "APPS RAW RESPONSE:",
      responseText.slice(0, 500)
    );


    try {

      return JSON.parse(
        responseText
      );

    } catch {

      return {
        ok: false,
        error:
          "Apps Script 回傳的內容不是 JSON",
        raw:
          responseText.slice(0, 500)
      };
    }


  } catch (error) {

    console.error(
      "APPS REQUEST ERROR:",
      error
    );


    return {
      ok: false,
      error:
        error?.message ||
        String(error)
    };
  }
}


// ======================================================
// 今日 Summary
// ======================================================

function buildTodaySummaryContent(
  summary
) {

  const entries =
    summary.entries || [];


  const entryLines =
    entries.map(item => {

      const amount =
        Number(
          item.amount || 0
        );


      const netAmount =
        Number(
          item.netAmount || 0
        );


      return (
        `${item.time} ` +
        `${formatMoney(amount)} * (0.91)=` +
        `${formatMoney(netAmount)} ${item.owner}`
      );
    });


  const feePercent =
    Number(
      summary.feeRate || 0
    ) * 100;


  return (
`💹今日入款（${summary.count || 0}筆）
${entryLines.length
  ? entryLines.join("\n")
  : "今天還沒有入款"}

♻️今日下發（0筆）

總入款：${formatMoney(summary.totalAmount)}
匯率：1
交易費率：${formatMoney(feePercent)}%

應下發：${formatMoney(summary.totalNetAmount)}
已下發：${formatMoney(summary.paidAmount)}
餘額：${formatMoney(summary.balance)}`
  );
}


// ======================================================
// 發送新 Summary
// ======================================================

async function refreshTodaySummary(
  channel
) {

  try {

    const config =
      getChannelConfig(
        channel.id
      );


    if (!config) {

      console.error(
        "SUMMARY CHANNEL NOT CONFIGURED:",
        channel.id
      );

      return;
    }


    console.log(
      `GET SUMMARY COMPANY: ${config.company}`
    );


    const result =
      await postToAppsScript(
        config.appsScriptUrl,
        {
          action:
            "GET_TODAY_SUMMARY"
        }
      );


    console.log(
      "SUMMARY RESULT:",
      result
    );


    if (!result.ok) {

      console.error(
        "GET SUMMARY FAILED:",
        result
      );

      return;
    }


    if (
      !channel ||
      !channel.isTextBased()
    ) {

      console.error(
        "Current channel is not text based"
      );

      return;
    }


    const content =
      buildTodaySummaryContent(
        result
      );


    const summaryMessage =
      await channel.send(
        content
      );


    console.log(
      `✅ ${config.company} 新 Summary 已發送:`,
      summaryMessage.id
    );


  } catch (error) {

    console.error(
      "REFRESH SUMMARY ERROR:",
      error
    );
  }
}


// ======================================================
// 入款文字解析
//
// +300
//
// +300 異常200
// +300 异常200
// +300 卡200
//
// +300 bal200 明天
// +300 balance 200 esok
// ======================================================

function parseReceiptInput(content) {

  const text =
    content.trim();


  // ==================================================
  // 正常
  // ==================================================

  let match =
    text.match(
      /^\+(\d+(?:\.\d{1,2})?)$/
    );


  if (match) {

    return {
      ok: true,
      amount:
        Number(match[1]),
      abnormalAmount: 0,
      pendingAmount: 0,
      note: "",
      type: "normal"
    };
  }


  // ==================================================
  // 異常 / 卡
  // ==================================================

  match =
    text.match(
      /^\+(\d+(?:\.\d{1,2})?)\s*[,，]?\s*(?:異常|异常|卡)\s*(\d+(?:\.\d{1,2})?)$/i
    );


  if (match) {

    return {
      ok: true,
      amount:
        Number(match[1]),
      abnormalAmount:
        Number(match[2]),
      pendingAmount: 0,
      note: "異常",
      type: "abnormal"
    };
  }


  // ==================================================
  // BAL / BALANCE
  // ==================================================

  match =
    text.match(
      /^\+(\d+(?:\.\d{1,2})?)\s+(?:bal|balance)\s*(\d+(?:\.\d{1,2})?)(?:\s+(.+))?$/i
    );


  if (match) {

    return {
      ok: true,
      amount:
        Number(match[1]),
      abnormalAmount: 0,
      pendingAmount:
        Number(match[2]),
      note:
        (match[3] || "").trim(),
      type: "balance"
    };
  }


  return {
    ok: false
  };
}


// ======================================================
// 撤銷 Target
// ======================================================

async function resolveVoidTargetMessageId(
  message
) {

  const referencedMessageId =
    message.reference?.messageId;


  if (!referencedMessageId) {
    return null;
  }


  const repliedMessage =
    await message.channel.messages.fetch(
      referencedMessageId
    );


  // Reply 指定 +金額
  if (!repliedMessage.author.bot) {

    return repliedMessage.id;
  }


  // Reply Bot 確認訊息
  if (
    repliedMessage.reference?.messageId
  ) {

    return (
      repliedMessage.reference.messageId
    );
  }


  return null;
}


// ======================================================
// 撤銷
// ======================================================

async function handleVoid(message) {

  const config =
    getChannelConfig(
      message.channel.id
    );


  if (!config) {

    await message.reply(
      "❌ 此頻道尚未設定入款系統"
    );

    return;
  }


  const targetMsgId =
    await resolveVoidTargetMessageId(
      message
    );


  if (!targetMsgId) {

    await message.reply(
      "❌ 請 Reply 要撤銷的入款，再輸入「撤销入款」"
    );

    return;
  }


  const operator =
    getReporter(message);


  console.log(
    `VOID COMPANY: ${config.company}`
  );


  const result =
    await postToAppsScript(
      config.appsScriptUrl,
      {
        action:
          "VOID_ENTRY",

        msgId:
          targetMsgId,

        operator
      }
    );


  console.log(
    "VOID RESULT:",
    result
  );


  // ==================================================
  // 成功
  // ==================================================

  if (
    result.ok &&
    result.voided
  ) {

    await message.reply(
      "撤销成功"
    );


    await refreshTodaySummary(
      message.channel
    );


    return;
  }


  // ==================================================
  // 已撤銷
  // ==================================================

  if (
    result.ok &&
    result.alreadyVoided
  ) {

    await message.reply(
      "⚠️ 此筆已經撤銷過了"
    );

    return;
  }


  // ==================================================
  // 找不到
  // ==================================================

  if (
    result.error ===
    "MsgID not found"
  ) {

    await message.reply(
      "❌ 找不到這筆入款"
    );

    return;
  }


  console.error(
    "VOID FAILED:",
    result
  );


  await message.reply(
    "❌ 撤銷失敗，請管理員檢查 Render Logs"
  );
}


// ======================================================
// 處理入款
// ======================================================

async function handleReceipt(message) {

  const config =
    getChannelConfig(
      message.channel.id
    );


  if (!config) {

    await message.reply(
      "❌ 此頻道尚未設定入款系統"
    );

    return;
  }


  const content =
    message.content.trim();


  const parsed =
    parseReceiptInput(
      content
    );


  if (!parsed.ok) {

    await message.reply(
`❌ 格式錯誤

正常：
+300

異常 / 卡：
+300 异常200
+300 卡200

待補：
+300 bal200 明天`
    );

    return;
  }


  const {
    amount,
    abnormalAmount,
    pendingAmount,
    note,
    type
  } = parsed;


  // ==================================================
  // 金額檢查
  // ==================================================

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {

    await message.reply(
      "❌ 金額錯誤，請確認正常入款金額大於 0"
    );

    return;
  }


  if (
    abnormalAmount < 0 ||
    pendingAmount < 0
  ) {

    await message.reply(
      "❌ 異常或待補金額不能小於 0"
    );

    return;
  }


  // ==================================================
  // 必須 Reply 原始 Receipt
  // ==================================================

  if (
    !message.reference?.messageId
  ) {

    await message.reply(
      "❌ 請 Reply 要確認的原始單據，再輸入入款"
    );

    return;
  }


  let originalMessage;


  try {

    originalMessage =
      await message.channel.messages.fetch(
        message.reference.messageId
      );


  } catch (error) {

    console.error(
      "FETCH ORIGINAL ERROR:",
      error
    );


    await message.reply(
      "❌ 找不到原始單據，請重新 Reply 該訊息"
    );

    return;
  }


  // ==================================================
  // 不允許 Bot 訊息
  // ==================================================

  if (
    originalMessage.author.bot
  ) {

    await message.reply(
      "❌ 請 Reply 原始單據，不要 Reply Bot 訊息"
    );

    return;
  }


  // ==================================================
  // 發單人
  // ==================================================

  const owner =
    originalMessage.member?.displayName ||
    originalMessage.author.globalName ||
    originalMessage.author.username;


  // ==================================================
  // 操作人
  // ==================================================

  const confirmer =
    getReporter(message);


  // ==================================================
  // Payload
  // ==================================================

  const payload = {

    owner,

    amount,

    abnormalAmount,

    pendingAmount,

    note,

    originalMsgId:
      originalMessage.id,

    confirmMsgId:
      message.id,

    confirmer
  };


  console.log(
    `RECEIPT COMPANY: ${config.company}`
  );


  console.log(
    "RECEIPT PAYLOAD:",
    payload
  );


  const result =
    await postToAppsScript(
      config.appsScriptUrl,
      payload
    );


  console.log(
    "RECEIPT RESULT:",
    result
  );


  // ==================================================
  // Duplicate
  // ==================================================

  if (
    result.ok &&
    result.duplicate
  ) {

    console.log(
      "Duplicate receipt ignored"
    );

    return;
  }


  // ==================================================
  // 成功
  // ==================================================

  if (result.ok) {

    let replyText =
      `✅ 已確認入款：RM ${formatMoney(amount)} ｜ ${owner}`;


    if (
      type === "abnormal"
    ) {

      replyText +=
        `\n⚠️ 異常：RM ${formatMoney(abnormalAmount)}（僅記錄）`;
    }


    if (
      type === "balance"
    ) {

      replyText +=
        `\n🕒 待補：RM ${formatMoney(pendingAmount)}`;


      if (note) {

        replyText +=
          ` ｜ ${note}`;
      }
    }


    await message.reply(
      replyText
    );


    // 每成功一筆
    // 發一張新 Summary

    await refreshTodaySummary(
      message.channel
    );


    return;
  }


  console.error(
    "RECEIPT FAILED:",
    result
  );


  await message.reply(
    "❌ 入款失敗，請管理員檢查 Render Logs"
  );
}


// ======================================================
// Discord Ready
// ======================================================

client.once(
  "clientReady",
  () => {

    console.log(
      `Bot 已上線：${client.user.tag}`
    );


    console.log(
      "===== Receipt Routing ====="
    );


    for (
      const [
        channelId,
        config
      ] of Object.entries(
        CHANNEL_CONFIG
      )
    ) {

      console.log(
        `${config.company} -> ${channelId}`
      );
    }


    console.log(
      `允許操作 Role -> ${ALLOWED_ROLE_ID}`
    );
  }
);


// ======================================================
// Message Create
// ======================================================

client.on(
  "messageCreate",
  async message => {

    try {

      // Bot 不處理
      if (
        message.author.bot
      ) {
        return;
      }


      const content =
        message.content.trim();


      // ==================================================
      // 是否 Receipt 指令
      // ==================================================

      const isReceiptOperation =
        content.startsWith("+") ||
        isVoidCommand(content);


      if (!isReceiptOperation) {
        return;
      }


      // ==================================================
      // 是否這個 Service 管理的 Channel
      // ==================================================

      const config =
        getChannelConfig(
          message.channel.id
        );


      if (!config) {

        // 不屬於這個第三方
        // 完全忽略

        return;
      }


      // ==================================================
      // Role
      // ==================================================

      const hasAllowedRole =
        message.member?.roles?.cache?.has(
          ALLOWED_ROLE_ID
        );


      if (!hasAllowedRole) {

        await message.reply(
          "❌ 你沒有權限操作入款系統"
        );

        return;
      }


      // ==================================================
      // +0
      // ==================================================

      if (
        content === "+0"
      ) {

        console.log(
          `+0 SUMMARY REQUEST: ${config.company}`
        );


        await refreshTodaySummary(
          message.channel
        );


        return;
      }


      // ==================================================
      // 撤銷
      // ==================================================

      if (
        isVoidCommand(content)
      ) {

        await handleVoid(
          message
        );


        return;
      }


      // ==================================================
      // 入款
      // ==================================================

      if (
        content.startsWith("+")
      ) {

        await handleReceipt(
          message
        );


        return;
      }


    } catch (error) {

      console.error(
        "MESSAGE CREATE ERROR:",
        error
      );


      await message.reply(
        "❌ 系統錯誤，請管理員檢查 Render Logs"
      ).catch(() => {});
    }
  }
);


// ======================================================
// 禁止 Edit 已入賬內容
// ======================================================

client.on(
  "messageUpdate",
  async (
    oldMessage,
    newMessage
  ) => {

    try {

      if (
        newMessage.author?.bot
      ) {
        return;
      }


      const newContent =
        newMessage.content?.trim() ||
        "";


      if (
        !newContent.startsWith("+")
      ) {
        return;
      }


      // 只有這個 Service
      // 設定的 Receipt Channel 才處理

      const config =
        getChannelConfig(
          newMessage.channel.id
        );


      if (!config) {
        return;
      }


      await newMessage.reply(
        "⚠️ 已入賬報數不接受 Edit 修改。\n" +
        "若資料錯誤，請 Reply 原報數輸入「撤销入款」。"
      );


    } catch (error) {

      console.error(
        "MESSAGE UPDATE ERROR:",
        error
      );
    }
  }
);


// ======================================================
// Login
// ======================================================

client.login(TOKEN);
