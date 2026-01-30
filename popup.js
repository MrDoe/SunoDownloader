// popup.js
const api = (typeof browser !== 'undefined') ? browser : chrome;

let allSongs = [];
let filteredSongs = [];

document.addEventListener('DOMContentLoaded', () => {
    const statusDiv = document.getElementById("status");
    const folderInput = document.getElementById("folder");
    const publicCheckbox = document.getElementById("publicOnly");
    const maxPagesInput = document.getElementById("maxPages");
    const fetchBtn = document.getElementById("fetchBtn");
    const stopBtn = document.getElementById("stopBtn");
    const viewSongsBtn = document.getElementById("viewSongsBtn");
    const downloadBtn = document.getElementById("downloadBtn");
    const backBtn = document.getElementById("backBtn");
    const filterInput = document.getElementById("filterInput");
    const selectAllCheckbox = document.getElementById("selectAll");
    const songList = document.getElementById("songList");
    const songCount = document.getElementById("songCount");
    const settingsPanel = document.getElementById("settingsPanel");
    const songListContainer = document.getElementById("songListContainer");

    // Load from storage on startup
    loadFromStorage();
    
    // Check if fetching is in progress
    checkFetchState();
    
    async function checkFetchState() {
        try {
            const response = await api.runtime.sendMessage({ action: "get_fetch_state" });
            if (response && response.isFetching) {
                fetchBtn.disabled = true;
                fetchBtn.textContent = "Fetching...";
                stopBtn.classList.remove("hidden");
                statusDiv.innerText = "Fetching in progress...";
            }
        } catch (e) {
            // Ignore errors (e.g., no response)
        }
    }

    async function loadFromStorage() {
        try {
            const result = await api.storage.local.get('sunoSongsList');
            const data = result.sunoSongsList;
            if (data) {
                // Check if data is older than 24 hours
                const maxAge = 24 * 60 * 60 * 1000; // 24 hours
                if (data.timestamp && (Date.now() - data.timestamp) > maxAge) {
                    await clearStorage();
                    settingsPanel.style.display = "block";
                    songListContainer.style.display = "none";
                    return;
                }
                
                allSongs = data.songs || [];
                filteredSongs = [...allSongs];
                
                // Restore settings
                if (data.folder) folderInput.value = data.folder;
                if (data.publicOnly !== undefined) publicCheckbox.checked = data.publicOnly;
                if (data.maxPages !== undefined) maxPagesInput.value = data.maxPages;
                
                if (allSongs.length > 0) {
                    // Go directly to song list
                    settingsPanel.style.display = "none";
                    songListContainer.style.display = "block";
                    filterInput.value = "";
                    selectAllCheckbox.checked = true;
                    renderSongList();
                    statusDiv.innerText = `${allSongs.length} cached songs. Checking for new...`;

                    // Check for new songs
                    setTimeout(() => checkForNewSongs(), 100);
                    return;
                }
            }
        } catch (e) {
            console.error('Failed to load from storage:', e);
        }
        
        // Show settings panel by default
        settingsPanel.style.display = "block";
        songListContainer.style.display = "none";
    }

    function checkForNewSongs() {
        const isPublicOnly = publicCheckbox.checked;
        const maxPages = parseInt(maxPagesInput.value) || 0;
        const knownIds = allSongs.map(s => s.id);
        
        api.runtime.sendMessage({ 
            action: "fetch_songs", 
            isPublicOnly: isPublicOnly,
            maxPages: maxPages,
            checkNewOnly: true,
            knownIds: knownIds
        });
    }

    async function saveToStorage() {
        try {
            await api.storage.local.set({
                sunoSongsList: {
                    songs: allSongs,
                    folder: folderInput.value,
                    publicOnly: publicCheckbox.checked,
                    maxPages: parseInt(maxPagesInput.value) || 0,
                    timestamp: Date.now()
                }
            });
        } catch (e) {
            console.error('Failed to save to storage:', e);
        }
    }

    function mergeSongs(newSongs) {
        const existingIds = new Set(allSongs.map(s => s.id));
        const addedSongs = newSongs.filter(s => !existingIds.has(s.id));
        
        if (addedSongs.length > 0) {
            // Add new songs at the beginning
            allSongs = [...addedSongs, ...allSongs];
            filteredSongs = [...allSongs];
            applyFilter();
            saveToStorage();
        }
        
        return addedSongs.length;
    }

    async function clearStorage() {
        try {
            await api.storage.local.remove('sunoSongsList');
        } catch (e) {}
    }

    // Fetch songs list
    fetchBtn.addEventListener("click", () => {
        const isPublicOnly = publicCheckbox.checked;
        const maxPages = parseInt(maxPagesInput.value) || 0;
        fetchBtn.disabled = true;
        fetchBtn.textContent = "Fetching...";
        stopBtn.classList.remove("hidden");
        statusDiv.innerText = "Fetching songs list...";
        
        api.runtime.sendMessage({ 
            action: "fetch_songs", 
            isPublicOnly: isPublicOnly,
            maxPages: maxPages
        });
    });

    // Stop fetching
    stopBtn.addEventListener("click", () => {
        api.runtime.sendMessage({ action: "stop_fetch" });
        stopBtn.classList.add("hidden");
        fetchBtn.disabled = false;
        fetchBtn.textContent = "Fetch Songs List";
        statusDiv.innerText = "Stopped by user.\n" + statusDiv.innerText;
    });

    // View cached songs
    viewSongsBtn.addEventListener("click", () => {
        if (allSongs.length > 0) {
            filteredSongs = [...allSongs];
            settingsPanel.style.display = "none";
            songListContainer.style.display = "block";
            filterInput.value = "";
            selectAllCheckbox.checked = true;
            renderSongList();
            statusDiv.innerText = `${allSongs.length} cached songs. Checking for new...`;
            
            // Check for new songs
            setTimeout(() => checkForNewSongs(), 100);
        }
    });

    // Back button
    backBtn.addEventListener("click", () => {
        settingsPanel.style.display = "block";
        songListContainer.style.display = "none";
        fetchBtn.disabled = false;
        fetchBtn.textContent = "Fetch Songs List";
        viewSongsBtn.classList.add("hidden");
        allSongs = [];
        filteredSongs = [];
        clearStorage();
    });

    // Filter input
    filterInput.addEventListener("input", () => {
        applyFilter();
    });

    // Select all checkbox
    selectAllCheckbox.addEventListener("change", () => {
        const checkboxes = songList.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => cb.checked = selectAllCheckbox.checked);
        updateSelectedCount();
    });

    // Download selected songs
    downloadBtn.addEventListener("click", () => {
        const selectedIds = getSelectedSongIds();
        if (selectedIds.length === 0) {
            statusDiv.innerText = "No songs selected!";
            return;
        }
        
        const folder = folderInput.value;
        const songsToDownload = allSongs.filter(s => selectedIds.includes(s.id));
        
        downloadBtn.disabled = true;
        downloadBtn.textContent = "Downloading...";
        
        api.runtime.sendMessage({ 
            action: "download_selected", 
            folderName: folder,
            songs: songsToDownload
        });
        
        statusDiv.innerText = `Downloading ${songsToDownload.length} songs...`;
    });

    // Listen for messages from background
    api.runtime.onMessage.addListener((message) => {
        if (message.action === "log") {
            statusDiv.innerText = message.text + "\n" + statusDiv.innerText;
        }
        
        if (message.action === "songs_fetched") {
            const newSongs = message.songs || [];
            const wasCheckingNew = message.checkNewOnly && allSongs.length > 0;
            
            if (wasCheckingNew) {
                // Merge with existing songs
                const addedCount = mergeSongs(newSongs);
                if (addedCount > 0) {
                    statusDiv.innerText = `Found ${addedCount} new song(s). Total: ${allSongs.length}`;
                } else {
                    statusDiv.innerText = `${allSongs.length} songs (no new songs found).`;
                }
            } else {
                // Fresh fetch - replace all
                allSongs = newSongs;
                filteredSongs = [...allSongs];
                
                settingsPanel.style.display = "none";
                songListContainer.style.display = "block";
                
                filterInput.value = "";
                selectAllCheckbox.checked = true;
                
                renderSongList();
                saveToStorage();
                statusDiv.innerText = `Found ${allSongs.length} songs.`;
            }
            
            // Update View Songs button
            viewSongsBtn.textContent = `View ${allSongs.length} Cached Songs`;
            viewSongsBtn.classList.remove("hidden");
            
            stopBtn.classList.add("hidden");
            fetchBtn.disabled = false;
            fetchBtn.textContent = "Fetch Songs List";
        }
        
        if (message.action === "fetch_error") {
            fetchBtn.disabled = false;
            fetchBtn.textContent = "Fetch Songs List";
            stopBtn.classList.add("hidden");
            statusDiv.innerText = message.error;
        }
        
        if (message.action === "download_complete") {
            downloadBtn.disabled = false;
            downloadBtn.textContent = "Download Selected";
        }
    });

    function applyFilter() {
        const filter = filterInput.value.toLowerCase();
        filteredSongs = allSongs.filter(song => 
            song.title.toLowerCase().includes(filter)
        );
        renderSongList();
    }

    function renderSongList() {
        songList.innerHTML = "";
        
        filteredSongs.forEach(song => {
            const item = document.createElement("div");
            item.className = "song-item";
            
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.dataset.id = song.id;
            checkbox.checked = true;
            checkbox.addEventListener("change", updateSelectedCount);
            
            const songInfo = document.createElement("div");
            songInfo.className = "song-info";
            
            const titleDiv = document.createElement("div");
            titleDiv.className = "song-title";
            titleDiv.title = song.title;
            titleDiv.textContent = song.title;
            
            const metaDiv = document.createElement("div");
            metaDiv.className = "song-meta";
            
            const visibilitySpan = document.createElement("span");
            visibilitySpan.className = song.is_public ? 'public' : 'private';
            visibilitySpan.textContent = song.is_public ? '🌐 Public' : '🔒 Private';
            metaDiv.appendChild(visibilitySpan);
            
            if (song.created_at) {
                metaDiv.appendChild(document.createTextNode(' • ' + formatDate(song.created_at)));
            }
            
            songInfo.appendChild(titleDiv);
            songInfo.appendChild(metaDiv);
            
            item.appendChild(checkbox);
            item.appendChild(songInfo);
            songList.appendChild(item);
        });
        
        updateSelectedCount();
    }

    function getSelectedSongIds() {
        const checkboxes = songList.querySelectorAll('input[type="checkbox"]:checked');
        return Array.from(checkboxes).map(cb => cb.dataset.id);
    }

    function updateSelectedCount() {
        const total = filteredSongs.length;
        const selected = getSelectedSongIds().length;
        songCount.textContent = `${selected}/${total} selected`;
        
        // Update select all checkbox state
        const allChecked = songList.querySelectorAll('input[type="checkbox"]').length === 
                          songList.querySelectorAll('input[type="checkbox"]:checked').length;
        selectAllCheckbox.checked = allChecked && total > 0;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatDate(dateStr) {
        try {
            return new Date(dateStr).toLocaleDateString();
        } catch {
            return '';
        }
    }
});

