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

// 💡 Để chuỗi rỗng "" ở lần đầu chạy để sinh mã session mới. 
// Sau khi bot in chuỗi session ra màn hình, bạn có thể dán nó vào đây để không phải đăng nhập lại.
const stringSession = new StringSession("1BQANOTEuMTA4LjU2LjE2OAG7rO4nc9jv58ctrpKpU4JofO1Z7uFOjNPTV9yL4sdAA3nok3k/wsKZKCfif8tHCdMCzNqyr6tf+G48/FAS3oLDBEbjbnJCeHiUzlTvR15hidFx0lSfuNq0S6F7PczyEZd9PhBzbZFInNkAjrpgo66yftbKn+Sgjns81PYBwoLixGml9tHAEW7etQIoTAKaJoOm5zA0R8+qgYQ0YsawcyDKZ4J14Z/st8RjVK9JDdebqBPJ5uj/Uxbqo/hSGCGoBSl/fbbbIMaXdo9K2C7I9TnqmDM0Su86jrZU2dnUggs/jjPUl0iiMkVgZazjzi7jMMwvzKaoyFqOCs8WGxJtheu0iw=="); 

const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
});

async function addNewRow(sheet, position, quantity, price, volume, date, groupName, groupId, messageId) {
    const rows = await sheet.getRows();
    const stt = rows.length + 1; 

    await sheet.addRow({
        "STT": stt.toString(),
        "Lệnh": position,
        "Số lượng": quantity.toString(),
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
    
    // In mã Session lần đầu để bạn lưu lại sử dụng lâu dài
    const savedSession = client.session.save();
    console.log("\n=================== TELEGRAM SESSION STRING ===================");
    console.log("🔑 Hãy sao chép chuỗi mã bên dưới và dán vào phần khởi tạo StringSession(\"chuỗi_ở_đây\") để bỏ qua đăng nhập lần sau:");
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
                        
                        //await client.sendMessage(message.peerId, {
                        //    message: `🔥 Đã xoá giao dịch gốc (Tin nhắn gốc ID: ${replyToMessageId})`,
                        //    replyTo: message.id
                        //});
                    } else {
                        console.log(`⚠️ Không tìm thấy giao dịch gốc để xóa trong sheet ${monthYearString}.`);
                    }
                } catch (error) {
                    console.error("❌ Lỗi khi xử lý xóa giao dịch:", error);
                }
            }
            return; 
        }

        // XỬ LÝ LỆNH CHỐT GIAO DỊCH
        const match = text.match(/^\/(chotmua|chotban)\s+(\d+)[uU]?\/(\d+)/);

        if (match) {
            try {
                const command = match[1]; 
                const position = command === "chotmua" ? "Mua" : "Bán";
                const quantity = parseInt(match[2]);
                const price = parseInt(match[3]);
                const volume = quantity * price;
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

                // Gửi tin nhắn trả về phép tính trơn (Không có dấu phân cách) vào nhóm
                if (isSuccess) {
                    const replyText = `${quantity} * ${price} = ${volume}`;
                    
                    await client.sendMessage(message.peerId, {
                        message: replyText,
                        replyTo: message.id // Trả lời trực tiếp vào tin nhắn chứa lệnh
                    });
                    console.log(`📩 Đã gửi tin nhắn tính toán trơn vào nhóm: "${replyText}"`);
                }

            } catch (error) {
                console.error("❌ Lỗi xử lý giao dịch:", error);
            }
        }
    }, new NewMessage({}));
}

start().catch(console.error);