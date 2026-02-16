// ==================== GLOBAL VARIABLES ====================
let currentUser = null;
let currentPage = 'forum-list';
let currentForum = null;
let currentThread = null;
let currentProfileUser = null;
let currentPMUser = null;
let threadMedia = [];

// Firebase sudah di-init di HTML, jadi bisa langsung pake:
// firebase.auth(), firebase.firestore(), firebase.storage()

// ==================== UTILITIES ====================
function formatTime() {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ==================== AUTH STATE ====================
firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        // Get user data from Firestore
        const userDoc = await firebase.firestore().collection('users').doc(user.uid).get();
        currentUser = {
            uid: user.uid,
            email: user.email,
            ...userDoc.data()
        };
        
        document.getElementById('currentUsernameDisplay').textContent = currentUser.username;
        document.getElementById('authModal').classList.remove('active');
        
        // Update online status
        await firebase.firestore().collection('users').doc(user.uid).update({ 
            online: true,
            lastSeen: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        await seedForums();
        
        // Load data
        await loadForums();
        await loadOnlineUsers();
        navigateToForumList();
    } else {
        showRegisterModal();
    }
});

// ==================== AUTO-SEED FORUMS ====================
async function seedForums() {
    const forumsSnapshot = await firebase.firestore().collection('forums').get();
    
    if (forumsSnapshot.empty) {
        console.log("No forums found, seeding default forums...");
        
        const defaultForums = [
            { name: 'general', description: 'General discussion', private: false, threadCount: 0 },
            { name: 'exploit', description: 'Zero-day & exploit discussion', private: false, threadCount: 0 },
            { name: 'gore', description: 'NSFW - 18+ only', private: true, threadCount: 0 },
            { name: 'education', description: 'Learning & tutorials', private: false, threadCount: 0 }
        ];
        
        const batch = firebase.firestore().batch();
        defaultForums.forEach(forum => {
            const docRef = firebase.firestore().collection('forums').doc(forum.name);
            batch.set(docRef, forum);
        });
        
        await batch.commit();
        console.log("Default forums seeded!");
    }
}

// ==================== AUTH MODAL ====================
function showRegisterModal() {
    const modalContent = document.getElementById('authModalContent');
    modalContent.innerHTML = `
        <h2><i class="fas fa-user-plus"></i> Register</h2>
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
        <div class="modal-actions">
            <button class="modal-btn primary" id="registerBtn"><i class="fas fa-check"></i> REGISTER</button>
        </div>
        <div class="toggle-auth">
            Already have account? <span onclick="showLoginModal()">Login here</span>
        </div>
    `;
    
    // Avatar selection
    const avatarOptions = document.querySelectorAll('.avatar-option');
    avatarOptions.forEach(opt => {
        opt.addEventListener('click', () => {
            avatarOptions.forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
        });
    });
    
    document.getElementById('registerBtn').addEventListener('click', async () => {
        const username = document.getElementById('regUsername').value.trim();
        const email = document.getElementById('regEmail').value.trim();
        const password = document.getElementById('regPassword').value;
        const bio = document.getElementById('regBio').value.trim() || 'No bio yet.';
        const avatar = document.querySelector('.avatar-option.selected')?.dataset.avatar || '👤';
        
        if (!username || !email || !password) {
            alert('All fields required');
            return;
        }
        
        try {
            // Check if username exists
            const usernameCheck = await firebase.firestore()
                .collection('users')
                .where('username', '==', username)
                .get();
            
            if (!usernameCheck.empty) {
                alert('Username already taken');
                return;
            }
            
            // Create auth user
            const userCred = await firebase.auth().createUserWithEmailAndPassword(email, password);
            
            // Save to Firestore
            await firebase.firestore().collection('users').doc(userCred.user.uid).set({
                username: username,
                email: email,
                bio: bio,
                avatar: avatar,
                online: true,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastSeen: firebase.firestore.FieldValue.serverTimestamp()
            });
            
        } catch (error) {
            alert(error.message);
        }
    });
}

function showLoginModal() {
    const modalContent = document.getElementById('authModalContent');
    modalContent.innerHTML = `
        <h2><i class="fas fa-sign-in-alt"></i> Login</h2>
        <div class="modal-input">
            <label>Email</label>
            <input type="email" id="loginEmail" placeholder="your@email.com">
        </div>
        <div class="modal-input">
            <label>Password</label>
            <input type="password" id="loginPassword" placeholder="Password...">
        </div>
        <div class="modal-actions">
            <button class="modal-btn primary" id="loginBtn"><i class="fas fa-sign-in-alt"></i> LOGIN</button>
        </div>
        <div class="toggle-auth">
            Don't have account? <span onclick="showRegisterModal()">Register here</span>
        </div>
    `;
    
    document.getElementById('loginBtn').addEventListener('click', async () => {
        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;
        
        try {
            await firebase.auth().signInWithEmailAndPassword(email, password);
        } catch (error) {
            alert(error.message);
        }
    });
}

// ==================== LOAD DATA ====================
async function loadForums() {
    const snapshot = await firebase.firestore()
        .collection('forums')
        .orderBy('name')
        .get();
    
    window.forums = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));
    
    renderForumList();
}

async function loadOnlineUsers() {
    // Get users active in last 5 minutes
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const snapshot = await firebase.firestore()
        .collection('users')
        .where('online', '==', true)
        // .where('lastSeen', '>', fiveMinAgo) // Uncomment kalo mau filter
        .get();
    
    window.onlineUsers = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));
    
    renderOnlineUsers();
}

// ==================== SIDEBAR ====================
const sidebar = document.getElementById('sidebar');
const menuToggle = document.getElementById('menuToggle');
const closeSidebar = document.getElementById('closeSidebar');

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
    const forumList = document.getElementById('forumList');
    if (!window.forums) return;
    
    forumList.innerHTML = '';
    window.forums.forEach(forum => {
        const forumDiv = document.createElement('div');
        forumDiv.className = 'forum-item';
        forumDiv.innerHTML = `
            ${forum.name}/
            ${forum.private ? '<span style="color:#ff6b6b;"> [PRIVATE]</span>' : ''}
            <span style="color:#888888; float:right;">${forum.threadCount || 0}</span>
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
    if (!onlineList || !window.onlineUsers) return;
    
    onlineList.innerHTML = '';
    window.onlineUsers.forEach(user => {
        const div = document.createElement('div');
        div.className = 'online-item';
        div.innerHTML = `${user.avatar || '👤'} ${user.username}`;
        div.onclick = () => navigateToProfile(user.username);
        onlineList.appendChild(div);
    });
}

// ==================== COMMAND BAR ====================
const commandBar = document.getElementById('commandBar');
const commandInput = document.getElementById('commandInput');
const sendBtn = document.getElementById('sendBtn');

function updateCommandBar() {
    if (currentPage === 'thread-view') {
        commandBar.classList.remove('hidden');
    } else {
        commandBar.classList.add('hidden');
    }
}

// ==================== THREAD MODAL ====================
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
    }
});

cancelFileBtn.addEventListener('click', () => {
    fileModal.classList.remove('active');
    fileInput.value = '';
    fileUrl.value = '';
    fileName.textContent = 'No file chosen';
});

insertFileBtn.addEventListener('click', async () => {
    let fileData = null;
    
    if (fileSourceUpload.classList.contains('active') && fileInput.files[0]) {
        const file = fileInput.files[0];
        const storageRef = firebase.storage().ref(`threads/${Date.now()}_${file.name}`);
        await storageRef.put(file);
        const url = await storageRef.getDownloadURL();
        
        fileData = {
            type: file.type.startsWith('image/') ? 'image' : 'video',
            url: url,
            name: file.name
        };
    } else if (fileSourceUrl.classList.contains('active') && fileUrl.value.trim()) {
        const url = fileUrl.value.trim();
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
});

cancelThreadBtn.addEventListener('click', hideThreadModal);

createThreadBtn.addEventListener('click', async () => {
    const title = threadTitle.value.trim();
    const content = threadContent.value.trim();
    
    if (!title || !content) {
        alert('Title and content are required');
        return;
    }
    
    // Save thread to Firestore
    await firebase.firestore().collection('threads').add({
        forumId: currentForum.id,
        title: title,
        author: currentUser.username,
        authorId: currentUser.uid,
        time: new Date().toISOString(),
        content: content,
        media: threadMedia,
        replies: 0,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    // Update thread count in forum
    await firebase.firestore().collection('forums').doc(currentForum.id).update({
        threadCount: firebase.firestore.FieldValue.increment(1)
    });
    
    hideThreadModal();
    navigateToForum(currentForum);
});

threadModal.addEventListener('click', (e) => {
    if (e.target === threadModal) hideThreadModal();
});

// ==================== EDIT PROFILE ====================
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
    }
});

saveEditBtn.addEventListener('click', async () => {
    const newUsername = editUsername.value.trim();
    const newBio = editBio.value.trim();
    
    // Check username availability if changed
    if (newUsername && newUsername !== currentUser.username) {
        const check = await firebase.firestore()
            .collection('users')
            .where('username', '==', newUsername)
            .get();
        
        if (!check.empty) {
            alert('Username already taken');
            return;
        }
    }
    
    let avatar = currentUser.avatar;
    
    // Upload new photo if selected
    if (photoSourceUpload.classList.contains('active') && photoInput.files[0]) {
        const file = photoInput.files[0];
        const storageRef = firebase.storage().ref(`avatars/${currentUser.uid}`);
        await storageRef.put(file);
        avatar = await storageRef.getDownloadURL();
    } else if (photoSourceUrl.classList.contains('active') && photoUrl.value.trim()) {
        avatar = photoUrl.value.trim();
    }
    
    // Update Firestore
    await firebase.firestore().collection('users').doc(currentUser.uid).update({
        username: newUsername || currentUser.username,
        bio: newBio || currentUser.bio,
        avatar: avatar
    });
    
    // Update current user object
    currentUser.username = newUsername || currentUser.username;
    currentUser.bio = newBio || currentUser.bio;
    currentUser.avatar = avatar;
    
    document.getElementById('currentUsernameDisplay').textContent = currentUser.username;
    editModal.classList.remove('active');
    
    // Refresh profile if on own profile page
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
    
    await firebase.firestore().collection('threads').doc(threadId).delete();
    await firebase.firestore().collection('forums').doc(forumId).update({
        threadCount: firebase.firestore.FieldValue.increment(-1)
    });
    
    navigateToForum(currentForum);
}

async function deletePost(threadId, postId) {
    if (!confirm('Delete this comment?')) return;
    
    await firebase.firestore().collection('posts').doc(postId).delete();
    await firebase.firestore().collection('threads').doc(threadId).update({
        replies: firebase.firestore.FieldValue.increment(-1)
    });
    
    navigateToThread(threadId);
}

// ==================== NAVIGATION ====================
window.navigateToForumList = async function() {
    if (!currentUser) return;
    
    currentPage = 'forum-list';
    currentForum = null;
    currentThread = null;
    currentProfileUser = null;
    currentPMUser = null;
    updateCommandBar();
    
    const forumsSnapshot = await firebase.firestore()
        .collection('forums')
        .orderBy('name')
        .get();
    
    const forums = forumsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    let html = `
        <div class="page-header">
            <span class="page-title"><i class="fas fa-th-large"></i> All Forums</span>
            <span class="page-meta">${forums.length} forums</span>
        </div>
    `;
    
    forums.forEach(forum => {
        html += `
            <div class="thread-card" onclick="navigateToForum(${JSON.stringify(forum).replace(/"/g, '&quot;')})">
                <div class="thread-header">
                    <span class="thread-title"><i class="fas fa-folder-open"></i> /${forum.name}/</span>
                    <span class="thread-meta"><i class="fas fa-comments"></i> ${forum.threadCount || 0} threads</span>
                </div>
                <div class="thread-content">${forum.description} ${forum.private ? '🔒 Private' : '🌍 Public'}</div>
            </div>
        `;
    });
    
    document.getElementById('contentArea').innerHTML = html;
};

window.navigateToForum = async function(forum) {
    if (!currentUser) return;
    
    currentPage = 'thread-list';
    currentForum = forum;
    currentThread = null;
    currentProfileUser = null;
    currentPMUser = null;
    updateCommandBar();
    
    const threadsSnapshot = await firebase.firestore()
        .collection('threads')
        .where('forumId', '==', forum.id)
        .orderBy('createdAt', 'desc')
        .get();
    
    const threads = threadsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
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
            const isOwnThread = thread.authorId === currentUser.uid;
            html += `
                <div class="thread-card" onclick="navigateToThread('${thread.id}')">
                    ${isOwnThread ? `<button class="delete-btn own-post" onclick="event.stopPropagation(); deleteThread('${thread.id}', '${forum.id}')"><i class="fas fa-trash"></i> DELETE</button>` : ''}
                    <div class="thread-header">
                        <span class="thread-title">${thread.title}</span>
                        <span class="thread-meta">by <a onclick="event.stopPropagation(); navigateToProfile('${thread.author}')">${thread.author}</a> · ${new Date(thread.time).toLocaleString()} · <i class="fas fa-reply"></i> ${thread.replies || 0}</span>
                    </div>
                    <div class="thread-content">${thread.content.substring(0, 150)}${thread.content.length > 150 ? '...' : ''}</div>
                </div>
            `;
        });
    }
    
    document.getElementById('contentArea').innerHTML = html;
};

window.navigateToThread = async function(threadId) {
    const threadDoc = await firebase.firestore().collection('threads').doc(threadId).get();
    if (!threadDoc.exists) return;
    
    const foundThread = { id: threadDoc.id, ...threadDoc.data() };
    const forumDoc = await firebase.firestore().collection('forums').doc(foundThread.forumId).get();
    const foundForum = { id: forumDoc.id, ...forumDoc.data() };
    
    currentPage = 'thread-view';
    currentThread = foundThread;
    currentForum = foundForum;
    currentProfileUser = null;
    currentPMUser = null;
    updateCommandBar();
    
    // Get posts
    const postsSnapshot = await firebase.firestore()
        .collection('posts')
        .where('threadId', '==', threadId)
        .orderBy('createdAt')
        .get();
    
    const posts = postsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
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
    
    if (foundThread.media && foundThread.media.length > 0) {
        foundThread.media.forEach(item => {
            if (item.type === 'image') {
                html += `<div class="post-media"><img src="${item.url}" style="max-width:100%;"></div>`;
            } else if (item.type === 'video') {
                html += `<div class="post-media"><video src="${item.url}" controls style="max-width:100%;"></video></div>`;
            }
        });
    }
    
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
        `;
        
        if (post.media && post.media.length > 0) {
            post.media.forEach(item => {
                if (item.type === 'image') {
                    html += `<div class="post-media"><img src="${item.url}" style="max-width:100%;"></div>`;
                } else if (item.type === 'video') {
                    html += `<div class="post-media"><video src="${item.url}" controls style="max-width:100%;"></video></div>`;
                }
            });
        }
        
        html += `
                <button class="reply-btn" onclick="quoteReply('${post.author}')">
                    <i class="fas fa-reply"></i> Reply
                </button>
            </div>
        `;
    });
    
    html += `<div class="empty-state" style="text-align:left; padding:20px 0;"><i class="fas fa-comment"></i> Type your reply below...</div>`;
    
    document.getElementById('contentArea').innerHTML = html;
};

window.navigateToProfile = async function(username) {
    console.log("navigateToProfile called with:", username); // DEBUG
    console.log("currentUser:", currentUser); // DEBUG
    
    if (!username) {
        // Fallback ke current user
        if (currentUser && currentUser.username) {
            username = currentUser.username;
            console.log("Fallback to current username:", username);
        } else {
            alert("Username not found");
            return;
        }
    }
    
    // Find user by username
    const userQuery = await firebase.firestore()
        .collection('users')
        .where('username', '==', username)
        .get();
    
    if (userQuery.empty) return;
    
    const userDoc = userQuery.docs[0];
    const user = { id: userDoc.id, ...userDoc.data() };
    
    currentPage = 'profile';
    currentProfileUser = user;
    currentPMUser = null;
    updateCommandBar();
    
    // Find threads by this user
    const threadsSnapshot = await firebase.firestore()
        .collection('threads')
        .where('author', '==', username)
        .orderBy('createdAt', 'desc')
        .get();
    
    const userThreads = threadsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
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
                ${user.avatar?.startsWith('http') ? `<img src="${user.avatar}">` : user.avatar || '👤'}
            </div>
            <div class="profile-info">
                <div class="profile-username">${user.username}</div>
                <div class="profile-bio">${user.bio || 'No bio yet.'}</div>
                <div class="profile-stats"><i class="fas fa-calendar-alt"></i> Joined: ${user.createdAt ? new Date(user.createdAt.toDate()).toLocaleDateString() : '2025'} · <i class="fas fa-file-alt"></i> Threads: ${userThreads.length}</div>
            </div>
            ${isOwnProfile ? 
                `<button class="edit-profile-btn" onclick="showEditProfileModal()"><i class="fas fa-edit"></i> EDIT PROFILE</button>` : 
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
            html += `
                <div class="thread-card" onclick="navigateToThread('${thread.id}')">
                    <div class="thread-header">
                        <span class="thread-title">${thread.title}</span>
                        <span class="thread-meta"><i class="fas fa-folder"></i> · ${new Date(thread.time).toLocaleString()}</span>
                    </div>
                    <div class="thread-content">${thread.content.substring(0, 100)}...</div>
                </div>
            `;
        });
    }
    
    html += '</div>';
    document.getElementById('contentArea').innerHTML = html;
};

window.navigateToGlobalChat = function() {
    currentPage = 'global-chat';
    updateCommandBar();
    
    let html = `
        <div class="page-header">
            <div style="display: flex; align-items: center; gap: 15px;">
                <button class="back-btn" onclick="navigateToForumList()"><i class="fas fa-arrow-left"></i> BACK</button>
                <span class="page-title"><i class="fas fa-globe"></i> Global Chat</span>
            </div>
            <span class="page-meta">Semua user bisa chat di sini</span>
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
    
    // Load messages realtime
    const messagesRef = firebase.firestore()
        .collection('globalChat')
        .orderBy('createdAt', 'desc')
        .limit(50);
    
    messagesRef.onSnapshot((snapshot) => {
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
        
        // Scroll ke bawah
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    });
    
    // Send message
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
};

window.navigateToPM = async function(withUser) {
    if (withUser === currentUser.username) return;
    
    const userQuery = await firebase.firestore()
        .collection('users')
        .where('username', '==', withUser)
        .get();
    
    if (userQuery.empty) return;
    
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
    
    // Load messages realtime
    const messagesRef = firebase.firestore()
        .collection('privateMessages')
        .doc(chatId)
        .collection('messages')
        .orderBy('createdAt');
    
    messagesRef.onSnapshot((snapshot) => {
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
        
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    });
    
    // Send message
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
};

window.navigateToPMList = async function() {
    currentPage = 'pm-list';
    updateCommandBar();
    
    // Cari semua chat yang melibatkan current user
    const chatsSnapshot = await firebase.firestore()
        .collection('privateMessages')
        .listDocuments();
    
    const chatList = [];
    
    for (const doc of chatsSnapshot) {
        const chatId = doc.id;
        if (chatId.includes(currentUser.uid)) {
            const otherUserId = chatId.split('_').find(id => id !== currentUser.uid);
            
            if (otherUserId) {
                const userDoc = await firebase.firestore().collection('users').doc(otherUserId).get();
                if (userDoc.exists) {
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

window.quoteReply = function(author) {
    commandInput.value = `@${author} `;
    commandInput.focus();
};

// ==================== SEND REPLY ====================
sendBtn.addEventListener('click', async () => {
    const text = commandInput.value.trim();
    if (!text || currentPage !== 'thread-view' || !currentThread) return;
    
    await firebase.firestore().collection('posts').add({
        threadId: currentThread.id,
        author: currentUser.username,
        authorId: currentUser.uid,
        time: formatTime(),
        content: text,
        media: [],
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    await firebase.firestore().collection('threads').doc(currentThread.id).update({
        replies: firebase.firestore.FieldValue.increment(1)
    });
    
    navigateToThread(currentThread.id);
    commandInput.value = '';
});

commandInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendBtn.click();
});

// ==================== LOGOUT HANDLER ====================
window.addEventListener('beforeunload', () => {
    if (currentUser) {
        firebase.firestore().collection('users').doc(currentUser.uid).update({
            online: false
        });
    }
});

// ==================== INITIAL RENDER ====================
renderForumList();

// Make functions global
window.showRegisterModal = showRegisterModal;
window.showLoginModal = showLoginModal;
window.showNewThreadModal = showNewThreadModal;
window.showEditProfileModal = showEditProfileModal;
window.deleteThread = deleteThread;
window.deletePost = deletePost;
window.navigateToProfile = navigateToProfile;
window.navigateToGlobalChat = navigateToGlobalChat;
window.navigateToPM = navigateToPM;
window.navigateToPMList = navigateToPMList;
window.quoteReply = quoteReply;
