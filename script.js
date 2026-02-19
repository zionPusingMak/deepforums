// ===== FIREBASE SETUP =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, push, set, onValue, onChildAdded, serverTimestamp, get, update, remove, query, orderByChild, limitToLast } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

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
async function uploadMedia(file) {
    const formData = new FormData();
    formData.append("files", file);

    const res = await fetch("https://cdn.yupra.my.id/upload", {
        method: "POST",
        body: formData
    });

    const data = await res.json();
    if (!data.success || !data.files || data.files.length === 0) {
        throw new Error("Upload ke CDN gagal");
    }
    return "https://cdn.yupra.my.id" + data.files[0].url;
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

let currentForum   = null;
let currentDMUser  = null;
let currentThreadId = null;
let currentForumId  = null;

// Active Firebase listeners — unsubscribe on view change
let activeListeners = [];

function clearListeners() {
    activeListeners.forEach(fn => fn());
    activeListeners = [];
}

// ===== NOTIFICATION BADGES =====
// Konsep: HANYA tampilkan badge kalau ada pesan BARU dari orang lain
// yang dateng setelah kita terakhir buka channel tersebut.
// "Terakhir buka" disimpan sebagai server timestamp snapshot key —
// kita catat Firebase key terakhir yang ada saat kita buka/tutup channel.
// Dengan ini: ganti username pun ga pengaruh (pakai userId, bukan username).

// In-memory badge counters (reset tiap reload — sama kayak WA/TG)
const _badgeCount = { global: 0, dm: 0 };

// Catat Firebase key terakhir per channel saat dibuka
// Format: { global: "-NxyzLastKey", dm_ali: "-NabcLastKey" }
const _lastReadKey = JSON.parse(sessionStorage.getItem("lastReadKey") || "{}");

function _saveLastReadKey() {
    sessionStorage.setItem("lastReadKey", JSON.stringify(_lastReadKey));
}

function showBadge(target, count) {
    // target: "global" | "dm"
    const id = target === "global" ? "navGlobalChat" : "navDMs";
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

// Dipanggil saat buka Global Chat → catat key terakhir, reset badge
function markGlobalRead() {
    _badgeCount.global = 0;
    showBadge("global", 0);
    // Catat key terakhir yang ada sekarang
    get(query(ref(db, "global_chat"), orderByChild("timestamp"), limitToLast(1))).then(snap => {
        snap.forEach(child => { _lastReadKey["global"] = child.key; });
        _saveLastReadKey();
    });
}

// Dipanggil saat buka DM convo → reset badge untuk DM itu
function markDMRead(otherUsername) {
    const dmKey = getDMKey(currentUser.username, otherUsername);
    get(query(ref(db, `dms/${dmKey}`), orderByChild("timestamp"), limitToLast(1))).then(snap => {
        snap.forEach(child => { _lastReadKey[`dm_${otherUsername}`] = child.key; });
        _saveLastReadKey();
    });
    // Recalculate total DM badge (subtract this convo's unread)
    _recalcDMBadge();
}

function _recalcDMBadge() {
    // Hitung ulang dari in-memory state
    // Ini dipanggil setelah markDMRead — badge akan berkurang
    // Actual count dikelola oleh listenDMBadge onChildAdded
    // Di sini kita cukup hide badge kalau _badgeCount.dm <= 0
    if (_badgeCount.dm <= 0) {
        _badgeCount.dm = 0;
        showBadge("dm", 0);
    }
}

// Listen global chat — HANYA hitung pesan yang dateng SETELAH lastReadKey
function listenGlobalBadge() {
    // Ambil dulu key terakhir yang ada saat ini (baseline), baru pasang listener
    get(query(ref(db, "global_chat"), orderByChild("timestamp"), limitToLast(1))).then(snap => {
        // Kalau belum pernah buka global chat, set baseline = key terakhir sekarang
        if (!_lastReadKey["global"]) {
            snap.forEach(child => { _lastReadKey["global"] = child.key; });
            _saveLastReadKey();
        }

        // Sekarang listen untuk pesan BARU saja (onChildAdded akan fire existing dulu,
        // lalu fire lagi tiap ada yang baru)
        const chatRef = query(ref(db, "global_chat"), orderByChild("timestamp"), limitToLast(200));
        let initialLoadDone = false;
        let initialKeys = new Set();

        onChildAdded(chatRef, (child) => {
            if (!initialLoadDone) {
                // Semua yang dateng sebelum initialLoadDone = existing data, skip
                initialKeys.add(child.key);
                return;
            }
            // Pesan baru yang beneran baru dateng
            const m = child.val();
            if (m.userId === MY_USER_ID) return; // pesan sendiri, skip
            if (child.key === _lastReadKey["global"]) return; // sudah dibaca

            // Kalau global chat sedang dibuka, jangan tambah badge
            if (document.getElementById("globalChatView").style.display !== "none") {
                markGlobalRead();
                return;
            }

            _badgeCount.global++;
            showBadge("global", _badgeCount.global);
        });

        // Tandai initial load selesai setelah microtask queue kosong
        setTimeout(() => { initialLoadDone = true; }, 0);
    });
}

// Listen DM — hanya hitung pesan baru dari orang lain
function listenDMBadge() {
    const dmsRef = ref(db, "dms");
    // Track initialLoad per DM room
    const initialDone = {};

    onValue(dmsRef, snap => {
        // Kalau ada room DM baru yang melibatkan kita, pasang listener
        const data = snap.val() || {};
        Object.keys(data).forEach(roomKey => {
            if (initialDone[roomKey] !== undefined) return; // sudah dipasang
            const parts = roomKey.split("__");
            if (!parts.includes(currentUser.username)) return;

            const other = parts.find(u => u !== currentUser.username);
            initialDone[roomKey] = false;

            const roomRef = query(ref(db, `dms/${roomKey}`), orderByChild("timestamp"), limitToLast(200));

            onChildAdded(roomRef, (child) => {
                if (!initialDone[roomKey]) return; // skip existing messages

                const m = child.val();
                // Skip pesan sendiri
                if (m.userId === MY_USER_ID) return;
                if (!m.userId && m.author === currentUser.username) return;

                // Kalau DM dengan orang ini sedang dibuka, jangan badge
                if (currentDMUser === other &&
                    document.getElementById("dmConvoView").style.display !== "none") {
                    markDMRead(other);
                    return;
                }

                _badgeCount.dm++;
                showBadge("dm", _badgeCount.dm);
            });

            setTimeout(() => { initialDone[roomKey] = true; }, 0);
        });
    });
}

// ===== ONLINE PRESENCE =====
// FIX: Use dynamic function so rename updates presence correctly
function getPresenceRef() {
    return ref(db, `presence/${currentUser.username}`);
}

async function heartbeat() {
    await set(getPresenceRef(), { online: true, last: serverTimestamp() });
}

function listenOnlineUsers() {
    const onlineRef = ref(db, "presence");
    const unsub = onValue(onlineRef, snap => {
        const data = snap.val() || {};
        const now = Date.now();
        const users = Object.entries(data)
            .filter(([, v]) => v.online && (now - (v.last || 0) < 60000))
            .map(([u]) => u);

        document.getElementById("onlineCount").textContent = users.length;
        const list = document.getElementById("onlineList");
        list.innerHTML = "";
        users.forEach(u => {
            const div = document.createElement("div");
            div.className = "online-user";

            const dot = document.createElement("span");
            dot.className = "online-dot";

            const name = document.createElement("span");
            name.className = "online-name";
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

// ===== SHARED CHAT MESSAGE ELEMENT BUILDER =====
function buildChatMsgEl(m, showClickableAuthor) {
    const isMe = m.userId === MY_USER_ID;
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
    if (m.userId) authorSpan.dataset.userid = m.userId;
    if (showClickableAuthor) authorSpan.dataset.username = displayName;

    const timeSpan = document.createElement("span");
    timeSpan.className = "chat-time";
    timeSpan.textContent = dateStr;

    meta.appendChild(authorSpan);
    meta.appendChild(timeSpan);
    wrapper.appendChild(meta);

    if (m.text) {
        const textDiv = document.createElement("div");
        textDiv.className = "chat-text";
        textDiv.textContent = m.text;
        wrapper.appendChild(textDiv);
    }

    if (m.mediaUrl) {
        const safeType = (typeof m.mediaType === "string") ? m.mediaType.split("/")[0] : "";
        if (safeType === "video") {
            const vid = document.createElement("video");
            vid.className = "chat-media";
            vid.controls = true;
            vid.src = m.mediaUrl;
            wrapper.appendChild(vid);
        } else if (safeType === "image") {
            const img = document.createElement("img");
            img.className = "chat-media";
            img.alt = "image";
            img.src = m.mediaUrl;
            wrapper.appendChild(img);
        }
    }

    return wrapper;
}

// ===== GLOBAL CHAT =====
function openGlobalChat() {
    hideAllViews();
    document.getElementById("globalChatView").style.display = "flex";
    mainTitle.textContent = "# global-chat";
    newThreadBtn.style.display = "none";
    closeSidebarFn();

    // Mark as read
    markGlobalRead();

    const container = document.getElementById("globalChatMessages");
    container.innerHTML = "";

    const chatRef = query(ref(db, "global_chat"), orderByChild("timestamp"), limitToLast(100));

    const unsub = onChildAdded(chatRef, snap => {
        const m = snap.val();
        const el = buildChatMsgEl(m, true);
        container.appendChild(el);
        attachUserClicks(el);
        container.scrollTop = container.scrollHeight;
        // Badge is handled by listenGlobalBadge
    });

    activeListeners.push(() => unsub());
}

async function sendGlobalMessage(text, file) {
    let mediaUrl = null;
    let mediaType = null;

    if (file) {
        showSendingIndicator(true);
        try {
            mediaUrl = await uploadMedia(file);
            mediaType = file.type;
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
        text: text || "",
        mediaUrl,
        mediaType,
        timestamp: serverTimestamp()
    });
}

document.getElementById("globalChatSend").addEventListener("click", async () => {
    const input = document.getElementById("globalChatInput");
    const text = input.value.trim();
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
    mainTitle.textContent = "✉ Messages";
    newThreadBtn.style.display = "none";
    closeSidebarFn();

    const list = document.getElementById("dmList");
    list.innerHTML = "";

    const dmsRef = ref(db, "dms");
    const unsub = onValue(dmsRef, snap => {
        const data = snap.val() || {};
        list.innerHTML = "";

        const myConvos = Object.entries(data)
            .filter(([key]) => key.includes(currentUser.username))
            .map(([key, msgs]) => {
                const other = key.split("__").find(u => u !== currentUser.username);
                const msgArr = Object.values(msgs || {});
                const last = msgArr.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).pop();
                // Unread count: shown in badge on nav, not per-item here
                const unread = 0;
                return { other, last, key, unread };
            })
            .sort((a, b) => (b.last?.timestamp || 0) - (a.last?.timestamp || 0));

        if (myConvos.length === 0) {
            const p = document.createElement("p");
            p.className = "empty-msg";
            p.textContent = "No messages yet. Click a user's name to start a conversation.";
            list.appendChild(p);
            return;
        }

        myConvos.forEach(c => {
            const div = document.createElement("div");
            div.className = "dm-item";

            const nameDiv = document.createElement("div");
            nameDiv.className = "dm-item-name";

            const nameText = document.createTextNode(c.other);
            nameDiv.appendChild(nameText);

            // Unread badge on DM item
            if (c.unread > 0) {
                const badge = document.createElement("span");
                badge.className = "dm-item-badge";
                badge.textContent = c.unread > 99 ? "99+" : c.unread;
                nameDiv.appendChild(badge);
            }

            const previewDiv = document.createElement("div");
            previewDiv.className = "dm-item-preview";
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
    document.getElementById("dmConvoView").style.display = "flex";
    document.getElementById("dmConvoName").textContent = username;
    mainTitle.textContent = `✉ ${username}`;
    newThreadBtn.style.display = "none";

    // Mark this DM as read
    markDMRead(username);

    const container = document.getElementById("dmMessages");
    container.innerHTML = "";

    const key = getDMKey(currentUser.username, username);
    const dmRef = query(ref(db, `dms/${key}`), orderByChild("timestamp"), limitToLast(100));

    const unsub = onChildAdded(dmRef, snap => {
        const m = snap.val();
        const el = buildChatMsgEl(m, false);
        container.appendChild(el);
        container.scrollTop = container.scrollHeight;
        // Badge cleared by listenDMBadge when convo is open
    });

    activeListeners.push(() => unsub());
}

async function sendDMMessage(text, file) {
    if (!currentDMUser) return;
    let mediaUrl = null;
    let mediaType = null;

    if (file) {
        showSendingIndicator(true);
        try {
            mediaUrl = await uploadMedia(file);
            mediaType = file.type;
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
        text: text || "",
        mediaUrl,
        mediaType,
        timestamp: serverTimestamp()
    });
}

document.getElementById("dmSend").addEventListener("click", async () => {
    const input = document.getElementById("dmInput");
    const text = input.value.trim();
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
    mainTitle.textContent = `@${username}`;
    newThreadBtn.style.display = "none";
    closeSidebarFn();

    const profileSnap = await get(ref(db, `profiles/${username}`));
    const profile = profileSnap.val() || { username, bio: "No bio yet.", avatar: null };
    const isMe = username === currentUser.username;
    const displayProfile = isMe ? currentUser : profile;

    document.getElementById("profileUsername").textContent = displayProfile.username;
    document.getElementById("profileBio").textContent = displayProfile.bio || "No bio yet.";

    const avatarEl = document.getElementById("profileAvatar");
    const placeholderEl = document.getElementById("profileAvatarPlaceholder");
    placeholderEl.textContent = displayProfile.username.charAt(0).toUpperCase();

    if (displayProfile.avatar) {
        avatarEl.src = displayProfile.avatar;
        avatarEl.style.display = "block";
        placeholderEl.style.display = "none";
    } else {
        avatarEl.style.display = "none";
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
        p.className = "empty-msg";
        p.textContent = "No threads yet.";
        profileThreadList.appendChild(p);
    } else {
        allThreads.forEach((t, i) => {
            const div = document.createElement("div");
            div.className = "forum-card";
            div.style.animationDelay = `${i * 0.08}s`;

            const h3 = document.createElement("h3");
            h3.textContent = t.title;

            const p = document.createElement("p");
            p.textContent = (t.content || "").substring(0, 80) + ((t.content || "").length > 80 ? "..." : "");

            const meta = document.createElement("div");
            meta.className = "thread-meta";

            const fSpan = document.createElement("span");
            fSpan.textContent = `/${t.forumId}/`;

            const cSpan = document.createElement("span");
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
    mainTitle.textContent = "All Forums";
    newThreadBtn.style.display = "none";

    hideAllViews();
    mainEl.style.display = "block";
    forumListEl.style.display = "grid";
    forumListEl.innerHTML = "";

    forums.forEach((forum, index) => {
        const div = document.createElement("div");
        div.className = "forum-card";
        div.style.animationDelay = `${index * 0.15}s`;

        const h3 = document.createElement("h3");
        h3.textContent = `/${forum.name}/`;

        const p = document.createElement("p");
        p.textContent = forum.desc;

        const countSpan = document.createElement("span");
        countSpan.className = "thread-count";
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
    mainTitle.textContent = `/${forum.name}/`;
    newThreadBtn.style.display = "inline-flex";

    hideAllViews();
    mainEl.style.display = "block";
    forumListEl.style.display = "grid";

    renderThreads(forum.id);
}

// ===== RENDER THREADS =====
function renderThreads(forumId) {
    forumListEl.innerHTML = "";

    const threadsRef = query(ref(db, `threads/${forumId}`), orderByChild("timestamp"));

    const unsub = onValue(threadsRef, snap => {
        forumListEl.innerHTML = "";

        if (!snap.exists()) {
            const p = document.createElement("p");
            p.className = "empty-msg";
            p.textContent = "No threads yet. Be the first to post!";
            forumListEl.appendChild(p);
            return;
        }

        const threadArr = [];
        snap.forEach(child => {
            threadArr.unshift({ id: child.key, ...child.val() });
        });

        threadArr.forEach((thread, index) => {
            const div = document.createElement("div");
            div.className = "forum-card";
            div.style.animationDelay = `${index * 0.08}s`;

            const h3 = document.createElement("h3");
            h3.textContent = thread.title;

            const p = document.createElement("p");
            p.textContent = (thread.content || "").substring(0, 80) + ((thread.content || "").length > 80 ? "..." : "");

            const commentCount = thread.comments ? Object.keys(thread.comments).length : 0;
            const meta = document.createElement("div");
            meta.className = "thread-meta";

            const bySpan = document.createElement("span");
            bySpan.textContent = "by ";

            const authorB = document.createElement("b");
            authorB.className = "clickable-user";
            authorB.dataset.username = thread.author;
            authorB.textContent = thread.author;
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
    const fid = forumId || currentForum?.id;
    currentThreadId = threadId;
    currentForumId = fid;

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

        const postDiv = document.createElement("div");
        postDiv.className = "thread-post";

        const header = document.createElement("div");
        header.className = "post-header";

        const authorSpan = document.createElement("span");
        authorSpan.className = "post-author clickable-user";
        authorSpan.dataset.username = thread.author;
        authorSpan.textContent = thread.author;

        const dateSpan = document.createElement("span");
        dateSpan.className = "post-date";
        dateSpan.textContent = dateStr;

        header.appendChild(authorSpan);
        header.appendChild(dateSpan);

        const titleEl = document.createElement("h2");
        titleEl.className = "post-title";
        titleEl.textContent = thread.title;

        const bodyEl = document.createElement("div");
        bodyEl.className = "post-body";
        bodyEl.textContent = thread.content;

        postDiv.appendChild(header);
        postDiv.appendChild(titleEl);
        postDiv.appendChild(bodyEl);

        if (thread.imageUrl) {
            const img = document.createElement("img");
            img.src = thread.imageUrl;
            img.className = "thread-media";
            img.alt = "Thread image";
            postDiv.appendChild(img);
        }

        if (thread.video) {
            const embedUrl = convertVideoUrl(thread.video);
            if (embedUrl) {
                const iframe = document.createElement("iframe");
                iframe.src = embedUrl;
                iframe.className = "thread-media video-embed";
                iframe.frameBorder = "0";
                iframe.allowFullscreen = true;
                postDiv.appendChild(iframe);
            }
        }

        threadContent.appendChild(postDiv);
        attachUserClicks(threadContent);

        const commentList = document.getElementById("commentList");
        commentList.innerHTML = "";

        const comments = thread.comments ? Object.values(thread.comments).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)) : [];

        if (comments.length === 0) {
            const p = document.createElement("p");
            p.className = "empty-msg";
            p.textContent = "No comments yet.";
            commentList.appendChild(p);
        } else {
            comments.forEach(c => {
                const div = document.createElement("div");
                div.className = "comment-item";

                const dateStr = c.timestamp
                    ? new Date(c.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                    : "";

                const metaDiv = document.createElement("div");
                metaDiv.className = "comment-meta";

                const aSpan = document.createElement("span");
                aSpan.className = "comment-author clickable-user";
                aSpan.dataset.username = c.author;
                aSpan.textContent = c.author;

                const dSpan = document.createElement("span");
                dSpan.className = "comment-date";
                dSpan.textContent = dateStr;

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
                    img.src = c.mediaUrl;
                    img.className = "comment-media";
                    img.alt = "image";
                    div.appendChild(img);
                }

                attachUserClicks(div);
                commentList.appendChild(div);
            });
        }
    });

    activeListeners.push(() => unsub());

    // Re-wire submit button (clone to remove old listeners)
    const submitBtn = document.getElementById("submitComment");
    const newSubmit = submitBtn.cloneNode(true);
    submitBtn.parentNode.replaceChild(newSubmit, submitBtn);

    // Re-wire file input (clone to remove old listeners)
    const fileInput = document.getElementById("commentFile");
    const newFileInput = fileInput.cloneNode(true);
    fileInput.parentNode.replaceChild(newFileInput, fileInput);
    // Re-attach label's for target still works since id stays the same

    // Pending media for current comment
    let pendingCommentFile = null;

    newFileInput.addEventListener("change", e => {
        const file = e.target.files[0];
        if (!file || !file.type.startsWith("image/")) return;
        pendingCommentFile = file;

        // Show preview
        const preview = document.getElementById("commentMediaPreview");
        const previewImg = document.getElementById("commentMediaPreviewImg");
        previewImg.src = URL.createObjectURL(file);
        preview.style.display = "flex";
        e.target.value = "";
    });

    document.getElementById("commentMediaClear").onclick = () => {
        pendingCommentFile = null;
        document.getElementById("commentMediaPreview").style.display = "none";
        document.getElementById("commentMediaPreviewImg").src = "";
    };

    newSubmit.addEventListener("click", async () => {
        const text = document.getElementById("commentInput").value.trim();
        if (!text && !pendingCommentFile) return;

        let mediaUrl = null;
        let mediaType = null;

        if (pendingCommentFile) {
            showSendingIndicator(true);
            try {
                mediaUrl = await uploadMedia(pendingCommentFile);
                mediaType = pendingCommentFile.type;
            } catch(e) {
                alert("Upload gagal: " + e.message);
                showSendingIndicator(false);
                return;
            }
            showSendingIndicator(false);
            // Clear preview
            pendingCommentFile = null;
            document.getElementById("commentMediaPreview").style.display = "none";
            document.getElementById("commentMediaPreviewImg").src = "";
        }

        document.getElementById("commentInput").value = "";

        await push(ref(db, `threads/${forumId}/${threadId}/comments`), {
            author: currentUser.username,
            text: text || "",
            mediaUrl: mediaUrl || null,
            mediaType: mediaType || null,
            timestamp: serverTimestamp()
        });
    });
}

// ===== VIDEO URL CONVERTER =====
function convertVideoUrl(url) {
    try {
        const u = new URL(url);
        if (u.protocol !== "https:") return null;
        if (u.hostname.includes("youtube.com") || u.hostname.includes("youtu.be")) {
            const vid = u.searchParams.get("v") || u.pathname.split("/").pop();
            if (!/^[\w-]{5,20}$/.test(vid)) return null;
            return `https://www.youtube.com/embed/${vid}`;
        }
        return null;
    } catch { return null; }
}

// ===== SENDING INDICATOR =====
function showSendingIndicator(show) {
    let el = document.getElementById("sendingIndicator");
    if (!el) {
        el = document.createElement("div");
        el.id = "sendingIndicator";
        el.textContent = "Uploading...";
        el.style.cssText = "position:fixed;bottom:70px;right:20px;background:#1e1e1e;border:1px solid #2a2a2a;color:#777;padding:6px 14px;border-radius:20px;font-size:12px;font-family:JetBrains Mono,monospace;z-index:999;";
        document.body.appendChild(el);
    }
    el.style.display = show ? "block" : "none";
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
    document.getElementById("threadBodyInput").value = "";
    document.getElementById("threadImageInput").value = "";
    document.getElementById("threadVideoInput").value = "";
    newThreadModal.classList.add("active");
});

cancelThreadBtn.addEventListener("click", () => newThreadModal.classList.remove("active"));

saveThreadBtn.addEventListener("click", async () => {
    const title    = document.getElementById("threadTitleInput").value.trim();
    const content  = document.getElementById("threadBodyInput").value.trim();
    const videoUrl = document.getElementById("threadVideoInput").value.trim();

    if (!title || !content) { alert("Title and content are required."); return; }

    const safeVideo = videoUrl ? (convertVideoUrl(videoUrl) ? videoUrl : null) : null;
    if (videoUrl && !safeVideo) { alert("Only YouTube video URLs are supported."); return; }

    let imageUrl = null;
    const imgFile = document.getElementById("threadImageInput").files[0];

    if (imgFile) {
        if (!imgFile.type.startsWith("image/")) { alert("Please select an image file."); return; }
        showSendingIndicator(true);
        try {
            imageUrl = await uploadMedia(imgFile);
        } catch(e) {
            alert("Image upload failed.");
            showSendingIndicator(false);
            return;
        }
        showSendingIndicator(false);
    }

    await push(ref(db, `threads/${currentForum.id}`), {
        forumId: currentForum.id,
        title, content,
        author: currentUser.username,
        imageUrl,
        video: safeVideo,
        timestamp: serverTimestamp(),
        comments: {}
    });

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
    document.getElementById("editBio").value = currentUser.bio;
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

    // FIX: Mark old presence offline before renaming
    if (newName !== oldName) {
        await set(ref(db, `presence/${oldName}`), { online: false, last: serverTimestamp() });
    }

    currentUser.username = newName;
    currentUser.bio = newBio;
    localStorage.setItem("user", JSON.stringify(currentUser));

    if (newName !== oldName) {
        await remove(ref(db, `profiles/${oldName}`));
    }

    await set(ref(db, `profiles/${newName}`), {
        username: newName,
        bio: newBio,
        avatar: currentUser.avatar || null,
        userId: MY_USER_ID
    });

    await set(ref(db, `userIds/${MY_USER_ID}`), newName);

    // FIX: Set new presence with new name
    await heartbeat();
    renderUser();
    profileModal.classList.remove("active");
});

avatarInput.addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file || !file.type.startsWith("image/")) return;

    showSendingIndicator(true);
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
    bio: currentUser.bio || "No bio yet.",
    avatar: currentUser.avatar || null
});

listenOnlineUsers();
listenUserIdMap();
listenGlobalBadge();
listenDMBadge();

set(ref(db, `userIds/${MY_USER_ID}`), currentUser.username);

history.replaceState({ page: "home" }, "", "#/");
renderUser();
renderForums();
