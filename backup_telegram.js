const fs = require("fs");
const path = require("path");
const https = require("https");

require("dotenv").config({
    path: path.join(__dirname, "backend", ".env")
});

const DB_PATH = path.join(__dirname, "backend", "data.json");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
    console.error("[BACKUP] Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID");
    process.exit(1);
}

function sendBackup() {
    if (!fs.existsSync(DB_PATH)) {
        console.error(`[BACKUP] No existe: ${DB_PATH}`);
        return;
    }

    const file = fs.readFileSync(DB_PATH);
    const boundary = "----AFXXTelegramBackup";

    const bodyStart = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="chat_id"\r\n\r\n` +
        `${CHAT_ID}\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="document"; filename="data.json"\r\n` +
        `Content-Type: application/json\r\n\r\n`
    );

    const bodyEnd = Buffer.from(
        `\r\n--${boundary}--\r\n`
    );

    const body = Buffer.concat([
        bodyStart,
        file,
        bodyEnd
    ]);

    const options = {
        hostname: "api.telegram.org",
        path: `/bot${BOT_TOKEN}/sendDocument`,
        method: "POST",
        headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": body.length
        }
    };

    const req = https.request(options, (res) => {
        let response = "";

        res.on("data", (chunk) => {
            response += chunk;
        });

        res.on("end", () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                console.log(
                    `[BACKUP] data.json enviado correctamente: ${new Date().toISOString()}`
                );
            } else {
                console.error(
                    `[BACKUP] Telegram respondió ${res.statusCode}: ${response}`
                );
            }
        });
    });

    req.on("error", (error) => {
        console.error("[BACKUP] Error:", error.message);
    });

    req.write(body);
    req.end();
}

// Primer backup inmediatamente al arrancar
sendBackup();

// Backup cada 10 minutos
setInterval(sendBackup, 10 * 60 * 1000);