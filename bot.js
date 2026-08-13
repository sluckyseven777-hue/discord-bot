const { Client, GatewayIntentBits } = require("discord.js");

// ======================================================
// 系統設定
// ======================================================

const TOKEN = process.env.TOKEN;
const ALLOWED_ROLE_ID = process.env.ALLOWED_ROLE_ID;

// 六間公司 Apps Script
const APPS_SCRIPT_URL_LV = process.env.APPS_SCRIPT_URL_LV;
const APPS_SCRIPT_URL_LT = process.env.APPS_SCRIPT_URL_LT;
const APPS_SCRIPT_URL_MMC = process.env.APPS_SCRIPT_URL_MMC;
const APPS_SCRIPT_URL_XC = process.env.APPS_SCRIPT_URL_XC;
const APPS_SCRIPT_URL_LU = process.env.APPS_SCRIPT_URL_LU;
const APPS_SCRIPT_URL_LS = process.env.APPS_SCRIPT_URL_LS;


// ======================================================
// 必要環境變數檢查
// ======================================================

if (!TOKEN) {
  throw new Error("缺少 Render 環境變量：TOKEN");
}

if (!ALLOWED_ROLE_ID) {
  throw new Error("缺少 Render 環境變量：ALLOWED_ROLE_ID");
}

if (!APPS_SCRIPT_URL_LV) {
  throw new Error("缺少 Render 環境變量：APPS_SCRIPT_URL_LV");
}

if (!APPS_SCRIPT_URL_LT) {
  throw new Error("缺少 Render 環境變量：APPS_SCRIPT_URL_LT");
}

if (!APPS_SCRIPT_URL_MMC) {
  throw new Error("缺少 Render 環境變量：APPS_SCRIPT_URL_MMC");
}

if (!APPS_SCRIPT_URL_XC) {
  throw new Error("缺少 Render 環境變量：APPS_SCRIPT_URL_XC");
}

if (!APPS_SCRIPT_URL_LU) {
  throw new Error("缺少 Render 環境變量：APPS_SCRIPT_URL_LU");
}

if (!APPS_SCRIPT_URL_LS) {
  throw new Error("缺少 Render 環境變量：APPS_SCRIPT_URL_LS");
}


// ======================================================
// 六公司 Channel 對應
// ======================================================

const CHANNEL_CONFIG = {
  // LV
  "1530062853577506816": {
    company: "LV",
    appsScriptUrl: APPS_SCRIPT_URL_LV
  },

  // LT
  "1536957257663909938": {
    company: "LT",
    appsScriptUrl: APPS_SCRIPT_URL_LT
  },

  // MMC
  "1536957294506676355": {
    company: "MMC",
    appsScriptUrl: APPS_SCRIPT_URL_MMC
  },

  // 鑫宸
  "1536957455995502634": {
    company: "鑫宸",
    appsScriptUrl: APPS_SCRIPT_URL_XC
  },

  // LU
  "1536958163209822271": {
    company: "LU",
    appsScriptUrl: APPS_SCRIPT_URL_LU
  },

  // LS
  "1536958281216688168": {
    company: "LS",
    appsScriptUrl: APPS_SCRIPT_URL_LS
  }
};


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
  ].includes(content.trim());
}


function formatMoney(value) {
  const num = Number(value || 0);

  return num.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(num) ? 0 : 2,
    maximumFractionDigits: 2
  });
}


function getChannelConfig(channelId) {
  return CHANNEL_CONFIG[channelId] || null;
}


// ======================================================
// Apps Script API
// ======================================================

async function postToAppsScript(appsScriptUrl, payload) {
  try {

    if (!appsScriptUrl) {
      return {
        ok: false,
        error: "Apps Script URL not configured"
      };
    }

    const response = await fetch(appsScriptUrl, {
      method: "POST",
      redirect: "follow",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();

    console.log(
      "APPS HTTP STATUS:",
      response.status
    );

    console.log(
      "APPS RAW RESPONSE:",
      responseText.slice(0, 500)
    );

    try {
      return JSON.parse(responseText);
    } catch {
      return {
        ok: false,
        error: "Apps Script 回傳的內容不是 JSON",
        raw: responseText.slice(0, 500)
      };
    }

  } catch (error) {

    console.error(
      "APPS REQUEST ERROR:",
      error
    );

    return {
      ok: false,
      error: error?.message || String(error)
    };
  }
}


// ======================================================
// 今日 Summary 內容
// ======================================================

function buildTodaySummaryContent(summary) {

  const entries =
    summary.entries || [];

  const entryLines =
    entries.map(item => {

      const amount =
        Number(item.amount || 0);

      const netAmount =
        Number(item.netAmount || 0);

      return (
        `${item.time} ` +
        `${formatMoney(amount)} * (0.91)=` +
        `${formatMoney(netAmount)} ${item.owner}`
      );
    });


  const feePercent =
    Number(summary.feeRate || 0) * 100;


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
// 每次發一張新的 Summary
// ======================================================

async function refreshTodaySummary(channel) {
  try {

    const config =
      getChannelConfig(channel.id);

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
          action: "GET_TODAY_SUMMARY"
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
// 支援：
// +300
// +300 異常200
// +300 异常200
// +300 卡200
// +300 bal200 明天
// +300 balance 200 esok
// ======================================================

function parseReceiptInput(content) {

  const text =
    content.trim();


  // ==================================================
  // 1. 正常入款
  // ==================================================

  let match =
    text.match(
      /^\+(\d+(?:\.\d{1,2})?)$/
    );


  if (match) {

    return {
      ok: true,
      amount: Number(match[1]),
      abnormalAmount: 0,
      pendingAmount: 0,
      note: "",
      type: "normal"
    };
  }


  // ==================================================
  // 2. 異常 / 异常 / 卡
  //
  // +300 異常200
  // +300 异常200
  // +300 卡200
  // +300,异常200
  // +300，卡 200
  // ==================================================

  match =
    text.match(
      /^\+(\d+(?:\.\d{1,2})?)\s*[,，]?\s*(?:異常|异常|卡)\s*(\d+(?:\.\d{1,2})?)$/i
    );


  if (match) {

    return {
      ok: true,
      amount: Number(match[1]),
      abnormalAmount: Number(match[2]),
      pendingAmount: 0,
      note: "異常",
      type: "abnormal"
    };
  }


  // ==================================================
  // 3. BAL / BALANCE
  //
  // +300 bal200 明天
  // +300 bal 200 明天
  // +300 balance200 esok
  // +300 balance 200 tomorrow
  // ==================================================

  match =
    text.match(
      /^\+(\d+(?:\.\d{1,2})?)\s+(?:bal|balance)\s*(\d+(?:\.\d{1,2})?)(?:\s+(.+))?$/i
    );


  if (match) {

    return {
      ok: true,
      amount: Number(match[1]),
      abnormalAmount: 0,
      pendingAmount: Number(match[2]),
      note: (match[3] || "").trim(),
      type: "balance"
    };
  }


  return {
    ok: false
  };
}


// ======================================================
// 撤销入款 Target
// ======================================================

async function resolveVoidTargetMessageId(message) {

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


  // Reply Bot 已確認訊息
  if (
    repliedMessage.reference?.messageId
  ) {
    return repliedMessage.reference.messageId;
  }


  return null;
}


// ======================================================
// 處理撤销入款
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
        action: "VOID_ENTRY",
        msgId: targetMsgId,
        operator
      }
    );


  console.log(
    "VOID RESULT:",
    result
  );


  // ==================================================
  // 撤销成功
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
  // 已經撤销過
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


  // ==================================================
  // 解析格式
  // ==================================================

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
  // 必須 Reply 原始單據
  // ==================================================

  if (
    !message.reference?.messageId
  ) {

    await message.reply(
      "❌ 請 Reply 要確認的原始單據，再輸入入款"
    );

    return;
  }


  // ==================================================
  // 取得原始單據
  // ==================================================

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
  // 不允許 Bot 訊息當原單
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


  // ==================================================
  // 發送到該公司的 Apps Script
  // ==================================================

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
  // 防真正重複
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


    // 異常 / 卡
    if (
      type === "abnormal"
    ) {

      replyText +=
        `\n⚠️ 異常：RM ${formatMoney(abnormalAmount)}（僅記錄）`;
    }


    // Balance
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


    // ==================================================
    // 每成功一筆
    // 發該公司的最新 Summary
    // ==================================================

    await refreshTodaySummary(
      message.channel
    );


    return;
  }


  // ==================================================
  // 失敗
  // ==================================================

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
      "===== 六公司 Receipt Routing ====="
    );

    console.log(
      "LV   -> 1530062853577506816"
    );

    console.log(
      "LT   -> 1536957257663909938"
    );

    console.log(
      "MMC  -> 1536957294506676355"
    );

    console.log(
      "鑫宸 -> 1536957455995502634"
    );

    console.log(
      "LU   -> 1536958163209822271"
    );

    console.log(
      "LS   -> 1536958281216688168"
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

      // ==================================================
      // Bot 自己不處理
      // ==================================================

      if (
        message.author.bot
      ) {
        return;
      }


      const content =
        message.content.trim();


      // ==================================================
      // 是否屬於 Receipt 指令
      // ==================================================

      const isReceiptOperation =
        content.startsWith("+") ||
        isVoidCommand(content);


      if (
        !isReceiptOperation
      ) {
        return;
      }


      // ==================================================
      // 只允許六個設定好的 Channel
      // ==================================================

      const config =
        getChannelConfig(
          message.channel.id
        );


      if (!config) {

        // 不在 Receipt Channel
        // 直接忽略，不影響其他頻道

        return;
      }


      // ==================================================
      // 第三方 Role 權限
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
      //
      // 不寫 Sheet
      // 不增加筆數
      // 直接取得該公司目前帳務日 Summary
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
      // 撤销入款
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
      // 正常 + 入款
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


      // 只有六個 Receipt Channel 才處理 Edit
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
