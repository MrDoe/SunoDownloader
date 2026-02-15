// content.js
(async function() {
    const api = (typeof browser !== 'undefined') ? browser : chrome;
    
    function log(text) {
        api.runtime.sendMessage({ action: "log", text: text });
    }

    const token = window.sunoAuthToken;
    const isPublicOnly = window.sunoPublicOnly;
    const maxPages = window.sunoMaxPages || 0; // 0 = unlimited
    const checkNewOnly = window.sunoCheckNewOnly || false;
    const knownIds = new Set(window.sunoKnownIds || []);
    const userId = window.sunoUserId || null;
    const mode = window.sunoMode || "fetch"; // "fetch" to get list

    if (!token) {
        api.runtime.sendMessage({ action: "fetch_error_internal", error: "❌ Fatal: No Auth Token received." });
        return;
    }

    const modeLabel = isPublicOnly ? "Public Songs Only" : "All Songs";
    const pagesLabel = maxPages > 0 ? `, max ${maxPages} pages` : "";
    if (!checkNewOnly) {
        log(`🔍 Fetching songs (${modeLabel}${pagesLabel})...`);
    }

    let keepGoing = true;
    let allSongs = [];
    let cursor = null;
    
    // Adaptive settings
    let delay = 300;
    let successStreak = 0;
    const minDelay = 200;
    const maxDelay = 5000;

    async function fetchPage(cursorValue) {
        // IMPORTANT (Firefox Android compatibility): do the network request in the background
        // to avoid content-script fetch/CORS edge cases.
        const res = await Promise.race([
            api.runtime.sendMessage({
                action: "fetch_feed_page",
                token,
                cursor: cursorValue || null,
                isPublicOnly,
                userId
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout contacting background')), 25000))
        ]).catch((e) => ({ ok: false, status: 0, error: e?.message || String(e) }));

        // If the background didn't respond properly, throw to trigger retry logic.
        if (!res?.ok && (!res?.status || res.status === 0)) {
            throw new Error(res?.error || 'Background fetch failed');
        }

        // Emulate the minimal Response shape the rest of the code expects.
        return {
            ok: !!res?.ok,
            status: typeof res?.status === 'number' ? res.status : 0,
            json: async () => {
                if (res?.data) return res.data;
                return {};
            }
        };
    }

    async function fetchWithRetry(cursorValue) {
        let retries = 0;
        const maxRetries = 5;
        
        while (retries < maxRetries) {
            try {
                const response = await fetchPage(cursorValue);
                
                if (response.status === 429) {
                    retries++;
                    delay = Math.min(maxDelay, delay * 2);
                    successStreak = 0;
                    const waitTime = Math.pow(2, retries) * 1000;
                    log(`⏳ Rate limited (${delay}ms delay). Waiting ${waitTime / 1000}s...`);
                    await new Promise(r => setTimeout(r, waitTime));
                    continue;
                }
                
                // Success - potentially speed up
                successStreak++;
                if (successStreak >= 5 && delay > minDelay) {
                    delay = Math.max(minDelay, Math.floor(delay * 0.8));
                    successStreak = 0;
                }
                
                return response;
            } catch (err) {
                retries++;
                if (retries >= maxRetries) throw err;
                await new Promise(r => setTimeout(r, 1000 * retries));
            }
        }
        return null;
    }

    let pageNum = 0;
    try {
        while (keepGoing) {
            // Check if stop was requested
            if (window.sunoStopFetch) {
                log(`⏹️ Stopped by user. Found ${allSongs.length} songs.`);
                break;
            }
            
            // Check max pages limit
            pageNum++;
            if (maxPages > 0 && pageNum > maxPages) {
                log(`✅ Reached max pages limit (${maxPages}). Found ${allSongs.length} songs.`);
                break;
            }
            
            log(`📄 Page ${pageNum}${maxPages > 0 ? '/' + maxPages : ''} | ${allSongs.length} songs`);

            const response = await fetchWithRetry(cursor);
            
            if (!response) {
                api.runtime.sendMessage({ action: "fetch_error_internal", error: `❌ API Error: Max retries exceeded` });
                return;
            }
            
            if (response.status === 401) {
                api.runtime.sendMessage({ action: "fetch_error_internal", error: "❌ Error 401: Token expired." });
                return;
            }
            if (!response.ok) {
                api.runtime.sendMessage({ action: "fetch_error_internal", error: `❌ API Error: ${response.status}` });
                return;
            }

            const data = await response.json();
            const clips = data.clips || [];
            cursor = data.next_cursor;
            const hasMore = data.has_more;

            if (!clips || clips.length === 0) {
                log(`✅ End of list. Found ${allSongs.length} songs total.`);
                keepGoing = false;
                break;
            }
            
            if (!hasMore) {
                // Process this last page, then stop
                keepGoing = false;
            }
            
            let foundKnownSong = false;

            for (const clip of clips) {
                if (isPublicOnly && !clip.is_public) {
                    continue;
                }

                if (checkNewOnly && knownIds.has(clip.id)) {
                    log(`✅ Found known song. ${allSongs.length} new song(s) found.`);
                    foundKnownSong = true;
                    break;
                }

                allSongs.push({
                    id: clip.id,
                    title: clip.title || `Untitled_${clip.id}`,
                    audio_url: clip.audio_url || null,
                    is_public: clip.is_public,
                    created_at: clip.created_at,
                    is_liked: clip.is_liked || false,
                    is_stem: clip.stem_of ? true : false
                });
            }

            if (foundKnownSong) {
                keepGoing = false;
                break;
            }
            
            if (!cursor) {
                log(`✅ End of list. Found ${allSongs.length} songs total.`);
                keepGoing = false;
                break;
            }

            await new Promise(r => setTimeout(r, delay));
        }
        
        log(`✅ Found ${allSongs.length} songs.`);
        
        // Send songs list back to background script
        api.runtime.sendMessage({ 
            action: "songs_list", 
            songs: allSongs,
            checkNewOnly: checkNewOnly
        });

    } catch (err) {
        api.runtime.sendMessage({ action: "fetch_error_internal", error: `❌ Critical Error: ${err.message}` });
    }
})();

