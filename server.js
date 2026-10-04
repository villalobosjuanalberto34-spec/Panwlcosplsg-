const http = require(“http”);
const fs = require(“fs”);
const path = require(“path”);
const crypto = require(“crypto”);
const WebSocket = require(“ws”);

const PORT =
process.env.PORT || 3000;

const PUBLIC =
__dirname;

const server =
http.createServer(
(req, res) => {

        let requestPath =
            decodeURIComponent(
                req.url.split("?")[0]
            );
        if (
            requestPath === "/" ||
            requestPath === ""
        ) {
            requestPath =
                "/index.html";
        }
        const filePath =
            path.join(
                PUBLIC,
                requestPath
            );
        if (
            !filePath.startsWith(PUBLIC)
        ) {
            res.writeHead(403);
            res.end("Forbidden");
            return;
        }
        fs.readFile(
            filePath,
            (error, data) => {
                if (error) {
                    res.writeHead(404);
                    res.end("Not found");
                    return;
                }
                const ext =
                    path.extname(
                        filePath
                    ).toLowerCase();
                const types = {
                    ".html":
                        "text/html; charset=utf-8",
                    ".css":
                        "text/css; charset=utf-8",
                    ".js":
                        "application/javascript; charset=utf-8",
                    ".json":
                        "application/json; charset=utf-8",
                    ".png":
                        "image/png",
                    ".jpg":
                        "image/jpeg",
                    ".jpeg":
                        "image/jpeg",
                    ".svg":
                        "image/svg+xml"
                };
                res.writeHead(
                    200,
                    {
                        "Content-Type":
                            types[ext] ||
                            "application/octet-stream"
                    }
                );
                res.end(data);
            }
        );
    }
);

const wss =
new WebSocket.Server({
server
});

const clients =
new Map();

const pairCodes =
new Map();

function send(ws, data) {

if (
    ws.readyState ===
    WebSocket.OPEN
) {
    ws.send(
        JSON.stringify(data)
    );
}

}

function broadcast(data, except = null) {

for (
    const client of clients.values()
) {
    if (
        client.ws !== except
    ) {
        send(
            client.ws,
            data
        );
    }
}

}

function createId() {

return crypto.randomUUID();

}

function cleanCode(code) {

return String(code || "")
    .replace(/\D/g, "")
    .slice(0, 6);

}

wss.on(
“connection”,
ws => {

    const clientId =
        createId();
    const client = {
        id:
            clientId,
        ws,
        role:
            "unknown",
        deviceId:
            null,
        deviceName:
            null
    };
    clients.set(
        clientId,
        client
    );
    send(ws, {
        type:
            "connected",
        clientId
    });
    ws.on(
        "message",
        raw => {
            let data;
            try {
                data =
                    JSON.parse(
                        raw.toString()
                    );
            } catch {
                return;
            }
            // PANEL
            if (
                data.type ===
                "panel_register"
            ) {
                client.role =
                    "panel";
                send(
                    ws,
                    {
                        type:
                            "panel_ready"
                    }
                );
                return;
            }
            // CREATE PAIR CODE
            if (
                data.type ===
                "create_pair_code"
            ) {
                if (
                    client.role !==
                    "panel"
                ) {
                    return;
                }
                const code =
                    cleanCode(
                        data.code
                    );
                if (
                    code.length !== 6
                ) {
                    return;
                }
                pairCodes.set(
                    code,
                    {
                        panelId:
                            client.id,
                        created:
                            Date.now()
                    }
                );
                send(
                    ws,
                    {
                        type:
                            "pair_code_created",
                        code
                    }
                );
                return;
            }
            // DEVICE PAIR
            if (
                data.type ===
                "pair_device"
            ) {
                const code =
                    cleanCode(
                        data.code
                    );
                const pair =
                    pairCodes.get(
                        code
                    );
                if (!pair) {
                    send(
                        ws,
                        {
                            type:
                                "pair_result",
                            ok:
                                false,
                            message:
                                "Código inválido o expirado."
                        }
                    );
                    return;
                }
                if (
                    Date.now() -
                    pair.created >
                    5 * 60 * 1000
                ) {
                    pairCodes.delete(
                        code
                    );
                    send(
                        ws,
                        {
                            type:
                                "pair_result",
                            ok:
                                false,
                            message:
                                "El código expiró."
                        }
                    );
                    return;
                }
                const deviceId =
                    createId();
                const device = {
                    id:
                        deviceId,
                    name:
                        String(
                            data.name ||
                            "Dispositivo"
                        ).slice(0, 30),
                    deviceType:
                        String(
                            data.deviceType ||
                            "Browser"
                        ).slice(0, 20),
                    status:
                        "online",
                    lastSeen:
                        new Date()
                            .toLocaleString()
                };
                client.role =
                    "device";
                client.deviceId =
                    deviceId;
                client.deviceName =
                    device.name;
                const panel =
                    clients.get(
                        pair.panelId
                    );
                if (!panel) {
                    send(
                        ws,
                        {
                            type:
                                "pair_result",
                            ok:
                                false,
                            message:
                                "El panel ya no está conectado."
                        }
                    );
                    return;
                }
                send(
                    ws,
                    {
                        type:
                            "pair_result",
                        ok:
                            true,
                        device
                    }
                );
                send(
                    panel.ws,
                    {
                        type:
                            "device_connected",
                        device
                    }
                );
                pairCodes.delete(
                    code
                );
                return;
            }
            // DEVICE EVENT
            if (
                data.type ===
                "device_event"
            ) {
                if (
                    client.role !==
                    "device"
                ) {
                    return;
                }
                const message =
                    String(
                        data.message ||
                        "Evento"
                    ).slice(0, 500);
                const event = {
                    type:
                        "device_event",
                    deviceId:
                        client.deviceId,
                    deviceName:
                        client.deviceName,
                    message
                };
                broadcast(
                    event,
                    ws
                );
                return;
            }
            // DEVICE ONLINE
            if (
                data.type ===
                "device_online"
            ) {
                if (
                    client.role !==
                    "device"
                ) {
                    return;
                }
                broadcast({
                    type:
                        "device_connected",
                    device: {
                        id:
                            client.deviceId,
                        name:
                            client.deviceName,
                        status:
                            "online",
                        lastSeen:
                            new Date()
                                .toLocaleString()
                    }
                }, ws);
                return;
            }
            // SCREEN STARTED
            if (
                data.type ===
                "screen_started"
            ) {
                if (
                    client.role !==
                    "device"
                ) {
                    return;
                }
                broadcast({
                    type:
                        "screen_started",
                    deviceId:
                        client.deviceId,
                    deviceName:
                        client.deviceName
                }, ws);
                return;
            }
            // SCREEN STOPPED
            if (
                data.type ===
                "screen_stopped"
            ) {
                if (
                    client.role !==
                    "device"
                ) {
                    return;
                }
                broadcast({
                    type:
                        "screen_stopped",
                    deviceId:
                        client.deviceId,
                    deviceName:
                        client.deviceName
                }, ws);
                return;
            }
        }
    );
    ws.on(
        "close",
        () => {
            clients.delete(
                clientId
            );
            if (
                client.role ===
                "device"
            ) {
                broadcast({
                    type:
                        "device_disconnected",
                    deviceId:
                        client.deviceId,
                    deviceName:
                        client.deviceName
                }, ws);
            }
        }
    );
}

);

server.listen(
PORT,
() => {

    console.log(
        `CyberPanel running on port ${PORT}`
    );
}

);