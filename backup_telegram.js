const fs = require("fs");
const path = require("path");
const https = require("https");

require("dotenv").config({
    path: path.join(__dirname, "backend", ".env")
});

const DB_PATH = path.join(__dirname, "backend", "data.json");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// El backup es opcional: si faltan las variables (por ejemplo en un clon
// nuevo sin .env) el servidor debe seguir arrancando igual. Antes esto
// apagaba el proceso entero y tumbaba la web.
const BACKUP_ACTIVO = Boolean(BOT_TOKEN && CHAT_ID);

if (!BACKUP_ACTIVO) {
    console.warn(
        "[BACKUP] Sin TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID: el backup automatico queda desactivado (el servidor sigue normal)."
    );
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
// Backup cada 10 minutos
// (solo si hay credenciales configuradas; si no, el backup queda apagado
//  y el servidor sigue funcionando con normalidad)
if (BACKUP_ACTIVO) {
    sendBackup();
    setInterval(sendBackup, 10 * 60 * 1000);
}