const TelegramBot = require("node-telegram-bot-api");
require("dotenv").config();
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { webHook: true });
// Set webhook URL
const webhookUrl = process.env.WEBHOOK_URL || "https://worker-production-f32b.up.railway.app";
bot.setWebHook(`${webhookUrl}/bot${process.env.TELEGRAM_BOT_TOKEN}`);

// Webhook endpoint
const express = require("express");   
const bodyParser = require("body-parser");
const app = express();

app.use(bodyParser.json());

// Handle webhook updates
app.post(`/bot${process.env.TELEGRAM_BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Health check endpoint
app.get("/", (req, res) => {
  res.send("Bot is running now go a head check one !");
});

// Start Express server
const PORT = process.env.PORT || 8080 ;
app.listen(PORT, () => {
  console.log(`Bot is listening on port ${PORT}`);
});

const ADMIN_IDS = process.env.ADMIN_ID.split(","); // Admin IDs as an array
const counselors = new Set(); // Approved counselors
const counselorCategories = {}; // Categories for each counselor
const counselorGenders = {}; // Gender for each counselor
const pendingCounselors = {}; // Pending counselor registrations
const userCategories = {}; // Categories selected by users
const userGenders = {}; // Genders for users
const sessions = {}; // Active user-counselor sessions (maps user ID to counselor ID and vice versa)
const userHistory = {}; // Tracks previous user-counselor relationships
const counselorActiveUsers = {}; // Tracks active users per counselor
const pendingRequests = {};
const registeredUsers = new Set(); // Tracks registered users
const reminderMessages = {}; // Stores reminder messages (userId -> counselorId and vice versa)

// Start session button
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  if (!registeredUsers.has(chatId)) {
    bot.sendMessage(chatId, "🔒 Galmee jalqabuuf cuqaasa(button) armaan gadii tuqaa.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Galma’aa", callback_data: "register_user" }]
        ],
      },
    });
  } else {
    bot.sendMessage(chatId, "Duraan galmooftanitu. itti fufuf cuqaasa(button) armaan gadii fayyadami.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Itti Fufa", callback_data: "start_session" }]
          
        ],
      },
    });
  }
});

// Handle button clicks
bot.on("callback_query", (callbackQuery) => {
  const action = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;

  if (action === "register_user") {
    registeredUsers.add(chatId);
    bot.sendMessage(chatId, "✅ galmeen keessan xumuramee jira. Amma cuqaasa(button) armaan gadii fayyadamuun turtii jalqabuu dandeessa:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Waliin dubbii eegalluu?", callback_data: "start_session" }]
        ],
      },
    });
  } else if (action === "start_session") {
    if (!registeredUsers.has(chatId)) {
      bot.sendMessage(chatId, "❌ Jalqabuuf dursitee galmaa'uu qabda.");
      return;
    }
    bot.sendMessage(chatId, "Baga gara Bootii gorsaa dhuftan! Mee itti fufuuf saala kee filadhu", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Dhiira 🙍‍♂️", callback_data: "gender_male_user" }],
          [{ text: "Dhalaa 🙍‍♀️", callback_data: "gender_female_user" }],
          [{ text: "Filachuu hin barbaadu 🙅", callback_data: "gender_none_user" }],
        ],
      },
    });
  } else if (action === "start_new_session") {
    delete userCategories[chatId];
    delete userGenders[chatId];

    bot.sendMessage(chatId, `👍 Nama kana dura gorsa siif kennaa ture waliin walitti deebi'uuf cuqaasa(button) itti fufi jedhu tuqudhaan mata duree kana dura irratti gorsa fudhachaa turte tuquudhaan gorsaa kee waliin deebi'uu dandeessa. 
     👇👇👇👇 `, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Itti fufi ⏭️", callback_data: "start_session" }]
        ],
      },
    });

  } else if (action === "disconnect") {
    registeredUsers.delete(chatId); // Remove the user from the registered users set
    delete userCategories[chatId];
    delete userGenders[chatId];
    delete sessions[chatId];
    delete userHistory[chatId];

    bot.sendMessage(chatId, `🛑 Bootii kana keessaa guutummaa guutuutti baatee jirta. Gara jalqabaatti deebitee fayyadamuuf, /start tuqi.`, {
      reply_markup: {
        remove_keyboard: true,
      },
    });
  }
});

// Connect user to counselor
function connectUserToCounselor(userChatId) {
  const userCategory = userCategories[userChatId];
  const userGender = userGenders[userChatId];

  const previousCounselorId = userHistory[userChatId];
  if (previousCounselorId && counselors.has(previousCounselorId)) {
    if (sessions[previousCounselorId]) {
      bot.sendMessage(userChatId, "🚫 Your previous counselor is currently busy. Please wait.");
      queuePendingRequest(userChatId, previousCounselorId);
      return;
    }
    startSession(userChatId, previousCounselorId);
    return;
  }

  const availableCounselors = [...counselors].filter((counselorId) => {
    return (
      counselorCategories[counselorId]?.includes(userCategory) &&
      (userGender === "None" || counselorGenders[counselorId] === userGender) &&
      !sessions[counselorId] &&
      (!counselorActiveUsers[counselorId] || counselorActiveUsers[counselorId].size < 2)
    );
  });
  if (!availableCounselors.length) {
    return bot.sendMessage(userChatId, "❌ Ammatti namni Bootii kana irratti isin gorsu hin jiru. Gorsitoota keenya kanneen biroo link armaan gadii tuquun argachuu dandeessu @gb_youth_counseling2_bot");
  }

  startSession(userChatId, availableCounselors[0]);
}



// Handle ending sessions
function endSession(chatId) {
  const counterpartId = sessions[chatId]; // Get the counterpart's ID
  if (!counterpartId) {
    bot.sendMessage(chatId, "⚠️ No active session to end.");
    return;
  }

  // End the session by removing both parties from the sessions object
  delete sessions[chatId];
  delete sessions[counterpartId];
  counselorActiveUsers[counterpartId]?.delete(chatId);

  bot.sendMessage(chatId, "🛑 Yeroof turti gorsaa kee waliin qabdu addaan kuttetta. Itti fuftee maal gochuu barbaadda?", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Itti fufi", callback_data: "start_new_session" }],
        [{ text: "Guutummaan guutuutti addaan kuti", callback_data: "disconnect" }],
      ],
    },
  });

  bot.sendMessage(counterpartId, "🛑 The session has ended.");

  // Handle pending requests for counselors if applicable
  if (counselors.has(counterpartId)) {
    if (pendingRequests[counterpartId]?.length) {
      connectUserToCounselor(pendingRequests[counterpartId].shift());
    } else {
      bot.sendMessage(counterpartId, "🔄 Waiting for the next session.");
    }
  }
}


  
function startSession(userChatId, counselorId) {
  sessions[userChatId] = counselorId;
  sessions[counselorId] = userChatId;

  userHistory[userChatId] = counselorId;

  if (!counselorActiveUsers[counselorId]) {
    counselorActiveUsers[counselorId] = new Set();
  }
  counselorActiveUsers[counselorId].add(userChatId);

  // Send "End Session" button to both the user and the counselor
  bot.sendMessage(userChatId, `🔗Mata duree ${userCategories[userChatId]} irratti gorsaa kee waliin wal quunnamteetta.
    
Namni gorsa siif kennu yeroo kanatti toorarra jiraachuu dhiisuu waan danda'uf bifa siif danda'amun(barreffamaan ykn sagaleen) ergaa kaa'iif
   `, {
    reply_markup: {
      inline_keyboard: [ 
        [{ text: "Yeroof addaan kuti", callback_data: "end_session_user" }]  // For the user
      ],
    },
  });

  bot.sendMessage(counselorId, `🔗 Connected to a user seeking ${userCategories[userChatId]} counseling. Begin your session.`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "End Session", callback_data: "end_session_counselor" }]  // For the counselor
      ],
    },
  });
}


// Queue pending request
function queuePendingRequest(userChatId, counselorId) {
  if (!pendingRequests[counselorId]) {
    pendingRequests[counselorId] = [];
  }

  if (pendingRequests[counselorId].length < 2) {
    pendingRequests[counselorId].push(userChatId);
  } else {
    bot.sendMessage(userChatId, "🚫 The queue for your preferred counselor is full. Please try again later.");
  }
}

// Handle callback queries for session control actions
bot.on("callback_query", (callbackQuery) => {
  const action = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;

  if (action === "end_session_user" || action === "end_session_counselor") {
      endSession(chatId);  // Same function for both user and counselor
  } else if (action === "start_new_session") {You 
      bot.sendMessage(chatId, "👍 can now start a new session by selecting your preferences.");
  } else if (action === "disconnect") {
      bot.sendMessage(chatId, `Bootii kana fayyadamuu keetiif Eebbifami🙏🙏🙏
        
Nama gorsa barbaadu kam gara bootii kanatti afeeruun ga'ee ba'adhu.
        
Ati garuu gorsa itti fuftee argachuu yoo barbaadde tuqi 👉 /start 👈`);
  } else if (action === "continue_session_user" || action === "continue_session_counselor") {
      bot.sendMessage(chatId, "✅ Continuing your session. Feel free to resume your conversation.");
  }
});





  



bot.onText(/\/register_counselor/, (msg) => {
    const chatId = msg.chat.id.toString();

    bot.sendMessage(chatId, "📝  itti fufuuf saala kee filadhu.", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "Dhalaa", callback_data: "gender_female_counselor" }],
                [{ text: "Dhiira", callback_data: "gender_male_counselor" }],
            ],
        },
    });

    pendingCounselors[chatId] = msg.from.username || "Unknown Username";
});


// Command: View Available Counselors (User)
bot.onText(/\/view_counselors/, (msg) => {
    const chatId = msg.chat.id;

    const availableCounselors = [...counselors].map(counselorId => {
        const categories = counselorCategories[counselorId]?.join(", ") || "Unknown";
        const gender = counselorGenders[counselorId] || "Unknown";
        return `- Counselor ID: ${counselorId} (Categories: ${categories}, Gender: ${gender})`;
    }).join("\n");

    if (!availableCounselors) {
        return bot.sendMessage(chatId, "❌ No counselors available at the moment. Please try again later.");
    }

    bot.sendMessage(chatId, `👥 Available Counselors:\n${availableCounselors}`);
});

// Admin Command: Manage Counselors
bot.onText(/\/admin/, (msg) => {
  if (!ADMIN_IDS.includes(msg.chat.id.toString())) {
      return bot.sendMessage(msg.chat.id, "❌ You are not authorized to use this command.");
  }

  bot.sendMessage(msg.chat.id, "Admin Panel", {
      reply_markup: {
          inline_keyboard: [
              [{ text: "List Approved Counselors", callback_data: "admin_list_counselors" }],
              [{ text: "View Pending Registrations", callback_data: "admin_pending_counselors" }],
              [{ text: "End All Sessions", callback_data: "admin_end_sessions" }],
              [{ text: "View Stats", callback_data: "admin_view_stats" }],
              [{ text: "Delete All Data", callback_data: "admin_delete_all_data" }],
          ],
      },
  });
});

// Callback Query Handler
bot.on("callback_query", (callbackQuery) => {
    const action = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;

    if (action.startsWith("gender_")) {
        handleGenderSelection(chatId, action);
    } else if (action.startsWith("category_")) {
        handleCategorySelection(chatId, action, callbackQuery);
    } else if (action.startsWith("approve_")) {
        handleApproval(action.split("_")[1]);
    } else if (action.startsWith("reject_")) {
        handleRejection(action.split("_")[1]);
    } else if (action === "admin_list_counselors") {
        listCounselors(chatId);
    } else if (action === "admin_pending_counselors") {
        viewPendingRegistrations(chatId);
    } else if (action === "admin_end_sessions") {
        endAllSessions();
    } else if (action === "admin_view_stats") {
        viewStats(chatId);
    } else if (action === "admin_delete_all_data") {
        deleteAllData();
    } else if (action === "end_session") {
        endSession(chatId);
    }
});

function handleGenderSelection(chatId, action) {
  let gender = "";

  // Check if the action contains "female" first, to avoid the "male" condition matching it
  if (action.includes("female")) {
      gender = "Female";
  } else if (action.includes("male")) {
      gender = "Male";
  } else {
      gender = "None";
  }

  if (action.endsWith("_user")) {
      userGenders[chatId] = gender;

      bot.sendMessage(chatId, "Maaloo itti fufuuf mata duree gorsaa barbaaddu filadhu:", {
          reply_markup: {
              inline_keyboard: [
                  [{ text: "Amantii fi guddina hafuura 🙏", callback_data: "category_spiritual_user" }],
                  [{ text: "Beellamaa fi hariiroo jaalalaa saala faallaa 💕", callback_data: "category_dating_user" }],
                  [{ text: "Fayyaa sammuu 🧠", callback_data: "category_mental_user" }],
                  [{ text: "qulqulluummaa quunnamtii saalaan walqabatu 🚫", callback_data: "category_sexual_user" }],
                  [{ text: "Rakkoo hoogganuu(Crisis Management) 🆘", callback_data: "category_crisis_user" }],
                  [{ text: " Aarii to'achuu fi bilchina miiraa 😡", callback_data: "category_anger_user" }],
                  [{ text: "Barumsaa fi galmaa ofii beekuu", callback_data: "category_education_user" }],
                  [{ text: "Araada fi fayyadama wantoota garaagaraa 💊", callback_data: "category_addiction_user" }],
                  [{ text: "Barsiisa dogoggoraa(Heresy) ❗", callback_data: "category_heresy_user" }],
                  [{ text: "kan biraa(Other) 💡", callback_data: "category_other_user" }],
              ],
          },
      });
  } else {
      counselorGenders[chatId] = gender;

      bot.sendMessage(chatId, "📝 You can select multiple categories you want to provide counseling in. Click 'Done' when finished:", {
          reply_markup: {
              inline_keyboard: [
                [{ text: "Amantii fi guddina hafuura 🙏", callback_data: "category_spiritual" }],
                [{ text: "Beellamaa fi hariiroo jaalalaa saala faallaa 💕", callback_data: "category_dating" }],
                [{ text: "Fayyaa sammuu 🧠", callback_data: "category_mental" }],
                [{ text: "qulqulluummaa quunnamtii saalaan walqabatu 🚫", callback_data: "category_sexual" }],
                [{ text: "Rakkoo hoogganuu(Crisis Management) 🆘", callback_data: "category_crisis" }],
                [{ text: "Aarii to'achuu fi bilchina miiraa 😡", callback_data: "category_anger" }],
                [{ text: "Barumsaa fi galmaa ofii beekuu", callback_data: "category_education" }],
                [{ text: "Araada fi fayyadama wantoota garaagaraa 💊", callback_data: "category_addiction" }],
                [{ text: "Barsiisa dogoggoraa(Heresy) ❗", callback_data: "category_heresy" }],
                [{ text: "kan biraa(Other) 💡", callback_data: "category_other" }],
                [{ text: "Done ✔️", callback_data: "category_done" }],
              ],
          },
      });
      counselorCategories[chatId] = []; // Initialize empty list for categories
  }
}

function handleCategorySelection(chatId, action, callbackQuery) {
  const categories = {
      "category_spiritual": "Amantii fi guddina hafuura 🙏",
        "category_dating": "Beellamaa fi hariiroo jaalalaa saala faallaa 💕",
        "category_mental": "Fayyaa sammuu 🧠",
        "category_sexual": "qulqulluummaa quunnamtii saalaan walqabatu 🚫",
        "category_crisis": "Rakkoo hoogganuu(Crisis Management) 🆘",
        "category_anger": "Aarii to'achuu fi bilchina miiraa 😡",
        "category_education": "Barumsaa fi galmaa ofii beekuu",
        "category_addiction": "Araada fi fayyadama wantoota garaagaraa 💊",
        "category_heresy": "Barsiisa dogoggoraa(Heresy) ❗",
        "category_other": "kan biraa(Other) 💡",

        "category_spiritual_user": "Amantii fi guddina hafuura 🙏",
        "category_dating_user": "Beellamaa fi hariiroo jaalalaa saala faallaa 💕",
        "category_mental_user": "Fayyaa sammuu 🧠",
        "category_sexual_user": "qulqulluummaa quunnamtii saalaan walqabatu 🚫",
        "category_crisis_user": "Rakkoo hoogganuu(Crisis Management) 🆘",
        "category_anger_user": "Aarii to'achuu fi bilchina miiraa 😡",
        "category_education_user": "Barumsaa fi galmaa ofii beekuu",
        "category_addiction_user": "Araada fi fayyadama wantoota garaagaraa 💊",
        "category_heresy_user": "Barsiisa dogoggoraa(Heresy) ❗",
        "category_other_user": "kan biraa(Other) 💡",
  };

  if (action.endsWith("_user")) {
      userCategories[chatId] = categories[action];
      connectUserToCounselor(chatId);
  } else if (action === "category_done") {
      // Make sure categories exist before proceeding
      if (!counselorCategories[chatId] || counselorCategories[chatId].length === 0) {
          return bot.sendMessage(chatId, "Please select at least one category before proceeding.");
      }

      // Store the final categories
      const finalCategories = [...counselorCategories[chatId]];

      bot.sendMessage(chatId, `📝 Categories registered: ${finalCategories.join(", ")}. Waiting for admin approval.`);
      notifyAdminOfRegistration(chatId, callbackQuery.from.username);
  } else {
      const category = categories[action];
      if (!counselorCategories[chatId]) {
          counselorCategories[chatId] = [];
      }
      if (!counselorCategories[chatId].includes(category)) {
          counselorCategories[chatId].push(category);
          bot.sendMessage(chatId, `✅ Added category: ${category}. You can select more or click 'Done'.`);
      }
  }
}




function notifyAdminOfRegistration(counselorId, username) {
  const categories = counselorCategories[counselorId]?.join(", ") || "Unknown";
  const gender = counselorGenders[counselorId] || "Unknown";

  ADMIN_IDS.forEach(adminId => {
      bot.sendMessage(adminId, `🔔 New counselor registration:\n- ID: ${counselorId}\n- Username: @${username || "Unknown"}\n- Categories: ${categories}\n- Gender: ${gender}`, {
          reply_markup: {
              inline_keyboard: [
                  [{ text: "Approve", callback_data: `approve_${counselorId}` }, { text: "Reject", callback_data: `reject_${counselorId}` }],
              ],
          },
      });
  });
}





function handleApproval(counselorId) {
  if (!pendingCounselors[counselorId]) return;

  const preservedCategories = [...(counselorCategories[counselorId] || [])];
  const preservedGender = counselorGenders[counselorId];

  counselors.add(counselorId);
  counselorCategories[counselorId] = preservedCategories;
  counselorGenders[counselorId] = preservedGender;

  delete pendingCounselors[counselorId];

  bot.sendMessage(counselorId, `✅ Congratulations! Your request to become a counselor has been approved.\nYour categories: ${preservedCategories.join(", ")}`);

  ADMIN_IDS.forEach(adminId => {
      bot.sendMessage(adminId, `✅ Counselor ${counselorId} has been approved.\nCategories: ${preservedCategories.join(", ")}\nGender: ${preservedGender}`);
  });
}

// Handle Rejection
function handleRejection(counselorId) {
  if (!pendingCounselors[counselorId]) return;

  delete pendingCounselors[counselorId];

  bot.sendMessage(counselorId, "❌ Sorry, your request to become a counselor has been rejected.");

  ADMIN_IDS.forEach(adminId => {
      bot.sendMessage(adminId, `❌ Counselor ${counselorId} has been rejected.`);
  });
}





// End All Sessions
function endAllSessions() {
  Object.keys(sessions).forEach(chatId => {
      bot.sendMessage(chatId, "🔔 All sessions have been ended by the admin.");
      delete sessions[chatId];
  });

  ADMIN_IDS.forEach(adminId => {
      bot.sendMessage(adminId, "✅ All sessions have been successfully ended.");
  });
}

// List Approved Counselors
function listCounselors(chatId) {
  if (counselors.size === 0) {
      return bot.sendMessage(chatId, "🔍 No counselors available.");
  }

  const counselorList = [...counselors]
      .map(id => `- ${id} (Categories: ${counselorCategories[id]?.join(", ") || "Unknown"})`)
      .join("\n");

  bot.sendMessage(chatId, `👥 Approved Counselors:\n${counselorList}`);
}

// View Pending Registrations
function viewPendingRegistrations(chatId) {
  const pendingList = Object.keys(pendingCounselors)
      .map(id => `- ${id} (@${pendingCounselors[id]})`)
      .join("\n");

  if (!pendingList) {
      return bot.sendMessage(chatId, "🔍 No pending counselor registrations.");
  }

  bot.sendMessage(chatId, `🔔 Pending Registrations:\n${pendingList}`);
}

// Forward messages between users and counselors
bot.on("message", (msg) => {
    const chatId = msg.chat.id;

    // Check if the sender is in an active session
    if (sessions[chatId]) {
        const otherPartyId = sessions[chatId];

        // Forward only the text message
        if (msg.text) {
            bot.sendMessage(otherPartyId, msg.text);
        }

        // You can add more handlers for other types of messages (photo, document, etc.) if needed
        if (msg.photo) {
            const fileId = msg.photo[msg.photo.length - 1].file_id; // Get the highest resolution photo
            bot.sendPhoto(otherPartyId, fileId, { caption: msg.caption || "" });
        }

        if (msg.document) {
            const fileId = msg.document.file_id;
            bot.sendDocument(otherPartyId, fileId, { caption: msg.caption || "" });
        }

        if (msg.voice) {
            const fileId = msg.voice.file_id;
            bot.sendVoice(otherPartyId, fileId);
        }

        if (msg.video) {
            const fileId = msg.video.file_id;
            bot.sendVideo(otherPartyId, fileId, { caption: msg.caption || "" });
        }
    } else {
        // If no session, notify the sender
        bot.sendMessage(chatId, "❌ Yeroo ammaa nama gorsa siif kennu wajjin wal hin quunnamne");
    }
});


// Function to show stats
// Function to show stats
function viewStats() {
  const activeUsers = Object.keys(sessions).filter(chatId => !isNaN(chatId)).length;
  const activeCounselors = counselors.size;
  const activeSessions = Object.keys(sessions).length;
  const totalUsers = registeredUsers.size;

  const statsMessage = `📊 Current Stats:\n\n` +
      `👥 Active Counselors: ${activeCounselors}\n` +
      `🧑‍🤝‍🧑 Active Users: ${activeUsers}\n` +
      `📝 Total Counseling Sessions: ${activeSessions}\n` +
      `👨‍👩‍👧‍👦 Total Users Interacted: ${totalUsers}`;

  ADMIN_IDS.forEach(adminId => {
      bot.sendMessage(adminId, statsMessage);
  });
}


// Function to delete all data
function deleteAllData() {
  counselors.clear();
  Object.keys(pendingCounselors).forEach(chatId => {
      delete pendingCounselors[chatId];
  });
  Object.keys(sessions).forEach(chatId => {
      delete sessions[chatId];
  });

  ADMIN_IDS.forEach(adminId => {
      bot.sendMessage(adminId, "✅ All data has been deleted successfully. All counselors, pending registrations, and sessions have been cleared.");
  });
}

bot.onText(/\/check_categories/, (msg) => {
    const chatId = msg.chat.id.toString();
    if (msg.chat.id.toString() === ADMIN_ID) {
        const allCounselors = [...counselors];
        const categoriesInfo = allCounselors.map(counselorId => 
            `Counselor ${counselorId}: ${counselorCategories[counselorId]?.join(", ") || "No categories"}`
        ).join("\n");
        bot.sendMessage(chatId, `Current counselor categories:\n${categoriesInfo}`);
    }
});

// Allow user to send a reminder to their counselor
bot.onText(/\/remind (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const message = match[1];

  // Check if the user is registered
  if (!registeredUsers.has(chatId)) {
    return bot.sendMessage(chatId, "❌ You must register first to send a reminder.");
  }

  // Check for user history
  const counselorId = userHistory[chatId];
  if (!counselorId || !counselors.has(counselorId)) {
    return bot.sendMessage(chatId, "❌ You cannot send a reminder because you are not connected to a counselor.");
  }

  // Store the reminder message
  reminderMessages[counselorId] = { from: chatId, message };
  bot.sendMessage(chatId, "✅ Your reminder has been sent to the counselor.");
  bot.sendMessage(counselorId, `🔔 You have a reminder from a user: "${message}"`);
});

// Allow counselor to send a reminder to their user
bot.onText(/\/remind_user (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const message = match[1];

  // Check if the sender is a counselor
  if (!counselors.has(chatId)) {
    return bot.sendMessage(chatId, "❌ Only counselors can send reminders to users.");
  }

  // Check for active or historical users
  const userIds = Object.keys(userHistory).filter(userId => userHistory[userId] === chatId);
  if (!userIds.length) {
    return bot.sendMessage(chatId, "❌ You have no users to send a reminder to.");
  }

  // Send a reminder to the first user in the history.
  const userId = userIds[0];
  reminderMessages[userId] = { from: chatId, message };
  bot.sendMessage(chatId, "✅ Your reminder has been sent to the user.");
  bot.sendMessage(userId, `🔔 You have a reminder from your counselor: "${message}"`);
});