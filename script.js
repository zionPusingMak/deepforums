// ===== FIREBASE SETUP =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, push, set, onValue, onChildAdded, serverTimestamp, get, update, remove, query, orderByChild, limitToLast, startAt } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyAFceErp5Ba4IeeRM_41wgDzxG3P92_zuE",
    authDomain: "deepforums.firebaseapp.com",
    databaseURL: "https://deepforums-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "deepforums",
    storageBucket: "deepforums.firebasestorage.app",
    messagingSenderId: "905218411017",
    appId: "1:905218411017:web:883f3c6d663d048ca886d8"
};

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

// ===== XSS PROTECTION =====
// All user data rendered via textContent or DOM API — never raw innerHTML with user input.

// ===== REALTIME USERNAME CACHE =====
const userIdToUsername = {};

function listenUserIdMap() {
    onValue(ref(db, "userIds"), snap => {
        const data = snap.val() || {};
        Object.entries(data).forEach(([uid, uname]) => {
            userIdToUsername[uid] = uname;
        });
        document.querySelectorAll("[data-userid]").forEach(el => {
            const uid = el.dataset.userid;
            if (uid && userIdToUsername[uid]) {
                el.textContent = userIdToUsername[uid];
                if (el.classList.contains("clickable-user")) {
                    el.dataset.username = userIdToUsername[uid];
                }
            }
        });
    });
}

// ===== VIDEO COMPRESSOR (Browser-Native, No WASM) =====
// Mirip cara WA/IG/TikTok compress: render ke canvas + MediaRecorder
// Target: < 28MB, max 480p, 800kbps video, 96kbps audio

async function compressVideo(file) {
    const MAX_BYTES  = 28 * 1024 * 1024;
    const MAX_WIDTH  = 854;   // 480p landscape / 480p portrait
    const MAX_HEIGHT = 480;
    const FPS        = 24;
    const VBITRATE   = 1_200_000; // 1.2 Mbps — hasil oke, file kecil

    // Kalau udah kecil, skip compress
    if (file.size <= 10 * 1024 * 1024) return file;

    showSendingIndicator(true);

    return new Promise((resolve, reject) => {
        const video = document.createElement("video");
        video.src     = URL.createObjectURL(file);
        video.muted   = false; // FIX: perlu false supaya audio bisa di-capture
        video.preload = "metadata";

        video.onerror = () => {
            showSendingIndicator(false);
            reject(new Error("Gagal baca video. Format tidak didukung."));
        };

        video.onloadedmetadata = () => {
            // Hitung dimensi baru, jaga aspect ratio
            let w = video.videoWidth  || 640;
            let h = video.videoHeight || 480;
            const ratio = w / h;

            if (w > MAX_WIDTH || h > MAX_HEIGHT) {
                if (ratio > 1) {
                    w = MAX_WIDTH;
                    h = Math.round(MAX_WIDTH / ratio);
                } else {
                    h = MAX_HEIGHT;
                    w = Math.round(MAX_HEIGHT * ratio);
                }
            }

            // Buat canvas sebagai "encoder"
            const canvas  = document.createElement("canvas");
            canvas.width  = w % 2 === 0 ? w : w - 1; // harus genap untuk codec
            canvas.height = h % 2 === 0 ? h : h - 1;
            const ctx     = canvas.getContext("2d");

            // Pilih codec terbaik yang tersedia di browser
            const mimeOptions = [
                "video/mp4;codecs=avc1",
                "video/webm;codecs=vp9,opus",
                "video/webm;codecs=vp8,opus",
                "video/webm",
            ];
            const mimeType = mimeOptions.find(m => MediaRecorder.isTypeSupported(m)) || "video/webm";

            // Capture stream dari canvas
            const canvasStream = canvas.captureStream(FPS);
            const chunks       = [];

            // Setup audio — sambungkan audio dari video ke stream
            let audioStream = null;
            try {
                const audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
                const src       = audioCtx.createMediaElementSource(video);
                const dest      = audioCtx.createMediaStreamDestination();
                src.connect(dest);
                src.connect(audioCtx.destination);
                audioStream = dest.stream;
                audioStream.getAudioTracks().forEach(t => canvasStream.addTrack(t));
            } catch (_) {
                // Kalau audio gagal, lanjut tanpa audio (edge case)
            }

            const recorder = new MediaRecorder(canvasStream, {
                mimeType,
                videoBitsPerSecond: VBITRATE,
                audioBitsPerSecond: 96_000,
            });

            recorder.ondataavailable = e => {
                if (e.data && e.data.size > 0) chunks.push(e.data);
            };

            recorder.onstop = () => {
                URL.revokeObjectURL(video.src);
                showSendingIndicator(false);

                const ext  = mimeType.includes("mp4") ? "mp4" : "webm";
                const type = mimeType.split(";")[0];
                const blob = new Blob(chunks, { type });
                const out  = new File([blob], `compressed.${ext}`, { type });

                console.log(`[compress] ${(file.size/1024/1024).toFixed(1)}MB → ${(out.size/1024/1024).toFixed(1)}MB (${mimeType})`);

                if (out.size > MAX_BYTES) {
                    reject(new Error(`Video masih terlalu besar setelah kompresi (${(out.size/1024/1024).toFixed(1)}MB). Coba video yang lebih pendek.`));
                    return;
                }
                resolve(out);
            };

            recorder.onerror = e => {
                showSendingIndicator(false);
                reject(new Error("Kompresi gagal: " + e.error?.message));
            };

            // Draw frame-by-frame dari video ke canvas
            let animFrame;
            const drawFrame = () => {
                if (!video.paused && !video.ended) {
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                }
                animFrame = requestAnimationFrame(drawFrame);
            };

            video.onplay  = () => {
                recorder.start(200); // collect chunks tiap 200ms
                drawFrame();
            };
            video.onended = () => {
                cancelAnimationFrame(animFrame);
                if (recorder.state !== "inactive") recorder.stop();
            };
            video.onpause = () => {
                // Kalau video pause sebelum ended (edge case durasi pendek)
                if (video.ended) return;
                cancelAnimationFrame(animFrame);
                if (recorder.state !== "inactive") recorder.stop();
            };

            video.play().catch(err => {
                showSendingIndicator(false);
                reject(new Error("Gagal play video untuk kompresi: " + err.message));
            });
        };
    });
}

// ===== MEDIA UPLOAD =====
async function uploadMedia(file) {
    let fileToUpload = file;

    if (file.type.startsWith("video/")) {
        try {
            fileToUpload = await compressVideo(file);
        } catch(e) {
            // Kalau compress gagal, coba upload original (mungkin udah kecil)
            console.warn("[compress] gagal, upload original:", e.message);
            if (file.size > 28 * 1024 * 1024) {
                throw new Error("Video terlalu besar dan gagal dikompres. Coba video yang lebih pendek.");
            }
        }
    }

    try {
        return await uploadToYupra(fileToUpload);
    } catch(e) {
        console.warn("Yupra failed, trying pomf:", e.message);
        return await uploadToPomf(fileToUpload);
    }
}

async function uploadToYupra(file) {
    const formData = new FormData();
    const ext = (file.name && file.name.includes("."))
        ? file.name.split(".").pop()
        : (file.type.split("/")[1] || "bin");
    const filename = (file.name && file.name !== "") ? file.name : ("upload." + ext);
    formData.append("files", file, filename);

    const res = await fetch("https://cdn.yupra.my.id/upload", {
        method: "POST",
        body: formData
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch(e) { throw new Error("Yupra response invalid: " + text.slice(0, 80)); }

    if (!data.success || !data.files || data.files.length === 0) {
        throw new Error(data.message || "Yupra upload failed");
    }
    return "https://cdn.yupra.my.id" + data.files[0].url;
}

async function uploadToPomf(file) {
    const formData = new FormData();
    const ext = (file.name && file.name.includes("."))
        ? file.name.split(".").pop()
        : (file.type.split("/")[1] || "bin");
    const filename = (file.name && file.name !== "") ? file.name : ("upload." + ext);
    formData.append("files[]", file, filename);

    const res = await fetch("https://pomf2.lain.la/upload.php", {
        method: "POST",
        body: formData
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch(e) { throw new Error("Pomf response invalid: " + text.slice(0, 80)); }

    if (!data.success || !data.files || data.files.length === 0) {
        throw new Error("Pomf upload failed: " + text.slice(0, 80));
    }
    return "https://pomf2.lain.la" + data.files[0].url;
}

// ===== USER =====
function getOrCreateUserId() {
    let uid = localStorage.getItem("userId");
    if (!uid) {
        uid = "u_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        localStorage.setItem("userId", uid);
    }
    return uid;
}
const MY_USER_ID = getOrCreateUserId();

let currentUser = JSON.parse(localStorage.getItem("user")) || {
    username: "guest",
    bio: "No bio yet",
    avatar: null
};

let currentForum    = null;
let currentDMUser   = null;
let currentThreadId = null;
let currentForumId  = null;

// Active Firebase listeners — unsubscribe on view change
let activeListeners = [];

function clearListeners() {
    activeListeners.forEach(fn => fn());
    activeListeners = [];
}

// ===== NOTIFICATION BADGES =====
const _badgeCount = { global: 0, dm: 0 };
const _lastReadKey = JSON.parse(sessionStorage.getItem("lastReadKey") || "{}");

function _saveLastReadKey() {
    sessionStorage.setItem("lastReadKey", JSON.stringify(_lastReadKey));
}

function showBadge(target, count) {
    const id  = target === "global" ? "navGlobalChat" : "navDMs";
    const btn = document.getElementById(id);
    if (!btn) return;
    let badge = btn.querySelector(".nav-badge");
    if (count > 0) {
        if (!badge) {
            badge = document.createElement("span");
            badge.className = "nav-badge";
            btn.appendChild(badge);
        }
        badge.textContent = count > 99 ? "99+" : count;
    } else {
        if (badge) badge.remove();
    }
}

function markGlobalRead() {
    _badgeCount.global = 0;
    showBadge("global", 0);
    get(query(ref(db, "global_chat"), orderByChild("timestamp"), limitToLast(1))).then(snap => {
        snap.forEach(child => { _lastReadKey["global"] = child.key; });
        _saveLastReadKey();
    });
}

function markDMRead(otherUsername) {
    const dmKey = getDMKey(currentUser.username, otherUsername);
    get(query(ref(db, `dms/${dmKey}`), orderByChild("timestamp"), limitToLast(1))).then(snap => {
        snap.forEach(child => { _lastReadKey[`dm_${otherUsername}`] = child.key; });
        _saveLastReadKey();
    });
    _recalcDMBadge();
}

function _recalcDMBadge() {
    if (_badgeCount.dm <= 0) {
        _badgeCount.dm = 0;
        showBadge("dm", 0);
    }
}

const APP_START_TIME = Date.now();

function listenGlobalBadge() {
    const chatRef = query(
        ref(db, "global_chat"),
        orderByChild("timestamp"),
        startAt(APP_START_TIME)
    );
    onChildAdded(chatRef, (child) => {
        const m = child.val();
        if (m.userId === MY_USER_ID) return;
        if (document.getElementById("globalChatView").style.display !== "none") return;
        _badgeCount.global++;
        showBadge("global", _badgeCount.global);
    });
}

function listenDMBadge() {
    const registeredRooms = new Set();
    onChildAdded(ref(db, "dms"), (roomSnap) => {
        const roomKey = roomSnap.key;
        if (registeredRooms.has(roomKey)) return;
        const parts    = roomKey.split("__");
        const involveMe = parts.includes(currentUser.username);
        if (!involveMe) return;
        registeredRooms.add(roomKey);
        const other = parts.find(u => u !== currentUser.username);
        const roomRef = query(
            ref(db, `dms/${roomKey}`),
            orderByChild("timestamp"),
            startAt(APP_START_TIME)
        );
        onChildAdded(roomRef, (child) => {
            const m = child.val();
            if (m.userId === MY_USER_ID) return;
            if (!m.userId && m.author === currentUser.username) return;
            if (currentDMUser === other &&
                document.getElementById("dmConvoView").style.display !== "none") return;
            _badgeCount.dm++;
            showBadge("dm", _badgeCount.dm);
        });
    });
}

// ===== ONLINE PRESENCE =====
function getPresenceRef() {
    return ref(db, `presence/${currentUser.username}`);
}

async function heartbeat() {
    await set(getPresenceRef(), { online: true, last: serverTimestamp() });
}

function listenOnlineUsers() {
    const onlineRef = ref(db, "presence");
    const unsub = onValue(onlineRef, snap => {
        const data  = snap.val() || {};
        const now   = Date.now();
        const users = Object.entries(data)
            .filter(([, v]) => v.online && (now - (v.last || 0) < 60000))
            .map(([u]) => u);

        document.getElementById("onlineCount").textContent = users.length;
        const list = document.getElementById("onlineList");
        list.innerHTML = "";
        users.forEach(u => {
            const div = document.createElement("div");
            div.className = "online-user";
            const dot  = document.createElement("span");
            dot.className = "online-dot";
            const name = document.createElement("span");
            name.className  = "online-name";
            name.textContent = u;
            div.appendChild(dot);
            div.appendChild(name);
            div.addEventListener("click", () => {
                if (u !== currentUser.username) openUserProfile(u);
            });
            list.appendChild(div);
        });
    });
    return unsub;
}

heartbeat();
setInterval(heartbeat, 30000);
window.addEventListener("beforeunload", () => {
    set(getPresenceRef(), { online: false, last: serverTimestamp() });
});

// ===== FORUMS =====
const forums = [
    { id: "general", name: "general", desc: "General discussion" },
    { id: "gore",    name: "gore",    desc: "Things that should you never see" },
    { id: "exploit", name: "exploit", desc: "Nothing is impossible" },
    { id: "random",  name: "random",  desc: "Anything goes here" }
];

// ===== ELEMENTS =====
const forumListEl  = document.getElementById("forumList");
const mainTitle    = document.getElementById("mainTitle");
const newThreadBtn = document.getElementById("newThreadBtn");
const threadViewEl = document.getElementById("threadView");
const mainEl       = document.querySelector("main");

// ===== HIDE ALL VIEWS =====
function hideAllViews() {
    clearListeners();
    mainEl.style.display = "none";
    threadViewEl.style.display = "none";
    document.getElementById("commentBar").classList.remove("visible");
    document.getElementById("globalChatView").style.display = "none";
    document.getElementById("dmView").style.display = "none";
    document.getElementById("dmConvoView").style.display = "none";
    document.getElementById("userProfileView").style.display = "none";
}

// ===== SENDING INDICATOR =====
function showSendingIndicator(show, label) {
    let el = document.getElementById("sendingIndicator");
    if (!el) {
        el = document.createElement("div");
        el.id = "sendingIndicator";
        el.style.cssText = [
            "position:fixed",
            "bottom:70px",
            "right:20px",
            "background:#1e1e1e",
            "border:1px solid #2a2a2a",
            "color:#aaa",
            "padding:6px 14px",
            "border-radius:20px",
            "font-size:12px",
            "font-family:'JetBrains Mono',monospace",
            "z-index:9999",
            "display:none",
            "gap:8px",
            "align-items:center"
        ].join(";");

        const dot = document.createElement("span");
        dot.id = "sendingDot";
        dot.style.cssText = [
            "width:7px",
            "height:7px",
            "border-radius:50%",
            "background:#4da6ff",
            "display:inline-block",
            "animation:sendPulse 0.9s ease-in-out infinite"
        ].join(";");

        const lbl = document.createElement("span");
        lbl.id = "sendingLabel";
        lbl.textContent = "Uploading...";

        el.appendChild(dot);
        el.appendChild(lbl);
        document.body.appendChild(el);

        if (!document.getElementById("sendPulseStyle")) {
            const style = document.createElement("style");
            style.id = "sendPulseStyle";
            style.textContent = "@keyframes sendPulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1.2)}}";
            document.head.appendChild(style);
        }
    }

    if (label) {
        const lbl = document.getElementById("sendingLabel");
        if (lbl) lbl.textContent = label;
    }

    el.style.display = show ? "flex" : "none";
}

// ===== SHARED CHAT MESSAGE ELEMENT BUILDER =====
function buildChatMsgEl(m, showClickableAuthor) {
    const isMe    = m.userId === MY_USER_ID;
    const dateStr = m.timestamp
        ? new Date(m.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
        : "";

    const wrapper = document.createElement("div");
    wrapper.className = "chat-msg" + (isMe ? " chat-msg-me" : "");

    const meta = document.createElement("div");
    meta.className = "chat-msg-meta";

    const authorSpan = document.createElement("span");
    authorSpan.className = "chat-author" + (showClickableAuthor ? " clickable-user" : "");
    const displayName = (m.userId && userIdToUsername[m.userId]) ? userIdToUsername[m.userId] : m.author;
    authorSpan.textContent = displayName;
    if (m.userId) authorSpan.dataset.userid   = m.userId;
    if (showClickableAuthor) authorSpan.dataset.username = displayName;

    const timeSpan = document.createElement("span");
    timeSpan.className  = "chat-time";
    timeSpan.textContent = dateStr;

    meta.appendChild(authorSpan);
    meta.appendChild(timeSpan);
    wrapper.appendChild(meta);

    if (m.text) {
        const textDiv = document.createElement("div");
        textDiv.className  = "chat-text";
        textDiv.textContent = m.text;
        wrapper.appendChild(textDiv);
    }

    if (m.mediaUrl) {
        // FIX: deteksi video dari mediaType ATAU ekstensi URL (handle mediaType null/kosong)
        const isVideo = (typeof m.mediaType === "string" && m.mediaType.startsWith("video/"))
            || /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(m.mediaUrl);
        const isImage = !isVideo && (
            (typeof m.mediaType === "string" && m.mediaType.startsWith("image/"))
            || /\.(jpg|jpeg|png|gif|webp|bmp)(\?|$)/i.test(m.mediaUrl)
            || typeof m.mediaType !== "string"  // kalau null, asumsikan gambar
        );
        if (isVideo) {
            const vid = document.createElement("video");
            vid.className = "chat-media";
            vid.controls  = true;
            vid.src        = m.mediaUrl;
            wrapper.appendChild(vid);
        } else if (isImage) {
            const img = document.createElement("img");
            img.className = "chat-media";
            img.alt       = "image";
            img.src        = m.mediaUrl;
            wrapper.appendChild(img);
        }
    }

    return wrapper;
}

// ===== GLOBAL CHAT =====
function openGlobalChat() {
    hideAllViews();
    document.getElementById("globalChatView").style.display = "flex";
    mainTitle.textContent          = "# global-chat";
    newThreadBtn.style.display     = "none";
    closeSidebarFn();
    markGlobalRead();

    const container = document.getElementById("globalChatMessages");
    container.innerHTML = "";

    const chatRef = query(ref(db, "global_chat"), orderByChild("timestamp"), limitToLast(100));
    const unsub = onChildAdded(chatRef, snap => {
        const m  = snap.val();
        const el = buildChatMsgEl(m, true);
        container.appendChild(el);
        attachUserClicks(el);
        container.scrollTop = container.scrollHeight;
    });
    activeListeners.push(() => unsub());
}

async function sendGlobalMessage(text, file) {
    let mediaUrl  = null;
    let mediaType = null;

    if (file) {
        showSendingIndicator(true, file.type.startsWith("video/") ? "Compressing..." : "Uploading...");
        try {
            mediaUrl  = await uploadMedia(file);
            mediaType  = file.type.startsWith("video/") ? "video/mp4" : file.type;
        } catch(e) {
            alert("Upload gagal: " + e.message);
            showSendingIndicator(false);
            return;
        }
        showSendingIndicator(false);
    }

    if (!text && !mediaUrl) return;

    await push(ref(db, "global_chat"), {
        userId: MY_USER_ID,
        author: currentUser.username,
        text:   text || "",
        mediaUrl,
        mediaType,
        timestamp: serverTimestamp()
    });
}

document.getElementById("globalChatSend").addEventListener("click", async () => {
    const input = document.getElementById("globalChatInput");
    const text  = input.value.trim();
    if (!text) return;
    input.value = "";
    await sendGlobalMessage(text, null);
});

document.getElementById("globalChatFile").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) return;
    const captured = file;
    e.target.value = "";
    await sendGlobalMessage("", captured);
});

document.getElementById("globalChatInput").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        document.getElementById("globalChatSend").click();
    }
});

// ===== DM =====
function getDMKey(a, b) {
    return [a, b].sort().join("__");
}

function openDMList() {
    hideAllViews();
    document.getElementById("dmView").style.display = "block";
    mainTitle.textContent      = "✉ Messages";
    newThreadBtn.style.display = "none";
    closeSidebarFn();

    const list = document.getElementById("dmList");
    list.innerHTML = "";

    const dmsRef = ref(db, "dms");
    const unsub  = onValue(dmsRef, snap => {
        const data = snap.val() || {};
        list.innerHTML = "";

        const myConvos = Object.entries(data)
            .filter(([key]) => key.includes(currentUser.username))
            .map(([key, msgs]) => {
                const other  = key.split("__").find(u => u !== currentUser.username);
                const msgArr = Object.values(msgs || {});
                const last   = msgArr.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).pop();
                return { other, last, key };
            })
            .sort((a, b) => (b.last?.timestamp || 0) - (a.last?.timestamp || 0));

        if (myConvos.length === 0) {
            const p = document.createElement("p");
            p.className  = "empty-msg";
            p.textContent = "No messages yet. Click a user's name to start a conversation.";
            list.appendChild(p);
            return;
        }

        myConvos.forEach(c => {
            const div = document.createElement("div");
            div.className = "dm-item";

            const nameDiv = document.createElement("div");
            nameDiv.className = "dm-item-name";
            nameDiv.appendChild(document.createTextNode(c.other));

            const previewDiv = document.createElement("div");
            previewDiv.className  = "dm-item-preview";
            previewDiv.textContent = c.last
                ? (c.last.text ? c.last.text.substring(0, 50) : "[media]")
                : "";

            div.appendChild(nameDiv);
            div.appendChild(previewDiv);
            div.addEventListener("click", () => openDMConvo(c.other));
            list.appendChild(div);
        });
    });
    activeListeners.push(() => unsub());
}

function openDMConvo(username) {
    currentDMUser = username;
    hideAllViews();
    document.getElementById("dmConvoView").style.display    = "flex";
    document.getElementById("dmConvoName").textContent      = username;
    mainTitle.textContent      = `✉ ${username}`;
    newThreadBtn.style.display = "none";
    markDMRead(username);

    const container = document.getElementById("dmMessages");
    container.innerHTML = "";

    const key    = getDMKey(currentUser.username, username);
    const dmRef  = query(ref(db, `dms/${key}`), orderByChild("timestamp"), limitToLast(100));
    const unsub  = onChildAdded(dmRef, snap => {
        const m  = snap.val();
        const el = buildChatMsgEl(m, false);
        container.appendChild(el);
        container.scrollTop = container.scrollHeight;
    });
    activeListeners.push(() => unsub());
}

async function sendDMMessage(text, file) {
    if (!currentDMUser) return;
    let mediaUrl  = null;
    let mediaType = null;

    if (file) {
        showSendingIndicator(true, file.type.startsWith("video/") ? "Compressing..." : "Uploading...");
        try {
            mediaUrl  = await uploadMedia(file);
            mediaType  = file.type.startsWith("video/") ? "video/mp4" : file.type;
        } catch(e) {
            alert("Upload gagal: " + e.message);
            showSendingIndicator(false);
            return;
        }
        showSendingIndicator(false);
    }

    if (!text && !mediaUrl) return;

    const key = getDMKey(currentUser.username, currentDMUser);
    await push(ref(db, `dms/${key}`), {
        userId: MY_USER_ID,
        author: currentUser.username,
        text:   text || "",
        mediaUrl,
        mediaType,
        timestamp: serverTimestamp()
    });
}

document.getElementById("dmSend").addEventListener("click", async () => {
    const input = document.getElementById("dmInput");
    const text  = input.value.trim();
    if (!text) return;
    input.value = "";
    await sendDMMessage(text, null);
});

document.getElementById("dmFile").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) return;
    const captured = file;
    e.target.value = "";
    await sendDMMessage("", captured);
});

document.getElementById("dmInput").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        document.getElementById("dmSend").click();
    }
});

// ===== USER PROFILE VIEW =====
async function openUserProfile(username) {
    hideAllViews();
    document.getElementById("userProfileView").style.display = "block";
    mainTitle.textContent      = `@${username}`;
    newThreadBtn.style.display = "none";
    closeSidebarFn();

    const profileSnap    = await get(ref(db, `profiles/${username}`));
    const profile        = profileSnap.val() || { username, bio: "No bio yet.", avatar: null };
    const isMe           = username === currentUser.username;
    const displayProfile = isMe ? currentUser : profile;

    document.getElementById("profileUsername").textContent = displayProfile.username;
    document.getElementById("profileBio").textContent      = displayProfile.bio || "No bio yet.";

    const avatarEl      = document.getElementById("profileAvatar");
    const placeholderEl = document.getElementById("profileAvatarPlaceholder");
    placeholderEl.textContent = displayProfile.username.charAt(0).toUpperCase();

    if (displayProfile.avatar) {
        avatarEl.src           = displayProfile.avatar;
        avatarEl.style.display = "block";
        placeholderEl.style.display = "none";
    } else {
        avatarEl.style.display      = "none";
        placeholderEl.style.display = "flex";
    }

    const msgBtn = document.getElementById("profileMessageBtn");
    if (isMe) {
        msgBtn.style.display = "none";
    } else {
        msgBtn.style.display = "inline-flex";
        msgBtn.onclick = () => openDMConvo(username);
    }

    const profileThreadList = document.getElementById("profileThreadList");
    profileThreadList.innerHTML = "";

    const allThreads = [];
    for (const forum of forums) {
        const fSnap = await get(ref(db, `threads/${forum.id}`));
        const fData = fSnap.val() || {};
        Object.entries(fData).forEach(([id, t]) => {
            if (t.author === username) allThreads.push({ ...t, id, forumId: forum.id });
        });
    }

    if (allThreads.length === 0) {
        const p = document.createElement("p");
        p.className  = "empty-msg";
        p.textContent = "No threads yet.";
        profileThreadList.appendChild(p);
    } else {
        allThreads.forEach((t, i) => {
            const div = document.createElement("div");
            div.className    = "forum-card";
            div.style.animationDelay = `${i * 0.08}s`;

            const h3 = document.createElement("h3");
            h3.textContent = t.title;

            const p = document.createElement("p");
            p.textContent = (t.content || "").substring(0, 80) + ((t.content || "").length > 80 ? "..." : "");

            const meta   = document.createElement("div");
            meta.className = "thread-meta";
            const fSpan  = document.createElement("span");
            fSpan.textContent = `/${t.forumId}/`;
            const cSpan  = document.createElement("span");
            cSpan.textContent = `${Object.keys(t.comments || {}).length} comments`;
            meta.appendChild(fSpan);
            meta.appendChild(cSpan);

            div.appendChild(h3);
            div.appendChild(p);
            div.appendChild(meta);
            div.addEventListener("click", () => {
                currentForum = forums.find(f => f.id === t.forumId);
                openThread(t.id, t.forumId);
            });
            profileThreadList.appendChild(div);
        });
    }
}

// ===== CLICKABLE USERNAMES =====
function attachUserClicks(container) {
    container.querySelectorAll(".clickable-user").forEach(el => {
        el.addEventListener("click", () => {
            const u = el.dataset.username;
            if (u) openUserProfile(u);
        });
    });
}

// ===== RENDER FORUMS =====
function renderForums() {
    currentForum = null;
    mainTitle.textContent      = "All Forums";
    newThreadBtn.style.display = "none";

    hideAllViews();
    mainEl.style.display       = "block";
    forumListEl.style.display  = "grid";
    forumListEl.innerHTML      = "";

    forums.forEach((forum, index) => {
        const div = document.createElement("div");
        div.className            = "forum-card";
        div.style.animationDelay = `${index * 0.15}s`;

        const h3 = document.createElement("h3");
        h3.textContent = `/${forum.name}/`;

        const p = document.createElement("p");
        p.textContent = forum.desc;

        const countSpan = document.createElement("span");
        countSpan.className  = "thread-count";
        countSpan.textContent = "loading...";

        div.appendChild(h3);
        div.appendChild(p);
        div.appendChild(countSpan);
        div.addEventListener("click", () => openForum(forum));
        forumListEl.appendChild(div);

        const unsub = onValue(ref(db, `threads/${forum.id}`), snap => {
            const count = snap.exists() ? Object.keys(snap.val()).length : 0;
            countSpan.textContent = `${count} thread${count !== 1 ? "s" : ""}`;
        });
        activeListeners.push(() => unsub());
    });
}

// ===== OPEN FORUM =====
function openForum(forum) {
    currentForum = forum;
    history.pushState({ page: "forum", forumId: forum.id }, "", "#/forum/" + forum.name);
    mainTitle.textContent      = `/${forum.name}/`;
    newThreadBtn.style.display = "inline-flex";

    hideAllViews();
    mainEl.style.display      = "block";
    forumListEl.style.display = "grid";

    renderThreads(forum.id);
}

// ===== RENDER THREADS =====
function renderThreads(forumId) {
    forumListEl.innerHTML = "";

    // FIX: jangan pakai orderByChild("timestamp") karena Firebase skip nodes
    // yang tidak punya field timestamp — thread lama jadi hilang.
    // Ambil semua dulu, sort manual di client side.
    const threadsRef = ref(db, `threads/${forumId}`);
    const unsub = onValue(threadsRef, snap => {
        forumListEl.innerHTML = "";

        if (!snap.exists()) {
            const p = document.createElement("p");
            p.className  = "empty-msg";
            p.textContent = "No threads yet. Be the first to post!";
            forumListEl.appendChild(p);
            return;
        }

        const threadArr = [];
        snap.forEach(child => { threadArr.push({ id: child.key, ...child.val() }); });
        // Sort descending by timestamp, thread tanpa timestamp tetap masuk (ditaruh di akhir)
        threadArr.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        threadArr.forEach((thread, index) => {
            const div = document.createElement("div");
            div.className            = "forum-card";
            div.style.animationDelay = `${index * 0.08}s`;

            const h3 = document.createElement("h3");
            h3.textContent = thread.title;

            const p = document.createElement("p");
            p.textContent = (thread.content || "").substring(0, 80) + ((thread.content || "").length > 80 ? "..." : "");

            const commentCount = thread.comments ? Object.keys(thread.comments).length : 0;
            const meta         = document.createElement("div");
            meta.className     = "thread-meta";

            const bySpan = document.createElement("span");
            bySpan.textContent = "by ";
            const authorB = document.createElement("b");
            authorB.className        = "clickable-user";
            authorB.dataset.username = thread.author;
            authorB.textContent      = thread.author;
            bySpan.appendChild(authorB);

            const cSpan = document.createElement("span");
            cSpan.textContent = `${commentCount} comment${commentCount !== 1 ? "s" : ""}`;

            meta.appendChild(bySpan);
            meta.appendChild(cSpan);
            div.appendChild(h3);
            div.appendChild(p);
            div.appendChild(meta);

            div.addEventListener("click", e => {
                if (e.target.classList.contains("clickable-user")) return;
                openThread(thread.id, forumId);
            });
            attachUserClicks(div);
            forumListEl.appendChild(div);
        });
    });
    activeListeners.push(() => unsub());
}

// ===== OPEN THREAD =====
function openThread(threadId, forumId) {
    const fid       = forumId || currentForum?.id;
    currentThreadId = threadId;
    currentForumId  = fid;

    history.pushState({ page: "thread", threadId, forumId: fid }, "", `#/forum/${fid}/thread/${threadId}`);

    hideAllViews();
    threadViewEl.style.display = "block";
    document.getElementById("commentBar").classList.add("visible");
    newThreadBtn.style.display = "none";

    renderThreadView(threadId, fid);
}

// ===== RENDER THREAD VIEW =====
function renderThreadView(threadId, forumId) {
    const threadContent = document.getElementById("threadPostContent");
    threadContent.innerHTML = "";

    const unsub = onValue(ref(db, `threads/${forumId}/${threadId}`), snap => {
        if (!snap.exists()) return;
        const thread = { id: threadId, ...snap.val() };

        mainTitle.textContent = `/${forumId}/ › ${thread.title}`;
        threadContent.innerHTML = "";

        const dateStr = thread.timestamp
            ? new Date(thread.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
            : "";

        const postDiv  = document.createElement("div");
        postDiv.className = "thread-post";

        const header = document.createElement("div");
        header.className = "post-header";

        const authorSpan = document.createElement("span");
        authorSpan.className        = "post-author clickable-user";
        authorSpan.dataset.username = thread.author;
        authorSpan.textContent      = thread.author;

        const dateSpan = document.createElement("span");
        dateSpan.className  = "post-date";
        dateSpan.textContent = dateStr;

        header.appendChild(authorSpan);
        header.appendChild(dateSpan);

        const titleEl = document.createElement("h2");
        titleEl.className  = "post-title";
        titleEl.textContent = thread.title;

        const bodyEl = document.createElement("div");
        bodyEl.className  = "post-body";
        bodyEl.textContent = thread.content;

        postDiv.appendChild(header);
        postDiv.appendChild(titleEl);
        postDiv.appendChild(bodyEl);

        if (thread.mediaItems && thread.mediaItems.length > 0) {
            const grid = document.createElement("div");
            grid.className = "thread-media-grid";
            thread.mediaItems.forEach(item => {
                if (item.type && item.type.startsWith("video/")) {
                    const vid = document.createElement("video");
                    vid.src       = item.url;
                    vid.controls  = true;
                    vid.className = "thread-media-item";
                    grid.appendChild(vid);
                } else {
                    const img = document.createElement("img");
                    img.src       = item.url;
                    img.className = "thread-media-item";
                    img.alt       = "";
                    grid.appendChild(img);
                }
            });
            postDiv.appendChild(grid);
        }

        if (!thread.mediaItems) {
            if (thread.imageUrl) {
                const img = document.createElement("img");
                img.src       = thread.imageUrl;
                img.className = "thread-media";
                img.alt       = "Thread image";
                postDiv.appendChild(img);
            }
            if (thread.videoUrl) {
                const vid = document.createElement("video");
                vid.src       = thread.videoUrl;
                vid.className = "thread-media";
                vid.controls  = true;
                postDiv.appendChild(vid);
            }
        }

        threadContent.appendChild(postDiv);
        attachUserClicks(threadContent);

        const commentList = document.getElementById("commentList");
        commentList.innerHTML = "";

        const comments = thread.comments
            ? Object.values(thread.comments).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
            : [];

        if (comments.length === 0) {
            const p = document.createElement("p");
            p.className  = "empty-msg";
            p.textContent = "No comments yet.";
            commentList.appendChild(p);
        } else {
            comments.forEach(c => {
                const div = document.createElement("div");
                div.className = "comment-item";

                const cDateStr = c.timestamp
                    ? new Date(c.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                    : "";

                const metaDiv = document.createElement("div");
                metaDiv.className = "comment-meta";

                const aSpan = document.createElement("span");
                aSpan.className = "comment-author clickable-user";
                // FIX: pakai userId buat lookup nama terkini, fallback ke c.author lama
                const cDisplayName = (c.userId && userIdToUsername[c.userId])
                    ? userIdToUsername[c.userId]
                    : c.author;
                aSpan.dataset.username = cDisplayName;
                aSpan.textContent      = cDisplayName;
                if (c.userId) aSpan.dataset.userid = c.userId;

                const dSpan = document.createElement("span");
                dSpan.className  = "comment-date";
                dSpan.textContent = cDateStr;

                metaDiv.appendChild(aSpan);
                metaDiv.appendChild(dSpan);
                div.appendChild(metaDiv);

                if (c.text) {
                    const textP = document.createElement("p");
                    textP.textContent = c.text;
                    div.appendChild(textP);
                }

                if (c.mediaUrl) {
                    const img = document.createElement("img");
                    img.src       = c.mediaUrl;
                    img.className = "comment-media";
                    img.alt       = "image";
                    div.appendChild(img);
                }

                attachUserClicks(div);
                commentList.appendChild(div);
            });
        }
    });
    activeListeners.push(() => unsub());

    const submitBtn  = document.getElementById("submitComment");
    const newSubmit  = submitBtn.cloneNode(true);
    submitBtn.parentNode.replaceChild(newSubmit, submitBtn);

    const fileInput    = document.getElementById("commentFile");
    const newFileInput = fileInput.cloneNode(true);
    fileInput.parentNode.replaceChild(newFileInput, fileInput);

    let pendingCommentFile = null;

    newFileInput.addEventListener("change", e => {
        const file = e.target.files[0];
        if (!file || !file.type.startsWith("image/")) return;
        pendingCommentFile = file;
        const preview    = document.getElementById("commentMediaPreview");
        const previewImg = document.getElementById("commentMediaPreviewImg");
        previewImg.src           = URL.createObjectURL(file);
        preview.style.display   = "flex";
        e.target.value          = "";
    });

    document.getElementById("commentMediaClear").onclick = () => {
        pendingCommentFile                                          = null;
        document.getElementById("commentMediaPreview").style.display = "none";
        document.getElementById("commentMediaPreviewImg").src         = "";
    };

    newSubmit.addEventListener("click", async () => {
        const text = document.getElementById("commentInput").value.trim();
        if (!text && !pendingCommentFile) return;

        let mediaUrl  = null;
        let mediaType = null;

        if (pendingCommentFile) {
            showSendingIndicator(true, "Uploading...");
            try {
                mediaUrl  = await uploadMedia(pendingCommentFile);
                mediaType = pendingCommentFile.type;
            } catch(e) {
                alert("Upload gagal: " + e.message);
                showSendingIndicator(false);
                return;
            }
            showSendingIndicator(false);
            pendingCommentFile                                          = null;
            document.getElementById("commentMediaPreview").style.display = "none";
            document.getElementById("commentMediaPreviewImg").src         = "";
        }

        document.getElementById("commentInput").value = "";

        await push(ref(db, `threads/${forumId}/${threadId}/comments`), {
            userId:    MY_USER_ID,           // FIX: simpan userId supaya nama bisa update realtime
            author:    currentUser.username,
            text:      text || "",
            mediaUrl:  mediaUrl  || null,
            mediaType: mediaType || null,
            timestamp: serverTimestamp()
        });
    });
}

// ===== SIDEBAR =====
const menuBtn = document.getElementById("menuBtn");
const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("overlay");

function closeSidebarFn() {
    sidebar.classList.remove("active");
    overlay.classList.remove("active");
}

menuBtn.addEventListener("click", () => {
    sidebar.classList.add("active");
    overlay.classList.add("active");
});

document.getElementById("closeSidebar").addEventListener("click", closeSidebarFn);

overlay.addEventListener("click", () => {
    closeSidebarFn();
    document.querySelectorAll(".modal").forEach(m => m.classList.remove("active"));
});

document.getElementById("navHome").addEventListener("click", e => {
    e.preventDefault();
    closeSidebarFn();
    history.pushState({ page: "home" }, "", "#/");
    renderForums();
});

document.getElementById("navGlobalChat").addEventListener("click", e => {
    e.preventDefault();
    openGlobalChat();
});

document.getElementById("navDMs").addEventListener("click", e => {
    e.preventDefault();
    openDMList();
});

document.getElementById("navSettings").addEventListener("click", e => {
    e.preventDefault();
    closeSidebarFn();
    openProfile();
});

// ===== BACK BUTTON =====
window.addEventListener("popstate", e => {
    if (!e.state || e.state.page === "home") {
        renderForums();
    } else if (e.state.page === "forum") {
        const forum = forums.find(f => f.id === e.state.forumId);
        if (forum) openForum(forum);
    } else if (e.state.page === "thread") {
        const forum = forums.find(f => f.id === e.state.forumId);
        if (forum) {
            currentForum = forum;
            openThread(e.state.threadId, e.state.forumId);
        }
    }
});

// ===== NEW THREAD =====
const newThreadModal  = document.getElementById("newThreadModal");
const cancelThreadBtn = document.getElementById("cancelThreadBtn");
const saveThreadBtn   = document.getElementById("saveThreadBtn");

newThreadBtn.addEventListener("click", () => {
    document.getElementById("threadTitleInput").value = "";
    document.getElementById("threadBodyInput").value  = "";
    document.getElementById("threadMediaInput").value = "";
    threadPendingFiles = [];
    renderThreadMediaPreview();
    newThreadModal.classList.add("active");
});

cancelThreadBtn.addEventListener("click", () => newThreadModal.classList.remove("active"));

let threadPendingFiles = [];

function renderThreadMediaPreview() {
    const preview = document.getElementById("threadMediaPreview");
    const countEl = document.getElementById("threadMediaCount");
    preview.innerHTML    = "";
    countEl.textContent  = `${threadPendingFiles.length} / 3`;
    if (threadPendingFiles.length === 0) return;

    threadPendingFiles.forEach((file, idx) => {
        const item = document.createElement("div");
        item.className = "thread-preview-item";

        if (file.type.startsWith("video/")) {
            const vid = document.createElement("video");
            vid.src      = URL.createObjectURL(file);
            vid.controls = true;
            item.appendChild(vid);
        } else {
            const img = document.createElement("img");
            img.src = URL.createObjectURL(file);
            item.appendChild(img);
        }

        const rm = document.createElement("button");
        rm.className  = "thread-preview-remove";
        rm.textContent = "✕";
        rm.onclick = () => {
            threadPendingFiles.splice(idx, 1);
            renderThreadMediaPreview();
        };
        item.appendChild(rm);
        preview.appendChild(item);
    });
}

document.getElementById("threadMediaInput").addEventListener("change", e => {
    const files     = Array.from(e.target.files);
    const remaining = 3 - threadPendingFiles.length;
    if (remaining <= 0) { alert("Maksimal 3 media."); e.target.value = ""; return; }

    const toAdd = files.slice(0, remaining);
    if (files.length > remaining) alert(`Hanya ${remaining} file lagi yang bisa ditambah. Sisanya diabaikan.`);

    threadPendingFiles = [...threadPendingFiles, ...toAdd];
    e.target.value     = "";
    renderThreadMediaPreview();
});

saveThreadBtn.addEventListener("click", async () => {
    const title   = document.getElementById("threadTitleInput").value.trim();
    const content = document.getElementById("threadBodyInput").value.trim();

    if (!title || !content) { alert("Title and content are required."); return; }

    const mediaItems = [];
    if (threadPendingFiles.length > 0) {
        for (const file of threadPendingFiles) {
            const isVideo = file.type.startsWith("video/");
            showSendingIndicator(true, isVideo ? "Compressing video..." : "Uploading...");
            try {
                const url = await uploadMedia(file);
                mediaItems.push({ url, type: isVideo ? "video/mp4" : file.type });
            } catch(e) {
                alert("Upload gagal: " + e.message);
                showSendingIndicator(false);
                return;
            }
        }
        showSendingIndicator(false);
    }

    await push(ref(db, `threads/${currentForum.id}`), {
        forumId:    currentForum.id,
        title,
        content,
        author:     currentUser.username,
        mediaItems: mediaItems.length > 0 ? mediaItems : null,
        imageUrl:   null,
        videoUrl:   null,
        timestamp:  serverTimestamp(),
        comments:   {}
    });

    threadPendingFiles = [];
    renderThreadMediaPreview();
    newThreadModal.classList.remove("active");
});

// ===== PROFILE =====
const profileModal     = document.getElementById("profileModal");
const userBtn          = document.getElementById("userBtn");
const cancelProfileBtn = document.getElementById("cancelProfileBtn");
const saveProfileBtn   = document.getElementById("saveProfileBtn");
const avatarInput      = document.getElementById("avatarInput");

function renderUser() {
    document.getElementById("username").textContent = currentUser.username;
}

function openProfile() {
    document.getElementById("editUsername").value = currentUser.username;
    document.getElementById("editBio").value      = currentUser.bio;
    profileModal.classList.add("active");
}

userBtn.addEventListener("click", openProfile);
cancelProfileBtn.addEventListener("click", () => profileModal.classList.remove("active"));

saveProfileBtn.addEventListener("click", async () => {
    const newName = document.getElementById("editUsername").value.trim();
    const newBio  = document.getElementById("editBio").value.trim();
    if (!newName) { alert("Username required"); return; }

    const oldName = currentUser.username;

    if (newName !== oldName) {
        const existing = await get(ref(db, `profiles/${newName}`));
        if (existing.exists()) {
            const existingUserId = existing.val().userId;
            if (!existingUserId || existingUserId !== MY_USER_ID) {
                alert(`Username "@${newName}" sudah dipakai. Coba username lain.`);
                return;
            }
        }
    }

    if (newName !== oldName) {
        await set(ref(db, `presence/${oldName}`), { online: false, last: serverTimestamp() });
    }

    currentUser.username = newName;
    currentUser.bio      = newBio;
    localStorage.setItem("user", JSON.stringify(currentUser));

    if (newName !== oldName) {
        await remove(ref(db, `profiles/${oldName}`));
    }

    await set(ref(db, `profiles/${newName}`), {
        username: newName,
        bio:      newBio,
        avatar:   currentUser.avatar || null,
        userId:   MY_USER_ID
    });

    await set(ref(db, `userIds/${MY_USER_ID}`), newName);
    await heartbeat();
    renderUser();
    profileModal.classList.remove("active");
});

avatarInput.addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file || !file.type.startsWith("image/")) return;

    showSendingIndicator(true, "Uploading avatar...");
    try {
        const url = await uploadMedia(file);
        currentUser.avatar = url;
        localStorage.setItem("user", JSON.stringify(currentUser));
        await update(ref(db, `profiles/${currentUser.username}`), { avatar: url });
    } catch(err) {
        alert("Avatar upload failed.");
    }
    showSendingIndicator(false);
});

// ===== INIT =====
set(ref(db, `profiles/${currentUser.username}`), {
    username: currentUser.username,
    bio:      currentUser.bio || "No bio yet.",
    avatar:   currentUser.avatar || null
});

listenOnlineUsers();
listenUserIdMap();
listenGlobalBadge();
listenDMBadge();

set(ref(db, `userIds/${MY_USER_ID}`), currentUser.username);

history.replaceState({ page: "home" }, "", "#/");
renderUser();
renderForums();
