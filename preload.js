// preload.js - 在渲染器进程加载前运行，并有权访问 Node.js API 和 window 对象

const { contextBridge, ipcRenderer } = require('electron');

// 定义一个白名单，列出允许从主进程发送到渲染进程的通道
// 以及允许渲染进程调用主进程的通道。
const validSendChannels = [
    'add-log-entry',
    'update-subscription-node',
    'refresh-subscription-list',
    'update-next-check-time',
    'update-app-icon-display', // 用于主进程通知渲染进程更新侧边栏图标
    'show-toast' // 新增：允许主进程请求显示 Toast
];

const validInvokeChannels = [
    'signal-ui-ready',
    'load-initial-data',
    'get-subscriptions',
    'get-subscription-sources',
    'add-subscription-source-url',
    'remove-subscription-source-url',
    'refresh-all-subscription-sources',
    'remove-subscription',
    'manual-check-node',
    'manual-check-all-nodes',
    'get-settings',
    'save-settings',
    'get-webhook-configs',
    'add-webhook-config',
    'update-webhook-config',
    'remove-webhook-config',
    'test-specific-webhook',
    'minimize-to-tray',
    'quit-application',
    'select-app-icon',      // 用于选择应用图标
    'get-app-version-info', // 新增：用于获取应用版本信息
    'open-external-link'    // 新增：用于打开外部链接
];

contextBridge.exposeInMainWorld('electronAPI', {
    // --- 从主进程到渲染进程的事件监听 ---
    on: (channel, callback) => {
        if (validSendChannels.includes(channel)) {
            // Deliberately strip event as it includes `sender`
            ipcRenderer.on(channel, (event, ...args) => callback(...args));
        } else {
            console.warn(`[Preload] Attempted to subscribe to invalid channel: ${channel}`);
        }
    },
    removeListener: (channel, callback) => {
        if (validSendChannels.includes(channel)) {
            ipcRenderer.removeListener(channel, callback);
        } else {
            console.warn(`[Preload] Attempted to remove listener from invalid channel: ${channel}`);
        }
    },
    removeAllListeners: (channel) => {
        if (validSendChannels.includes(channel)) {
            ipcRenderer.removeAllListeners(channel);
        } else {
            console.warn(`[Preload] Attempted to remove all listeners from invalid channel: ${channel}`);
        }
    },

    // --- 从渲染进程到主进程的调用 (invoke/handle 模式) ---
    signalUiReady: () => ipcRenderer.invoke('signal-ui-ready'),
    loadInitialData: () => ipcRenderer.invoke('load-initial-data'),
    getSubscriptions: () => ipcRenderer.invoke('get-subscriptions'),
    getSubscriptionSources: () => ipcRenderer.invoke('get-subscription-sources'),
    addSubscriptionSourceUrl: (subUrl) => ipcRenderer.invoke('add-subscription-source-url', subUrl),
    removeSubscriptionSourceUrl: (sourceUrl) => ipcRenderer.invoke('remove-subscription-source-url', sourceUrl),
    refreshAllSubscriptionSources: () => ipcRenderer.invoke('refresh-all-subscription-sources'),
    removeSubscription: (nodeUrl) => ipcRenderer.invoke('remove-subscription', nodeUrl),
    manualCheckNode: (nodeUrl) => ipcRenderer.invoke('manual-check-node', nodeUrl),
    manualCheckAllNodes: () => ipcRenderer.invoke('manual-check-all-nodes'),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settingsData) => ipcRenderer.invoke('save-settings', settingsData),
    getWebhookConfigs: () => ipcRenderer.invoke('get-webhook-configs'),
    addWebhookConfig: (configData) => ipcRenderer.invoke('add-webhook-config', configData),
    updateWebhookConfig: (configData) => ipcRenderer.invoke('update-webhook-config', configData),
    removeWebhookConfig: (webhookId) => ipcRenderer.invoke('remove-webhook-config', webhookId),
    testSpecificWebhook: (webhookId, testMessage) => ipcRenderer.invoke('test-specific-webhook', webhookId, testMessage),
    minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),
    quitApplication: () => ipcRenderer.invoke('quit-application'),
    selectAppIcon: () => ipcRenderer.invoke('select-app-icon'),
    getAppVersionInfo: () => ipcRenderer.invoke('get-app-version-info'), // 新增
    openExternalLink: (url) => ipcRenderer.invoke('open-external-link', url) // 新增
});

console.log('[Preload] electronAPI 已经成功注入到 window 对象 (v3 - 集成关于页面)。');
