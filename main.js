// main.js - Electron 主进程 (v5 - 修复 ISO-8859-1 解码错误)

const { app, BrowserWindow, ipcMain, nativeTheme, Menu, Tray, dialog, shell, systemPreferences, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs'); 
const Store = require('electron-store'); 
const fetch = require('node-fetch'); 
const chardet = require('chardet'); 
const { v4: uuidv4 } = require('uuid'); 
const log = require('electron-log'); 
const AutoLaunch = require('auto-launch'); 

// --- 全局变量和常量 ---
let mainWindow;
let tray = null;
const store = new Store(); 

const SUBSCRIPTIONS_STORE_KEY = "subscriptions";
const SETTINGS_STORE_KEY = "settings";
const DEFAULT_USER_ICON_NAME = 'user_app_icon'; 

const DEFAULT_APP_TITLE = "主动可用性监测平台";

const DEFAULT_SETTINGS = {
    app_title: DEFAULT_APP_TITLE,
    url_check_interval: 30,
    url_check_interval_unit: "minutes", 
    start_with_windows: false,
    start_minimized: false,
    webhooks: [], 
    fault_renotification_interval_minutes: 60, 
    notify_on_recovery: true,
    subscription_source_urls: [],
    auto_update_sources_interval_minutes: 60, 
    app_icon_path: null, 
    fault_confirm_attempts: 2, 
    fault_confirm_interval_seconds: 10, 
};

let settings = {}; 
let subscriptions = []; 
let nodeCheckSchedulerId = null;
let sourceUpdateSchedulerId = null;
let uiReady = false;
let logQueueForUi = [];
let appIsQuitting = false; 

log.transports.file.resolvePath = () => path.join(app.getPath('userData'), 'logs', `main-${new Date().toISOString().split('T')[0]}.log`);
log.transports.file.level = 'info'; 
log.transports.console.level = 'debug'; 

let appAutoLauncher;
if (app.isPackaged) {
    appAutoLauncher = new AutoLaunch({
        name: DEFAULT_APP_TITLE, 
        path: app.getPath('exe'), 
        isHidden: false, 
    });
}

function getAppIconPath() {
    if (settings && settings.app_icon_path && fs.existsSync(settings.app_icon_path)) {
        return settings.app_icon_path;
    }
    let defaultIconName = 'app_icon.png'; 
    if (process.platform === 'win32') {
        defaultIconName = 'app_icon.ico';
    } else if (process.platform === 'darwin') {
        defaultIconName = 'app_icon.icns'; 
        if (!fs.existsSync(path.join(__dirname, 'ui', defaultIconName))) {
            defaultIconName = 'app_icon.png';
        }
    }
    const bundledIconPath = path.join(__dirname, 'ui', defaultIconName);
    if (fs.existsSync(bundledIconPath)) {
        return bundledIconPath;
    }
    logMessage(`默认应用图标未找到: ${bundledIconPath}`, 'error');
    return null; 
}

function updateApplicationIcons(iconPathInput) {
    let actualIconPath = iconPathInput;
    if (!actualIconPath || !fs.existsSync(actualIconPath)) {
        logMessage(`更新应用图标失败：提供的路径无效或文件不存在 "${actualIconPath}"。尝试使用默认图标。`, 'warn');
        actualIconPath = getAppIconPath(); 
        if (!actualIconPath) {
            logMessage(`更新应用图标失败：无法找到有效的备用图标路径。`, 'error');
            return;
        }
    }

    try {
        const image = nativeImage.createFromPath(actualIconPath);
        if (image.isEmpty()){
            logMessage(`从路径创建 NativeImage 失败: "${actualIconPath}"`, 'error');
            return;
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setIcon(image);
            logMessage(`主窗口图标已更新为: ${actualIconPath}`, 'info');
        }
        if (tray && !tray.isDestroyed()) {
            tray.setImage(image); 
            logMessage(`系统托盘图标已更新为: ${actualIconPath}`, 'info');
        }
        if (mainWindow && !mainWindow.isDestroyed() && uiReady) {
            mainWindow.webContents.send('update-app-icon-display', actualIconPath);
        }
    } catch (error) {
        logMessage(`更新应用图标时发生错误: ${error.message}`, 'error');
    }
}

function logMessage(message, level = 'info') {
    switch (level.toLowerCase()) {
        case 'error': log.error(message); break;
        case 'warn': log.warn(message); break;
        case 'debug': log.debug(message); break;
        case 'verbose': log.verbose(message); break;
        default: log.info(message);
    }
    const uiLogTimestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    let uiMessage = message;
    if (typeof message !== 'string') {
        try { uiMessage = JSON.stringify(message); } catch (e) { uiMessage = String(message); }
    }
    uiMessage = uiMessage.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
    uiMessage = uiMessage.replace(/"/g, "'").replace(/\n/g, " ");
    const logEntryForUi = `${uiLogTimestamp}: ${uiMessage}`;

    if (mainWindow && !mainWindow.isDestroyed() && uiReady) {
        while (logQueueForUi.length > 0) {
            const queuedLog = logQueueForUi.shift();
            try { mainWindow.webContents.send('add-log-entry', queuedLog); } catch (e) { log.error(`CRITICAL - Error sending queued log to UI: ${e.message}`); }
        }
        try { mainWindow.webContents.send('add-log-entry', logEntryForUi); } catch (e) { log.error(`CRITICAL - Error sending log to UI: ${e.message}`); }
    } else {
        logQueueForUi.push(logEntryForUi);
    }
}

function loadSettings() {
    const loadedSettings = store.get(SETTINGS_STORE_KEY);
    let tempSettings = { ...DEFAULT_SETTINGS }; 

    if (loadedSettings && typeof loadedSettings === 'object') {
        tempSettings = {
            ...tempSettings,
            ...loadedSettings,
            url_check_interval: parseInt(loadedSettings.url_check_interval, 10) || DEFAULT_SETTINGS.url_check_interval,
            url_check_interval_unit: ['seconds', 'minutes'].includes(loadedSettings.url_check_interval_unit) ? loadedSettings.url_check_interval_unit : DEFAULT_SETTINGS.url_check_interval_unit,
            start_with_windows: typeof loadedSettings.start_with_windows === 'boolean' ? loadedSettings.start_with_windows : DEFAULT_SETTINGS.start_with_windows,
            start_minimized: typeof loadedSettings.start_minimized === 'boolean' ? loadedSettings.start_minimized : DEFAULT_SETTINGS.start_minimized,
            fault_renotification_interval_minutes: parseInt(loadedSettings.fault_renotification_interval_minutes), 
            notify_on_recovery: typeof loadedSettings.notify_on_recovery === 'boolean' ? loadedSettings.notify_on_recovery : DEFAULT_SETTINGS.notify_on_recovery,
            auto_update_sources_interval_minutes: parseInt(loadedSettings.auto_update_sources_interval_minutes, 10) || DEFAULT_SETTINGS.auto_update_sources_interval_minutes,
            webhooks: Array.isArray(loadedSettings.webhooks) ? loadedSettings.webhooks : DEFAULT_SETTINGS.webhooks,
            subscription_source_urls: Array.isArray(loadedSettings.subscription_source_urls) ? loadedSettings.subscription_source_urls : DEFAULT_SETTINGS.subscription_source_urls,
            app_icon_path: typeof loadedSettings.app_icon_path === 'string' ? loadedSettings.app_icon_path : DEFAULT_SETTINGS.app_icon_path,
            fault_confirm_attempts: parseInt(loadedSettings.fault_confirm_attempts, 10), 
            fault_confirm_interval_seconds: parseInt(loadedSettings.fault_confirm_interval_seconds, 10), 
        };
        if (isNaN(tempSettings.fault_renotification_interval_minutes)) {
            tempSettings.fault_renotification_interval_minutes = DEFAULT_SETTINGS.fault_renotification_interval_minutes;
        }
        if (isNaN(tempSettings.fault_confirm_attempts) || tempSettings.fault_confirm_attempts < 0) {
            tempSettings.fault_confirm_attempts = DEFAULT_SETTINGS.fault_confirm_attempts;
        }
        if (isNaN(tempSettings.fault_confirm_interval_seconds) || tempSettings.fault_confirm_interval_seconds < 1) {
            tempSettings.fault_confirm_interval_seconds = DEFAULT_SETTINGS.fault_confirm_interval_seconds;
        }

        tempSettings.webhooks = tempSettings.webhooks.map(wh => ({
            id: wh.id || uuidv4(),
            name: wh.name || "未命名 Webhook",
            type: wh.type || "custom",
            url: wh.url || "",
            custom_payload_template: wh.custom_payload_template || '{"text": "{message}"}',
            enabled: typeof wh.enabled === 'boolean' ? wh.enabled : true,
            notify_on_recovery: typeof wh.notify_on_recovery === 'boolean' ? wh.notify_on_recovery : tempSettings.notify_on_recovery, 
            renotification_interval_minutes: typeof wh.renotification_interval_minutes === 'number' ? wh.renotification_interval_minutes : tempSettings.fault_renotification_interval_minutes, 
        }));
    }
    settings = tempSettings;
    logMessage("设置已加载。", "info");
    if (!loadedSettings) { 
        saveSettings();
    }
}

function saveSettings() {
    try {
        if (settings.webhooks && Array.isArray(settings.webhooks)) {
            settings.webhooks.forEach(wh => { if (!wh.id) wh.id = uuidv4(); });
        }
        store.set(SETTINGS_STORE_KEY, settings);
        logMessage("设置已保存。", "info");

        if (appAutoLauncher) {
            appAutoLauncher.isEnabled().then((isEnabled) => {
                if (settings.start_with_windows && !isEnabled) {
                    appAutoLauncher.enable().catch(err => logMessage(`启用开机自启失败: ${err.message}`, 'error'));
                } else if (!settings.start_with_windows && isEnabled) {
                    appAutoLauncher.disable().catch(err => logMessage(`禁用开机自启失败: ${err.message}`, 'error'));
                }
            }).catch((err) => { logMessage(`检查开机自启状态时出错: ${err.message}`, 'error'); });
        }
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.getTitle() !== settings.app_title) {
            mainWindow.setTitle(settings.app_title);
        }
        if (tray && !tray.isDestroyed()) { // 修复：直接设置，不获取
            tray.setToolTip(settings.app_title || DEFAULT_APP_TITLE);
        }
    } catch (e) {
        logMessage(`保存设置出错: ${e.message}`, 'error');
    }
}

function loadSubscriptions() {
    const loadedSubs = store.get(SUBSCRIPTIONS_STORE_KEY);
    if (loadedSubs && Array.isArray(loadedSubs)) {
        subscriptions = loadedSubs.map(sub => ({
            name: sub.name || "未知节点",
            url: sub.url,
            raw_line: sub.raw_line || sub.url,
            status: sub.status || "pending",
            last_checked: sub.last_checked || null,
            previous_status: sub.previous_status || null,
            last_notified_status: sub.last_notified_status || null,
            last_notification_time: sub.last_notification_time || 0.0,
            origin_url: sub.origin_url || null,
            _fault_retry_count: sub._fault_retry_count || 0, 
            _potential_fault_status: sub._potential_fault_status || null,
        }));
    } else {
        subscriptions = [];
    }
    logMessage(`订阅列表已加载，共 ${subscriptions.length} 个节点。`, "info");
}

function saveSubscriptions() {
    try {
        const subsToSave = subscriptions.map(sub => {
            const { _fault_retry_count, _potential_fault_status, ...rest } = sub;
            return rest; 
        });
        store.set(SUBSCRIPTIONS_STORE_KEY, subsToSave);
        logMessage("订阅列表已保存。", "info");
    } catch (e) {
        logMessage(`保存订阅列表出错: ${e.message}`, 'error');
    }
}

async function decodeContentRobustly(rawBuffer, headers = {}, sourceUrlForDebug = "") {
    const contentType = (headers['content-type'] || '').toLowerCase();
    let charsetFromHeader = null;
    if (contentType.includes('charset=')) {
        charsetFromHeader = contentType.split('charset=')[1].split(';')[0].trim();
        if (charsetFromHeader) {
            try { 
                // 修正：将 ISO-8859-1 映射到 latin1
                const nodeEncoding = charsetFromHeader.toUpperCase() === 'ISO-8859-1' ? 'latin1' : charsetFromHeader;
                return rawBuffer.toString(nodeEncoding); 
            } catch (e) {
                logMessage(`使用 Header 中的字符集 ${charsetFromHeader} (尝试映射为 ${nodeEncoding}) 解码失败 (源: ${sourceUrlForDebug}): ${e.message}`, 'warn');
            }
        }
    }
    try {
        let detectedCharset = chardet.detect(rawBuffer); // chardet 可能返回 null 或一个数组
        if (Array.isArray(detectedCharset)) { // 如果 chardet 返回数组，取第一个（通常是置信度最高的）
            detectedCharset = detectedCharset.length > 0 ? detectedCharset[0] : null;
        }

        if (detectedCharset) { 
            try { 
                // 修正：将 ISO-8859-1 映射到 latin1
                const nodeEncoding = detectedCharset.toUpperCase() === 'ISO-8859-1' ? 'latin1' : detectedCharset;
                return rawBuffer.toString(nodeEncoding); 
            } catch (e) {
                logMessage(`使用 chardet 检测到的字符集 ${detectedCharset} (尝试映射为 ${nodeEncoding}) 解码失败 (源: ${sourceUrlForDebug}): ${e.message}`, 'warn');
            }
        }
    } catch (e) { logMessage(`Chardet 检测失败 (源: ${sourceUrlForDebug}): ${e.message}`, 'warn'); }

    for (const enc of ['utf8', 'gbk', 'gb2312', 'latin1']) { // 添加 latin1 到备选列表
        try { return rawBuffer.toString(enc); } catch (e) { /* continue */ }
    }
    logMessage(`所有解码尝试失败，使用默认解码 (源: ${sourceUrlForDebug})`, 'warn');
    return rawBuffer.toString(); // Node.js 默认 utf8
}

function unquoteNameRobustly(nameRawStr, sourceUrlForDebug = "") {
    if (!nameRawStr.includes('%')) return nameRawStr;
    try {
        return decodeURIComponent(nameRawStr); 
    } catch (e) {
        logMessage(`使用 decodeURIComponent (UTF-8) 解码名称 "${nameRawStr}" 失败 (源: ${sourceUrlForDebug}): ${e.message}。`, 'warn');
        return nameRawStr;
    }
}

async function fetchAndParseSubscriptionUrl(subUrl) {
    logMessage(`开始从源获取节点: ${subUrl}`, "info");
    let nodes = [];
    try {
        const response = await fetch(subUrl, { timeout: 15000, redirect: 'follow' });
        if (!response.ok) {
            logMessage(`获取订阅 ${subUrl} 失败: HTTP 状态 ${response.status} ${response.statusText}`, 'error');
            return [];
        }

        const rawBuffer = await response.buffer();
        let parsedContentText = null;
        let isBase64Source = false;

        if (rawBuffer.length > 20 && !rawBuffer.slice(0, 100).toString().match(/[\s\r\n\t]/)) {
            try {
                const base64DecodedBuffer = Buffer.from(rawBuffer.toString('ascii'), 'base64');
                const tempDecodedText = await decodeContentRobustly(base64DecodedBuffer, response.headers, `${subUrl} (as Base64)`);
                if (tempDecodedText && (tempDecodedText.includes('://') || tempDecodedText.includes(','))) {
                    parsedContentText = tempDecodedText;
                    isBase64Source = true;
                    logMessage(`源 ${subUrl} 被识别并成功解码为 Base64。`, "info");
                } else {
                     logMessage(`源 ${subUrl} 疑似 Base64 但解码后内容不符合预期。`, "warn");
                }
            } catch (e) {
                logMessage(`尝试 Base64 解码源 ${subUrl} 失败: ${e.message}`, 'warn');
            }
        }

        if (!isBase64Source || !parsedContentText) {
            parsedContentText = await decodeContentRobustly(rawBuffer, response.headers, subUrl);
        }
        
        if (!parsedContentText) {
            logMessage(`无法解码来自 ${subUrl} 的订阅内容。`, 'error');
            return [];
        }

        const lines = parsedContentText.trim().split(/\r?\n/);
        lines.forEach(lineStr => {
            lineStr = lineStr.trim();
            if (!lineStr || lineStr.startsWith("#")) return;

            let name = "";
            let urlVal = "";
            const firstCommaIndex = lineStr.indexOf(',');

            if (firstCommaIndex !== -1) {
                const namePart = lineStr.substring(0, firstCommaIndex).trim();
                const urlPart = lineStr.substring(firstCommaIndex + 1).trim();
                if (namePart && urlPart && urlPart.includes("://")) { 
                    name = unquoteNameRobustly(namePart, subUrl);
                    urlVal = urlPart;
                } else if (namePart.includes("://") && !urlPart) { 
                    urlVal = namePart;
                     try { name = new URL(urlVal).hostname; } catch { name = "未知主机"; }
                }
            } else if (lineStr.includes('://')) {
                urlVal = lineStr;
                try {
                    const parsedUrl = new URL(urlVal);
                    name = unquoteNameRobustly(parsedUrl.hostname, subUrl) || "未知主机";
                } catch (e) {
                    name = "格式无效的URL"; 
                    logMessage(`解析行 "${lineStr}" 中的URL失败 (源: ${subUrl}): ${e.message}`, 'warn');
                    urlVal = ""; 
                }
            }

            if (urlVal) {
                 nodes.push({
                    name: name,
                    url: urlVal,
                    raw_line: lineStr,
                    status: "pending", 
                    last_checked: null,
                    previous_status: null,
                    last_notified_status: null,
                    last_notification_time: 0.0,
                    origin_url: subUrl,
                    _fault_retry_count: 0, 
                    _potential_fault_status: null, 
                });
            } else {
                logMessage(`跳过无效行: "${lineStr}" (源: ${subUrl})`, 'debug');
            }
        });
        logMessage(`从 ${subUrl} 获取并解析了 ${nodes.length} 个节点。`, "info");
        return nodes;

    } catch (e) {
        logMessage(`获取或处理订阅 ${subUrl} 时发生严重错误: ${e.message} ${e.stack ? '\nStack: ' + e.stack : ''}`, 'error');
        return [];
    }
}

async function fetchAndMergeNodesFromSource(sourceUrl) {
    logMessage(`开始从源合并节点: ${sourceUrl}`, "info");
    const newlyParsedNodes = await fetchAndParseSubscriptionUrl(sourceUrl);

    if (!newlyParsedNodes) { 
        logMessage(`从源 ${sourceUrl} 获取节点失败或无节点，保留当前列表。`, 'warn');
        return false;
    }

    const existingNodesFromThisSource = subscriptions.filter(node => node.origin_url === sourceUrl);
    const otherSourceNodes = subscriptions.filter(node => node.origin_url !== sourceUrl);
    
    let updatedNodesForThisSource = [];
    let addedCount = 0;
    let updatedCount = 0;

    for (const newNodeData of newlyParsedNodes) {
        const existingNode = existingNodesFromThisSource.find(n => n.url === newNodeData.url);
        if (existingNode) {
            existingNode.name = newNodeData.name;
            existingNode.raw_line = newNodeData.raw_line; 
            updatedNodesForThisSource.push(existingNode);
            updatedCount++;
        } else {
            updatedNodesForThisSource.push(newNodeData);
            addedCount++;
        }
    }
    
    const newUrlsFromSource = new Set(updatedNodesForThisSource.map(n => n.url));
    const removedNodes = existingNodesFromThisSource.filter(n => !newUrlsFromSource.has(n.url));
    const removedCount = removedNodes.length;

    if (removedCount > 0) {
        removedNodes.forEach(node => {
            logMessage(`节点 (URL: ${node.url}, 名称: ${node.name}) 已从源 ${sourceUrl} 移除。`, "info");
        });
    }

    if (addedCount > 0 || updatedCount > 0 || removedCount > 0) {
        logMessage(`源 ${sourceUrl} 处理完毕: 新增 ${addedCount}, 更新 ${updatedCount}, 移除 ${removedCount}。`, "info");
        subscriptions = [...otherSourceNodes, ...updatedNodesForThisSource];
        saveSubscriptions();
        if (mainWindow && !mainWindow.isDestroyed() && uiReady) {
            mainWindow.webContents.send('refresh-subscription-list', subscriptions);
        }
        return true;
    } else {
        logMessage(`源 ${sourceUrl} 未导致订阅列表内容变化。`, "info");
        return false;
    }
}

async function performSingleNodeCheck(nodeUrl) {
    let checkStatus = "pending";
    const nodeTimestamp = new Date().toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'medium', hour12: false });
    try {
        const response = await fetch(nodeUrl, { timeout: 7000, redirect: 'follow' });
        if (response.ok) { 
            checkStatus = "online";
        } else {
            checkStatus = `error (${response.status})`;
        }
    } catch (e) {
        if (e.type === 'request-timeout' || (e.name && e.name === 'AbortError')) {
            checkStatus = "error (timeout)";
        } else {
            checkStatus = "error (connection)";
        }
    }
    return { status: checkStatus, last_checked: nodeTimestamp };
}

async function checkNodeUrl(node) {
    const originalStatus = node.status || "pending"; 
    let finalDeterminedStatus = "pending";
    let checkResult;

    checkResult = await performSingleNodeCheck(node.url);
    node.last_checked = checkResult.last_checked; 

    if (checkResult.status === "online") {
        finalDeterminedStatus = "online";
        node._fault_retry_count = 0; 
        node._potential_fault_status = null;
    } else { 
        logMessage(`节点 ${node.name} (${node.url}) 首次检测故障: ${checkResult.status}。开始重试确认...`, "warn");
        node._potential_fault_status = checkResult.status; 
        node._fault_retry_count = 0;

        const maxRetries = settings.fault_confirm_attempts || 0;
        const retryIntervalMs = (settings.fault_confirm_interval_seconds || 5) * 1000;

        for (let i = 0; i < maxRetries; i++) {
            if (appIsQuitting) {
                logMessage("应用退出，中止节点故障重试。", "info");
                finalDeterminedStatus = node._potential_fault_status; 
                break;
            }
            node._fault_retry_count = i + 1;
            logMessage(`节点 ${node.name} (${node.url}) 第 ${node._fault_retry_count}/${maxRetries} 次故障重试，等待 ${retryIntervalMs / 1000} 秒...`, "debug");
            await new Promise(resolve => setTimeout(resolve, retryIntervalMs));
            
            checkResult = await performSingleNodeCheck(node.url);
            node.last_checked = checkResult.last_checked; 

            if (checkResult.status === "online") {
                finalDeterminedStatus = "online";
                logMessage(`节点 ${node.name} (${node.url}) 在第 ${node._fault_retry_count} 次重试后恢复在线。`, "info");
                node._fault_retry_count = 0;
                node._potential_fault_status = null;
                break; 
            } else {
                node._potential_fault_status = checkResult.status; 
                logMessage(`节点 ${node.name} (${node.url}) 第 ${node._fault_retry_count} 次重试仍然故障: ${checkResult.status}`, "warn");
            }
        }

        if (finalDeterminedStatus !== "online") { 
            finalDeterminedStatus = node._potential_fault_status; 
            logMessage(`节点 ${node.name} (${node.url}) 在 ${maxRetries} 次重试后确认故障: ${finalDeterminedStatus}`, "error");
        }
    }
    
    node.status = finalDeterminedStatus;
    if ((originalStatus !== "online" && finalDeterminedStatus === "online") || 
        (originalStatus === "online" && finalDeterminedStatus !== "online") ||
        (originalStatus === "pending" && finalDeterminedStatus !== "pending")) {
        node.previous_status = originalStatus;
    }

    const lastNotifiedStatus = node.last_notified_status || "pending";
    const lastNotificationTime = node.last_notification_time || 0.0; 
    const globalRenotificationIntervalSecs = (settings.fault_renotification_interval_minutes || DEFAULT_SETTINGS.fault_renotification_interval_minutes) * 60;

    const isCurrentlyConfirmedFaulty = finalDeterminedStatus !== "online" && finalDeterminedStatus !== "pending";
    const wasPreviouslyNotifiedAsFaulty = lastNotifiedStatus !== "online" && lastNotifiedStatus !== "pending";

    let messageToSend = null;
    let eventType = null;

    if (finalDeterminedStatus === "online") {
        if (wasPreviouslyNotifiedAsFaulty && settings.notify_on_recovery) { 
            messageToSend = `节点恢复: ${node.name} (${node.url}) 已恢复在线。`;
            eventType = "recovery";
        }
    } else if (isCurrentlyConfirmedFaulty) { 
        if (!wasPreviouslyNotifiedAsFaulty) { 
            messageToSend = `节点故障: ${node.name} (${node.url}) 当前状态: ${finalDeterminedStatus}。`;
            eventType = "fault";
        } else { 
            if (globalRenotificationIntervalSecs > 0 && (Date.now() / 1000 - lastNotificationTime) >= globalRenotificationIntervalSecs) {
                messageToSend = `节点持续故障: ${node.name} (${node.url}) 当前状态: ${finalDeterminedStatus} (自 ${new Date(lastNotificationTime * 1000).toLocaleString('zh-CN')} 起)。`;
                eventType = "renotify_fault";
            }
        }
    }

    if (messageToSend && eventType) {
        await sendWebhookNotification(messageToSend, node, eventType); 
        node.last_notified_status = finalDeterminedStatus; 
        node.last_notification_time = Date.now() / 1000; 
    } else if (finalDeterminedStatus === "online" && lastNotifiedStatus !== "online") {
        node.last_notified_status = "online";
    }
    
    node._fault_retry_count = 0;
    node._potential_fault_status = null;

    if (mainWindow && !mainWindow.isDestroyed() && uiReady) {
        mainWindow.webContents.send('update-subscription-node', { ...node }); 
    }
    return true;
}

async function checkAllNodeUrls() {
    if (!subscriptions || subscriptions.length === 0) {
        logMessage("订阅列表为空，跳过检查。", "debug");
        return;
    }
    logMessage(`开始批量检查所有 ${subscriptions.length} 个节点 URL...`, "info");
    
    for (const node of subscriptions) {
        if (appIsQuitting) {
            logMessage("应用正在退出，中止节点检查。", "info");
            break;
        }
        await checkNodeUrl(node); 
    }
    
    saveSubscriptions(); 
    logMessage("所有节点批量检查完毕。", "info");
}

async function refreshAllSourcesContent() {
    logMessage("开始自动更新所有已保存的订阅源内容...", "info");
    const sourceUrls = settings.subscription_source_urls || [];
    if (sourceUrls.length === 0) {
        logMessage("没有配置订阅源URL，跳过自动更新。", "info");
        return;
    }

    let anyListChanged = false;
    for (const url of sourceUrls) {
        if (appIsQuitting) {
            logMessage("应用正在退出，中止订阅源更新。", "info");
            break;
        }
        const changed = await fetchAndMergeNodesFromSource(url);
        if (changed) anyListChanged = true;
        await new Promise(resolve => setTimeout(resolve, 500)); 
    }
    logMessage("所有订阅源内容自动更新处理完成。", "info");

    if (!appIsQuitting) {
        logMessage("订阅源更新后，开始检查所有节点状态。", "info");
        await checkAllNodeUrls(); 
    }
}

async function sendWebhookNotification(message, nodeDetails = null, eventType = null) {
    const appTitlePrefix = `【${settings.app_title || DEFAULT_APP_TITLE}】`;
    const fullMessageForSimplePayload = `${appTitlePrefix}${message}`; 

    const activeWebhooks = (settings.webhooks || []).filter(wh => wh.enabled && wh.url);
    if (activeWebhooks.length === 0) return;

    logMessage(`准备发送通知事件 '${eventType}' 关于节点 '${nodeDetails?.name || 'N/A'}'。符合条件的 Webhook 数量: ${activeWebhooks.length}`, "debug");

    for (const webhookConfig of activeWebhooks) {
        let actualRenotificationIntervalSecs = (webhookConfig.renotification_interval_minutes ?? settings.fault_renotification_interval_minutes ?? DEFAULT_SETTINGS.fault_renotification_interval_minutes) * 60;

        if (eventType === "recovery") {
            const notifyOnRecovery = webhookConfig.notify_on_recovery ?? settings.notify_on_recovery ?? DEFAULT_SETTINGS.notify_on_recovery;
            if (!notifyOnRecovery) {
                logMessage(`Webhook '${webhookConfig.name}' 配置为不发送恢复通知，已跳过。`, "debug");
                continue;
            }
        }

        if (eventType === "renotify_fault") {
            if (actualRenotificationIntervalSecs === 0) { 
                logMessage(`Webhook '${webhookConfig.name}' 配置为不发送重复故障通知 (间隔为0)，已跳过。`, "debug");
                continue;
            }
        }
        
        const headers = { "Content-Type": "application/json" };
        let payloadDict = {};
        const context = {
            message: message, 
            appName: settings.app_title || DEFAULT_APP_TITLE,
            nodeName: nodeDetails?.name || "N/A",
            nodeUrl: nodeDetails?.url || "N/A",
            nodeStatus: nodeDetails?.status || "N/A",
            eventType: eventType || "N/A",
            timestamp: new Date().toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'medium', hour12: false }),
            lastChecked: nodeDetails?.last_checked || "N/A",
        };

        try {
            if (webhookConfig.type === "wework") {
                payloadDict = { msgtype: "text", text: { content: fullMessageForSimplePayload } };
            } else if (webhookConfig.type === "dingtalk") {
                payloadDict = { msgtype: "text", text: { content: fullMessageForSimplePayload } };
            } else if (webhookConfig.type === "custom") {
                let templateStr = webhookConfig.custom_payload_template || '{"text": "{message}"}';
                for (const key in context) {
                    templateStr = templateStr.replace(new RegExp(`{${key}}`, 'g'), String(context[key]).replace(/"/g, '\\"'));
                }
                try {
                    payloadDict = JSON.parse(templateStr);
                } catch (e_json) {
                    logMessage(`自定义 Webhook (${webhookConfig.name}) Payload 模板解析为 JSON 失败: ${e_json.message}。模板: ${templateStr.substring(0,100)}...`, 'error');
                    continue; 
                }
            } else {
                logMessage(`不支持的 Webhook 类型: ${webhookConfig.type} (Webhook: ${webhookConfig.name})`, 'warn');
                continue;
            }

            if (Object.keys(payloadDict).length === 0) {
                logMessage(`未能为 Webhook '${webhookConfig.name}' 构建有效的 Payload。`, 'warn');
                continue;
            }
            
            logMessage(`发送 Webhook 到 ${webhookConfig.name} (${webhookConfig.url}), Payload: ${JSON.stringify(payloadDict).substring(0,200)}...`, "debug");
            const response = await fetch(webhookConfig.url, {
                method: 'POST',
                body: JSON.stringify(payloadDict),
                headers: headers,
                timeout: 10000 
            });

            if (response.ok) {
                logMessage(`Webhook 通知已成功发送到 ${webhookConfig.name} (${webhookConfig.type})。`, "info");
            } else {
                const responseText = await response.text().catch(() => "无法读取响应体");
                logMessage(`发送 Webhook 通知到 ${webhookConfig.name} (${webhookConfig.url}) 失败: ${response.status} ${response.statusText} (响应: ${responseText.substring(0,100)})`, 'error');
            }
        } catch (e) {
            logMessage(`处理并发送 Webhook 通知 (${webhookConfig.name}) 期间发生意外错误: ${e.message} ${e.stack ? '\nStack: ' + e.stack : ''}`, 'error');
        }
    }
}

function getCheckIntervalSeconds() {
    let interval = parseInt(settings.url_check_interval, 10);
    if (isNaN(interval) || interval <= 0) interval = DEFAULT_SETTINGS.url_check_interval;
    const unit = settings.url_check_interval_unit || DEFAULT_SETTINGS.url_check_interval_unit;
    return unit === "seconds" ? Math.max(5, interval) : Math.max(1, interval) * 60; 
}

function getAutoUpdateSourcesIntervalSeconds() {
    let interval = parseInt(settings.auto_update_sources_interval_minutes, 10);
    if (isNaN(interval) || interval <= 0) interval = DEFAULT_SETTINGS.auto_update_sources_interval_minutes;
    return Math.max(1, interval) * 60; 
}

function startSchedulers() {
    stopSchedulers(); 

    const nodeCheckIntervalMs = getCheckIntervalSeconds() * 1000;
    const sourceUpdateIntervalMs = getAutoUpdateSourcesIntervalSeconds() * 1000;

    logMessage(`调度器启动：节点检查间隔 ${nodeCheckIntervalMs / 1000} 秒，源更新间隔 ${sourceUpdateIntervalMs / 1000} 秒。`, "info");

    if (uiReady) {
        logMessage("UI就绪，执行首次订阅源更新和节点检查...", "info");
        refreshAllSourcesContent().then(() => {
            logMessage("首次订阅源更新和节点检查完成。", "info");
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('update-next-check-time', Date.now() + nodeCheckIntervalMs);
            }
        }).catch(e => logMessage(`首次任务执行失败: ${e.message}`, 'error'));
    } else {
        logMessage("UI 尚未就绪，延迟首次检查。将在 UI 就绪后触发。", "info");
    }
    
    nodeCheckSchedulerId = setInterval(async () => {
        if (appIsQuitting) return;
        logMessage("调度器：节点状态检查时间到达。", "debug");
        await checkAllNodeUrls();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-next-check-time', Date.now() + nodeCheckIntervalMs);
        }
    }, nodeCheckIntervalMs);

    sourceUpdateSchedulerId = setInterval(async () => {
        if (appIsQuitting) return;
        logMessage("调度器：订阅源自动更新时间到达。", "debug");
        await refreshAllSourcesContent(); 
    }, sourceUpdateIntervalMs);
}

function stopSchedulers() {
    if (nodeCheckSchedulerId) {
        clearInterval(nodeCheckSchedulerId);
        nodeCheckSchedulerId = null;
    }
    if (sourceUpdateSchedulerId) {
        clearInterval(sourceUpdateSchedulerId);
        sourceUpdateSchedulerId = null;
    }
    logMessage("所有调度器已停止。", "info");
}

function setupIpcHandlers() {
    ipcMain.handle('signal-ui-ready', (event) => {
        uiReady = true;
        logMessage("主进程确认 UI 处理器已就绪。", "info");
        while (logQueueForUi.length > 0) {
            const queuedLog = logQueueForUi.shift();
            if (mainWindow && !mainWindow.isDestroyed()) {
                 mainWindow.webContents.send('add-log-entry', queuedLog);
            }
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('add-log-entry', `${new Date().toLocaleTimeString('zh-CN', { hour12: false })}: Electron 后端已连接，UI 通信正常。`);
        }
        startSchedulers(); 
        return { success: true, message: "UI就绪信号已收到并处理完毕。" };
    });

    ipcMain.handle('load-initial-data', async () => {
        const recentLogsRaw = log.transports.file.readAllLogs(); 
        let recentLogLines = [];
        if (recentLogsRaw && recentLogsRaw.length > 0 && recentLogsRaw[0].lines) {
            recentLogLines = recentLogsRaw[0].lines.slice(-200);
        }
        return {
            settings: settings,
            subscriptions: subscriptions,
            logs: recentLogLines.map(l => { 
                const match = l.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\s\[(.*?)\]\s([\s\S]*)/) || l.match(/\d{2}:\d{2}:\d{2}\s\[(.*?)\]\s([\s\S]*)/);
                return match ? `${match[1]}: ${match[2]}` : l; 
            }),
        };
    });

    ipcMain.handle('get-subscriptions', () => subscriptions);
    ipcMain.handle('get-subscription-sources', () => settings.subscription_source_urls || []);

    ipcMain.handle('add-subscription-source-url', async (event, subUrl) => {
        logMessage(`API: 请求添加订阅源URL: ${subUrl}`, "info");
        if (!subUrl || (!subUrl.startsWith('http://') && !subUrl.startsWith('https://'))) {
            return { success: false, message: "无效的订阅源链接。请输入以 http:// 或 https:// 开头的有效 URL。" };
        }
        if (!(settings.subscription_source_urls || []).includes(subUrl)) {
            settings.subscription_source_urls = [...(settings.subscription_source_urls || []), subUrl];
            saveSettings();
            logMessage(`订阅源URL '${subUrl}' 已添加到列表并保存。`, "info");
            await fetchAndMergeNodesFromSource(subUrl); 
            return { success: true, message: `已添加并尝试处理订阅源 '${subUrl}'。`, subscriptions, subscription_sources: settings.subscription_source_urls };
        } else {
            logMessage(`订阅源URL '${subUrl}' 已存在。尝试刷新该源...`, "info");
            await fetchAndMergeNodesFromSource(subUrl);
            return { success: true, message: `订阅源 '${subUrl}' 已存在，并已尝试刷新其内容。`, subscriptions, subscription_sources: settings.subscription_source_urls };
        }
    });
    
    ipcMain.handle('remove-subscription-source-url', async (event, sourceUrlToRemove) => {
        logMessage(`API: 请求移除订阅源URL: ${sourceUrlToRemove}`, "info");
        const initialLength = (settings.subscription_source_urls || []).length;
        settings.subscription_source_urls = (settings.subscription_source_urls || []).filter(url => url !== sourceUrlToRemove);
        if (settings.subscription_source_urls.length < initialLength) {
            saveSettings();
            const subsBeforeRemovalCount = subscriptions.length;
            subscriptions = subscriptions.filter(node => node.origin_url !== sourceUrlToRemove);
            if (subscriptions.length < subsBeforeRemovalCount) {
                saveSubscriptions();
                logMessage(`已从主列表移除 ${subsBeforeRemovalCount - subscriptions.length} 个源自 '${sourceUrlToRemove}' 的节点。`, "info");
            }
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('refresh-subscription-list', subscriptions);
            return { success: true, message: `订阅源 '${sourceUrlToRemove}' 已移除，相关节点也已清理。`, subscriptions, subscription_sources: settings.subscription_source_urls };
        }
        return { success: false, message: "未找到要移除的订阅源URL。" };
    });

    ipcMain.handle('refresh-all-subscription-sources', async () => {
        logMessage("API: 请求刷新所有订阅源。", "info");
        refreshAllSourcesContent(); 
        return { success: true, message: "所有订阅源刷新任务已启动（后台进行）。" };
    });

    ipcMain.handle('remove-subscription', async (event, nodeUrlToRemove) => {
        logMessage(`API: 请求移除节点URL: '${nodeUrlToRemove}'`, "info");
        const originalCount = subscriptions.length;
        subscriptions = subscriptions.filter(node => node.url !== nodeUrlToRemove);
        if (subscriptions.length < originalCount) {
            saveSubscriptions();
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('refresh-subscription-list', subscriptions);
            return { success: true, message: "订阅节点已移除。", subscriptions };
        }
        return { success: false, message: "未找到要移除的节点。", subscriptions };
    });

    ipcMain.handle('manual-check-node', async (event, nodeUrl) => {
        const node = subscriptions.find(n => n.url === nodeUrl);
        if (node) {
            logMessage(`API: 已为节点 ${node.name} (${nodeUrl}) 启动手动检查。`, "info");
            checkNodeUrl(node); 
            return { success: true, message: `节点 ${node.name} 的手动检查已启动。` };
        }
        return { success: false, message: "未找到指定URL的节点。" };
    });
    
    ipcMain.handle('manual-check-all-nodes', async () => {
        logMessage("API: 请求手动检查所有节点。", "info");
        checkAllNodeUrls(); 
        return { success: true, message: "所有节点检查已启动（后台进行）。" };
    });

    ipcMain.handle('get-settings', () => settings);

    ipcMain.handle('save-settings', (event, newSettingsData) => {
        logMessage(`API: 收到保存设置的请求: ${JSON.stringify(newSettingsData).substring(0, 300)}...`, "info");
        const oldSettings = JSON.parse(JSON.stringify(settings)); 
        const oldIconPath = settings.app_icon_path;

        settings = {
            ...DEFAULT_SETTINGS, 
            ...settings,        
            ...newSettingsData, 
            url_check_interval: parseInt(newSettingsData.url_check_interval, 10) || oldSettings.url_check_interval,
            url_check_interval_unit: ['seconds', 'minutes'].includes(newSettingsData.url_check_interval_unit) ? newSettingsData.url_check_interval_unit : oldSettings.url_check_interval_unit,
            start_with_windows: typeof newSettingsData.start_with_windows === 'boolean' ? newSettingsData.start_with_windows : oldSettings.start_with_windows,
            start_minimized: typeof newSettingsData.start_minimized === 'boolean' ? newSettingsData.start_minimized : oldSettings.start_minimized,
            fault_renotification_interval_minutes: parseInt(newSettingsData.fault_renotification_interval_minutes),
            notify_on_recovery: typeof newSettingsData.notify_on_recovery === 'boolean' ? newSettingsData.notify_on_recovery : oldSettings.notify_on_recovery,
            auto_update_sources_interval_minutes: parseInt(newSettingsData.auto_update_sources_interval_minutes, 10) || oldSettings.auto_update_sources_interval_minutes,
            fault_confirm_attempts: parseInt(newSettingsData.fault_confirm_attempts, 10), 
            fault_confirm_interval_seconds: parseInt(newSettingsData.fault_confirm_interval_seconds, 10), 
            webhooks: Array.isArray(newSettingsData.webhooks) ? newSettingsData.webhooks.map(wh => ({ 
                id: wh.id || uuidv4(),
                name: wh.name || "未命名 Webhook",
                type: wh.type || "custom",
                url: wh.url || "",
                custom_payload_template: wh.custom_payload_template || '{"text": "{message}"}',
                enabled: typeof wh.enabled === 'boolean' ? wh.enabled : true,
                notify_on_recovery: typeof wh.notify_on_recovery === 'boolean' ? wh.notify_on_recovery : (settings.notify_on_recovery ?? DEFAULT_SETTINGS.notify_on_recovery),
                renotification_interval_minutes: typeof wh.renotification_interval_minutes === 'number' ? wh.renotification_interval_minutes : (settings.fault_renotification_interval_minutes ?? DEFAULT_SETTINGS.fault_renotification_interval_minutes),
            })) : oldSettings.webhooks,
            subscription_source_urls: Array.isArray(newSettingsData.subscription_source_urls) ? newSettingsData.subscription_source_urls : oldSettings.subscription_source_urls,
            app_icon_path: newSettingsData.app_icon_path !== undefined ? newSettingsData.app_icon_path : oldSettings.app_icon_path,
        };
         if (isNaN(settings.fault_renotification_interval_minutes)) {
            settings.fault_renotification_interval_minutes = oldSettings.fault_renotification_interval_minutes ?? DEFAULT_SETTINGS.fault_renotification_interval_minutes;
        }
        if (isNaN(settings.fault_confirm_attempts) || settings.fault_confirm_attempts < 0) {
            settings.fault_confirm_attempts = oldSettings.fault_confirm_attempts ?? DEFAULT_SETTINGS.fault_confirm_attempts;
        }
        if (isNaN(settings.fault_confirm_interval_seconds) || settings.fault_confirm_interval_seconds < 1) {
            settings.fault_confirm_interval_seconds = oldSettings.fault_confirm_interval_seconds ?? DEFAULT_SETTINGS.fault_confirm_interval_seconds;
        }

        saveSettings(); 

        if (settings.url_check_interval !== oldSettings.url_check_interval ||
            settings.url_check_interval_unit !== oldSettings.url_check_interval_unit ||
            settings.auto_update_sources_interval_minutes !== oldSettings.auto_update_sources_interval_minutes ||
            settings.fault_confirm_attempts !== oldSettings.fault_confirm_attempts || 
            settings.fault_confirm_interval_seconds !== oldSettings.fault_confirm_interval_seconds) {
            logMessage("检测到调度器或故障确认相关设置已更改，正在重启调度器...", "info");
            startSchedulers(); 
        }

        if (newSettingsData.app_icon_path && newSettingsData.app_icon_path !== oldIconPath) {
            updateApplicationIcons(newSettingsData.app_icon_path);
        }
        
        return { success: true, message: "设置已成功保存。", updated_settings: settings };
    });
    
    ipcMain.handle('get-webhook-configs', () => settings.webhooks || []);
    ipcMain.handle('add-webhook-config', (event, configData) => {
        if (!configData || !configData.name || !configData.url) {
            return { success: false, message: "配置数据不完整 (名称和URL为必填项)。" };
        }
        const newWebhook = {
            id: uuidv4(),
            name: configData.name,
            type: configData.type || "custom",
            url: configData.url,
            custom_payload_template: configData.custom_payload_template || '{"text": "{message}"}',
            enabled: typeof configData.enabled === 'boolean' ? configData.enabled : true,
            notify_on_recovery: typeof configData.notify_on_recovery === 'boolean' ? configData.notify_on_recovery : settings.notify_on_recovery,
            renotification_interval_minutes: typeof configData.renotification_interval_minutes === 'number' ? configData.renotification_interval_minutes : settings.fault_renotification_interval_minutes,
        };
        settings.webhooks = [...(settings.webhooks || []), newWebhook];
        saveSettings();
        return { success: true, message: "Webhook 配置已添加。", new_config: newWebhook, all_configs: settings.webhooks };
    });
    ipcMain.handle('update-webhook-config', (event, configData) => {
        const index = (settings.webhooks || []).findIndex(wh => wh.id === configData.id);
        if (index > -1) {
            settings.webhooks[index] = {
                ...settings.webhooks[index], 
                ...configData, 
            };
            saveSettings();
            return { success: true, message: "Webhook 配置已更新。", updated_config: settings.webhooks[index], all_configs: settings.webhooks };
        }
        return { success: false, message: "未找到要更新的 Webhook 配置。" };
    });
    ipcMain.handle('remove-webhook-config', (event, webhookIdToRemove) => {
        const oldLength = (settings.webhooks || []).length;
        settings.webhooks = (settings.webhooks || []).filter(wh => wh.id !== webhookIdToRemove);
        if (settings.webhooks.length < oldLength) {
            saveSettings();
            return { success: true, message: "Webhook 配置已移除。", all_configs: settings.webhooks };
        }
        return { success: false, message: "未找到要移除的 Webhook 配置。" };
    });
    ipcMain.handle('test-specific-webhook', async (event, webhookId, testMessageContent) => {
        const webhookToTest = (settings.webhooks || []).find(wh => wh.id === webhookId);
        if (!webhookToTest) return { success: false, message: `未找到 ID 为 '${webhookId}' 的配置。` };
        if (!webhookToTest.url) return { success: false, message: `Webhook '${webhookToTest.name}' 的 URL 为空。` };
        
        const appName = settings.app_title || DEFAULT_APP_TITLE;
        const message = (testMessageContent || "这是一条来自【{appName}】的测试通知。").replace("{appName}", appName);
        
        logMessage(`API: 请求测试 Webhook '${webhookToTest.name}' (ID: ${webhookId})。`, "info");
        try {
            const testNode = { name: "测试节点", url: "http://example.com/test", status: "TESTING", last_checked: new Date().toLocaleString('zh-CN') };
            const originalWebhooks = settings.webhooks; 
            settings.webhooks = [webhookToTest]; 
            await sendWebhookNotification(message, testNode, "test_notification");
            settings.webhooks = originalWebhooks; 
            return { success: true, message: `已尝试向 '${webhookToTest.name}' 发送测试通知。请检查接收端。` };
        } catch (e) {
            settings.webhooks = originalWebhooks; 
            logMessage(`测试 Webhook (${webhookToTest.name}) 时发生错误: ${e.message}`, 'error');
            return { success: false, message: `测试期间发生错误: ${e.message}` };
        }
    });
    
    ipcMain.handle('minimize-to-tray', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.hide();
            logMessage("窗口已最小化（隐藏）到托盘。", "info");
            return { success: true, message: "窗口已最小化到托盘。" };
        }
        return { success: false, message: "窗口对象未找到。" };
    });
    ipcMain.handle('quit-application', () => {
        logMessage("API: JS请求退出应用。", "info");
        appIsQuitting = true; 
        app.quit();
        return { success: true, message: "应用退出请求已提交。" };
    });
    ipcMain.handle('select-app-icon', async (event) => {
        if (!mainWindow) return null;
        const result = await dialog.showOpenDialog(mainWindow, {
            title: '选择应用图标',
            properties: ['openFile'],
            filters: [
                { name: 'Images', extensions: ['png', 'ico', 'icns', 'jpg', 'jpeg'] }
            ]
        });

        if (!result.canceled && result.filePaths.length > 0) {
            const selectedPath = result.filePaths[0];
            logMessage(`用户选择了新的应用图标路径: ${selectedPath}`, 'info');
            
            const userDataPath = app.getPath('userData');
            const iconsDir = path.join(userDataPath, 'app_icons');
            if (!fs.existsSync(iconsDir)) {
                fs.mkdirSync(iconsDir, { recursive: true });
            }
            const newIconName = `${DEFAULT_USER_ICON_NAME}${path.extname(selectedPath)}`;
            const copiedIconPath = path.join(iconsDir, newIconName);

            try {
                fs.copyFileSync(selectedPath, copiedIconPath);
                logMessage(`图标已复制到: ${copiedIconPath}`, 'info');
                return copiedIconPath; 
            } catch (copyError) {
                logMessage(`复制图标文件失败: ${copyError.message}`, 'error');
                if (mainWindow && !mainWindow.isDestroyed()) {
                     mainWindow.webContents.send('show-toast', { message: `复制图标文件失败: ${copyError.message}`, type: 'error' });
                }
                return selectedPath; 
            }
        }
        return null; 
    });
    ipcMain.handle('get-app-version-info', async (event) => {
        return {
            app: app.getVersion(),
            electron: process.versions.electron,
            node: process.versions.node,
            chrome: process.versions.chrome,
            os: `${process.platform} ${process.arch}`
        };
    });
    ipcMain.handle('open-external-link', async (event, urlToOpen) => {
        try {
            if (urlToOpen && (urlToOpen.startsWith('http:') || urlToOpen.startsWith('https://') || urlToOpen.startsWith('mailto:'))) {
                await shell.openExternal(urlToOpen);
                return { success: true };
            } else {
                logMessage(`尝试打开无效或不受支持的外部链接协议: ${urlToOpen}`, 'warn');
                return { success: false, message: '无效的链接协议。' };
            }
        } catch (error) {
            logMessage(`无法打开外部链接 ${urlToOpen}: ${error.message}`, 'error');
            return { success: false, message: `无法打开链接: ${error.message}` };
        }
    });
}

// --- 托盘图标 ---
function createTray() {
    if (tray && !tray.isDestroyed()) { 
        logMessage("托盘图标已存在。", "debug");
        return;
    }
    const iconToUsePath = getAppIconPath(); 
    if (!iconToUsePath) {
        logMessage("无法创建托盘图标：未找到有效的图标路径。", "error");
        return;
    }

    try {
        const image = nativeImage.createFromPath(iconToUsePath); 
        if (image.isEmpty()) { 
            logMessage(`创建托盘图标失败：无法从路径加载图片 "${iconToUsePath}"`, 'error');
            const fallback = path.join(__dirname, 'ui', 'app_icon.png'); 
            try {
                const fallbackImage = nativeImage.createFromPath(fallback);
                if (fallbackImage.isEmpty()) throw new Error("Fallback icon also empty");
                tray = new Tray(fallbackImage);
                logMessage(`使用了备用托盘图标: ${fallback}`, 'warn');
            } catch (e2) {
                 logMessage(`使用备用托盘图标也失败: ${e2.message}`, 'error');
                 return;
            }
        } else {
            tray = new Tray(image); 
        }
    } catch (e) {
        logMessage(`创建托盘图标时发生异常: ${e.message}`, 'error');
        return;
    }

    const contextMenu = Menu.buildFromTemplate([
        {
            label: '显示/隐藏窗口',
            click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
                        mainWindow.hide();
                    } else {
                        mainWindow.show();
                        if (process.platform === 'darwin') mainWindow.focus(); 
                        else { mainWindow.setAlwaysOnTop(true); setTimeout(()=> mainWindow.setAlwaysOnTop(false), 500); }
                    }
                } else if (!mainWindow || mainWindow.isDestroyed()) {
                    createWindow(); 
                }
            }
        },
        { type: 'separator' },
        { label: '退出应用', click: () => { appIsQuitting = true; app.quit(); } }
    ]);
    tray.setToolTip(settings.app_title || DEFAULT_APP_TITLE);
    tray.setContextMenu(contextMenu);

    tray.on('click', () => { 
        if (process.platform !== 'darwin') { 
            if (mainWindow && !mainWindow.isDestroyed()) {
                 if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
                } else {
                    mainWindow.show();
                     if (process.platform === 'darwin') mainWindow.focus();
                     else { mainWindow.setAlwaysOnTop(true); setTimeout(()=> mainWindow.setAlwaysOnTop(false), 500); }
                }
            } else if (!mainWindow || mainWindow.isDestroyed()) {
                createWindow();
            }
        }
    });
    tray.on('double-click', () => { 
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            if (process.platform === 'darwin') mainWindow.focus();
            else { mainWindow.setAlwaysOnTop(true); setTimeout(()=> mainWindow.setAlwaysOnTop(false), 500); }
        } else if (!mainWindow || mainWindow.isDestroyed()) {
            createWindow();
        }
    });
    logMessage("系统托盘图标已创建。", "info");
}

// --- 窗口创建 ---
function createWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
        return;
    }
    const windowIconPath = getAppIconPath(); 

    mainWindow = new BrowserWindow({
        width: 1000,
        height: 750,
        minWidth: 800,
        minHeight: 600,
        frame: false,
        titleBarStyle: 'hidden',
        icon: windowIconPath, 
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            devTools: !app.isPackaged 
        },
        show: false, 
    });

    mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));

    mainWindow.once('ready-to-show', () => {
        if (settings.start_minimized && tray) { 
            logMessage("应用根据设置启动时最小化（不显示窗口）。", "info");
        } else {
            mainWindow.show();
        }
        // 移除或注释掉下面这行来禁止自动打开开发者工具
        // if (!app.isPackaged) {
        //     mainWindow.webContents.openDevTools({ mode: 'detach' });
        // }
    });

    mainWindow.on('closed', () => {
        mainWindow = null; 
    });
    mainWindow.on('minimize', (event) => {
        if (tray) { 
            event.preventDefault();
            mainWindow.hide();
            logMessage("窗口已通过原生最小化按钮操作隐藏到托盘。", "info");
        }
    });
    mainWindow.on('close', (event) => {
        if (!appIsQuitting && tray) { 
            event.preventDefault();
            mainWindow.hide();
            logMessage("窗口已通过原生关闭按钮操作隐藏到托盘（未退出）。", "info");
        }
    });
}

// --- 应用程序生命周期 ---
app.on('ready', () => {
    logMessage(`应用程序启动于 ${new Date().toLocaleString('zh-CN')}`, "info");
    logMessage(`应用版本: ${app.getVersion()}, Electron: ${process.versions.electron}, Node: ${process.versions.node}`, "info");
    logMessage(`用户数据路径: ${app.getPath('userData')}`, "info");
    
    loadSettings(); 
    loadSubscriptions();
    setupIpcHandlers();
    
    createWindow(); 
    createTray();

    if (appAutoLauncher) {
        appAutoLauncher.isEnabled().then((isEnabled) => {
            if (settings.start_with_windows && !isEnabled) {
                return appAutoLauncher.enable().catch(err => logMessage(`启用开机自启失败: ${err.message}`, 'error'));
            } else if (!settings.start_with_windows && isEnabled) {
                return appAutoLauncher.disable().catch(err => logMessage(`禁用开机自启失败: ${err.message}`, 'error'));
            }
        }).catch(err => logMessage(`检查开机自启状态失败: ${err.message}`, 'error'));
    }
    if (settings.app_icon_path) {
        updateApplicationIcons(settings.app_icon_path);
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        logMessage("所有窗口已关闭。", "debug");
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        if (!mainWindow || mainWindow.isDestroyed()) {
            createWindow();
        }
    }
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        mainWindow.show();
        mainWindow.focus();
    }
});

app.on('before-quit', (event) => {
    if (!appIsQuitting) appIsQuitting = true; 
    logMessage("应用关闭流程启动 (before-quit)...", "info");
    stopSchedulers();
    saveSettings(); 
    saveSubscriptions(); 
    
    if (tray && !tray.isDestroyed()) {
        tray.destroy();
        tray = null;
    }
    logMessage(`应用程序主线程即将退出。关闭时间: ${new Date().toLocaleString('zh-CN')}`, "info");
});

process.on('unhandledRejection', (reason, promise) => {
  logMessage(`未处理的 Promise Rejection 在: ${promise}, 原因: ${reason instanceof Error ? reason.message : reason}${reason instanceof Error ? '\nStack: ' + reason.stack : ''}`, 'error');
});
process.on('uncaughtException', (error, origin) => {
  logMessage(`未捕获的异常: ${error.message},来源: ${origin}${error.stack ? '\nStack: ' + error.stack : ''}`, 'error');
});
