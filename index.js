import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import dotenv from "dotenv";
import input from "input"; 

dotenv.config();

// --- CẤU HÌNH DANH SÁCH USERNAME ĐƯỢC PHÉP CHẠY LỆNH ---
const ALLOWED_USERNAMES = ["tuananhinvest", "cuong2386"];

// --- 1. Hàm làm sạch tên Nhóm (Chỉ giữ lại tên Khách hàng) ---
function cleanGroupName(rawName) {
    if (!rawName) return "Unknown Chat";

    let name = rawName;

    name = name.replace(/đức\s+anh/gi, "");
    name = name.replace(/dimond/gi, "");
    name = name.replace(/khách\s+hàng/gi, "");

    // Xóa các từ nối độc lập: "and", "và"
    name = name.replace(/\band\b/gi, "");
    name = name.replace(/\bvà\b/gi, "");
    name = name.replace(/\+/g, "");

    // Làm sạch khoảng trắng và các ký tự phân tách còn sót lại ở đầu/cuối
    name = name.replace(/^[\s\-_,\.\+]+/g, ""); 
    name = name.replace(/[\s\-_,\.\+]+$/g, ""); 
    name = name.replace(/\s+/g, " "); 

    return name.trim() || rawName;
}

// --- 2. Khởi tạo cấu hình Google Sheets API ---
const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), 
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

async function getOrCreateSheetForMonth(monthYearString) {
    await doc.loadInfo();
    let sheet = doc.sheetsByTitle[monthYearString];
    if (!sheet) {
        console.log(`📂 Không tìm thấy sheet "${monthYearString}". Đang tiến hành tạo mới...`);
        sheet = await doc.addSheet({ title: monthYearString });
        await sheet.setHeaderRow([
            "STT", "Lệnh", "Số lượng", "Giá", "Khối lượng", "Thời gian giao dịch", "Khách hàng", "group_id", "message_id"
        ]);
        console.log(`✨ Đã tạo thành công sheet mới: "${monthYearString}"`);
    }
    return sheet;
}

// --- 3. Khởi tạo Telegram Client ---
const apiId = parseInt(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

// Dán chuỗi session của bạn vào đây
const stringSession = new StringSession("1BQANOTEuMTA4LjU2LjE2OAG7aVQdMST4uRXvtmP9hCqe4Rb9Wn9l6c7OeszJxlOZMxQUQogp8iRCbi3iBb4EW2CUSZAf4GKgYPzar4rn7Oul0TYsP6/447/OEp6wviDdSCWJeuiy9jy1dP2VAOv9fT9k5FbHaCkWH2Apt5d8wRG6aKnlypfT64lmxD34bEw5nFYaL6eQZXQD/hjo463K9LEam2wb1pEvVU9pmh8ZblTmH5kipk8pSmnWAX5x6coqNWwdghh4x8JmIJKGT2bK70ly2F6hmyV9joCZFmqtM6ubdF8vvS4SrAKkSOTFmZk9QtkOSh2g702jh0VXNMbJzDWK0Xx6LBzgTPYQnfSY3cJM6g=="); 

const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
});

function formatForSheet(value) {
    if (value === undefined || value === null) return "";
    return value.toString().replace(/\./g, ",");
}

async function addNewRow(sheet, position, quantity, price, volume, date, groupName, groupId, messageId) {
    const rows = await sheet.getRows();
    const stt = rows.length + 1; 

    await sheet.addRow({
        "STT": stt.toString(),
        "Lệnh": position,
        "Số lượng": formatForSheet(quantity),
        "Giá": price.toString(),
        "Khối lượng": volume.toString(),
        "Thời gian giao dịch": date,
        "Khách hàng": groupName,
        "group_id": groupId,
        "message_id": messageId
    });
    console.log(`➕ [Sheet ${sheet.title}] Đã lưu giao dịch MỚI thành công! (STT: ${stt})`);
}

// --- 4. Hàm xử lý logic chính ---
async function start() {
    await client.start({
        phoneNumber: async () => await input.text("Nhập số điện thoại đăng ký Telegram: "),
        password: async () => await input.text("Nhập mật khẩu 2FA (nếu có): "),
        phoneCode: async () => await input.text("Nhập mã OTP gửi về Telegram: "),
        onError: (err) => console.log(err),
    });
    
    console.log("🤖 Bot Telegram đã kết nối thành công!");
    
    const savedSession = client.session.save();
    console.log("\n=================== TELEGRAM SESSION STRING ===================");
    console.log(`\n${savedSession}\n`);
    console.log("===============================================================\n");

    await doc.loadInfo();
    console.log(`📊 Đã kết nối tới Google Sheet gốc: "${doc.title}"`);

    client.addEventHandler(async (event) => {
        const message = event.message;
        if (!message) return;

        const text = (message.message || "").trim();

        // Kiểm tra quyền người gửi
        let senderUsername = "";
        try {
            const sender = await message.getSender();
            senderUsername = sender && sender.username ? sender.username.toLowerCase() : "";
        } catch (e) {
            console.error("⚠️ Không lấy được thông tin người gửi tin nhắn.");
        }

        if (!ALLOWED_USERNAMES.includes(senderUsername)) return;

        const jsDate = new Date(message.date * 1000);
        const vnDateString = jsDate.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
        const monthYearString = `${jsDate.getMonth() + 1}_${jsDate.getFullYear()}`;
        
        let groupId = "Private";
        if (message.peerId) {
            if (message.peerId.chatId) groupId = message.peerId.chatId.toString();
            else if (message.peerId.channelId) groupId = message.peerId.channelId.toString();
            else if (message.peerId.userId) groupId = message.peerId.userId.toString();
        }

        // XỬ LÝ LỆNH /HUY
        if (text === "/huy") {
            if (message.replyTo) {
                const replyToMessageId = message.replyTo.replyToMsgId.toString();
                console.log(`🗑️ Phát hiện lệnh /huy reply cho tin nhắn số ${replyToMessageId} của @${senderUsername}`);

                try {
                    const sheet = await getOrCreateSheetForMonth(monthYearString);
                    const rows = await sheet.getRows();
                    const targetRow = rows.find(row => 
                        row.get("group_id") === groupId && row.get("message_id") === replyToMessageId
                    );

                    if (targetRow) {
                        const deletedStt = targetRow.get("STT");
                        await targetRow.delete();
                        console.log(`🔥 Đã xóa thành công giao dịch có STT: ${deletedStt} tại sheet ${monthYearString}`);
                    } else {
                        console.log(`⚠️ Không tìm thấy giao dịch gốc để xóa trong sheet ${monthYearString}.`);
                    }
                } catch (error) {
                    console.error("❌ Lỗi khi xử lý xóa giao dịch:", error);
                }
            }
            return; 
        }

        // XỬ LÝ LỆNH CHỐT GIAO DỊCH (Hỗ trợ cả dạng U và dạng triệu VNĐ)
        // Regex bắt được các định dạng: /chotmua 30000/26370 hoặc /chotban 100tr/26500 hoặc /chotmua 50m/26400
        const match = text.match(/^\/(chotmua|chotban)\s+(\d+)([uU]|tr|m|triệu|trieu)?\/(\d+)/i);

        if (match) {
            try {
                const command = match[1].toLowerCase(); 
                const position = command === "chotmua" ? "Mua" : "Bán";
                
                const rawValue1 = parseInt(match[2]);                 // Số lượng nhập vào ban đầu
                const unit = match[3] ? match[3].toLowerCase() : "u"; // Đơn vị tính (mặc định là u nếu không nhập)
                const price = parseInt(match[4]);                     // Giá tỷ giá chốt

                let quantity = 0;
                let volume = 0;
                let replyText = "";

                // Kiểm tra xem người dùng chốt theo VNĐ (Triệu) hay chốt theo Số lượng U
                if (["tr", "m", "triệu", "trieu"].includes(unit)) {
                    // --- TRƯỜNG HỢP: CHỐT THEO VNĐ (TRIỆU) ---
                    volume = rawValue1 * 1000000;                     // Khối lượng VNĐ = X triệu
                    const calculatedQty = volume / price;             // Số lượng U = Khối lượng / Giá
                    
                    // Làm tròn 5 chữ số thập phân, nếu là số nguyên tròn thì không cần phần thập phân
                    quantity = Number(calculatedQty.toFixed(1));
                    
                    // Định dạng hiển thị tin nhắn phản hồi dạng Chia (/)
                    replyText = `${volume}/${price} = ${quantity}`;
                } else {
                    // --- TRƯỜNG HỢP: CHỐT THEO SỐ LƯỢNG U (MẶC ĐỊNH) ---
                    quantity = rawValue1;                             // Số lượng U
                    volume = quantity * price;                        // Khối lượng VNĐ
                    
                    // Định dạng hiển thị tin nhắn phản hồi dạng Nhân (*)
                    replyText = `${quantity} * ${price} = ${volume}`;
                }

                const messageId = message.id.toString();
                
                // Lấy tên gốc của nhóm
                let rawGroupName = "Private Chat/Unknown";
                try {
                    const chatEntity = await client.getEntity(message.peerId);
                    rawGroupName = chatEntity.title || chatEntity.firstName || "Unknown Chat";
                } catch (chatError) {
                    const chat = await message.getChat().catch(() => null);
                    if (chat) rawGroupName = chat.title || "Unknown Group";
                }

                // Tiến hành làm sạch tên nhóm trước khi lưu
                const groupName = cleanGroupName(rawGroupName);
                const sheet = await getOrCreateSheetForMonth(monthYearString);

                let isSuccess = false;

                if (message.replyTo) {
                    const replyToMessageId = message.replyTo.replyToMsgId.toString();
                    console.log(`🔄 Phát hiện reply cho tin nhắn số ${replyToMessageId} bởi @${senderUsername}`);

                    const rows = await sheet.getRows();
                    const targetRow = rows.find(row => 
                        row.get("group_id") === groupId && row.get("message_id") === replyToMessageId
                    );

                    if (targetRow) {
                        targetRow.set("Lệnh", position);
                        targetRow.set("Số lượng", quantity.toString());
                        targetRow.set("Giá", price.toString());
                        targetRow.set("Khối lượng", volume.toString());
                        targetRow.set("Thời gian giao dịch", vnDateString);
                        targetRow.set("Khách hàng", groupName); 

                        await targetRow.save();
                        console.log(`✅ Đã cập nhật thành công hàng cũ trong sheet ${monthYearString} (STT: ${targetRow.get("STT")})`);
                        isSuccess = true;
                    } else {
                        console.log(`⚠️ Có reply nhưng không tìm thấy tin nhắn gốc. Tiến hành thêm mới.`);
                        await addNewRow(sheet, position, quantity, price, volume, vnDateString, groupName, groupId, messageId);
                        isSuccess = true;
                    }
                } else {
                    await addNewRow(sheet, position, quantity, price, volume, vnDateString, groupName, groupId, messageId);
                    isSuccess = true;
                }

                // Gửi tin nhắn trả về kết quả trơn (Không chứa dấu chấm hàng nghìn) vào nhóm
                if (isSuccess) {
                    await client.sendMessage(message.peerId, {
                        message: replyText,
                        replyTo: message.id 
                    });
                    console.log(`📩 Đã gửi tin nhắn tính toán vào nhóm: "${replyText}"`);
                }

            } catch (error) {
                console.error("❌ Lỗi xử lý giao dịch:", error);
            }
        }
    }, new NewMessage({}));
}

async function gracefulShutdown() {
    console.log("\n🔌 Đang ngắt kết nối với Telegram...");
    try {
        await client.disconnect();
        console.log("👋 Đã ngắt kết nối an toàn.");
    } catch (err) {
        console.error("Lỗi khi ngắt kết nối:", err);
    }
    process.exit(0);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

start().catch(console.error);