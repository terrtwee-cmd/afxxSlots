const fs = require("fs");
const path = require("path");
const https = require("https");
require("dotenv").config();

const DB_PATH = path.join(__dirname, "db.json");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
    console.error("Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID");
    return;
}

function sendBackup() {
    if (!fs.existsSync(DB_PATH)) {
        console.error("No existe db.json");
        return;
    }

    const boundary = "----TelegramBackupBoundary";
    const file = fs.readFileSync(DB_PATH);

    const bodyStart = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="chat_id"\r\n\r\n` +
        `${CHAT_ID}\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="document"; filename="db.json"\r\n` +
        `Content-Type: application/json\r\n\r\n`
    );

    const bodyEnd = Buffer.from(`\r\n--${boundary}--\r\n`);

    const body = Buffer.concat([bodyStart, file, bodyEnd]);

    const options = {
        hostname: "api.telegram.org",
        path: `/bot${BOT_TOKEN}/sendDocument`,
        method: "POST",
        headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": body.length
        }
    };

    const req = https.request(options, res => {
        let data = "";

        res.on("data", chunk => {
            data += chunk;
        });

        res.on("end", () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                console.log(
                    `[BACKUP] db.json enviado correctamente: ${new Date().toISOString()}`
                );
            } else {
                console.error("[BACKUP] Telegram respondió:", data);
            }
        });
    });

    req.on("error", err => {
        console.error("[BACKUP] Error:", err.message);
    });

    req.write(body);
    req.end();
}

sendBackup();

setInterval(sendBackup, 10 * 60 * 1000);