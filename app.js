// ==========================================
// CYBERPANEL - APP.JS
// ==========================================

"use strict";

// ------------------------------------------
// CONFIGURACIÓN
// ------------------------------------------

const STORAGE = {
    devices: "cp_devices",
    files: "cp_files",
    events: "cp_events",
    settings: "cp_settings"
};

const sections = {
    dashboard: ["Dashboard", "Resumen general"],
    devices: ["Dispositivos", "Dispositivos autorizados"],
    screens: ["Pantallas", "Pantallas compartidas"],
    files: ["Archivos", "Almacenamiento"],
    activity: ["Actividad", "Historial de eventos"],
    console: ["Consola", "Comandos internos"],
    settings: ["Configuración", "Preferencias"]
};


// ------------------------------------------
// ESTADO
// ------------------------------------------

const state = {

    devices: load(STORAGE.devices, []),

    files: load(STORAGE.files, []),

    events: load(STORAGE.events, []),

    settings: load(STORAGE.settings, {
        notifications: true,
        animations: true
    })

};


// ------------------------------------------
// VARIABLES DE CONEXIÓN
// ------------------------------------------

let socket = null;

let reconnectTimer = null;

let reconnectAttempts = 0;

let pairCode = null;

let deviceScreenStream = null;

let deviceScreenPeer = null;

let dashboardPeers = new Map();

let currentDeviceId =
    localStorage.getItem("cp_device_id") || null;

let currentDeviceName =
    localStorage.getItem("cp_device_name") || null;

let currentDeviceToken =
    localStorage.getItem("cp_device_token") || null;

const isDeviceMode =
    new URLSearchParams(location.search)
        .get("device") === "1";


// ------------------------------------------
// UTILIDADES
// ------------------------------------------

function load(key, fallback) {

    try {

        const value =
            localStorage.getItem(key);

        if (!value) {
            return fallback;
        }

        return JSON.parse(value);

    } catch {

        return fallback;

    }

}


function save(key, value) {

    localStorage.setItem(
        key,
        JSON.stringify(value)
    );

}


function escapeHTML(value) {

    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

}


function formatBytes(bytes) {

    if (!bytes) {
        return "0 B";
    }

    const units = [
        "B",
        "KB",
        "MB",
        "GB",
        "TB"
    ];

    const index = Math.min(
        Math.floor(
            Math.log(bytes) /
            Math.log(1024)
        ),
        units.length - 1
    );

    return (
        bytes /
        Math.pow(1024, index)
    ).toFixed(1) +
        " " +
        units[index];

}


function formatTime() {

    return new Date()
        .toLocaleString();

}


// ------------------------------------------
// TOAST
// ------------------------------------------

function showToast(message) {

    const container =
        document.getElementById(
            "toastContainer"
        );

    if (!container) {
        return;
    }

    const toast =
        document.createElement("div");

    toast.className = "toast";

    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {

        toast.remove();

    }, 3200);

}


// ------------------------------------------
// EVENTOS LOCALES
// ------------------------------------------

function addEvent(message) {

    state.events.unshift({

        id:
            crypto.randomUUID(),

        message:
            String(message),

        time:
            formatTime()

    });

    state.events =
        state.events.slice(0, 200);

    save(
        STORAGE.events,
        state.events
    );

    renderAll();

    if (
        !isDeviceMode &&
        state.settings.notifications
    ) {

        showToast(message);

    }

}


// ------------------------------------------
// NAVEGACIÓN
// ------------------------------------------

function showSection(name) {

    document
        .querySelectorAll(".section")
        .forEach(section => {

            section.classList.toggle(
                "active",
                section.id === name
            );

        });


    document
        .querySelectorAll(".nav")
        .forEach(button => {

            button.classList.toggle(
                "active",
                button.dataset.section === name
            );

        });


    const info =
        sections[name];

    if (info) {

        const title =
            document.getElementById(
                "pageTitle"
            );

        const subtitle =
            document.getElementById(
                "pageSubtitle"
            );

        if (title) {
            title.textContent =
                info[0];
        }

        if (subtitle) {
            subtitle.textContent =
                info[1];
        }

    }

    closeMenu();

}


function closeMenu() {

    const sidebar =
        document.getElementById(
            "sidebar"
        );

    const overlay =
        document.getElementById(
            "overlay"
        );

    if (sidebar) {
        sidebar.classList.remove("open");
    }

    if (overlay) {
        overlay.classList.remove("show");
    }

}


document
    .querySelectorAll(".nav")
    .forEach(button => {

        button.addEventListener(
            "click",
            () => {

                showSection(
                    button.dataset.section
                );

            }
        );

    });


document
    .querySelectorAll("[data-go]")
    .forEach(button => {

        button.addEventListener(
            "click",
            () => {

                showSection(
                    button.dataset.go
                );

            }
        );

    });


const menuButton =
    document.getElementById(
        "menuButton"
    );

if (menuButton) {

    menuButton.onclick = () => {

        const sidebar =
            document.getElementById(
                "sidebar"
            );

        const overlay =
            document.getElementById(
                "overlay"
            );

        sidebar.classList.toggle("open");

        overlay.classList.toggle("show");

    };

}


const overlay =
    document.getElementById(
        "overlay"
    );

if (overlay) {

    overlay.onclick =
        closeMenu;

}


// ------------------------------------------
// WEBSOCKET
// ------------------------------------------

function getWebSocketURL() {

    const protocol =
        location.protocol === "https:"
            ? "wss:"
            : "ws:";

    return (
        protocol +
        "//" +
        location.host
    );

}


function connectSocket() {

    if (socket) {

        if (
            socket.readyState ===
            WebSocket.OPEN
        ) {
            return;
        }

        if (
            socket.readyState ===
            WebSocket.CONNECTING
        ) {
            return;
        }

    }


    try {

        socket =
            new WebSocket(
                getWebSocketURL()
            );

    } catch {

        updateConnection(false);

        scheduleReconnect();

        return;

    }


    socket.onopen = () => {

        reconnectAttempts = 0;

        updateConnection(true);

        if (isDeviceMode) {

            reconnectDevice();

        } else {

            registerPanel();

        }

    };


    socket.onclose = () => {

        updateConnection(false);

        scheduleReconnect();

    };


    socket.onerror = () => {

        updateConnection(false);

    };


    socket.onmessage =
        event => {

            let data;

            try {

                data =
                    JSON.parse(
                        event.data
                    );

            } catch {

                return;

            }

            handleServerMessage(data);

        };

}


function scheduleReconnect() {

    if (reconnectTimer) {
        return;
    }

    reconnectAttempts++;

    const delay =
        Math.min(
            1000 *
            Math.pow(
                1.5,
                reconnectAttempts
            ),
            10000
        );

    reconnectTimer =
        setTimeout(() => {

            reconnectTimer = null;

            connectSocket();

        }, delay);

}


function sendSocket(data) {

    if (
        socket &&
        socket.readyState ===
        WebSocket.OPEN
    ) {

        socket.send(
            JSON.stringify(data)
        );

        return true;

    }

    return false;

}


function updateConnection(online) {

    const status =
        document.getElementById(
            "connectionStatus"
        );

    if (!status) {
        return;
    }

    status.classList.toggle(
        "online",
        online
    );

    status.innerHTML =
        online
            ? "<i></i> Online"
            : "<i></i> Offline";

}


// ------------------------------------------
// PANEL
// ------------------------------------------

function registerPanel() {

    sendSocket({

        type:
            "panel_register"

    });

}


// ------------------------------------------
// SERVIDOR
// ------------------------------------------

function handleServerMessage(data) {

    // --------------------------------------
    // CONEXIÓN
    // --------------------------------------

    if (
        data.type ===
        "connected"
    ) {

        return;

    }


    // --------------------------------------
    // PANEL LISTO
    // --------------------------------------

    if (
        data.type ===
        "panel_ready"
    ) {

        addEvent(
            "Panel conectado al servidor."
        );

        return;

    }


    // --------------------------------------
    // NUEVO DISPOSITIVO
    // --------------------------------------

    if (
        data.type ===
        "device_connected"
    ) {

        if (data.device) {

            upsertDevice(
                data.device
            );

            addEvent(
                `${data.device.name} se conectó.`
            );

        }

        return;

    }


    // --------------------------------------
    // DISPOSITIVO DESCONECTADO
    // --------------------------------------

    if (
        data.type ===
        "device_disconnected"
    ) {

        const device =
            state.devices.find(
                item =>
                    item.id ===
                    data.deviceId
            );

        if (device) {

            device.status =
                "offline";

            device.lastSeen =
                formatTime();

            save(
                STORAGE.devices,
                state.devices
            );

            renderAll();

            addEvent(
                `${device.name} se desconectó.`
            );

        }

        return;

    }


    // --------------------------------------
    // EVENTO DE DISPOSITIVO
    // --------------------------------------

    if (
        data.type ===
        "device_event"
    ) {

        const name =
            data.deviceName ||
            "Dispositivo";

        addEvent(
            `${name}: ${data.message}`
        );

        return;

    }


    // --------------------------------------
    // RESULTADO DE PAIRING
    // --------------------------------------

    if (
        data.type ===
        "pair_result"
    ) {

        handlePairResult(
            data
        );

        return;

    }


    // --------------------------------------
    // PANTALLA
    // --------------------------------------

    if (
        data.type ===
        "screen_started"
    ) {

        addEvent(
            `${data.deviceName} inició una pantalla compartida.`
        );

        createScreenCard(
            data.deviceId,
            data.deviceName
        );

        return;

    }


    if (
        data.type ===
        "screen_stopped"
    ) {

        removeScreenCard(
            data.deviceId
        );

        addEvent(
            `${data.deviceName} terminó la pantalla compartida.`
        );

        return;

    }


    // --------------------------------------
    // WEBRTC
    // --------------------------------------

    if (
        data.type ===
        "webrtc_offer"
    ) {

        handleWebRTCOffer(
            data
        );

        return;

    }


    if (
        data.type ===
        "webrtc_answer"
    ) {

        handleWebRTCAnswer(
            data
        );

        return;

    }


    if (
        data.type ===
        "webrtc_candidate"
    ) {

        handleWebRTCCandidate(
            data
        );

        return;

    }


    // --------------------------------------
    // COMANDOS AL DISPOSITIVO
    // --------------------------------------

    if (
        data.type ===
        "device_command"
    ) {

        handleDeviceCommand(
            data
        );

        return;

    }

}


// ------------------------------------------
// PAIRING PANEL
// ------------------------------------------

const pairModal =
    document.getElementById(
        "pairModal"
    );


const connectButton =
    document.getElementById(
        "connectButton"
    );


const dashboardConnect =
    document.getElementById(
        "dashboardConnect"
    );


if (connectButton) {

    connectButton.onclick =
        openPairModal;

}


if (dashboardConnect) {

    dashboardConnect.onclick =
        openPairModal;

}


const closePair =
    document.getElementById(
        "closePair"
    );


if (closePair) {

    closePair.onclick =
        () => {

            if (pairModal) {

                pairModal.classList.add(
                    "hidden"
                );

            }

        };

}


function openPairModal() {

    if (!pairModal) {
        return;
    }

    pairModal.classList.remove(
        "hidden"
    );

    generatePairCode();

}


function generatePairCode() {

    pairCode =
        String(
            Math.floor(
                100000 +
                Math.random() *
                900000
            )
        );


    const codeElement =
        document.getElementById(
            "pairCode"
        );


    if (codeElement) {

        codeElement.textContent =
            pairCode;

    }


    sendSocket({

        type:
            "create_pair_code",

        code:
            pairCode

    });

}


const newPairCode =
    document.getElementById(
        "newPairCode"
    );


if (newPairCode) {

    newPairCode.onclick =
        generatePairCode;

}


// ------------------------------------------
// RESULTADO PAIR
// ------------------------------------------

function handlePairResult(data) {

    if (!isDeviceMode) {
        return;
    }


    const message =
        document.getElementById(
            "deviceMessage"
        );


    if (!data.ok) {

        if (message) {

            message.textContent =
                data.message ||
                "No se pudo autorizar el dispositivo.";

        }

        return;

    }


    const device =
        data.device;


    currentDeviceId =
        device.id;

    currentDeviceName =
        device.name;


    localStorage.setItem(
        "cp_device_id",
        device.id
    );

    localStorage.setItem(
        "cp_device_name",
        device.name
    );


    if (data.token) {

        currentDeviceToken =
            data.token;

        localStorage.setItem(
            "cp_device_token",
            data.token
        );

    }


    if (message) {

        message.textContent =
            "Dispositivo autorizado correctamente.";

    }


    showDeviceConnectedUI(
        device
    );


    sendSocket({

        type:
            "device_online",

        deviceId:
            device.id,

        deviceName:
            device.name

    });

}


// ------------------------------------------
// DEVICE MODE
// ------------------------------------------

function setupDeviceMode() {

    if (!isDeviceMode) {
        return;
    }


    const dashboard =
        document.querySelector(
            ".page"
        );


    const sidebar =
        document.querySelector(
            ".sidebar"
        );


    const deviceMode =
        document.getElementById(
            "deviceMode"
        );


    if (dashboard) {

        dashboard.style.display =
            "none";

    }


    if (sidebar) {

        sidebar.style.display =
            "none";

    }


    if (deviceMode) {

        deviceMode.classList.remove(
            "hidden"
        );

    }


    const savedId =
        localStorage.getItem(
            "cp_device_id"
        );


    const savedName =
        localStorage.getItem(
            "cp_device_name"
        );


    if (
        savedId &&
        savedName
    ) {

        currentDeviceId =
            savedId;

        currentDeviceName =
            savedName;

    }


    const button =
        document.getElementById(
            "authorizeDevice"
        );


    if (button) {

        button.onclick =
            authorizeDevice;

    }


    const codeInput =
        document.getElementById(
            "devicePairCode"
        );


    if (codeInput) {

        codeInput.addEventListener(
            "input",
            () => {

                codeInput.value =
                    codeInput.value
                        .replace(/\D/g, "")
                        .slice(0, 6);

            }
        );

    }

}


function authorizeDevice() {

    const nameInput =
        document.getElementById(
            "deviceName"
        );


    const typeInput =
        document.getElementById(
            "deviceType"
        );


    const codeInput =
        document.getElementById(
            "devicePairCode"
        );


    const message =
        document.getElementById(
            "deviceMessage"
        );


    const name =
        nameInput
            ? nameInput.value.trim()
            : "";


    const type =
        typeInput
            ? typeInput.value
            : "Browser";


    const code =
        codeInput
            ? codeInput.value.trim()
            : "";


    if (!name) {

        if (message) {

            message.textContent =
                "Escribe un nombre para el dispositivo.";

        }

        return;

    }


    if (
        !/^\d{6}$/.test(code)
    ) {

        if (message) {

            message.textContent =
                "El código debe tener 6 dígitos.";

        }

        return;

    }


    if (
        !socket ||
        socket.readyState !==
        WebSocket.OPEN
    ) {

        if (message) {

            message.textContent =
                "Conectando al servidor...";

        }

        connectSocket();

        return;

    }


    if (message) {

        message.textContent =
            "Solicitando autorización...";

    }


    sendSocket({

        type:
            "pair_device",

        name:
            name,

        deviceType:
            type,

        code:
            code

    });

}


function showDeviceConnectedUI(device) {

    const card =
        document.querySelector(
            ".device-mode-card"
        );


    if (!card) {
        return;
    }


    card.innerHTML = `

        <div class="brand-icon">
            C
        </div>

        <h1>
            Dispositivo conectado
        </h1>

        <p>
            <b>${escapeHTML(device.name)}</b>
            está autorizado.
        </p>

        <div style="
            background:#f5f6f8;
            border-radius:10px;
            padding:13px;
            margin:15px 0;
            font-size:11px;
        ">
            Estado:
            <b style="color:#16a36b;">
                En línea
            </b>
        </div>

        <button
            id="deviceShareButton"
            class="primary full">
            Compartir pantalla
        </button>

        <button
            id="deviceStopButton"
            class="secondary full">
            Detener pantalla
        </button>

        <input
            id="deviceSearchInput"
            placeholder="Buscar dentro de esta app..."
            maxlength="200">

        <button
            id="deviceSearchButton"
            class="secondary full">
            Registrar búsqueda
        </button>

        <div id="deviceMessage"></div>

    `;


    document
        .getElementById(
            "deviceShareButton"
        )
        .onclick =
            startScreenShare;


    document
        .getElementById(
            "deviceStopButton"
        )
        .onclick =
            stopScreenShare;


    document
        .getElementById(
            "deviceSearchButton"
        )
        .onclick =
            registerDeviceSearch;

}


// ------------------------------------------
// DEVICE RECONNECT
// ------------------------------------------

function reconnectDevice() {

    if (
        !currentDeviceId ||
        !currentDeviceName
    ) {

        return;

    }


    sendSocket({

        type:
            "device_reconnect",

        deviceId:
            currentDeviceId,

        deviceName:
            currentDeviceName,

        token:
            currentDeviceToken

    });

}


// ------------------------------------------
// DEVICE SEARCH
// ------------------------------------------

function registerDeviceSearch() {

    const input =
        document.getElementById(
            "deviceSearchInput"
        );


    if (!input) {
        return;
    }


    const value =
        input.value.trim();


    if (!value) {
        return;
    }


    sendSocket({

        type:
            "device_event",

        deviceId:
            currentDeviceId,

        deviceName:
            currentDeviceName,

        message:
            `Búsqueda dentro de la app: ${value}`

    });


    input.value = "";

}


// ------------------------------------------
// DEVICE SCREEN SHARE
// ------------------------------------------

async function startScreenShare() {

    const message =
        document.getElementById(
            "deviceMessage"
        );


    if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getDisplayMedia
    ) {

        if (message) {

            message.textContent =
                "Este navegador no permite compartir pantalla.";

        }

        return;

    }


    try {

        deviceScreenStream =
            await navigator.mediaDevices
                .getDisplayMedia({
                    video: {
                        frameRate: 30
                    },
                    audio: false
                });


        const videoTrack =
            deviceScreenStream
                .getVideoTracks()[0];


        videoTrack.addEventListener(
            "ended",
            () => {

                stopScreenShare();

            }
        );


        await createDevicePeer();


        sendSocket({

            type:
                "screen_started",

            deviceId:
                currentDeviceId,

            deviceName:
                currentDeviceName

        });


        if (message) {

            message.textContent =
                "Pantalla compartida.";

        }


    } catch (error) {

        deviceScreenStream =
            null;


        if (message) {

            message.textContent =
                "La pantalla no fue compartida.";

        }

    }

}


async function createDevicePeer() {

    if (deviceScreenPeer) {

        deviceScreenPeer.close();

    }


    deviceScreenPeer =
        new RTCPeerConnection({

            iceServers: [

                {
                    urls:
                        "stun:stun.l.google.com:19302"
                }

            ]

        });


    deviceScreenStream
        .getTracks()
        .forEach(track => {

            deviceScreenPeer.addTrack(
                track,
                deviceScreenStream
            );

        });


    deviceScreenPeer.onicecandidate =
        event => {

            if (
                !event.candidate
            ) {
                return;
            }


            sendSocket({

                type:
                    "webrtc_candidate",

                deviceId:
                    currentDeviceId,

                candidate:
                    event.candidate

            });

        };


    const offer =
        await deviceScreenPeer
            .createOffer();


    await deviceScreenPeer
        .setLocalDescription(
            offer
        );


    sendSocket({

        type:
            "webrtc_offer",

        deviceId:
            currentDeviceId,

        offer:
            deviceScreenPeer.localDescription

    });

}


function stopScreenShare() {

    if (deviceScreenStream) {

        deviceScreenStream
            .getTracks()
            .forEach(track => {

                track.stop();

            });

        deviceScreenStream = null;

    }


    if (deviceScreenPeer) {

        deviceScreenPeer.close();

        deviceScreenPeer =
            null;

    }


    if (
        currentDeviceId &&
        socket &&
        socket.readyState ===
        WebSocket.OPEN
    ) {

        sendSocket({

            type:
                "screen_stopped",

            deviceId:
                currentDeviceId,

            deviceName:
                currentDeviceName

        });

    }


    const message =
        document.getElementById(
            "deviceMessage"
        );


    if (message) {

        message.textContent =
            "Pantalla detenida.";

    }

}


// ------------------------------------------
// WEBRTC PANEL
// ------------------------------------------

async function handleWebRTCOffer(data) {

    if (isDeviceMode) {
        return;
    }


    const deviceId =
        data.deviceId;


    if (!deviceId) {
        return;
    }


    let peer =
        dashboardPeers.get(
            deviceId
        );


    if (peer) {

        peer.close();

    }


    peer =
        new RTCPeerConnection({

            iceServers: [

                {
                    urls:
                        "stun:stun.l.google.com:19302"
                }

            ]

        });


    dashboardPeers.set(
        deviceId,
        peer
    );


    peer.ontrack =
        event => {

            const video =
                document.querySelector(
                    `#screen-${CSS.escape(deviceId)} video`
                );


            if (
                video &&
                event.streams[0]
            ) {

                video.srcObject =
                    event.streams[0];

            }

        };


    peer.onicecandidate =
        event => {

            if (
                !event.candidate
            ) {
                return;
            }


            sendSocket({

                type:
                    "webrtc_candidate",

                deviceId:
                    deviceId,

                candidate:
                    event.candidate

            });

        };


    try {

        await peer.setRemoteDescription(
            new RTCSessionDescription(
                data.offer
            )
        );


        const answer =
            await peer.createAnswer();


        await peer.setLocalDescription(
            answer
        );


        sendSocket({

            type:
                "webrtc_answer",

            deviceId:
                deviceId,

            answer:
                peer.localDescription

        });

    } catch {

        addEvent(
            "No se pudo conectar la transmisión de pantalla."
        );

    }

}


async function handleWebRTCAnswer(data) {

    if (!isDeviceMode) {
        return;
    }


    if (!deviceScreenPeer) {
        return;
    }


    try {

        await deviceScreenPeer
            .setRemoteDescription(
                new RTCSessionDescription(
                    data.answer
                )
            );

    } catch {

        // Ignorar respuestas duplicadas.

    }

}


async function handleWebRTCCandidate(data) {

    if (isDeviceMode) {

        if (!deviceScreenPeer) {
            return;
        }

        try {

            await deviceScreenPeer
                .addIceCandidate(
                    data.candidate
                );

        } catch {}

        return;

    }


    const peer =
        dashboardPeers.get(
            data.deviceId
        );


    if (!peer) {
        return;
    }


    try {

        await peer.addIceCandidate(
            data.candidate
        );

    } catch {}

}


// ------------------------------------------
// PANTALLA EN EL PANEL
// ------------------------------------------

function createScreenCard(
    deviceId,
    deviceName
) {

    const grid =
        document.getElementById(
            "screenGrid"
        );


    if (!grid) {
        return;
    }


    const old =
        document.getElementById(
            `screen-${deviceId}`
        );


    if (old) {
        return;
    }


    const empty =
        grid.querySelector(
            ".screen-empty"
        );


    if (empty) {
        empty.remove();
    }


    const card =
        document.createElement(
            "div"
        );


    card.id =
        `screen-${deviceId}`;


    card.style.cssText = `
        width:100%;
        height:100%;
        min-height:500px;
        background:#101216;
        position:relative;
        overflow:hidden;
    `;


    card.innerHTML = `

        <video
            autoplay
            playsinline
            muted
            style="
                width:100%;
                height:100%;
                object-fit:contain;
                background:#101216;
            ">
        </video>

        <div style="
            position:absolute;
            left:14px;
            top:14px;
            padding:8px 11px;
            background:rgba(0,0,0,.65);
            border-radius:7px;
            color:white;
            font-size:10px;
        ">
            ${escapeHTML(deviceName)}
        </div>

    `;


    grid.appendChild(
        card
    );

}


function removeScreenCard(
    deviceId
) {

    const card =
        document.getElementById(
            `screen-${deviceId}`
        );


    if (card) {
        card.remove();
    }


    const peer =
        dashboardPeers.get(
            deviceId
        );


    if (peer) {

        peer.close();

        dashboardPeers.delete(
            deviceId
        );

    }


    const grid =
        document.getElementById(
            "screenGrid"
        );


    if (
        grid &&
        !grid.children.length
    ) {

        grid.innerHTML = `

            <div class="screen-empty">

                <div class="screen-empty-icon">
                    ▣
                </div>

                <b>
                    No hay pantallas compartidas
                </b>

                <span>
                    Una pantalla aparecerá aquí
                    cuando un dispositivo autorizado
                    la comparta.
                </span>

            </div>

        `;

    }

}


// ------------------------------------------
// COMANDOS DE DISPOSITIVO
// ------------------------------------------

function sendDeviceCommand(
    deviceId,
    command,
    value = null
) {

    sendSocket({

        type:
            "device_command",

        deviceId:
            deviceId,

        command:
            command,

        value:
            value

    });

}


function handleDeviceCommand(data) {

    if (!isDeviceMode) {
        return;
    }


    if (
        data.command ===
        "stop_screen"
    ) {

        stopScreenShare();

        return;

    }


    if (
        data.command ===
        "timeout"
    ) {

        const seconds =
            Number(data.value) || 30;


        setTimeout(
            () => {

                stopScreenShare();

            },
            Math.max(
                seconds,
                1
            ) * 1000
        );


        const message =
            document.getElementById(
                "deviceMessage"
            );


        if (message) {

            message.textContent =
                `La pantalla se detendrá en ${seconds} segundos.`;

        }

        return;

    }


    if (
        data.command ===
        "request_screen"
    ) {

        const message =
            document.getElementById(
                "deviceMessage"
            );


        if (message) {

            message.textContent =
                "El panel solicita compartir pantalla. Pulsa «Compartir pantalla» para autorizar.";

        }

    }

}


// ------------------------------------------
// DISPOSITIVOS
// ------------------------------------------

function upsertDevice(device) {

    const index =
        state.devices.findIndex(
            item =>
                item.id ===
                device.id
        );


    if (index === -1) {

        state.devices.push({
            ...device,
            status:
                device.status ||
                "online"
        });

    } else {

        state.devices[index] = {

            ...state.devices[index],

            ...device

        };

    }


    save(
        STORAGE.devices,
        state.devices
    );


    renderAll();

}


function requestScreen(deviceId) {

    sendDeviceCommand(
        deviceId,
        "request_screen"
    );

    addEvent(
        "Solicitud de pantalla enviada."
    );

}


function stopDeviceScreen(deviceId) {

    sendDeviceCommand(
        deviceId,
        "stop_screen"
    );

}


function timeoutDevice(
    deviceId,
    seconds = 30
) {

    sendDeviceCommand(
        deviceId,
        "timeout",
        seconds
    );


    addEvent(
        `Temporizador enviado: ${seconds} segundos.`
    );

}


// ------------------------------------------
// RENDER STATS
// ------------------------------------------

function renderStats() {

    const deviceCount =
        document.getElementById(
            "deviceCount"
        );


    const onlineCount =
        document.getElementById(
            "onlineCount"
        );


    const fileCount =
        document.getElementById(
            "fileCount"
        );


    const eventCount =
        document.getElementById(
            "eventCount"
        );


    if (deviceCount) {

        deviceCount.textContent =
            state.devices.length;

    }


    if (onlineCount) {

        onlineCount.textContent =
            state.devices.filter(
                device =>
                    device.status ===
                    "online"
            ).length;

    }


    if (fileCount) {

        fileCount.textContent =
            state.files.length;

    }


    if (eventCount) {

        eventCount.textContent =
            state.events.length;

    }

}


// ------------------------------------------
// RENDER DEVICES
// ------------------------------------------

function renderDevices() {

    const grid =
        document.getElementById(
            "deviceGrid"
        );


    const dashboard =
        document.getElementById(
            "dashboardDevices"
        );


    if (!grid || !dashboard) {
        return;
    }


    if (!state.devices.length) {

        grid.innerHTML = `
            <div class="empty">
                No hay dispositivos autorizados.
            </div>
        `;


        dashboard.innerHTML = `
            <div class="empty">
                No hay dispositivos conectados.
            </div>
        `;

        return;

    }


    grid.innerHTML =
        state.devices
            .map(device => {

                const online =
                    device.status ===
                    "online";


                return `

                    <div class="device-card">

                        <div class="device-top">

                            <div class="device-icon">
                                ${device.deviceType === "iPhone"
                                    ? "⌕"
                                    : "▣"}
                            </div>

                            <div>

                                <div class="device-name">
                                    ${escapeHTML(device.name)}
                                </div>

                                <div class="device-type">
                                    ${escapeHTML(device.deviceType || "Browser")}
                                </div>

                            </div>

                        </div>


                        <div class="device-bottom">

                            <span class="${
                                online
                                    ? "online-text"
                                    : "offline-text"
                            }">

                                ● ${
                                    online
                                        ? "En línea"
                                        : "Desconectado"
                                }

                            </span>

                            <span>
                                Autorizado
                            </span>

                        </div>


                        ${
                            online
                                ? `

                                <div style="
                                    display:grid;
                                    grid-template-columns:1fr 1fr;
                                    gap:7px;
                                    margin-top:13px;
                                ">

                                    <button
                                        class="secondary"
                                        onclick="requestScreen('${device.id}')">
                                        Pantalla
                                    </button>

                                    <button
                                        class="secondary"
                                        onclick="stopDeviceScreen('${device.id}')">
                                        Detener
                                    </button>

                                    <button
                                        class="secondary"
                                        style="grid-column:1/3;"
                                        onclick="timeoutDevice('${device.id}',30)">
                                        Timeout 30s
                                    </button>

                                </div>

                            `
                                : ""
                        }

                    </div>

                `;

            })
            .join("");


    dashboard.innerHTML =
        state.devices
            .slice(0, 5)
            .map(device => `

                <div class="activity-row">

                    <b>
                        ${escapeHTML(device.name)}
                    </b>

                    <small>

                        ${escapeHTML(
                            device.deviceType ||
                            "Browser"
                        )}

                        ·

                        ${
                            device.status === "online"
                                ? "En línea"
                                : "Desconectado"
                        }

                    </small>

                </div>

            `)
            .join("");

}


// ------------------------------------------
// RENDER FILES
// ------------------------------------------

function renderFiles(search = "") {

    const list =
        document.getElementById(
            "fileList"
        );


    if (!list) {
        return;
    }


    const files =
        state.files.filter(
            file =>
                file.name
                    .toLowerCase()
                    .includes(
                        search.toLowerCase()
                    )
        );


    if (!files.length) {

        list.innerHTML = `
            <div class="empty">
                No hay archivos.
            </div>
        `;

        return;

    }


    list.innerHTML =
        files
            .map(file => `

                <div class="file-row">

                    <div class="file-info">

                        <b>
                            ${escapeHTML(file.name)}
                        </b>

                        <small>
                            ${formatBytes(file.size)}
                            ·
                            ${escapeHTML(file.date)}
                        </small>

                    </div>

                    <div>

                        <button
                            class="link-button"
                            onclick="downloadFile('${file.id}')">
                            Descargar
                        </button>

                        <button
                            class="delete-file"
                            onclick="deleteFile('${file.id}')">
                            Eliminar
                        </button>

                    </div>

                </div>

            `)
            .join("");

}


function downloadFile(id) {

    const file =
        state.files.find(
            item =>
                item.id === id
        );


    if (!file) {
        return;
    }


    const link =
        document.createElement("a");


    link.href =
        file.data;


    link.download =
        file.name;


    document.body.appendChild(
        link
    );


    link.click();


    link.remove();

}


function deleteFile(id) {

    const file =
        state.files.find(
            item =>
                item.id === id
        );


    state.files =
        state.files.filter(
            item =>
                item.id !== id
        );


    save(
        STORAGE.files,
        state.files
    );


    renderAll();


    if (file) {

        addEvent(
            `Archivo eliminado: ${file.name}`
        );

    }

}


// ------------------------------------------
// UPLOAD
// ------------------------------------------

const fileInput =
    document.getElementById(
        "fileInput"
    );


if (fileInput) {

    fileInput.addEventListener(
        "change",
        event => {

            const files =
                Array.from(
                    event.target.files
                );


            files.forEach(
                saveUploadedFile
            );


            fileInput.value = "";

        }
    );

}


function saveUploadedFile(file) {

    const reader =
        new FileReader();


    reader.onload = () => {

        const item = {

            id:
                crypto.randomUUID(),

            name:
                file.name,

            type:
                file.type ||
                "application/octet-stream",

            size:
                file.size,

            data:
                reader.result,

            date:
                formatTime()

        };


        const index =
            state.files.findIndex(
                old =>
                    old.name ===
                    file.name
            );


        if (index >= 0) {

            state.files[index] =
                item;

        } else {

            state.files.push(
                item
            );

        }


        save(
            STORAGE.files,
            state.files
        );


        addEvent(
            `Archivo guardado: ${file.name}`
        );


        renderAll();

    };


    reader.readAsDataURL(
        file
    );

}


// ------------------------------------------
// FILE SEARCH
// ------------------------------------------

const fileSearch =
    document.getElementById(
        "fileSearch"
    );


if (fileSearch) {

    fileSearch.addEventListener(
        "input",
        () => {

            renderFiles(
                fileSearch.value
            );

        }
    );

}


// ------------------------------------------
// ACTIVITY
// ------------------------------------------

const clearActivity =
    document.getElementById(
        "clearActivity"
    );


if (clearActivity) {

    clearActivity.onclick =
        () => {

            state.events = [];

            save(
                STORAGE.events,
                state.events
            );

            renderAll();

            showToast(
                "Historial eliminado."
            );

        };

}


function renderActivity() {

    const list =
        document.getElementById(
            "activityList"
        );


    const dashboard =
        document.getElementById(
            "dashboardActivity"
        );


    if (!list || !dashboard) {
        return;
    }


    if (!state.events.length) {

        const empty = `
            <div class="empty">
                No hay actividad todavía.
            </div>
        `;

        list.innerHTML =
            empty;

        dashboard.innerHTML =
            empty;

        return;

    }


    list.innerHTML =
        state.events
            .map(event => `

                <div class="activity-row">

                    <b>
                        ${escapeHTML(event.message)}
                    </b>

                    <small>
                        ${escapeHTML(event.time)}
                    </small>

                </div>

            `)
            .join("");


    dashboard.innerHTML =
        state.events
            .slice(0, 5)
            .map(event => `

                <div class="activity-row">

                    <b>
                        ${escapeHTML(event.message)}
                    </b>

                    <small>
                        ${escapeHTML(event.time)}
                    </small>

                </div>

            `)
            .join("");

}


// ------------------------------------------
// SETTINGS
// ------------------------------------------

const notifications =
    document.getElementById(
        "notifications"
    );


const animations =
    document.getElementById(
        "animations"
    );


if (notifications) {

    notifications.checked =
        state.settings.notifications;


    notifications.addEventListener(
        "change",
        () => {

            state.settings.notifications =
                notifications.checked;

            save(
                STORAGE.settings,
                state.settings
            );

        }
    );

}


if (animations) {

    animations.checked =
        state.settings.animations;


    animations.addEventListener(
        "change",
        () => {

            state.settings.animations =
                animations.checked;

            save(
                STORAGE.settings,
                state.settings
            );


            document.body.style.setProperty(
                "--animation-speed",
                animations.checked
                    ? "1"
                    : "0"
            );

        }
    );

}


// ------------------------------------------
// CONSOLA
// ------------------------------------------

const consoleInput =
    document.getElementById(
        "consoleInput"
    );


const consoleOutput =
    document.getElementById(
        "consoleOutput"
    );


function consolePrint(text) {

    if (!consoleOutput) {
        return;
    }


    const line =
        document.createElement(
            "div"
        );


    line.textContent =
        text;


    consoleOutput.appendChild(
        line
    );


    consoleOutput.scrollTop =
        consoleOutput.scrollHeight;

}


if (consoleInput) {

    consoleInput.addEventListener(
        "keydown",
        event => {

            if (
                event.key !==
                "Enter"
            ) {
                return;
            }


            const command =
                consoleInput.value
                    .trim();


            consoleInput.value =
                "";


            if (!command) {
                return;
            }


            consolePrint(
                `panel@cyber:~$ ${command}`
            );


            executeCommand(
                command
            );

        }
    );

}


function executeCommand(command) {

    const cmd =
        command
            .split(/\s+/)[0]
            .toLowerCase();


    if (cmd === "help") {

        consolePrint(
            "Comandos disponibles:"
        );

        consolePrint(
            "help"
        );

        consolePrint(
            "devices"
        );

        consolePrint(
            "files"
        );

        consolePrint(
            "events"
        );

        consolePrint(
            "online"
        );

        consolePrint(
            "clear"
        );

        return;

    }


    if (cmd === "devices") {

        if (!state.devices.length) {

            consolePrint(
                "No hay dispositivos."
            );

            return;

        }


        state.devices.forEach(
            device => {

                consolePrint(
                    `${device.name} — ${device.status}`
                );

            }
        );

        return;

    }


    if (cmd === "online") {

        const online =
            state.devices.filter(
                device =>
                    device.status ===
                    "online"
            );


        consolePrint(
            `Dispositivos online: ${online.length}`
        );

        return;

    }


    if (cmd === "files") {

        consolePrint(
            `Archivos: ${state.files.length}`
        );

        state.files.forEach(
            file => {

                consolePrint(
                    file.name
                );

            }
        );

        return;

    }


    if (cmd === "events") {

        state.events.forEach(
            event => {

                consolePrint(
                    `[${event.time}] ${event.message}`
                );

            }
        );

        return;

    }


    if (cmd === "clear") {

        if (consoleOutput) {

            consoleOutput.innerHTML =
                "";

        }

        return;

    }


    consolePrint(
        `Comando desconocido: ${cmd}`
    );

}


// ------------------------------------------
// RENDER TODO
// ------------------------------------------

function renderAll() {

    if (isDeviceMode) {
        return;
    }

    renderStats();

    renderDevices();

    renderFiles(
        fileSearch
            ? fileSearch.value
            : ""
    );

    renderActivity();

}


// ------------------------------------------
// INICIALIZACIÓN
// ------------------------------------------

setupDeviceMode();

renderAll();


if (
    "serviceWorker" in navigator
) {

    // No se registra ningún service worker
    // automáticamente para evitar interferencias
    // durante el desarrollo.

}


connectSocket();


// ------------------------------------------
// EXPONER FUNCIONES PARA BOTONES HTML
// ------------------------------------------

window.downloadFile =
    downloadFile;

window.deleteFile =
    deleteFile;

window.requestScreen =
    requestScreen;

window.stopDeviceScreen =
    stopDeviceScreen;

window.timeoutDevice =
    timeoutDevice;

window.showSection =
    showSection;