const { Client, GatewayIntentBits } = require("discord.js");

// ======================================================
// 系統設定
// ======================================================

const TOKEN = process.env.TOKEN;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

if (!TOKEN) {
  throw new Error("缺少 Render 環境變量：TOKEN");
}

if (!APPS_SCRIPT_URL) {
  throw new Error("缺少 Render 環境變量：APPS_SCRIPT_URL");
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
  ].includes(content.trim());
}


function formatMoney(value) {
  const num = Number(value || 0);

  return num.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(num) ? 0 : 2,
    maximumFractionDigits: 2
  });
}


// ======================================================
// Apps Script API
// ======================================================

async function postToAppsScript(payload) {
  try {
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
  const entries = summary.entries || [];

  const entryLines = entries.map(item => {
    const amount = Number(item.amount || 0);
    const netAmount = Number(item.netAmount || 0);

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
// 每次都發一張新的 Summary
// ======================================================

async function refreshTodaySummary(channel) {
  try {
    const result = await postToAppsScript({
      action: "GET_TODAY_SUMMARY"
    });

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
      buildTodaySummaryContent(result);

    const summaryMessage =
      await channel.send(content);

    console.log(
      "✅ 新 Summary 已發送:",
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
// +300,異常200
// +300 balance 200 明天
// ======================================================

function parseReceiptInput(content) {
  const text = content.trim();

  // ==================================================
  // 1. 純正常入款
  //
  // +300
  // +300.50
  // ==================================================

  let match = text.match(
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
  //
  // 也接受：
  // +300 異常 200
  // +300,异常200
  // +300，卡 200
  // ==================================================

  match = text.match(
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
  //
  // 備註可以是任何文字
  // ==================================================

  match = text.match(
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
// 撤销入款
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

  // Reply 指定的 +300 / +300異常200
  if (!repliedMessage.author.bot) {
    return repliedMessage.id;
  }

  // Reply Bot 的已確認訊息
  if (
    repliedMessage.reference?.messageId
  ) {
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


function deleteMessageLater(
  message,
  delay = 2000
) {
  setTimeout(() => {
    deleteMessageSafely(message);
  }, delay);
}


// ======================================================
// 處理撤销入款
// ======================================================

async function handleVoid(message) {
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

  const result =
    await postToAppsScript({
      action: "VOID_ENTRY",
      msgId: targetMsgId,
      operator
    });

  console.log(
    "VOID RESULT:",
    result
  );


  // ------------------------------------------
  // 撤销成功
  // ------------------------------------------

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


  // ------------------------------------------
  // 已經撤销過
  // ------------------------------------------

  if (
    result.ok &&
    result.alreadyVoided
  ) {
    await message.reply(
      "⚠️ 此筆已經撤銷過了"
    );

    return;
  }


  // ------------------------------------------
  // 找不到
  // ------------------------------------------

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
  const content =
    message.content.trim();


  // ==================================================
  // 解析格式
  // ==================================================

  const parsed =
    parseReceiptInput(content);


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
    "RECEIPT PAYLOAD:",
    payload
  );


  const result =
    await postToAppsScript(
      payload
    );


  console.log(
    "RECEIPT RESULT:",
    result
  );


  // ==================================================
  // 真正重複訊息
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


    // 異常只顯示提醒
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


    // 每成功一筆發一張新的 Summary
    // Summary 只會計算 amount
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
// Discord Events
// ======================================================

client.once(
  "clientReady",
  () => {
    console.log(
      `Bot 已上線：${client.user.tag}`
    );
  }
);


client.on(
  "messageCreate",
  async message => {
    try {
      if (
        message.author.bot
      ) {
        return;
      }

      const content =
        message.content.trim();


      // ------------------------------------------
      // 撤销入款
      // ------------------------------------------

      if (
        isVoidCommand(content)
      ) {
        await handleVoid(
          message
        );

        return;
      }


      // ------------------------------------------
      // 非 + 開頭不處理
      // ------------------------------------------

      if (
        !content.startsWith("+")
      ) {
        return;
      }


      await handleReceipt(
        message
      );

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
// 禁止 Edit
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
