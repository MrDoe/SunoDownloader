// popup.js
const api = (typeof browser !== 'undefined') ? browser : chrome;

document.addEventListener('DOMContentLoaded', () => {
    
    const startBtn = document.getElementById("startBtn");
    const statusDiv = document.getElementById("status");
    const folderInput = document.getElementById("folder");
    const publicCheckbox = document.getElementById("publicOnly"); // <--- New

    startBtn.addEventListener("click", () => {
        const folder = folderInput.value;
        const isPublicOnly = publicCheckbox.checked; // <--- Get Value
        
        // Send folder AND isPublicOnly to background
        api.runtime.sendMessage({ 
            action: "start_download", 
            folderName: folder,
            isPublicOnly: isPublicOnly 
        });
        
        statusDiv.innerText = "Request sent to background...";
    });

    api.runtime.onMessage.addListener((message) => {
        if (message.action === "log") {
            statusDiv.innerText = message.text + "\n" + statusDiv.innerText;
        }
    });
});

