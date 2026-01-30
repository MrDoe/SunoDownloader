// background.js
const api = (typeof browser !== 'undefined') ? browser : chrome;

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "start_download") {
        // Pass the new parameter to the start function
        startProcess(message.folderName, message.isPublicOnly);
    }

    if (message.action === "download_item") {
        api.downloads.download({
            url: message.url,
            filename: message.filename,
            conflictAction: "uniquify"
        });
    }
});

async function startProcess(folderName, isPublicOnly) {
    try {
        const tabs = await api.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0 || !tabs[0].url.includes("suno.com")) {
            logToPopup("❌ Error: Please open Suno.com in the active tab.");
            return;
        }
        const tabId = tabs[0].id;

        logToPopup("🔑 Extracting Auth Token...");

        // 1. Get Token from Main World
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
            logToPopup("❌ Error: Could not find Auth Token. Log in first!");
            return;
        }

        logToPopup("✅ Token found! Injecting scraper...");

        // 2. Inject Variables (Token + Folder + PublicSetting)
        await api.scripting.executeScript({
            target: { tabId: tabId },
            func: (t, f, p) => { 
                window.sunoAuthToken = t; 
                window.sunoDownloadFolder = f;
                window.sunoPublicOnly = p; // <--- Store the checkbox value
            },
            args: [token, folderName, isPublicOnly]
        });

        // 3. Run Content Script
        await api.scripting.executeScript({
            target: { tabId: tabId },
            files: ["content.js"]
        });

    } catch (err) {
        console.error(err);
        logToPopup("❌ System Error: " + err.message);
    }
}

function logToPopup(text) {
    try { api.runtime.sendMessage({ action: "log", text: text }); } catch (e) {}
}

