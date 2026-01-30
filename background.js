// background.js
const api = (typeof browser !== 'undefined') ? browser : chrome;

let stopFetchRequested = false;

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "fetch_songs") {
        stopFetchRequested = false;
        fetchSongsList(message.isPublicOnly, message.maxPages, message.checkNewOnly);
    }
    
    if (message.action === "stop_fetch") {
        stopFetchRequested = true;
        // Notify content script to stop
        api.tabs.query({ active: true, currentWindow: true }).then(tabs => {
            if (tabs[0]) {
                api.scripting.executeScript({
                    target: { tabId: tabs[0].id },
                    func: () => { window.sunoStopFetch = true; }
                });
            }
        });
    }
    
    if (message.action === "check_stop") {
        sendResponse({ stop: stopFetchRequested });
        return true;
    }

    if (message.action === "download_selected") {
        downloadSelectedSongs(message.folderName, message.songs);
    }

    if (message.action === "download_item") {
        api.downloads.download({
            url: message.url,
            filename: message.filename,
            conflictAction: "uniquify"
        });
    }
    
    if (message.action === "songs_list") {
        // Forward songs list from content script to popup
        api.runtime.sendMessage({ 
            action: "songs_fetched", 
            songs: message.songs,
            checkNewOnly: message.checkNewOnly
        });
    }
    
    if (message.action === "fetch_error_internal") {
        api.runtime.sendMessage({ action: "fetch_error", error: message.error });
    }
});

async function fetchSongsList(isPublicOnly, maxPages, checkNewOnly = false) {
    try {
        const tabs = await api.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0 || !tabs[0].url.includes("suno.com")) {
            api.runtime.sendMessage({ action: "fetch_error", error: "❌ Error: Please open Suno.com in the active tab." });
            return;
        }
        const tabId = tabs[0].id;

        if (!checkNewOnly) {
            logToPopup("🔑 Extracting Auth Token...");
        }

        const tokenResults = await api.scripting.executeScript({
            target: { tabId: tabId },
            world: "MAIN",
            func: async () => {
                try {
                    if (window.Clerk && window.Clerk.session) {
                        return await window.Clerk.session.getToken();
                    }
                    return null;
                } catch (e) { return null; }
            }
        });

        const token = tokenResults[0]?.result;

        if (!token) {
            api.runtime.sendMessage({ action: "fetch_error", error: "❌ Error: Could not find Auth Token. Log in first!" });
            return;
        }

        if (!checkNewOnly) {
            logToPopup("✅ Token found! Fetching songs list...");
        }

        await api.scripting.executeScript({
            target: { tabId: tabId },
            func: (t, p, m, c) => { 
                window.sunoAuthToken = t; 
                window.sunoPublicOnly = p;
                window.sunoMaxPages = m;
                window.sunoCheckNewOnly = c;
                window.sunoStopFetch = false;
                window.sunoMode = "fetch";
            },
            args: [token, isPublicOnly, maxPages, checkNewOnly]
        });

        await api.scripting.executeScript({
            target: { tabId: tabId },
            files: ["content.js"]
        });

    } catch (err) {
        console.error(err);
        api.runtime.sendMessage({ action: "fetch_error", error: "❌ System Error: " + err.message });
    }
}

async function downloadSelectedSongs(folderName, songs) {
    const cleanFolder = folderName.replace(/[^a-zA-Z0-9_-]/g, "");
    
    function sanitizeFilename(name) {
        return name.replace(/[<>:"/\\|?*]/g, "").trim().substring(0, 100);
    }
    
    logToPopup(`🚀 Starting download of ${songs.length} songs...`);
    
    let downloadedCount = 0;
    
    for (const song of songs) {
        if (song.audio_url) {
            const title = song.title || `Untitled_${song.id}`;
            const filename = `${cleanFolder}/${sanitizeFilename(title)}_${song.id.slice(-4)}.mp3`;
            
            try {
                await api.downloads.download({
                    url: song.audio_url,
                    filename: filename,
                    conflictAction: "uniquify"
                });
                downloadedCount++;
                
                if (downloadedCount % 5 === 0) {
                    logToPopup(`📥 Downloaded ${downloadedCount}/${songs.length}...`);
                }
            } catch (err) {
                logToPopup(`⚠️ Failed: ${title}`);
            }
            
            // Small delay to avoid overwhelming the browser
            await new Promise(r => setTimeout(r, 200));
        }
    }
    
    logToPopup(`🎉 COMPLETE! Downloaded ${downloadedCount} songs.`);
    api.runtime.sendMessage({ action: "download_complete" });
}

function logToPopup(text) {
    try { api.runtime.sendMessage({ action: "log", text: text }); } catch (e) {}
}

