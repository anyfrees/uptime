// ui/script.js - 渲染器进程的 JavaScript 逻辑

document.addEventListener('DOMContentLoaded', () => {
    if (window.electronAPI) {
        console.log("JS: DOMContentLoaded event fired. window.electronAPI is available:", window.electronAPI);
        initializeApp();
    } else {
        console.error("JS: CRITICAL - window.electronAPI is not defined. Preload script might have failed.");
        const appLoader = document.getElementById('appLoader');
        if (appLoader) {
            appLoader.textContent = '错误：无法加载核心 API。请检查控制台。';
        }
    }
});

// --- 全局状态和元素变量 ---
let currentSettings = {};
let currentSubscriptions = [];
let currentSubscriptionSources = [];
let currentWebhookConfigs = [];
let currentView = 'dashboard';
let selectedWebhookId = null;
let isWebhookEditMode = false; 

// DOM 元素
let views = {}, navLinks = {};
let appTitleDisplay, appLogoContainer, appLogoLetter,
    subscriptionListBody, noSubscriptionsMessage,
    logContainer, appLoader, refreshSubFromSourceButton, subscriptionSourcesListDiv,
    noSubscriptionSourcesMessageElem, nextCheckTimeSpan;

let customTitleBar, customMinimizeBtn, customCloseBtn;

let createNewWebhookBtn, webhookListDiv, noWebhooksMessageAside, webhookDetailContainer,
    webhookForm, webhookIdInput, webhookFormTitle, webhookFormFields, webhookNameInput,
    webhookTypeSelect, webhookUrlInput, customWebhookPayloadContainer, customWebhookPayloadTextarea,
    webhookRenotificationIntervalInput, webhookEnabledCheckbox, webhookNotifyOnRecoveryCheckbox,
    webhookTestButton, webhookDeleteButton, webhookSaveButton, webhookDetailPlaceholder;

let appGlobalTitleInput, urlCheckIntervalInput, urlCheckIntervalUnitSelect,
    autoUpdateSourcesIntervalInput, globalFaultRenotificationIntervalInput,
    globalNotifyOnRecoveryCheckbox, startWithWindowsCheckbox, startMinimizedCheckbox,
    saveGeneralSettingsButton,
    faultConfirmAttemptsInput, faultConfirmIntervalSecondsInput; 

let quitAppButtonSidebarElem;

// 关于页面元素
let appVersionInfoSpan, electronVersionInfoSpan, nodeVersionInfoSpan, emailLink, blogLink;

// 自定义确认框元素
let confirmModalOverlay, confirmModalMessage, confirmModalOkBtn, confirmModalCancelBtn, customConfirmTitle;
let confirmCallback = null;


function generateSafeDomIdFromString(inputStr) {
    if (typeof inputStr !== 'string') {
        console.warn('generateSafeDomIdFromString: input is not a string, returning generic ID.');
        return 'id-invalid-input-' + Date.now();
    }
    const sanitized = inputStr.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `id-${sanitized}`; 
}

function assignElements() {
    console.log("JS: Assigning DOM elements...");
    views = {
        dashboard: document.getElementById('view-dashboard'),
        subscriptions: document.getElementById('view-subscriptions'),
        notifications: document.getElementById('view-notifications'),
        logs: document.getElementById('view-logs'),
        settings: document.getElementById('view-settings'),
        about: document.getElementById('view-about') 
    };
    navLinks = {
        dashboard: document.getElementById('nav-dashboard'),
        subscriptions: document.getElementById('nav-subscriptions'),
        notifications: document.getElementById('nav-notifications'),
        logs: document.getElementById('nav-logs'),
        settings: document.getElementById('nav-settings'),
        about: document.getElementById('nav-about') 
    };
    appTitleDisplay = document.getElementById('appTitleDisplay');
    appLogoContainer = document.getElementById('appLogoContainer');
    appLogoLetter = document.getElementById('appLogoLetter'); 
    subscriptionListBody = document.getElementById('subscriptionList');
    noSubscriptionsMessage = document.getElementById('noSubscriptionsMessage');
    logContainer = document.getElementById('logContainer');
    appLoader = document.getElementById('appLoader');
    refreshSubFromSourceButton = document.getElementById('refreshSubFromSourceButton');
    subscriptionSourcesListDiv = document.getElementById('subscriptionSourcesList');
    noSubscriptionSourcesMessageElem = document.getElementById('noSubscriptionSourcesMessage');
    nextCheckTimeSpan = document.getElementById('nextCheckTime');

    customTitleBar = document.getElementById('customTitleBar');
    customMinimizeBtn = document.getElementById('customMinimizeBtn');
    customCloseBtn = document.getElementById('customCloseBtn');

    createNewWebhookBtn = document.getElementById('createNewWebhookBtn');
    webhookListDiv = document.getElementById('webhookList');
    noWebhooksMessageAside = document.getElementById('noWebhooksMessageAside');
    webhookDetailContainer = document.getElementById('webhookDetailContainer');
    webhookForm = document.getElementById('webhookForm');
    webhookIdInput = document.getElementById('webhookId');
    webhookFormTitle = document.getElementById('webhookFormTitle');
    webhookFormFields = document.getElementById('webhookFormFields');
    webhookNameInput = document.getElementById('webhookName');
    webhookTypeSelect = document.getElementById('webhookType');
    webhookUrlInput = document.getElementById('webhookUrl');
    customWebhookPayloadContainer = document.getElementById('customWebhookPayloadContainer');
    customWebhookPayloadTextarea = document.getElementById('customWebhookPayload');
    webhookRenotificationIntervalInput = document.getElementById('webhookRenotificationInterval');
    webhookEnabledCheckbox = document.getElementById('webhookEnabled');
    webhookNotifyOnRecoveryCheckbox = document.getElementById('webhookNotifyOnRecovery');
    webhookTestButton = document.getElementById('webhookTestButton');
    webhookDeleteButton = document.getElementById('webhookDeleteButton');
    webhookSaveButton = document.getElementById('webhookSaveButton');
    webhookDetailPlaceholder = document.getElementById('webhookDetailPlaceholder');

    appGlobalTitleInput = document.getElementById('appGlobalTitleInput');
    urlCheckIntervalInput = document.getElementById('urlCheckInterval');
    urlCheckIntervalUnitSelect = document.getElementById('urlCheckIntervalUnit');
    autoUpdateSourcesIntervalInput = document.getElementById('autoUpdateSourcesInterval');
    globalFaultRenotificationIntervalInput = document.getElementById('globalFaultRenotificationInterval');
    globalNotifyOnRecoveryCheckbox = document.getElementById('globalNotifyOnRecovery');
    startWithWindowsCheckbox = document.getElementById('startWithWindows');
    startMinimizedCheckbox = document.getElementById('startMinimized');
    saveGeneralSettingsButton = document.getElementById('saveGeneralSettingsButton');
    
    faultConfirmAttemptsInput = document.getElementById('faultConfirmAttempts');
    faultConfirmIntervalSecondsInput = document.getElementById('faultConfirmIntervalSeconds');
    
    quitAppButtonSidebarElem = document.getElementById('quitAppButtonSidebar');

    appVersionInfoSpan = document.getElementById('appVersionInfo');
    electronVersionInfoSpan = document.getElementById('electronVersionInfo');
    nodeVersionInfoSpan = document.getElementById('nodeVersionInfo');
    emailLink = document.getElementById('emailLink'); 
    blogLink = document.getElementById('blogLink');   

    // 自定义确认框元素
    confirmModalOverlay = document.getElementById('customConfirmModalOverlay');
    customConfirmTitle = document.getElementById('customConfirmTitle');
    confirmModalMessage = document.getElementById('customConfirmMessage');
    confirmModalOkBtn = document.getElementById('customConfirmOkBtn');
    confirmModalCancelBtn = document.getElementById('customConfirmCancelBtn');

    console.log("JS: DOM elements assigned.");
}

function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toastContainer');
    if (!toastContainer) { console.warn("Toast container not found"); return; }
    const toastId = 'toast-' + Date.now();
    let bgColor, textColor, borderColor;
    switch (type) {
        case 'success': bgColor = 'bg-green-600'; textColor = 'text-white'; borderColor = 'border-green-700'; break;
        case 'error': bgColor = 'bg-red-600'; textColor = 'text-white'; borderColor = 'border-red-700'; break;
        case 'warning': bgColor = 'bg-yellow-500'; textColor = 'text-gray-900'; borderColor = 'border-yellow-600'; break;
        default: bgColor = 'bg-blue-600'; textColor = 'text-white'; borderColor = 'border-blue-700';
    }
    const toastElement = document.createElement('div');
    toastElement.id = toastId;
    toastElement.className = `${bgColor} ${textColor} p-4 rounded-lg shadow-md border-l-4 ${borderColor} text-sm animate-fadeIn`;
    toastElement.innerHTML = `<p>${message}</p>`;
    toastContainer.appendChild(toastElement);
    setTimeout(() => {
        const el = document.getElementById(toastId);
        if (el) {
            el.classList.remove('animate-fadeIn');
            el.classList.add('animate-fadeOut');
            setTimeout(() => el.remove(), 500);
        }
    }, 3000);
}

if (!document.getElementById('toastAnimationStyleSheet')) {
    const styleSheet = document.createElement("style");
    styleSheet.id = 'toastAnimationStyleSheet';
    styleSheet.type = "text/css";
    styleSheet.innerText = `@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } } .animate-fadeIn { animation: fadeIn 0.3s ease-out forwards; } @keyframes fadeOut { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(10px); } } .animate-fadeOut { animation: fadeOut 0.5s ease-in forwards; }`;
    document.head.appendChild(styleSheet);
}

function updateAppLogoDisplay(iconPath) {
    if (appLogoContainer && appLogoLetter) {
        if (iconPath && typeof iconPath === 'string' && iconPath.trim() !== '') {
            const formattedPath = iconPath.startsWith('file://') ? iconPath.replace(/\\/g, '/') : `file:///${iconPath.replace(/\\/g, '/')}`;
            appLogoContainer.style.backgroundImage = `url('${formattedPath}')`; 
            appLogoContainer.style.backgroundSize = 'cover';
            appLogoContainer.style.backgroundPosition = 'center';
            appLogoContainer.style.backgroundRepeat = 'no-repeat';
            appLogoLetter.style.display = 'none'; 
            appLogoContainer.classList.remove('bg-gradient-to-br', 'from-blue-500', 'to-green-400'); 
        } else {
            appLogoContainer.style.backgroundImage = '';
            appLogoLetter.style.display = 'block'; 
            appLogoContainer.classList.add('bg-gradient-to-br', 'from-blue-500', 'to-green-400'); 
        }
    }
}

async function loadAndDisplayAppVersionInfo() {
    console.log("JS: loadAndDisplayAppVersionInfo CALLED for view:", currentView); 
    if (currentView === 'about' && views.about && !views.about.classList.contains('hidden')) { 
        try {
            const versions = await window.electronAPI.getAppVersionInfo();
            console.log("JS: Versions received from main process:", versions); 
            if (versions) {
                if (appVersionInfoSpan) appVersionInfoSpan.textContent = versions.app || 'N/A';
                if (electronVersionInfoSpan) electronVersionInfoSpan.textContent = versions.electron || 'N/A';
                if (nodeVersionInfoSpan) nodeVersionInfoSpan.textContent = versions.node || 'N/A';
            } else {
                console.warn("JS: Received no version info from main process.");
                if (appVersionInfoSpan) appVersionInfoSpan.textContent = '获取失败';
                if (electronVersionInfoSpan) electronVersionInfoSpan.textContent = '获取失败';
                if (nodeVersionInfoSpan) nodeVersionInfoSpan.textContent = '获取失败';
            }
        } catch (error) {
            console.error("JS: Error fetching app version info:", error);
            if (appVersionInfoSpan) appVersionInfoSpan.textContent = '错误';
            if (electronVersionInfoSpan) electronVersionInfoSpan.textContent = '错误';
            if (nodeVersionInfoSpan) nodeVersionInfoSpan.textContent = '错误';
        }
    } else {
        console.log("JS: Not on 'about' view or 'about' view is hidden, skipping version info load.");
    }
}

function switchView(viewId) {
    console.log(`JS: Switching to view: ${viewId}`); 
    Object.values(views).forEach(view => {
        if (view) view.classList.add('hidden');
        else console.warn("JS: switchView - a view element is null");
    });

    if (views[viewId]) {
        views[viewId].classList.remove('hidden');
        currentView = viewId; 

        if (viewId === 'notifications') {
            renderWebhookConfigsList(currentWebhookConfigs); 
            if (!selectedWebhookId) {
                showWebhookDetailPlaceholder(true);
            } else {
                const selectedConfig = currentWebhookConfigs.find(wh => wh.id === selectedWebhookId);
                if (selectedConfig) {
                    populateWebhookForm(selectedConfig);
                } else { 
                    selectedWebhookId = null;
                    showWebhookDetailPlaceholder(true);
                }
            }
        } else if (viewId === 'about') { 
            loadAndDisplayAppVersionInfo(); 
        }
    } else {
        console.error(`JS: View with ID '${viewId}' not found!`);
    }

    Object.values(navLinks).forEach(link => {
        if (link) link.classList.remove('active', 'bg-gray-700', 'text-white'); 
        else console.warn("JS: switchView - a navLink element is null");
    });
    if (navLinks[viewId]) {
        navLinks[viewId].classList.add('active', 'bg-gray-700', 'text-white');
    } else {
        console.error(`JS: Nav link with ID for view '${viewId}' not found!`);
    }
}

function renderSubscriptionList(subscriptionsData) {
    currentSubscriptions = subscriptionsData || []; 
    if (!subscriptionListBody) { console.error("JS: subscriptionListBody is null in renderSubscriptionList"); return; }
    subscriptionListBody.innerHTML = ''; 

    if (currentSubscriptions.length === 0) {
        if (noSubscriptionsMessage) noSubscriptionsMessage.classList.remove('hidden');
        updateDashboardStats(currentSubscriptions); 
        return;
    }
    if (noSubscriptionsMessage) noSubscriptionsMessage.classList.add('hidden');

    currentSubscriptions.forEach(sub => {
        if (!sub || typeof sub.url !== 'string') { console.warn("JS: Invalid subscription object in renderSubscriptionList:", sub); return; }
        
        const row = subscriptionListBody.insertRow();
        const safeRowIdSuffix = generateSafeDomIdFromString(sub.url); 
        row.id = `sub-row-${safeRowIdSuffix.substring(3)}`; 

        row.className = 'hover:bg-gray-700/50 transition-colors duration-150';

        let statusClass = 'status-pending';
        let statusText = sub.status || '待检查';
        if (sub.status === 'online') { statusClass = 'status-online'; statusText = '在线'; }
        else if (sub.status && (sub.status.startsWith('error') || sub.status.startsWith('offline'))) {
            statusClass = 'status-offline';
            statusText = `错误/离线 (${sub.status.replace('error (', '').replace('offline (', '').replace(')', '')})`;
        } else if (sub.status === 'pending') {
            statusClass = 'status-pending'; statusText = '待检查';
        }

        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300">${sub.name || 'N/A'}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-400 truncate max-w-xs" title="${sub.url}">${sub.url}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm ${statusClass}"><span class="font-semibold">${statusText}</span></td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-400">${sub.last_checked || 'N/A'}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                <button class="text-blue-400 hover:text-blue-300 check-node-btn" data-url="${sub.url}" title="检查此节点">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 inline pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" /></svg>
                </button>
                <button class="text-red-400 hover:text-red-300 remove-node-btn" data-url="${sub.url}" title="移除此节点">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 inline pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
            </td>`;
    });
    updateDashboardStats(currentSubscriptions);
}

function updateSingleSubscriptionInList(node) {
    if (!node || !node.url) { console.warn("JS: Invalid node data for updateSingleSubscriptionInList:", node); return; }
    
    const safeRowIdSuffix = generateSafeDomIdFromString(node.url); 
    const rowId = `sub-row-${safeRowIdSuffix.substring(3)}`; 
    const row = document.getElementById(rowId);

    if (row) { 
        let statusClass = 'status-pending';
        let statusText = node.status || '待检查';
        if (node.status === 'online') { statusClass = 'status-online'; statusText = '在线'; }
        else if (node.status && (node.status.startsWith('error') || node.status.startsWith('offline'))) {
            statusClass = 'status-offline';
            statusText = `错误/离线 (${node.status.replace('error (', '').replace('offline (', '').replace(')', '')})`;
        } else if (node.status === 'pending') {
            statusClass = 'status-pending'; statusText = '待检查';
        }
        if (row.cells[0].textContent !== (node.name || 'N/A')) {
            row.cells[0].textContent = node.name || 'N/A';
        }
        row.cells[2].innerHTML = `<span class="font-semibold">${statusText}</span>`;
        row.cells[2].className = `px-6 py-4 whitespace-nowrap text-sm ${statusClass}`;
        row.cells[3].textContent = node.last_checked || 'N/A';
    } else {
        console.warn(`JS: Row with id ${rowId} not found for update. Consider full refresh or adding new row.`);
        const existingNodeIndex = currentSubscriptions.findIndex(s => s.url === node.url);
        if (existingNodeIndex === -1) {
            currentSubscriptions.push(node); 
        } else {
            currentSubscriptions[existingNodeIndex] = { ...currentSubscriptions[existingNodeIndex], ...node }; 
        }
        renderSubscriptionList(currentSubscriptions); 
        return;
    }

    const index = currentSubscriptions.findIndex(s => s.url === node.url);
    if (index > -1) {
        currentSubscriptions[index] = { ...currentSubscriptions[index], ...node };
    } else {
        currentSubscriptions.push(node);
    }
    updateDashboardStats(currentSubscriptions); 
}

function populateSettingsForm(settingsData) {
    currentSettings = settingsData; 
    if (appTitleDisplay) appTitleDisplay.textContent = settingsData.app_title || "主动可用性监测平台";
    updateAppLogoDisplay(settingsData.app_icon_path); 

    if (appGlobalTitleInput) appGlobalTitleInput.value = settingsData.app_title || "";
    if (urlCheckIntervalInput) urlCheckIntervalInput.value = settingsData.url_check_interval || 30;
    if (urlCheckIntervalUnitSelect) urlCheckIntervalUnitSelect.value = settingsData.url_check_interval_unit || 'minutes';
    if (autoUpdateSourcesIntervalInput) autoUpdateSourcesIntervalInput.value = settingsData.auto_update_sources_interval_minutes || 60;
    
    if (faultConfirmAttemptsInput) faultConfirmAttemptsInput.value = settingsData.fault_confirm_attempts === undefined ? 2 : settingsData.fault_confirm_attempts;
    if (faultConfirmIntervalSecondsInput) faultConfirmIntervalSecondsInput.value = settingsData.fault_confirm_interval_seconds === undefined ? 10 : settingsData.fault_confirm_interval_seconds;

    if (globalFaultRenotificationIntervalInput) globalFaultRenotificationIntervalInput.value = settingsData.fault_renotification_interval_minutes === undefined ? 60 : settingsData.fault_renotification_interval_minutes;
    if (globalNotifyOnRecoveryCheckbox) globalNotifyOnRecoveryCheckbox.checked = typeof settingsData.notify_on_recovery === 'boolean' ? settingsData.notify_on_recovery : true;
    if (startWithWindowsCheckbox) startWithWindowsCheckbox.checked = settingsData.start_with_windows || false;
    if (startMinimizedCheckbox) startMinimizedCheckbox.checked = settingsData.start_minimized || false;
}

function addLogEntryToUi(logEntry) {
    if (!logContainer) { console.warn("JS: logContainer is null, cannot add log entry."); return; }
    const entryDiv = document.createElement('div');
    const timeMatch = logEntry.match(/^(\d{2}:\d{2}:\d{2}):\s*(.*)/);
    if (timeMatch) {
        entryDiv.innerHTML = `<span class="text-gray-500">${timeMatch[1]}</span> ${timeMatch[2]}`;
    } else {
        entryDiv.textContent = logEntry;
    }

    const lowerLogEntry = logEntry.toLowerCase();
    if (lowerLogEntry.includes("error") || lowerLogEntry.includes("fail") || lowerLogEntry.includes("错误") || lowerLogEntry.includes("失败") || lowerLogEntry.includes("critical")) {
        entryDiv.classList.add('text-red-400');
    } else if (lowerLogEntry.includes("warn") || lowerLogEntry.includes("警告")) {
        entryDiv.classList.add('text-yellow-400');
    } else if (lowerLogEntry.includes("success") || lowerLogEntry.includes("online") || lowerLogEntry.includes("成功") || lowerLogEntry.includes("已连接")) {
        entryDiv.classList.add('text-green-400');
    } else {
        entryDiv.classList.add('text-gray-300'); 
    }

    // 修改：将新日志条目插入到顶部
    if (logContainer.firstChild) {
        logContainer.insertBefore(entryDiv, logContainer.firstChild);
    } else {
        logContainer.appendChild(entryDiv);
    }

    // 可选：如果希望在添加新日志时自动滚动到顶部 (仅当用户未向上滚动时)
    // if (logContainer.scrollTop < 50) { // 50px 阈值，表示用户在顶部附近
    //     logContainer.scrollTop = 0;
    // }
}

function updateDashboardStats(subscriptionsData) {
    const stats = {
        total: subscriptionsData.length,
        online: subscriptionsData.filter(s => s.status === 'online').length,
        offline: subscriptionsData.filter(s => s.status && (s.status.startsWith('error') || s.status.startsWith('offline') || s.status === 'timeout')).length,
        pending: subscriptionsData.filter(s => s.status === 'pending' || !s.status).length,
    };
    if (document.getElementById('stats-total-nodes')) document.getElementById('stats-total-nodes').textContent = stats.total;
    if (document.getElementById('stats-online-nodes')) document.getElementById('stats-online-nodes').textContent = stats.online;
    if (document.getElementById('stats-offline-nodes')) document.getElementById('stats-offline-nodes').textContent = stats.offline;
    if (document.getElementById('stats-pending-nodes')) document.getElementById('stats-pending-nodes').textContent = stats.pending;
}

function updateNextCheckTimeDisplay(unixTimestampMs) { 
    if (nextCheckTimeSpan) {
        if (unixTimestampMs && typeof unixTimestampMs === 'number') {
            const date = new Date(unixTimestampMs);
            nextCheckTimeSpan.textContent = `下次全体检查: ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
        } else {
            nextCheckTimeSpan.textContent = ''; 
        }
    }
}

function renderSubscriptionSourcesList(sourceUrlsData) {
    currentSubscriptionSources = sourceUrlsData || [];
    if (!subscriptionSourcesListDiv) { console.error("JS: Subscription sources list DIV not found!"); return; }
    subscriptionSourcesListDiv.innerHTML = '';

    if (currentSubscriptionSources.length === 0) {
        if (noSubscriptionSourcesMessageElem) noSubscriptionSourcesMessageElem.classList.remove('hidden');
        return;
    }
    if (noSubscriptionSourcesMessageElem) noSubscriptionSourcesMessageElem.classList.add('hidden');

    currentSubscriptionSources.forEach(url => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'source-url-item text-sm'; 

        const urlSpan = document.createElement('span');
        urlSpan.textContent = url;
        urlSpan.className = 'truncate flex-grow mr-2 text-gray-300';
        urlSpan.title = url;

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '删除';
        deleteBtn.className = 'delete-source-btn'; 
        deleteBtn.dataset.url = url;

        deleteBtn.addEventListener('click', async () => {
            showCustomConfirm(`确定要移除订阅源 ${url} 吗？这将同时移除该源提供的所有节点。`, async (confirmed) => {
                if (confirmed) {
                    try {
                        const result = await window.electronAPI.removeSubscriptionSourceUrl(url);
                        if (result.success) {
                            showToast(result.message, 'success');
                            renderSubscriptionSourcesList(result.subscription_sources); 
                            renderSubscriptionList(result.subscriptions); 
                        } else { showToast(result.message, 'error'); }
                    } catch (error) {
                        console.error("JS: Error removing subscription source:", error);
                        showToast('移除订阅源时发生错误。', 'error');
                    }
                }
            });
        });
        itemDiv.appendChild(urlSpan);
        itemDiv.appendChild(deleteBtn);
        subscriptionSourcesListDiv.appendChild(itemDiv);
    });
}

function renderWebhookConfigsList(webhookConfigsData) {
    currentWebhookConfigs = webhookConfigsData || [];
    if (!webhookListDiv) { console.error("JS: webhookListDiv is null!"); return; }
    webhookListDiv.innerHTML = '';

    if (currentWebhookConfigs.length === 0) {
        if (noWebhooksMessageAside) noWebhooksMessageAside.classList.remove('hidden');
        return;
    }
    if (noWebhooksMessageAside) noWebhooksMessageAside.classList.add('hidden');

    currentWebhookConfigs.forEach(wh => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'webhook-list-item p-3 rounded-lg cursor-pointer hover:bg-gray-700/70 transition-colors flex items-center';
        itemDiv.dataset.webhookId = wh.id;

        const statusIndicator = document.createElement('span');
        statusIndicator.className = `webhook-status-indicator ${wh.enabled ? 'enabled' : 'disabled'}`;
        statusIndicator.title = wh.enabled ? '已启用' : '已禁用';

        const textContainer = document.createElement('div');
        textContainer.className = 'flex-grow overflow-hidden ml-2'; 

        const nameH4 = document.createElement('h4');
        nameH4.className = 'font-medium text-white truncate';
        nameH4.textContent = wh.name;
        nameH4.title = wh.name;

        const typeP = document.createElement('p');
        typeP.className = 'text-xs text-gray-400 truncate';
        typeP.textContent = `${wh.type}: ${wh.url ? wh.url.substring(0, 30) + (wh.url.length > 30 ? '...' : '') : 'URL未设置'}`;
        typeP.title = wh.url;

        textContainer.appendChild(nameH4);
        textContainer.appendChild(typeP);
        itemDiv.appendChild(statusIndicator);
        itemDiv.appendChild(textContainer);

        if (wh.id === selectedWebhookId) {
            itemDiv.classList.add('active', 'bg-gray-700');
        }

        itemDiv.addEventListener('click', () => {
            selectedWebhookId = wh.id;
            isWebhookEditMode = true;
            populateWebhookForm(wh);
            renderWebhookConfigsList(currentWebhookConfigs); 
        });
        webhookListDiv.appendChild(itemDiv);
    });
}

function showWebhookDetailPlaceholder(show) {
    if (!webhookDetailContainer || !webhookFormFields || !webhookDetailPlaceholder || !webhookFormTitle) {
        console.error("JS: Webhook detail elements not found for placeholder toggle."); return;
    }
    if (show) {
        webhookDetailContainer.classList.remove('form-fields-visible');
        webhookDetailContainer.classList.add('form-fields-hidden');
    } else {
        webhookDetailContainer.classList.remove('form-fields-hidden');
        webhookDetailContainer.classList.add('form-fields-visible');
    }
}

function resetWebhookForm() {
    if (!webhookForm) { console.error("JS: webhookForm is null in resetWebhookForm"); return; }
    webhookForm.reset(); 
    if (webhookIdInput) webhookIdInput.value = '';
    if (webhookNameInput) webhookNameInput.value = '';
    if (webhookTypeSelect) webhookTypeSelect.value = 'custom'; 
    if (webhookUrlInput) webhookUrlInput.value = '';
    if (customWebhookPayloadTextarea) customWebhookPayloadTextarea.value = '{"text": "{message}", "nodeName": "{nodeName}", "nodeUrl": "{nodeUrl}", "status": "{nodeStatus}", "appName": "{appName}", "eventType": "{eventType}" }';
    
    const defaultRenotifyInterval = currentSettings.fault_renotification_interval_minutes === undefined ? 60 : currentSettings.fault_renotification_interval_minutes;
    const defaultNotifyOnRecovery = typeof currentSettings.notify_on_recovery === 'boolean' ? currentSettings.notify_on_recovery : true;

    if (webhookRenotificationIntervalInput) webhookRenotificationIntervalInput.value = defaultRenotifyInterval;
    if (webhookEnabledCheckbox) webhookEnabledCheckbox.checked = true; 
    if (webhookNotifyOnRecoveryCheckbox) webhookNotifyOnRecoveryCheckbox.checked = defaultNotifyOnRecovery;

    toggleCustomPayloadVisibility();
    if (webhookDeleteButton) webhookDeleteButton.classList.add('hidden');
    if (webhookFormTitle) webhookFormTitle.textContent = '添加新 Webhook';
    isWebhookEditMode = false;
}

function populateWebhookForm(webhookConfig) {
    if (!webhookForm) { console.error("JS: webhookForm is null in populateWebhookForm"); return; }
    showWebhookDetailPlaceholder(false); 

    if (webhookIdInput) webhookIdInput.value = webhookConfig.id;
    if (webhookNameInput) webhookNameInput.value = webhookConfig.name;
    if (webhookTypeSelect) webhookTypeSelect.value = webhookConfig.type;
    if (webhookUrlInput) webhookUrlInput.value = webhookConfig.url;
    if (customWebhookPayloadTextarea) customWebhookPayloadTextarea.value = webhookConfig.custom_payload_template || '{"text": "{message}"}';
    if (webhookRenotificationIntervalInput) webhookRenotificationIntervalInput.value = webhookConfig.renotification_interval_minutes;
    if (webhookEnabledCheckbox) webhookEnabledCheckbox.checked = webhookConfig.enabled;
    if (webhookNotifyOnRecoveryCheckbox) webhookNotifyOnRecoveryCheckbox.checked = webhookConfig.notify_on_recovery;

    toggleCustomPayloadVisibility();
    if (webhookDeleteButton) webhookDeleteButton.classList.remove('hidden');
    if (webhookFormTitle) webhookFormTitle.textContent = '编辑 Webhook: ' + webhookConfig.name;
}

function toggleCustomPayloadVisibility() {
    if (!webhookTypeSelect || !customWebhookPayloadContainer) return;
    if (webhookTypeSelect.value === 'custom') {
        customWebhookPayloadContainer.classList.remove('hidden');
    } else {
        customWebhookPayloadContainer.classList.add('hidden');
    }
}

async function handleWebhookFormSubmit(event) {
    event.preventDefault();
    if (!webhookForm.checkValidity()) { 
        showToast('请填写所有必填字段 (名称和URL)。', 'warning');
        webhookForm.reportValidity(); 
        return;
    }
    const webhookData = {
        id: webhookIdInput.value || null, 
        name: webhookNameInput.value.trim(),
        type: webhookTypeSelect.value,
        url: webhookUrlInput.value.trim(),
        custom_payload_template: customWebhookPayloadTextarea.value,
        enabled: webhookEnabledCheckbox.checked,
        notify_on_recovery: webhookNotifyOnRecoveryCheckbox.checked,
        renotification_interval_minutes: parseInt(webhookRenotificationIntervalInput.value, 10) || 0, 
    };

    try {
        let result;
        if (isWebhookEditMode && webhookData.id) { 
            result = await window.electronAPI.updateWebhookConfig(webhookData);
        } else { 
            result = await window.electronAPI.addWebhookConfig(webhookData);
        }

        if (result && result.success) {
            showToast(result.message, 'success');
            currentWebhookConfigs = result.all_configs || []; 
            selectedWebhookId = result.updated_config ? result.updated_config.id : (result.new_config ? result.new_config.id : null);
            renderWebhookConfigsList(currentWebhookConfigs); 
            if (selectedWebhookId) { 
                const currentSelectedConfig = currentWebhookConfigs.find(wh => wh.id === selectedWebhookId);
                if (currentSelectedConfig) populateWebhookForm(currentSelectedConfig);
            } else {
                resetWebhookForm(); 
                showWebhookDetailPlaceholder(true);
            }
        } else {
            showToast(result ? result.message : '保存 Webhook 失败。', 'error');
        }
    } catch (error) {
        console.error("JS: Error saving webhook:", error);
        showToast('保存 Webhook 时发生前端错误。', 'error');
    }
}

async function handleDeleteWebhook() {
    if (!selectedWebhookId) {
        showToast('没有选中的 Webhook 可供删除。', 'warning');
        return;
    }
    const webhookToDelete = currentWebhookConfigs.find(wh => wh.id === selectedWebhookId);
    if (!webhookToDelete) {
        showToast('无法找到要删除的 Webhook 配置。', 'error');
        return;
    }
    
    showCustomConfirm(`确定要删除 Webhook "${webhookToDelete.name}" 吗？此操作无法撤销。`, async (confirmed) => {
        if (confirmed) {
            try {
                const result = await window.electronAPI.removeWebhookConfig(selectedWebhookId);
                if (result.success) {
                    showToast(result.message, 'success');
                    currentWebhookConfigs = result.all_configs || [];
                    selectedWebhookId = null; 
                    isWebhookEditMode = false;
                    renderWebhookConfigsList(currentWebhookConfigs);
                    resetWebhookForm(); 
                    showWebhookDetailPlaceholder(true);
                } else {
                    showToast(result.message, 'error');
                }
            } catch (error) {
                console.error("JS: Error deleting webhook:", error);
                showToast('删除 Webhook 时发生错误。', 'error');
            }
        }
    });
}

async function handleTestWebhook() {
    const idToTest = webhookIdInput.value; 
    if (!idToTest) {
        showToast('请先保存或选择一个 Webhook 配置以进行测试。', 'warning');
        return;
    }
    const webhookToTest = currentWebhookConfigs.find(wh => wh.id === idToTest);
    if (!webhookToTest || !webhookToTest.url) {
        showToast('请确保 Webhook 配置已保存且 URL 有效。', 'warning');
        return;
    }

    showToast(`正在测试 Webhook "${webhookToTest.name}"...`, 'info');
    try {
        const result = await window.electronAPI.testSpecificWebhook(idToTest, "这是一条来自【{appName}】的可用性监测平台(Electron)测试通知。");
        showToast(result.message, result.success ? 'success' : 'error');
    } catch (error) {
        console.error("JS: Error testing webhook:", error);
        showToast('测试 Webhook 时发生前端错误。', 'error');
    }
}

async function handleSaveGeneralSettings() {
    const settingsToSave = {
        app_title: appGlobalTitleInput.value.trim() || currentSettings.app_title,
        url_check_interval: parseInt(urlCheckIntervalInput.value, 10) || 30,
        url_check_interval_unit: urlCheckIntervalUnitSelect.value || 'minutes',
        auto_update_sources_interval_minutes: parseInt(autoUpdateSourcesIntervalInput.value, 10) || 60,
        fault_renotification_interval_minutes: parseInt(globalFaultRenotificationIntervalInput.value, 10),
        notify_on_recovery: globalNotifyOnRecoveryCheckbox.checked,
        start_with_windows: startWithWindowsCheckbox.checked,
        start_minimized: startMinimizedCheckbox.checked,
        fault_confirm_attempts: parseInt(faultConfirmAttemptsInput.value, 10),
        fault_confirm_interval_seconds: parseInt(faultConfirmIntervalSecondsInput.value, 10),
        app_icon_path: currentSettings.app_icon_path || null 
    };
    if (isNaN(settingsToSave.fault_renotification_interval_minutes)) {
        settingsToSave.fault_renotification_interval_minutes = 60; 
    }
    if (isNaN(settingsToSave.fault_confirm_attempts) || settingsToSave.fault_confirm_attempts < 0) {
        settingsToSave.fault_confirm_attempts = 2; 
    }
    if (isNaN(settingsToSave.fault_confirm_interval_seconds) || settingsToSave.fault_confirm_interval_seconds < 1) {
        settingsToSave.fault_confirm_interval_seconds = 10; 
    }

    try {
        const result = await window.electronAPI.saveSettings(settingsToSave);
        if (result.success) {
            currentSettings = result.updated_settings; 
            populateSettingsForm(currentSettings); 
            showToast('常规设置已保存。', 'success');
        } else {
            showToast(result.message || '保存常规设置失败。', 'error');
        }
    } catch (error) {
        console.error("JS: Error saving general settings:", error);
        showToast('保存常规设置时发生错误。', 'error');
    }
}

function setupCustomConfirmModal() {
    // DOM元素已在 assignElements 中获取
    if (confirmModalOkBtn) {
        confirmModalOkBtn.addEventListener('click', () => {
            if (confirmCallback) confirmCallback(true);
            hideCustomConfirm();
        });
    }
    if (confirmModalCancelBtn) {
        confirmModalCancelBtn.addEventListener('click', () => {
            if (confirmCallback) confirmCallback(false);
            hideCustomConfirm();
        });
    }
    if (confirmModalOverlay) {
        confirmModalOverlay.addEventListener('click', (event) => {
            if (event.target === confirmModalOverlay) { 
                if (confirmCallback) confirmCallback(false);
                hideCustomConfirm();
            }
        });
    }
}

function showCustomConfirm(message, callback, title = "请确认") { // 增加 title 参数
    if (!confirmModalOverlay || !confirmModalMessage || !customConfirmTitle) {
        console.error("Custom confirm modal elements not found. Falling back to native confirm.");
        if (callback) callback(confirm(message)); 
        return;
    }
    customConfirmTitle.textContent = title; // 设置标题
    confirmModalMessage.textContent = message;
    confirmCallback = callback; 
    confirmModalOverlay.classList.add('active');
}

function hideCustomConfirm() {
    if (confirmModalOverlay) {
        confirmModalOverlay.classList.remove('active');
    }
    confirmCallback = null; 
}


function attachAllEventListeners() {
    console.log("JS: Attaching all event listeners...");
    Object.keys(navLinks).forEach(key => {
        const linkElement = navLinks[key];
        if (linkElement) {
            if (key === 'about') {
                linkElement.addEventListener('click', (e) => {
                    e.preventDefault();
                    console.log("JS: 'About' navigation link clicked."); 
                    switchView(key);
                });
            } else {
                linkElement.addEventListener('click', (e) => { e.preventDefault(); switchView(key); });
            }
        } else { console.warn(`JS: Nav link element for '${key}' not found.`); }
    });

    if (customMinimizeBtn) {
        customMinimizeBtn.addEventListener('click', async () => {
            console.log("JS: Custom minimize button clicked.");
            try {
                await window.electronAPI.minimizeToTray();
            } catch (error) {
                console.error("JS: Error calling minimizeToTray:", error);
                showToast("最小化到托盘失败。", "error");
            }
        });
    }
    if (customCloseBtn) { 
        customCloseBtn.addEventListener('click', async () => {
            console.log("JS: Custom close (X) button clicked, minimizing to tray.");
            try {
                await window.electronAPI.minimizeToTray();
            } catch (error) {
                console.error("JS: Error calling minimizeToTray from custom close:", error);
                showToast("最小化到托盘失败。", "error");
            }
        });
    }

    const addSubUrlButtonElem = document.getElementById('addSubUrlButton');
    if (addSubUrlButtonElem) {
        addSubUrlButtonElem.addEventListener('click', async () => {
            const urlInput = document.getElementById('newSubUrl');
            if (!urlInput) { console.error("JS: newSubUrl input not found"); return; }
            const subUrl = urlInput.value.trim();
            if (!subUrl) { showToast('请输入订阅源链接。', 'warning'); return; }
            try {
                const result = await window.electronAPI.addSubscriptionSourceUrl(subUrl);
                if (result.success) {
                    showToast(result.message, 'success');
                    renderSubscriptionList(result.subscriptions);
                    renderSubscriptionSourcesList(result.subscription_sources);
                    urlInput.value = ''; 
                } else { showToast(result.message, 'error'); }
            } catch (error) { console.error("JS: Error adding subscription source URL:", error); showToast('添加订阅源时发生错误。', 'error'); }
        });
    }

    if (refreshSubFromSourceButton) {
        refreshSubFromSourceButton.addEventListener('click', async () => {
            showToast('正在刷新所有订阅源...', 'info');
            try {
                const result = await window.electronAPI.refreshAllSubscriptionSources();
                showToast(result.message, result.success ? 'info' : 'warning'); 
            } catch (error) { console.error("JS: Error refreshing all subscription sources:", error); showToast('刷新所有订阅源时发生前端错误。', 'error'); }
        });
    }

    if (subscriptionListBody) {
        subscriptionListBody.addEventListener('click', async (e) => {
            const targetButton = e.target.closest('button.remove-node-btn, button.check-node-btn');
            if (!targetButton) return;
            const url = targetButton.dataset.url;
            if (!url) { showToast('无法获取节点URL。', 'error'); return; }

            if (targetButton.classList.contains('remove-node-btn')) {
                showCustomConfirm(`确定要移除节点 ${url} 吗?`, async (confirmed) => {
                    if (confirmed) {
                        try {
                            const result = await window.electronAPI.removeSubscription(url);
                            showToast(result.message, result.success ? 'success' : 'error');
                            if (result.success) renderSubscriptionList(result.subscriptions);
                        } catch (error) { console.error("JS: Error removing subscription:", error); showToast('移除订阅时发生错误。', 'error'); }
                    }
                });
            } else if (targetButton.classList.contains('check-node-btn')) {
                try {
                    showToast(`正在检查节点 ${url}...`, 'info');
                    const result = await window.electronAPI.manualCheckNode(url);
                    showToast(result.message, result.success ? 'info' : 'error');
                } catch (error) { console.error("JS: Error checking node:", error); showToast('检查节点时发生错误。', 'error'); }
            }
        });
    }

    const manualCheckAllDashboard = document.getElementById('manualCheckAllButtonDashboard');
    const manualCheckAllSubs = document.getElementById('manualCheckAllButtonSubs');
    async function doManualCheckAll() {
        showToast('正在启动所有节点检查...', 'info');
        try {
            const result = await window.electronAPI.manualCheckAllNodes();
            showToast(result.message, result.success ? 'info' : 'error');
        } catch (error) { console.error("JS: Error manually checking all nodes:", error); showToast('手动检查所有节点时发生错误。', 'error'); }
    }
    if (manualCheckAllDashboard) manualCheckAllDashboard.addEventListener('click', doManualCheckAll);
    if (manualCheckAllSubs) manualCheckAllSubs.addEventListener('click', doManualCheckAll);

    let logoClickTimeout = null; 
    let logoClickCount = 0;
    if (appLogoContainer) {
        appLogoContainer.addEventListener('click', async () => {
            logoClickCount++;
            if (logoClickCount === 1) {
                logoClickTimeout = setTimeout(() => { logoClickCount = 0; }, 400); 
            } else if (logoClickCount === 3) {
                clearTimeout(logoClickTimeout); logoClickCount = 0;
                console.log("JS: Logo triple-clicked. Requesting new icon selection.");
                try {
                    if (window.electronAPI && typeof window.electronAPI.selectAppIcon === 'function') {
                        const newIconPath = await window.electronAPI.selectAppIcon(); 
                        if (newIconPath) {
                            console.log("JS: New icon selected:", newIconPath);
                            const result = await window.electronAPI.saveSettings({ app_icon_path: newIconPath });
                            if (result.success) {
                                showToast('应用图标已请求更改。部分更改可能在重启后生效。', 'success');
                                currentSettings = result.updated_settings; 
                                updateAppLogoDisplay(newIconPath); 
                            } else {
                                showToast(result.message || '保存新图标路径失败。', 'error');
                            }
                        } else {
                            console.log("JS: Icon selection cancelled.");
                        }
                    } else {
                        console.error("JS: window.electronAPI.selectAppIcon is not a function!");
                        showToast('选择图标功能不可用。', 'error');
                    }
                } catch (error) {
                    console.error("JS: Error selecting or saving app icon:", error);
                    showToast(`选择或保存图标时错误: ${error.message}`, 'error');
                }
            }
        });
    }


    if (quitAppButtonSidebarElem) {
        quitAppButtonSidebarElem.addEventListener('click', () => {
            showCustomConfirm('确定要退出应用吗? 这将关闭整个程序。', (confirmed) => {
                if (confirmed) {
                    window.electronAPI.quitApplication().catch(err => showToast('请求退出应用时出错: ' + err, 'error'));
                }
            }, '退出应用'); // 自定义确认框标题
        });
    }

    if (createNewWebhookBtn) {
        createNewWebhookBtn.addEventListener('click', () => {
            selectedWebhookId = null; 
            isWebhookEditMode = false; 
            resetWebhookForm(); 
            showWebhookDetailPlaceholder(false); 
            renderWebhookConfigsList(currentWebhookConfigs); 
            if (webhookNameInput) webhookNameInput.focus();
        });
    }
    if (webhookForm) webhookForm.addEventListener('submit', handleWebhookFormSubmit);
    if (webhookTypeSelect) webhookTypeSelect.addEventListener('change', toggleCustomPayloadVisibility);
    if (webhookDeleteButton) webhookDeleteButton.addEventListener('click', handleDeleteWebhook); 
    if (webhookTestButton) webhookTestButton.addEventListener('click', handleTestWebhook);

    if (saveGeneralSettingsButton) {
        saveGeneralSettingsButton.addEventListener('click', handleSaveGeneralSettings);
    }

    if (emailLink) {
        emailLink.addEventListener('click', (e) => {
            e.preventDefault(); 
            if (window.electronAPI && typeof window.electronAPI.openExternalLink === 'function') {
                window.electronAPI.openExternalLink(emailLink.href)
                    .catch(err => {
                        console.error("JS: Error opening email link via API:", err);
                        showToast("无法打开邮件链接。", "error");
                    });
            } else {
                console.error("JS: window.electronAPI.openExternalLink is not a function!");
                showToast("打开链接功能不可用。", "error");
            }
        });
    }
    if (blogLink) {
        blogLink.addEventListener('click', (e) => {
            e.preventDefault(); 
            if (window.electronAPI && typeof window.electronAPI.openExternalLink === 'function') {
                window.electronAPI.openExternalLink(blogLink.href)
                    .catch(err => {
                        console.error("JS: Error opening blog link via API:", err);
                        showToast("无法打开博客链接。", "error");
                    });
            } else {
                console.error("JS: window.electronAPI.openExternalLink is not a function!");
                showToast("打开链接功能不可用。", "error");
            }
        });
    }


    window.electronAPI.on('add-log-entry', (logEntryString) => {
        addLogEntryToUi(logEntryString);
    });
    window.electronAPI.on('update-subscription-node', (nodeData) => {
        updateSingleSubscriptionInList(nodeData);
    });
    window.electronAPI.on('refresh-subscription-list', (subscriptionsData) => {
        console.log("JS: Received 'refresh-subscription-list' from main process.");
        renderSubscriptionList(subscriptionsData);
    });
    window.electronAPI.on('update-next-check-time', (unixTimestampMs) => {
        updateNextCheckTimeDisplay(unixTimestampMs);
    });
    window.electronAPI.on('update-app-icon-display', (iconPath) => {
        console.log("JS: Received 'update-app-icon-display' with path:", iconPath);
        updateAppLogoDisplay(iconPath);
    });
    window.electronAPI.on('show-toast', (toastData) => { 
        if (toastData && toastData.message) {
            showToast(toastData.message, toastData.type || 'info');
        }
    });

    console.log("JS: All event listeners attachment process completed.");
}


async function initializeApp() {
    try {
        console.log("JS: Initializing app with electronAPI...");
        assignElements(); 
        setupCustomConfirmModal(); 
        showWebhookDetailPlaceholder(true); 

        const uiReadyResponse = await window.electronAPI.signalUiReady();
        console.log("JS: signalUiReady response:", uiReadyResponse);

        const initialData = await window.electronAPI.loadInitialData();
        console.log("JS: Initial data loaded:", initialData);

        if (initialData) {
            currentSettings = initialData.settings || {};
            currentSubscriptions = initialData.subscriptions || [];
            currentWebhookConfigs = initialData.settings.webhooks || [];
            currentSubscriptionSources = initialData.settings.subscription_source_urls || [];

            populateSettingsForm(currentSettings); 
            renderSubscriptionList(currentSubscriptions); 
            renderSubscriptionSourcesList(currentSubscriptionSources); 
            renderWebhookConfigsList(currentWebhookConfigs);

            if (initialData.logs && Array.isArray(initialData.logs)) {
                // 修改：倒序加载初始日志
                for (let i = initialData.logs.length - 1; i >= 0; i--) {
                    addLogEntryToUi(initialData.logs[i]);
                }
            }
            updateDashboardStats(currentSubscriptions);
        } else {
            console.error("JS: Failed to load initial data from Electron main process.");
            showToast('无法从后端加载初始数据。', 'error');
        }

        switchView('dashboard'); 
        if (appLoader) {
            appLoader.style.display = 'none';
            console.log("JS: appLoader display set to none.");
        }

        attachAllEventListeners(); 

    } catch (error) {
        console.error("JS: Error initializing app:", error, error.stack); 
        if (appLoader) appLoader.textContent = '应用加载失败。请检查控制台。';
        showToast('初始化应用时发生严重错误: ' + error.message, 'error');
    }
}
