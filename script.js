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

// ===== MEDIA UPLOAD =====
const MAX_VIDEO_BYTES = 28 * 1024 * 1024; // 28MB

async function uploadMedia(file) {
    console.log("Uploading file:", file.name, "Size:", file.size, "Type:", file.type); // Debug log
    
    if (file.type.startsWith("video/") && file.size > MAX_VIDEO_BYTES) {
        throw new Error(`Video terlalu besar (${(file.size/1024/1024).toFixed(1)}MB). Maksimal 28MB.`);
    }

    try {
        console.log("Trying Yupra upload...");
        const url = await uploadToYupra(file);
        console.log("Yupra upload success:", url);
        return url;
    } catch(e) {
        console.warn("Yupra failed, trying pomf:", e.message);
        try {
            const url = await uploadToPomf(file);
            console.log("Pomf upload success:", url);
            return url;
        } catch(e2) {
            console.error("Both upload services failed:", e.message, e2.message);
            throw new Error("Upload gagal ke semua service. Coba lagi nanti.");
        }
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

    if (!res.ok) {
        throw new Error(`Yupra HTTP error: ${res.status} ${res.statusText}`);
    }

    const text = await res.text();
    console.log("Yupra response:", text.substring(0, 200)); // Debug log
    
    let data;
    try { data = JSON.parse(text); }
    catch(e) { 
        console.error("Yupra JSON parse error:", text.slice(0, 200));
        throw new Error("Yupra response invalid: " + text.slice(0, 80)); 
    }

    if (!data.success || !data.files || data.files.length === 0) {
        throw new Error(data.message || "Yupra upload failed");
    }
    
    const url = "https://cdn.yupra.my.id" + data.files[0].url;
    console.log("Yupra final URL:", url);
    return url;
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

    if (!res.ok) {
        throw new Error(`Pomf HTTP error: ${res.status} ${res.statusText}`);
    }

    const text = await res.text();
    console.log("Pomf response:", text.substring(0, 200)); // Debug log
    
    let data;
    try { data = JSON.parse(text); }
    catch(e) { 
        console.error("Pomf JSON parse error:", text.slice(0, 200));
        throw new Error("Pomf response invalid: " + text.slice(0, 80)); 
    }

    if (!data.success || !data.files || data.files.length === 0) {
        throw new Error("Pomf upload failed: " + text.slice(0, 80));
    }
    
    const url = "https://pomf2.lain.la" + data.files[0].url;
    console.log("Pomf final URL:", url);
    return url;
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
        console.log("Media URL:", m.mediaUrl, "Type:", m.mediaType); // Debug log
        
        // Deteksi video dari mediaType ATAU ekstensi URL
        const isVideo = (typeof m.mediaType === "string" && m.mediaType.startsWith("video/"))
            || /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(m.mediaUrl);
        const isImage = !isVideo && (
            (typeof m.mediaType === "string" && m.mediaType.startsWith("image/"))
            || /\.(jpg|jpeg|png|gif|webp|bmp)(\?|$)/i.test(m.mediaUrl)
            || typeof m.mediaType !== "string"
        );
        
        if (isVideo) {
            const vid = document.createElement("video");
            vid.className = "chat-media";
            vid.controls  = true;
            vid.src       = m.mediaUrl;
            vid.onerror = () => {
                console.error("Video failed to load:", m.mediaUrl);
                const errorDiv = document.createElement("div");
                errorDiv.className = "chat-text";
                errorDiv.textContent = "⚠️ Video gagal dimuat";
                errorDiv.style.color = "#ff5555";
                wrapper.appendChild(errorDiv);
            };
            wrapper.appendChild(vid);
        } else if (isImage) {
            const img = document.createElement("img");
            img.className = "chat-media";
            img.alt       = "image";
            img.src       = m.mediaUrl;
            img.onerror = () => {
                console.error("Image failed to load:", m.mediaUrl);
                img.style.display = "none";
                const errorDiv = document.createElement("div");
                errorDiv.className = "chat-text";
                errorDiv.textContent = "⚠️ Image gagal dimuat: " + m.mediaUrl.substring(0, 50) + "...";
                errorDiv.style.color = "#ff5555";
                errorDiv.style.fontSize = "11px";
                wrapper.appendChild(errorDiv);
            };
            img.onload = () => {
                console.log("Image loaded successfully:", m.mediaUrl);
            };
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
        showSendingIndicator(true, "Uploading...");
        try {
            mediaUrl  = await uploadMedia(file);
            mediaType = file.type || null;
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
        showSendingIndicator(true, "Uploading...");
        try {
            mediaUrl  = await uploadMedia(file);
            mediaType = file.type || null;
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

        // Pakai get() + timeout fallback supaya ga stuck di browser yg blokir WebSocket
        const timeout = setTimeout(() => {
            if (countSpan.textContent === "loading...") countSpan.textContent = "–";
        }, 5000);

        get(ref(db, `threads/${forum.id}`)).then(snap => {
            clearTimeout(timeout);
            const count = snap.exists() ? Object.keys(snap.val()).length : 0;
            countSpan.textContent = `${count} thread${count !== 1 ? "s" : ""}`;
        }).catch(() => {
            clearTimeout(timeout);
            countSpan.textContent = "–";
        });
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
                console.log("Thread media item:", item.url, "Type:", item.type); // Debug log
                
                const isVideo = (typeof item.type === "string" && item.type.startsWith("video/"))
                    || /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(item.url || "");
                if (isVideo) {
                    const vid = document.createElement("video");
                    vid.src       = item.url;
                    vid.controls  = true;
                    vid.className = "thread-media-item";
                    vid.onerror = () => {
                        console.error("Video failed to load:", item.url);
                        vid.style.display = "none";
                    };
                    grid.appendChild(vid);
                } else {
                    const img = document.createElement("img");
                    img.src       = item.url;
                    img.className = "thread-media-item";
                    img.alt       = "";
                    img.onerror = () => {
                        console.error("Image failed to load:", item.url);
                        img.style.display = "none";
                    };
                    img.onload = () => {
                        console.log("Thread image loaded successfully:", item.url);
                    };
                    grid.appendChild(img);
                }
            });
            postDiv.appendChild(grid);
        }

        // Support for legacy single imageUrl/videoUrl fields
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
                    const isVideo = (typeof c.mediaType === "string" && c.mediaType.startsWith("video/"))
                        || /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(c.mediaUrl || "");
                    if (isVideo) {
                        const vid = document.createElement("video");
                        vid.src       = c.mediaUrl;
                        vid.controls  = true;
                        vid.className = "comment-media";
                        div.appendChild(vid);
                    } else {
                        const img = document.createElement("img");
                        img.src       = c.mediaUrl;
                        img.className = "comment-media";
                        img.alt       = "image";
                        div.appendChild(img);
                    }
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
            userId:    MY_USER_ID,
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
            showSendingIndicator(true, "Uploading...");
            try {
                const url = await uploadMedia(file);
                mediaItems.push({ url, type: file.type || null });
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
