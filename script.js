// ==================== DATA ====================
let currentUser = null;
let users = [];
let dummyForums = [];

// Sample avatars
const avatarList = ['👤', '💻', '🕶️', '🧠', '👑', '🦊'];

// ==================== UTILITIES ====================
function formatTime() {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getUserByUsername(username) {
    return users.find(u => u.username === username) || { username, avatar: '👤', bio: '' };
}

// Load sample data setelah register
function loadSampleData() {
    // Sample users (akan ditambah dengan user baru)
    users = [
        { id: 'zer0c00l', username: 'zer0c00l', bio: 'Exploit hunter', avatar: '💻', online: true },
        { id: 'dark_1337', username: 'dark_1337', bio: 'Darknet enthusiast', avatar: '🕶️', online: true },
        { id: 'neuro_hacker', username: 'neuro_hacker', bio: 'AI jailbreak specialist', avatar: '🧠', online: true },
        { id: 'admin', username: 'admin', bio: 'Forum administrator', avatar: '👑', online: true }
    ];
}

// ==================== FIREBASE AUTH STATE ====================
firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        // User sudah login
        console.log("User logged in:", user.email);
        
        // Cari user di dummy users berdasarkan email
        let existingUser = users.find(u => u.email === user.email);
        
        if (existingUser) {
            currentUser = existingUser;
        } else {
            // Kalo user Firebase tapi belum ada di dummy, buat baru
            currentUser = {
                id: user.uid,
                username: user.email.split('@')[0],
                bio: 'No bio yet.',
                avatar: '👤',
                online: true,
                email: user.email
            };
            users.push(currentUser);
        }
        
        document.getElementById('currentUsernameDisplay').textContent = currentUser.username;
        document.getElementById('authModal').classList.remove('active');
        
        if (dummyForums.length === 0) loadSampleData();
        renderForumList();
        await seedForums();      // buat forums kalo belum ada
        await loadForums();      // load forums dari Firestore
        renderOnlineUsers();
        navigateToForumList();
        
    } else {
        // User belum login - tampilkan modal auth
        showFirebaseAuthModal();
    }
});

// ==================== SEED FORUMS KE FIRESTORE ====================
async function seedForums() {
    const db = firebase.firestore();
    const forumsSnapshot = await db.collection('forums').get();
    
    // Kalo masih kosong, tambahin default forums
    if (forumsSnapshot.empty) {
        console.log("🔥 Seeding default forums to Firestore...");
        
        const defaultForums = [
            { 
                name: 'general', 
                description: 'General discussion', 
                private: false, 
                threadCount: 0,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            },
            { 
                name: 'exploit', 
                description: 'Zero-day & exploit discussion', 
                private: false, 
                threadCount: 0,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            },
            { 
                name: 'gore', 
                description: 'NSFW - 18+ only', 
                private: true, 
                threadCount: 0,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            },
            { 
                name: 'education', 
                description: 'Learning & tutorials', 
                private: false, 
                threadCount: 0,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }
        ];
        
        // Batch write biar cepet
        const batch = db.batch();
        defaultForums.forEach(forum => {
            const docRef = db.collection('forums').doc(forum.name);
            batch.set(docRef, forum);
        });
        
        await batch.commit();
        console.log("✅ Default forums seeded!");
    } else {
        console.log("📁 Forums already exist in Firestore");
    }
}

// ==================== LOAD FORUMS DARI FIRESTORE ====================
async function loadForums() {
    const db = firebase.firestore();
    
    try {
        const snapshot = await db.collection('forums')
            .orderBy('name')
            .get();
        
        // Kosongin dummyForums dulu
        dummyForums.length = 0;
        
        snapshot.forEach(doc => {
            dummyForums.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        console.log("📁 Forums loaded from Firestore:", dummyForums.length);
        renderForumList();
        
    } catch (error) {
        console.error("Error loading forums:", error);
        // Fallback ke dummy data kalo error
        if (dummyForums.length === 0) {
            dummyForums.push(
                { id: 1, name: 'general', description: 'General discussion', private: false, postCount: 142 },
                { id: 2, name: 'exploit', description: 'Zero-day & exploit', private: false, postCount: 87 }
            );
            renderForumList();
        }
    }
}

// ==================== FIREBASE AUTH MODAL ====================
function showFirebaseAuthModal() {
    const modalContent = document.getElementById('authModalContent');
    modalContent.innerHTML = `
        <h2><i class="fas fa-user-plus"></i> Register / Login</h2>
        <div class="modal-input">
            <label>Username *</label>
            <input type="text" id="regUsername" placeholder="Choose username...">
        </div>
        <div class="modal-input">
            <label>Email *</label>
            <input type="email" id="regEmail" placeholder="your@email.com">
        </div>
        <div class="modal-input">
            <label>Password *</label>
            <input type="password" id="regPassword" placeholder="Password...">
        </div>
        <div class="modal-input">
            <label>Bio (optional)</label>
            <textarea id="regBio" placeholder="Tell something about yourself..."></textarea>
        </div>
        <div class="modal-input">
            <label>Choose Avatar</label>
            <div class="avatar-options">
                <div class="avatar-option selected" data-avatar="👤">👤</div>
                <div class="avatar-option" data-avatar="💻">💻</div>
                <div class="avatar-option" data-avatar="🕶️">🕶️</div>
                <div class="avatar-option" data-avatar="🧠">🧠</div>
                <div class="avatar-option" data-avatar="👑">👑</div>
                <div class="avatar-option" data-avatar="🦊">🦊</div>
            </div>
        </div>
        <div class="modal-actions" style="justify-content: space-between;">
            <button class="modal-btn" id="loginBtn">LOGIN</button>
            <button class="modal-btn primary" id="registerBtn">REGISTER</button>
        </div>
        <div class="toggle-auth">
            <span style="color:#888;">Akun akan tersimpan di Firebase</span>
        </div>
    `;
    
    // Avatar selection (sama seperti sebelumnya)
    const avatarOptions = document.querySelectorAll('.avatar-option');
    avatarOptions.forEach(opt => {
        opt.addEventListener('click', () => {
            avatarOptions.forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
        });
    });
    
    // ========== LOGIN ==========
    document.getElementById('loginBtn').addEventListener('click', async () => {
        const email = document.getElementById('regEmail').value.trim();
        const password = document.getElementById('regPassword').value;
        
        if (!email || !password) {
            alert('Email and password required');
            return;
        }
        
        try {
            await firebase.auth().signInWithEmailAndPassword(email, password);
            // Auth state akan otomatis ke onAuthStateChanged
        } catch (error) {
            alert('Login error: ' + error.message);
        }
    });
    
    // ========== REGISTER ==========
    document.getElementById('registerBtn').addEventListener('click', async () => {
        const username = document.getElementById('regUsername').value.trim();
        const email = document.getElementById('regEmail').value.trim();
        const password = document.getElementById('regPassword').value;
        const bio = document.getElementById('regBio').value.trim() || 'No bio yet.';
        const selectedAvatar = document.querySelector('.avatar-option.selected')?.dataset.avatar || '👤';
        
        if (!username || !email || !password) {
            alert('All fields required');
            return;
        }
        
        // Cek username udah dipake? (di dummy users)
        if (users.some(u => u.username === username)) {
            alert('Username already taken');
            return;
        }
        
        try {
            // Buat akun Firebase
            const userCred = await firebase.auth().createUserWithEmailAndPassword(email, password);
            
            // Tambah user ke dummy users (tetep pake dummy)
            const newUser = {
                id: userCred.user.uid,
                username: username,
                bio: bio,
                avatar: selectedAvatar,
                online: true,
                email: email
            };
            
            users.push(newUser);
            currentUser = newUser;
            
            document.getElementById('currentUsernameDisplay').textContent = currentUser.username;
            document.getElementById('authModal').classList.remove('active');
            
            loadSampleData();
            renderForumList();
            renderOnlineUsers();
            navigateToForumList();
            
        } catch (error) {
            alert('Register error: ' + error.message);
        }
    });
}

// ==================== STATE ====================
let currentPage = 'forum-list';
let currentForum = null;
let currentThread = null;
let currentProfileUser = null;
let currentPMUser = null;
let threadMedia = [];

// ==================== DOM ELEMENTS ====================
const sidebar = document.getElementById('sidebar');
const menuToggle = document.getElementById('menuToggle');
const closeSidebar = document.getElementById('closeSidebar');
const forumList = document.getElementById('forumList');
const contentArea = document.getElementById('contentArea');
const commandBar = document.getElementById('commandBar');
const commandInput = document.getElementById('commandInput');
const sendBtn = document.getElementById('sendBtn');
const threadModal = document.getElementById('newThreadModal');
const threadTitle = document.getElementById('threadTitle');
const threadContent = document.getElementById('threadContent');
const cancelThreadBtn = document.getElementById('cancelThreadBtn');
const createThreadBtn = document.getElementById('createThreadBtn');
const addFileBtn = document.getElementById('addFileBtn');
const mediaPreview = document.getElementById('mediaPreview');
const fileModal = document.getElementById('fileUploadModal');
const fileInput = document.getElementById('fileInput');
const fileUrl = document.getElementById('fileUrl');
const fileName = document.getElementById('fileName');
const cancelFileBtn = document.getElementById('cancelFileBtn');
const insertFileBtn = document.getElementById('insertFileBtn');
const fileSourceUpload = document.getElementById('fileSourceUpload');
const fileSourceUrl = document.getElementById('fileSourceUrl');
const fileUploadSection = document.getElementById('fileUploadSection');
const fileUrlSection = document.getElementById('fileUrlSection');
const editModal = document.getElementById('editProfileModal');
const editUsername = document.getElementById('editUsername');
const editBio = document.getElementById('editBio');
const photoInput = document.getElementById('photoInput');
const photoUrl = document.getElementById('photoUrl');
const photoName = document.getElementById('photoName');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const saveEditBtn = document.getElementById('saveEditBtn');
const photoSourceUpload = document.getElementById('photoSourceUpload');
const photoSourceUrl = document.getElementById('photoSourceUrl');
const photoUploadSection = document.getElementById('photoUploadSection');
const photoUrlSection = document.getElementById('photoUrlSection');

// ==================== SIDEBAR ====================
menuToggle.addEventListener('click', () => sidebar.classList.add('open'));
closeSidebar.addEventListener('click', () => sidebar.classList.remove('open'));
document.addEventListener('click', (e) => {
    if (window.innerWidth <= 767) {
        if (!sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
            sidebar.classList.remove('open');
        }
    }
});

function renderForumList() {
    if (!dummyForums.length) return;
    forumList.innerHTML = '';
    dummyForums.forEach(forum => {
        const forumDiv = document.createElement('div');
        forumDiv.className = 'forum-item';
        forumDiv.innerHTML = `
            ${forum.name}/
            ${forum.private ? '<span style="color:#ff6b6b;"> [PRIVATE]</span>' : ''}
            <span style="color:#888888; float:right;">${forum.postCount}</span>
        `;
        forumDiv.onclick = () => {
            navigateToForum(forum);
            if (window.innerWidth <= 767) sidebar.classList.remove('open');
        };
        forumList.appendChild(forumDiv);
    });
}

function renderOnlineUsers() {
    const onlineList = document.getElementById('onlineList');
    if (!onlineList || !users.length) return;
    onlineList.innerHTML = '';
    users.filter(u => u.online).forEach(user => {
        const div = document.createElement('div');
        div.className = 'online-item';
        div.innerHTML = `${user.avatar || '👤'} ${user.username}`;
        div.onclick = () => navigateToProfile(user.username);
        onlineList.appendChild(div);
    });
}

// ==================== COMMAND BAR ====================
function updateCommandBar() {
    if (currentPage === 'thread-view') {
        commandBar.classList.remove('hidden');
    } else {
        commandBar.classList.add('hidden');
    }
}

// ==================== THREAD MODAL ====================
function showNewThreadModal() {
    threadTitle.value = '';
    threadContent.value = '';
    threadMedia = [];
    mediaPreview.innerHTML = '';
    threadModal.classList.add('active');
}

function hideThreadModal() {
    threadModal.classList.remove('active');
}

// File upload modal
let currentFileType = 'image';
let currentFileData = null;

addFileBtn.addEventListener('click', () => {
    fileModal.classList.add('active');
    fileSourceUpload.click();
});

fileSourceUpload.addEventListener('click', () => {
    fileSourceUpload.classList.add('active');
    fileSourceUrl.classList.remove('active');
    fileUploadSection.style.display = 'block';
    fileUrlSection.style.display = 'none';
});

fileSourceUrl.addEventListener('click', () => {
    fileSourceUrl.classList.add('active');
    fileSourceUpload.classList.remove('active');
    fileUploadSection.style.display = 'none';
    fileUrlSection.style.display = 'block';
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        fileName.textContent = file.name;
        const reader = new FileReader();
        reader.onload = (e) => {
            currentFileData = {
                type: file.type.startsWith('image/') ? 'image' : 'video',
                url: e.target.result,
                name: file.name
            };
        };
        reader.readAsDataURL(file);
    }
});

cancelFileBtn.addEventListener('click', () => {
    fileModal.classList.remove('active');
    fileInput.value = '';
    fileUrl.value = '';
    fileName.textContent = 'No file chosen';
    currentFileData = null;
});

insertFileBtn.addEventListener('click', () => {
    let fileData = null;
    
    if (fileSourceUpload.classList.contains('active')) {
        fileData = currentFileData;
    } else {
        const url = fileUrl.value.trim();
        if (url) {
            const isImage = url.match(/\.(jpeg|jpg|gif|png|webp)$/i);
            const isVideo = url.match(/\.(mp4|webm|mov)$/i);
            
            if (isImage || isVideo) {
                fileData = {
                    type: isImage ? 'image' : 'video',
                    url: url,
                    name: url.split('/').pop()
                };
            } else {
                alert('Invalid URL. Please use image or video URL');
                return;
            }
        }
    }
    
    if (fileData) {
        threadMedia.push(fileData);
        if (fileData.type === 'image') {
            mediaPreview.innerHTML += `<div class="post-media"><img src="${fileData.url}" style="max-width:200px;"></div>`;
        } else {
            mediaPreview.innerHTML += `<div class="post-media"><video src="${fileData.url}" controls style="max-width:200px;"></video></div>`;
        }
    }
    
    fileModal.classList.remove('active');
    fileInput.value = '';
    fileUrl.value = '';
    fileName.textContent = 'No file chosen';
    currentFileData = null;
});

cancelThreadBtn.addEventListener('click', hideThreadModal);

createThreadBtn.addEventListener('click', async () => {  
    const title = threadTitle.value.trim();
    const content = threadContent.value.trim();
    
    if (!title || !content) {
        alert('Title and content are required');
        return;
    }

    const user = firebase.auth().currentUser;
    
    if (!user) {
        alert("Please login first");
        return;
    }
    
    // Simpan ke Firestore
    await firebase.firestore().collection('threads').add({
        forumId: currentForum.id,
        title: title,
        author: currentUser.username,
        authorId: user.uid,
        time: new Date().toISOString(),
        content: content,
        media: threadMedia,
        replies: 0,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    // Update thread count di forum (kalo pake Firestore di Tahap 2)
    // await firebase.firestore().collection('forums').doc(currentForum.id).update({
    //     threadCount: firebase.firestore.FieldValue.increment(1)
    // });
    
    hideThreadModal();
    navigateToForum(currentForum);
});

threadModal.addEventListener('click', (e) => {
    if (e.target === threadModal) hideThreadModal();
});

// ==================== EDIT PROFILE ====================
function showEditProfileModal() {
    editUsername.value = currentUser.username;
    editBio.value = currentUser.bio || '';
    photoName.textContent = 'No file chosen';
    photoUrl.value = '';
    editModal.classList.add('active');
}

cancelEditBtn.addEventListener('click', () => {
    editModal.classList.remove('active');
});

photoSourceUpload.addEventListener('click', () => {
    photoSourceUpload.classList.add('active');
    photoSourceUrl.classList.remove('active');
    photoUploadSection.style.display = 'block';
    photoUrlSection.style.display = 'none';
});

photoSourceUrl.addEventListener('click', () => {
    photoSourceUrl.classList.add('active');
    photoSourceUpload.classList.remove('active');
    photoUploadSection.style.display = 'none';
    photoUrlSection.style.display = 'block';
});

photoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        photoName.textContent = file.name;
        const reader = new FileReader();
        reader.onload = (e) => {
            currentUser.avatar = e.target.result;
        };
        reader.readAsDataURL(file);
    }
});

saveEditBtn.addEventListener('click', () => {
    const newUsername = editUsername.value.trim();
    const newBio = editBio.value.trim();
    const newPhotoUrl = photoUrl.value.trim();
    
    if (newUsername && newUsername !== currentUser.username) {
        if (users.some(u => u.username === newUsername)) {
            alert('Username already taken');
            return;
        }
        currentUser.username = newUsername;
        document.getElementById('currentUsernameDisplay').textContent = newUsername;
    }
    
    if (newBio) currentUser.bio = newBio;
    
    if (newPhotoUrl) {
        currentUser.avatar = newPhotoUrl;
    }
    
    editModal.classList.remove('active');
    if (currentPage === 'profile' && currentProfileUser?.username === currentUser.username) {
        navigateToProfile(currentUser.username);
    }
});

editModal.addEventListener('click', (e) => {
    if (e.target === editModal) editModal.classList.remove('active');
});

// ==================== DELETE FUNCTIONS ====================
async function deleteThread(threadId, forumId) {  
    if (!confirm('Delete this thread?')) return;
    
    try {
        // Hapus thread dari Firestore
        await firebase.firestore().collection('threads').doc(threadId).delete();
        
        // Opsional: Update threadCount di forum (kalo pake)
        // await firebase.firestore().collection('forums').doc(forumId).update({
        //     threadCount: firebase.firestore.FieldValue.increment(-1)
        // });
        
        console.log("Thread deleted:", threadId);
        
        // Refresh halaman forum
        navigateToForum(currentForum);
        
    } catch (error) {
        console.error("Error deleting thread:", error);
        alert("Gagal menghapus thread: " + error.message);
    }
}

async function deletePost(threadId, postId) {  // ← TAMBAH async
    if (!confirm('Delete this comment?')) return;
    
    try {
        // Hapus post dari subcollection
        await firebase.firestore()
            .collection('threads')
            .doc(threadId)
            .collection('posts')
            .doc(postId)
            .delete();
        
        // Update reply count di thread
        await firebase.firestore()
            .collection('threads')
            .doc(threadId)
            .update({
                replies: firebase.firestore.FieldValue.increment(-1)
            });
        
        console.log("Post deleted:", postId);
        
        // Refresh halaman thread
        navigateToThread(threadId);
        
    } catch (error) {
        console.error("Error deleting post:", error);
        alert("Gagal menghapus komentar: " + error.message);
    }
}

// ==================== NAVIGATION ====================
window.navigateToForumList = function() {
    if (!currentUser) return;
    
    currentPage = 'forum-list';
    currentForum = null;
    currentThread = null;
    currentProfileUser = null;
    currentPMUser = null;
    updateCommandBar();
    
    let html = `
        <div class="page-header">
            <span class="page-title"><i class="fas fa-th-large"></i> All Forums</span>
            <span class="page-meta">${dummyForums.length} forums</span>
        </div>
    `;
    
    dummyForums.forEach(forum => {
        // Pake threadCount dari Firestore, atau fallback 0
        const threadCount = forum.threadCount || 0;
        
        html += `
            <div class="thread-card" onclick="navigateToForum(${JSON.stringify(forum).replace(/"/g, '&quot;')})">
                <div class="thread-header">
                    <span class="thread-title"><i class="fas fa-folder-open"></i> /${forum.name}/</span>
                    <span class="thread-meta"><i class="fas fa-comments"></i> ${threadCount} threads</span>
                </div>
                <div class="thread-content">${forum.description} ${forum.private ? '🔒 Private' : '🌍 Public'}</div>
            </div>
        `;
    });
    
    contentArea.innerHTML = html;
};

window.navigateToForum = async function(forum) {
    if (!currentUser) return;
    
    currentPage = 'thread-list';
    currentForum = forum;
    currentThread = null;
    currentProfileUser = null;
    currentPMUser = null;
    updateCommandBar();
    
    // AMBIL THREAD DARI FIRESTORE
    const threadsSnapshot = await firebase.firestore()
        .collection('threads')
        .where('forumId', '==', forum.id)
        .orderBy('createdAt', 'desc')
        .get();
    
    const threads = threadsSnapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
    }));
    
    let html = `
        <div class="page-header">
            <div style="display: flex; align-items: center; gap: 15px;">
                ${window.innerWidth <= 767 ? '<button class="back-btn" onclick="navigateToForumList()"><i class="fas fa-arrow-left"></i> BACK</button>' : ''}
                <span class="page-title"><i class="fas fa-folder-open"></i> /${forum.name}/</span>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
                <span class="page-meta">${forum.description} ${forum.private ? '🔒 Private' : ''}</span>
                <button class="new-thread-btn" onclick="showNewThreadModal()"><i class="fas fa-plus"></i> NEW THREAD</button>
            </div>
        </div>
    `;
    
    if (threads.length === 0) {
        html += '<div class="empty-state">No threads in this forum yet.</div>';
    } else {
        threads.forEach(thread => {
            const isOwnThread = thread.author === currentUser.username;
            html += `
                <div class="thread-card" onclick="navigateToThread('${thread.id}')">
                    ${isOwnThread ? `<button class="delete-btn own-post" onclick="event.stopPropagation(); deleteThread('${thread.id}', '${forum.id}')"><i class="fas fa-trash"></i> DELETE</button>` : ''}
                    <div class="thread-header">
                        <span class="thread-title">${thread.title}</span>
                        <span class="thread-meta">by <a onclick="event.stopPropagation(); navigateToProfile('${thread.author}')">${thread.author}</a> · ${thread.time} · <i class="fas fa-reply"></i> ${thread.replies || 0}</span>
                    </div>
                    <div class="thread-content">${thread.content.substring(0, 150)}${thread.content.length > 150 ? '...' : ''}</div>
                </div>
            `;
        });
    }
    
    contentArea.innerHTML = html;
};

window.navigateToThread = async function(threadId) {  // ← TAMBAH async
    // Ambil thread dari firestore

    if (!threadId) {
        console.error("Thread ID missing",threadId);
        alert("Error: Thread not found.");
        return;
    }
    
    const threadDoc = await firebase.firestore()
        .collection('threads')
        .doc(threadId)
        .get();
    
    if (!threadDoc.exists) return;
    
    const foundThread = { id: threadDoc.id, ...threadDoc.data() };
    
    // Ambil forum (masih pake dummy atau Firestore? Tergantung Tahap 2)
    const foundForum = dummyForums.find(f => f.id === foundThread.forumId) || 
                      { id: foundThread.forumId, name: 'unknown' };
    
    currentPage = 'thread-view';
    currentThread = foundThread;
    currentForum = foundForum;
    updateCommandBar();
    
    // AMBIL POSTS DARI FIRESTORE (subcollection)
    const postsSnapshot = await firebase.firestore()
        .collection('threads')
        .doc(threadId)
        .collection('posts')
        .orderBy('createdAt')
        .get();
    
    const posts = postsSnapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
    }));
    
    let html = `
        <div class="page-header">
            <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 10px;">
                <button class="back-btn" onclick="navigateToForum(${JSON.stringify(foundForum).replace(/"/g, '&quot;')})"><i class="fas fa-arrow-left"></i> BACK TO FORUM</button>
                <span class="page-title">${foundThread.title}</span>
            </div>
            <span class="page-meta">by <a onclick="navigateToProfile('${foundThread.author}')">${foundThread.author}</a> · ${new Date(foundThread.time).toLocaleString()}</span>
        </div>
        
        <div class="thread-content" style="margin-bottom: 20px;">${foundThread.content}</div>
    `;
    
    // Tampilkan media thread
    if (foundThread.media && foundThread.media.length > 0) {
        foundThread.media.forEach(item => {
            if (item.type === 'image') {
                html += `<div class="post-media"><img src="${item.url}" style="max-width:100%;"></div>`;
            } else if (item.type === 'video') {
                html += `<div class="post-media"><video src="${item.url}" controls style="max-width:100%;"></video></div>`;
            }
        });
    }
    
    // Tampilkan posts
    posts.forEach(post => {
        const isOwnPost = post.authorId === currentUser.uid;
        html += `
            <div class="post" id="post-${post.id}">
                ${isOwnPost ? `<button class="post-delete-btn own-post" onclick="deletePost('${threadId}', '${post.id}')"><i class="fas fa-trash"></i></button>` : ''}
                <div class="post-header">
                    <span><a class="post-author" onclick="navigateToProfile('${post.author}')">${post.author}</a></span>
                    <span class="post-time">${post.time}</span>
                </div>
                <div class="post-content">${post.content}</div>
                <button class="reply-btn" onclick="quoteReply('${post.author}')">
                    <i class="fas fa-reply"></i> Reply
                </button>
            </div>
        `;
    });
    
    html += `<div class="empty-state" style="text-align:left; padding:20px 0;"><i class="fas fa-comment"></i> Type your reply below...</div>`;
    
    contentArea.innerHTML = html;
};

window.quoteReply = function(author, preview) {
    commandInput.value = `@${author} `;
    commandInput.focus();
};

window.navigateToProfile = async function(username) {
    const user = getUserByUsername(username);
    if (!user) return;
    
    currentPage = 'profile';
    currentProfileUser = user;
    currentPMUser = null;
    updateCommandBar();
    
// Ambil threads dari Firestore berdasarkan author
const threadsSnapshot = await firebase.firestore()
    .collection('threads')
    .where('author', '==', username)
    .orderBy('createdAt', 'desc')
    .get();

const userThreads = threadsSnapshot.docs.map(doc => ({ 
    id: doc.id, 
    ...doc.data() 
}));
    
    const isOwnProfile = currentUser.username === username;
    
    let html = `
        <div class="page-header">
            <div style="display: flex; align-items: center; gap: 15px;">
                <button class="back-btn" onclick="navigateToForumList()"><i class="fas fa-arrow-left"></i> BACK</button>
                <span class="page-title"><i class="fas fa-user"></i> Profile</span>
            </div>
        </div>
        
        <div class="profile-header">
            <div class="profile-avatar">
                ${user.avatar?.startsWith('data:') ? `<img src="${user.avatar}">` : user.avatar || '👤'}
            </div>
            <div class="profile-info">
                <div class="profile-username">${user.username}</div>
                <div class="profile-bio">${user.bio || 'No bio yet.'}</div>
                <div class="profile-stats"><i class="fas fa-calendar-alt"></i> Joined: 2025 · <i class="fas fa-file-alt"></i> Threads: ${userThreads.length}</div>
            </div>
            ${isOwnProfile ? 
                `<button class="edit-profile-btn" onclick="showEditProfileModal()"><i class="fas fa-edit"></i> EDIT </button>` : 
                `<button class="send-message-btn" onclick="navigateToPM('${user.username}')"><i class="fas fa-envelope"></i> SEND MESSAGE</button>`
            }
        </div>
        
        <div class="profile-threads">
            <h3><i class="fas fa-threads"></i> Threads by ${user.username}</h3>
    `;
    
    if (userThreads.length === 0) {
        html += '<div class="empty-state">No threads yet.</div>';
    } else {
        userThreads.forEach(thread => {
            const forum = dummyForums.find(f => f.id === parseInt(thread.forumId));
            html += `
                <div class="thread-card" onclick="navigateToThread('${thread.id}')">
                    <div class="thread-header">
                        <span class="thread-title">${thread.title}</span>
                        <span class="thread-meta"><i class="fas fa-folder"></i> /${forum.name}/ · ${thread.time}</span>
                    </div>
                    <div class="thread-content">${thread.content.substring(0, 100)}...</div>
                </div>
            `;
        });
    }
    
    html += '</div>';
    contentArea.innerHTML = html;
};

window.navigateToGlobalChat = function() {
    if (!currentUser) {
        alert("Please login first");
        return;
    }
    
    currentPage = 'global-chat';
    updateCommandBar();
    
    let html = `
        <div class="page-header">
            <div style="display: flex; align-items: center; gap: 15px;">
                <button class="back-btn" onclick="navigateToForumList()"><i class="fas fa-arrow-left"></i> BACK</button>
                <span class="page-title"><i class="fas fa-globe"></i> Global Chat</span>
            </div>
            <span class="page-meta">Real-time chat</span>
        </div>
        
        <div class="chat-container">
            <div class="chat-messages" id="globalMessages"></div>
            <div class="chat-input-area">
                <input type="text" id="chatInput" placeholder="Type a message...">
                <button id="chatSendBtn"><i class="fas fa-paper-plane"></i> SEND</button>
            </div>
        </div>
    `;
    
    document.getElementById('contentArea').innerHTML = html;
    
    // ========== REALTIME LISTENER ==========
    const messagesRef = firebase.firestore()
        .collection('globalChat')
        .orderBy('createdAt', 'desc')
        .limit(50);
    
    // Listener akan jalan terus
    const unsubscribe = messagesRef.onSnapshot((snapshot) => {
        const messagesDiv = document.getElementById('globalMessages');
        if (!messagesDiv) return;
        
        messagesDiv.innerHTML = '';
        const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).reverse();
        
        msgs.forEach(msg => {
            const msgDiv = document.createElement('div');
            msgDiv.className = 'chat-message';
            msgDiv.innerHTML = `
                <div class="chat-header">
                    <span class="chat-sender" onclick="navigateToProfile('${msg.sender}')">${msg.sender}</span>
                    <span>${msg.time || ''}</span>
                </div>
                <div class="chat-text">${msg.text}</div>
            `;
            messagesDiv.appendChild(msgDiv);
        });
        
        // Auto scroll ke bawah
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    });
    
    // ========== SEND MESSAGE ==========
    document.getElementById('chatSendBtn').addEventListener('click', async () => {
        const input = document.getElementById('chatInput');
        const text = input.value.trim();
        if (!text) return;
        
        await firebase.firestore().collection('globalChat').add({
            sender: currentUser.username,
            senderId: currentUser.uid,
            text: text,
            time: formatTime(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        input.value = '';
    });
    
    document.getElementById('chatInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('chatSendBtn').click();
        }
    });
    
    // Simpan unsubscribe function untuk cleanup (opsional)
    window.globalChatUnsubscribe = unsubscribe;
};

window.navigateToPM = async function(withUser) {
    if (!currentUser) return;
    if (withUser === currentUser.username) return;
    
    // Cari user tujuan di Firestore
    const userQuery = await firebase.firestore()
        .collection('users')
        .where('username', '==', withUser)
        .get();
    
    if (userQuery.empty) {
        alert("User not found");
        return;
    }
    
    const otherUser = { id: userQuery.docs[0].id, ...userQuery.docs[0].data() };
    
    currentPage = 'private-chat';
    currentPMUser = otherUser;
    updateCommandBar();
    
    // Buat chat ID unik (sorted biar sama untuk kedua user)
    const chatId = [currentUser.uid, otherUser.id].sort().join('_');
    
    let html = `
        <div class="pm-container">
            <div class="pm-header">
                <div class="pm-with"><i class="fas fa-envelope"></i> Chat with <span>${withUser}</span></div>
                <button class="back-btn" onclick="navigateToProfile('${withUser}')"><i class="fas fa-arrow-left"></i> BACK</button>
            </div>
            
            <div class="pm-messages" id="pmMessages"></div>
            
            <div class="pm-input-area">
                <input type="text" id="pmInput" placeholder="Type a message...">
                <button id="pmSendBtn"><i class="fas fa-paper-plane"></i> SEND</button>
            </div>
        </div>
    `;
    
    document.getElementById('contentArea').innerHTML = html;
    
    // ========== REALTIME LISTENER ==========
    const messagesRef = firebase.firestore()
        .collection('privateMessages')
        .doc(chatId)
        .collection('messages')
        .orderBy('createdAt');
    
    const unsubscribe = messagesRef.onSnapshot((snapshot) => {
        const messagesDiv = document.getElementById('pmMessages');
        if (!messagesDiv) return;
        
        messagesDiv.innerHTML = '';
        snapshot.docs.forEach(doc => {
            const msg = doc.data();
            const isSent = msg.senderId === currentUser.uid;
            
            const msgDiv = document.createElement('div');
            msgDiv.className = `pm-message ${isSent ? 'sent' : 'received'}`;
            msgDiv.innerHTML = `
                <div class="pm-bubble">
                    <div>${msg.text}</div>
                    <div class="pm-time">${msg.time}</div>
                </div>
            `;
            messagesDiv.appendChild(msgDiv);
        });
        
        // Auto scroll ke bawah
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    });
    
    // ========== SEND MESSAGE ==========
    document.getElementById('pmSendBtn').addEventListener('click', async () => {
        const input = document.getElementById('pmInput');
        const text = input.value.trim();
        if (!text) return;
        
        await firebase.firestore()
            .collection('privateMessages')
            .doc(chatId)
            .collection('messages')
            .add({
                sender: currentUser.username,
                senderId: currentUser.uid,
                text: text,
                time: formatTime(),
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        
        input.value = '';
    });
    
    document.getElementById('pmInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('pmSendBtn').click();
        }
    });
    
    // Simpan unsubscribe untuk cleanup (optional)
    window.pmUnsubscribe = unsubscribe;
};

window.navigateToPMList = async function() {
    if (!currentUser) return;
    
    currentPage = 'pm-list';
    updateCommandBar();
    
    // Cari semua chat yang melibatkan current user
    const chatsSnapshot = await firebase.firestore()
    .collection('privateMessages')
    .get();
    
    const chatList = [];
    
    for (const doc of chatsSnapshot.docs) {
        const chatId = doc.id;
        if (chatId.includes(currentUser.uid)) {
            const otherUserId = chatId.split('_').find(id => id !== currentUser.uid);
            
            if (otherUserId) {
                const userDoc = await firebase.firestore().collection('users').doc(otherUserId).get();
                if (userDoc.exists) {
                    // Ambil pesan terakhir
                    const lastMsg = await doc.collection('messages')
                        .orderBy('createdAt', 'desc')
                        .limit(1)
                        .get();
                    
                    chatList.push({
                        userId: otherUserId,
                        username: userDoc.data().username,
                        avatar: userDoc.data().avatar,
                        lastMessage: lastMsg.empty ? null : lastMsg.docs[0].data()
                    });
                }
            }
        }
    }
    
    let html = `
        <div class="page-header">
            <div style="display: flex; align-items: center; gap: 15px;">
                <button class="back-btn" onclick="navigateToForumList()"><i class="fas fa-arrow-left"></i> BACK</button>
                <span class="page-title"><i class="fas fa-envelope"></i> Private Messages</span>
            </div>
            <span class="page-meta">${chatList.length} conversations</span>
        </div>
    `;
    
    if (chatList.length === 0) {
        html += '<div class="empty-state">No messages yet.</div>';
    } else {
        chatList.forEach(chat => {
            html += `
                <div class="thread-card" onclick="navigateToPM('${chat.username}')">
                    <div class="thread-header">
                        <span class="thread-title">${chat.avatar || '👤'} ${chat.username}</span>
                        <span class="thread-meta"><i class="fas fa-clock"></i> ${chat.lastMessage ? chat.lastMessage.time : 'No messages'}</span>
                    </div>
                    <div class="thread-content">${chat.lastMessage ? chat.lastMessage.text.substring(0, 50) + '...' : 'Click to start conversation'}</div>
                </div>
            `;
        });
    }
    
    document.getElementById('contentArea').innerHTML = html;
};

// ==================== COMMAND HANDLER ====================
sendBtn.addEventListener('click', async () => {  
    const text = commandInput.value.trim();
    if (!text || currentPage !== 'thread-view' || !currentThread) return;
    
    // Simpan post ke subcollection
    await firebase.firestore()
        .collection('threads')
        .doc(currentThread.id)
        .collection('posts')
        .add({
            author: currentUser.username,
            authorId: currentUser.uid,
            time: formatTime(),
            content: text,
            media: [],
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    
    // Update reply count di thread
    await firebase.firestore()
        .collection('threads')
        .doc(currentThread.id)
        .update({
            replies: firebase.firestore.FieldValue.increment(1)
        });
    
    // Refresh thread
    navigateToThread(currentThread.id);
    commandInput.value = '';
});

commandInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendBtn.click();
});

// ==================== INIT ====================

// Make functions global
window.deleteThread = deleteThread;
window.deletePost = deletePost;
window.showNewThreadModal = showNewThreadModal;
window.showEditProfileModal = showEditProfileModal;
window.showFirebaseAuthModal = showFirebaseAuthModal;
