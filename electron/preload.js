const { contextBridge, ipcRenderer } = require('electron');

const call = async (channel, ...args) => {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

const CRM_CALLS = ['listContacts', 'getContact', 'saveContact', 'deleteContact', 'allTags',
  'listDeals', 'getDeal', 'saveDeal', 'moveDeal', 'deleteDeal', 'linkContact', 'unlinkContact',
  'listTasks', 'saveTask', 'setTaskDone', 'deleteTask', 'listActivities', 'logActivity', 'deleteActivity',
  'weeklyNumbers', 'weeklyTrend', 'dueToday', 'pipelineCounts', 'options', 'callInfo', 'pickImportFile', 'runImport', 'promoteContact', 'teamSearch', 'team', 'saveTeamMember', 'removeTeamMember', 'setFundsNeeded'];
const crm = Object.fromEntries(CRM_CALLS.map((fn) => [fn, (...a) => call(`crm:${fn}`, ...a)]));
const LIST_CALLS = ['listLists', 'listItems', 'getItem', 'neighbor', 'setStatus', 'updateItem', 'markPhone', 'promote', 'renameList', 'deleteList',
  'statuses', 'analyze', 'run', 'export'];
const lists = Object.fromEntries(LIST_CALLS.map((fn) => [fn, (...a) => call(`lists:${fn}`, ...a)]));
lists.onProgress = (fn) => {
  const h = (_e, d) => fn(d);
  ipcRenderer.on('import-progress', h);
  return () => ipcRenderer.removeListener('import-progress', h);
};

const uw = {
  list: (opts) => call('uw:list', opts),
  get: (id) => call('uw:get', id),
  save: (a) => call('uw:save', a),
  remove: (id) => call('uw:remove', id),
  pdf: (html, name) => call('uw:pdf', html, name),
  addressSearch: (q) => call('uw:addressSearch', q),
  prefillData: (ref) => call('uw:prefillData', ref),
  fetchListing: (address) => call('uw:fetchListing', address),
  extractFromTab: (wcId) => call('uw:extractFromTab', wcId),
};

const search = {
  query: (q) => call('search:query', q),
  file: (id, q) => call('search:file', id, q),
  scan: () => call('search:scan'),
  stats: () => call('search:stats'),
  recent: (n) => call('search:recent', n),
  addFolder: () => call('search:addFolder'),
  removeFolder: (p) => call('search:removeFolder', p),
  onProgress: (fn) => {
    const h = (_e, d) => fn(d);
    ipcRenderer.on('search-progress', h);
    return () => ipcRenderer.removeListener('search-progress', h);
  },
};
const files = {
  open: (p) => call('files:open', p),
  show: (p) => call('files:show', p),
  forDeal: (id) => call('files:forDeal', id),
  linkDeal: (id, p) => call('files:linkDeal', id, p),
  unlink: (id) => call('files:unlink', id),
};

const cal = {
  events: (fromMs, toMs, fromYmd, toYmd) => call('cal:events', fromMs, toMs, fromYmd, toYmd),
  refresh: () => call('cal:refresh'),
  join: (url) => call('cal:join', url),
  testAlert: () => call('cal:testAlert'),
  onAlert: (fn) => {
    const h = (_e, d) => fn(d);
    ipcRenderer.on('cal-alert', h);
    return () => ipcRenderer.removeListener('cal-alert', h);
  },
};

contextBridge.exposeInMainWorld('hub', {
  cal,
  crm,
  lists,
  uw,
  search,
  files,
  onNavigate: (fn) => {
    const h = (_e, page) => fn(page);
    ipcRenderer.on('navigate', h);
    return () => ipcRenderer.removeListener('navigate', h);
  },
  settings: {
    get: () => call('settings:get'),
    set: (key, value) => call('settings:set', key, value),
  },
  notes: {
    list: () => call('notes:list'),
    add: (body) => call('notes:add', body),
    remove: (id) => call('notes:delete', id),
  },
  backup: {
    now: () => call('backup:now'),
    list: () => call('backup:list'),
    chooseFolder: () => call('backup:chooseFolder'),
    restore: () => call('backup:restore'),
  },
  sites: {
    list: () => call('sites:list'),
    setHome: (id, url) => call('sites:setHome', id, url),
    resetHome: (id) => call('sites:resetHome', id),
    addCustom: (label, url) => call('sites:addCustom', label, url),
    removeCustom: (id) => call('sites:removeCustom', id),
    signOut: (id) => call('sites:signOut', id),
    setMode: (id, mode) => call('sites:setMode', id, mode),
    openWindow: (id, browserId, remember, url) => call('sites:openWindow', id, browserId, remember, url),
    lock: (id, url, title) => call('sites:lock', id, url, title),
    unlock: (id, pin) => call('sites:unlock', id, pin),
    makePermanent: (id, pin) => call('sites:makePermanent', id, pin),
    removePermanent: (id, pin) => call('sites:removePermanent', id, pin),
    relock: (id) => call('sites:relock', id),
  },
  browsers: {
    list: () => call('browsers:list'),
    setPrefs: (browserId, separate) => call('browsers:setPrefs', browserId, separate),
  },
  onAppLinkBlocked: (fn) => {
    const h = (_e, d) => fn(d);
    ipcRenderer.on('app-link-blocked', h);
    return () => ipcRenderer.removeListener('app-link-blocked', h);
  },
  lock: {
    hasPin: () => call('lock:hasPin'),
    setPin: (oldPin, newPin) => call('lock:setPin', oldPin, newPin),
    onBlocked: (fn) => {
      const h = (_e, d) => fn(d);
      ipcRenderer.on('lock-blocked', h);
      return () => ipcRenderer.removeListener('lock-blocked', h);
    },
  },
  downloads: {
    chooseFolder: () => call('downloads:chooseFolder'),
    openFolder: () => call('downloads:openFolder'),
    show: (file) => call('downloads:show', file),
    onEvent: (fn) => {
      const h = (_e, d) => fn(d);
      ipcRenderer.on('download', h);
      return () => ipcRenderer.removeListener('download', h);
    },
  },
  zc: {
    status: () => call('zc:status'),
    scan: () => call('zc:scan'),
    chooseDir: () => call('zc:chooseDir'),
    pickFiles: () => call('zc:pickFiles'),
    add: (files) => call('zc:add', files),
    applyCandidate: (id, kind, value) => call('zc:applyCandidate', id, kind, value),
    duplicates: () => call('zc:duplicates'),
    merge: (keep, drop) => call('zc:merge', keep, drop),
    names: (id) => call('zc:names', id),
    export: () => call('zc:export'),
    searchFolder: () => call('zc:searchFolder'),
    onUpdate: (fn) => {
      const h = (_e, d) => fn(d);
      ipcRenderer.on('zc-update', h);
      return () => ipcRenderer.removeListener('zc-update', h);
    },
  },
  zoom: {
    status: () => call('zoom:status'),
    detect: () => call('zoom:detect'),
    choose: () => call('zoom:choose'),
    open: () => call('zoom:open'),
  },
  app: {
    openExternal: (url) => call('app:openExternal', url),
    refocus: () => call('app:refocus'),
    openMail: (email) => call('app:openMail', email),
    info: () => call('app:info'),
    openDataFolder: () => call('app:openDataFolder'),
    openPath: (p) => call('app:openPath', p),
  },
});
