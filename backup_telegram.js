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

// Resumen de lo que lleva el archivo: sirve para ver de un vistazo si el
// backup trae TODOS los usuarios o si va incompleto.
function resumen(data) {
    const usuarios = Array.isArray(data.users) ? data.users.length : 0;
    const depositos = Array.isArray(data.deposits) ? data.deposits.length : 0;
    const retiros = Array.isArray(data.withdrawals) ? data.withdrawals.length : 0;
    const referidos = Array.isArray(data.referralClaims) ? data.referralClaims.length : 0;
    const clabe = (data.settings && data.settings.clabe) || "?";
    return { usuarios, depositos, retiros, referidos, clabe };
}

function sendBackup() {
    if (!fs.existsSync(DB_PATH)) {
        console.error(`[BACKUP] No existe: ${DB_PATH}`);
        return;
    }

    let info = null;
    try {
        info = resumen(JSON.parse(fs.readFileSync(DB_PATH, "utf-8")));
    } catch (e) {
        console.error("[BACKUP] data.json no se pudo leer:", e.message);
        return;
    }

    const file = fs.readFileSync(DB_PATH);
    const boundary = "----AFXXTelegramBackup";
    const caption =
        `AFXX | ${info.usuarios} usuarios | ${info.depositos} depositos | ` +
        `${info.retiros} retiros | ${info.referidos} referidos | CLABE ${info.clabe}`;

    const bodyStart = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="chat_id"\r\n\r\n` +
        `${CHAT_ID}\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="caption"\r\n\r\n` +
        `${caption}\r\n` +
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
                    `[BACKUP] data.json enviado: ${info.usuarios} usuarios, ${info.depositos} depositos, ` +
                    `${info.retiros} retiros - ${new Date().toISOString()}`
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

// ---- Arranque de los backups ----
// El servidor lo llama DESPUES de restaurar la base de datos, para que el
// primer archivo que llegue a Telegram ya traiga todos los usuarios y no solo
// los que se hayan registrado desde el ultimo reinicio.
function iniciar() {
    if (!BACKUP_ACTIVO) return false;
    sendBackup();
    setInterval(sendBackup, 10 * 60 * 1000);
    return true;
}

module.exports = { iniciar, sendBackup, BACKUP_ACTIVO };
