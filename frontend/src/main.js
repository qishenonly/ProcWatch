import './style.css';
import {
    GetProcesses,
    GetSystemStats,
    KillProcess,
    KillProcesses,
    AddAutoKillRule,
    RemoveAutoKillRule,
    GetAutoKillRules,
    ToggleAutoKillRule,
    UpdateAutoKillRule,
    CheckAutoKillRules,
    ConfirmKill,
    ConfirmKillSelected,
    TestAutoKillRule
} from '../wailsjs/go/main/App';

const avatarColors = [
    'linear-gradient(135deg, #FF6B35, #F7931E)',
    'linear-gradient(135deg, #00D4AA, #00E5B8)',
    'linear-gradient(135deg, #FF5CAA, #FF8AD8)',
    'linear-gradient(135deg, #4F8CFF, #6BA3FF)',
    'linear-gradient(135deg, #8B5CF6, #A78BFA)',
    'linear-gradient(135deg, #F59E0B, #FBBF24)',
];

let processes = [];
let selectedProcesses = new Set();
let hideSystem = false;
let autoKillEnabled = false;
let showNotifications = true;
let autoKillRules = [];
let selectedProcess = null;
let autoKillInterval = null;
let refreshInterval = null;
let sortField = 'cpu';
let sortAsc = false;
let currentPage = 1;
let editingRuleId = null;
const pageSize = 20;

function getCpuClass(cpu) {
    if (cpu >= 50) return 'high';
    if (cpu >= 20) return 'medium';
    return 'low';
}

function getInitials(name) {
    return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
}

function getAvatarColor(pid) {
    return avatarColors[pid % avatarColors.length];
}

function formatNumber(num) {
    if (typeof num !== 'number') return '0';
    return num.toFixed(1);
}

function showNotification(title, body) {
    if (!showNotifications) return;
    
    const container = document.getElementById('notification-container');
    if (!container) return;
    
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.innerHTML = `
        <div class="notification-title">${title}</div>
        <div class="notification-body">${body}</div>
    `;
    container.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

async function loadProcesses() {
    try {
        processes = await GetProcesses();
        renderCurrentView();
    } catch (err) {
        console.error('Failed to load processes:', err);
    }
}

async function loadStats() {
    try {
        const stats = await GetSystemStats();
        const totalEl = document.getElementById('totalProcesses');
        const highEl = document.getElementById('highCpuCount');
        const avgCpuEl = document.getElementById('avgCpu');
        const avgMemEl = document.getElementById('avgMemory');
        
        if (totalEl) totalEl.textContent = stats.totalProcesses;
        if (highEl) highEl.textContent = stats.highCpuCount;
        if (avgCpuEl) avgCpuEl.textContent = formatNumber(stats.avgCpu) + '%';
        if (avgMemEl) avgMemEl.textContent = formatNumber(stats.avgMemory) + '%';
    } catch (err) {
        console.error('Failed to load stats:', err);
    }
}

async function loadRules() {
    try {
        autoKillRules = await GetAutoKillRules();
        renderRules();
    } catch (err) {
        console.error('Failed to load rules:', err);
    }
}

function isSystemUser(user) {
    if (!user) return false;
    const lowerUser = user.toLowerCase();
    const systemUsers = ['root', 'system', 'daemon', 'nobody', 'messagebus', 'syslog', '_windowserver', '_coreaudiod', '_mdnsresponder', '_appleevents', '_securityagent', '_trustevaluationagent', '_locationd', '_networkd', '_notifyd', '_ondemand', '_usbmuxd', '_cfnetwork', '_applecoord', '_gamecontrollerd', '_reportmemoryexception', '_distnote', '_csseed', '_fpsd', '_timed', '_atsserver', '_softwareupdate', '_installassistant', '_installer', '_postfix', '_tokend', '_taskgated', '_appowner', '_appserver', '_ces', '_iconservices', '_spotlight', '_nsurlsessiond', '_nsurlstoraged', '_webfilterproxy', '_netbios', '_captiveagent', '_clamav', '_devdocs', '_screencapture'];
    if (systemUsers.includes(lowerUser)) return true;
    if (lowerUser.startsWith('_')) return true;
    return false;
}

function getFilteredProcesses() {
    const cpuThreshold = parseInt(document.getElementById('cpuThreshold')?.value || 0);
    const memThreshold = parseInt(document.getElementById('memoryThreshold')?.value || 0);
    const searchQuery = document.getElementById('searchInput')?.value?.toLowerCase() || '';
    
    let filtered = processes.filter(p => {
        if (cpuThreshold > 0 && p.cpu < cpuThreshold) return false;
        if (memThreshold > 0 && p.memory < memThreshold) return false;
        if (hideSystem && isSystemUser(p.user)) return false;
        if (searchQuery) {
            if (!p.name.toLowerCase().includes(searchQuery) &&
                !String(p.pid).includes(searchQuery) &&
                !p.user.toLowerCase().includes(searchQuery)) {
                return false;
            }
        }
        return true;
    });
    
    filtered.sort((a, b) => {
        let aVal, bVal;
        switch (sortField) {
            case 'cpu':
                aVal = a.cpu;
                bVal = b.cpu;
                break;
            case 'memory':
                aVal = a.memory;
                bVal = b.memory;
                break;
            case 'pid':
                aVal = a.pid;
                bVal = b.pid;
                break;
            case 'name':
                aVal = a.name.toLowerCase();
                bVal = b.name.toLowerCase();
                break;
            default:
                aVal = a.cpu;
                bVal = b.cpu;
        }
        
        if (typeof aVal === 'string') {
            return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }
        return sortAsc ? aVal - bVal : bVal - aVal;
    });
    
    return filtered;
}

function renderCurrentView() {
    const filtered = getFilteredProcesses();
    const totalPages = Math.ceil(filtered.length / pageSize);
    
    if (currentPage > totalPages) {
        currentPage = Math.max(1, totalPages);
    }
    
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    const pageData = filtered.slice(start, end);
    
    renderProcesses(pageData);
    renderPagination(filtered.length, totalPages);
    
    const countEl = document.getElementById('processCount');
    if (countEl) countEl.textContent = filtered.length;
}

function renderPagination(total, totalPages) {
    const paginationEl = document.getElementById('pagination');
    if (!paginationEl) return;
    
    if (totalPages <= 1) {
        paginationEl.innerHTML = '';
        return;
    }
    
    const start = (currentPage - 1) * pageSize + 1;
    const end = Math.min(currentPage * pageSize, total);
    
    let html = `
        <div class="pagination-info">${start}-${end} / ${total}</div>
        <div class="pagination-buttons">
            <button class="page-btn" onclick="window.goToPage(1)" ${currentPage === 1 ? 'disabled' : ''}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="11 17 6 12 11 7"/>
                    <polyline points="18 17 13 12 18 7"/>
                </svg>
            </button>
            <button class="page-btn" onclick="window.goToPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="15 18 9 12 15 6"/>
                </svg>
            </button>
            <span class="page-current">${currentPage} / ${totalPages}</span>
            <button class="page-btn" onclick="window.goToPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 18 15 12 9 6"/>
                </svg>
            </button>
            <button class="page-btn" onclick="window.goToPage(${totalPages})" ${currentPage === totalPages ? 'disabled' : ''}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="13 17 18 12 13 7"/>
                    <polyline points="6 17 11 12 6 7"/>
                </svg>
            </button>
        </div>
    `;
    
    paginationEl.innerHTML = html;
}

window.goToPage = function(page) {
    const filtered = getFilteredProcesses();
    const totalPages = Math.ceil(filtered.length / pageSize);
    currentPage = Math.max(1, Math.min(page, totalPages));
    renderCurrentView();
};

window.handleSearch = function() {
    currentPage = 1;
    renderCurrentView();
};

function renderProcesses(processList) {
    const tbody = document.getElementById('processTableBody');
    if (!tbody) return;
    
    if (processList.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7">
                    <div class="empty-state">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                        </svg>
                        <h3>没有找到进程</h3>
                        <p>尝试调整过滤条件</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = processList.map(p => `
        <tr class="process-row ${selectedProcesses.has(p.pid) ? 'selected' : ''}" data-pid="${p.pid}">
            <td><input type="checkbox" class="row-checkbox" ${selectedProcesses.has(p.pid) ? 'checked' : ''} data-pid="${p.pid}"></td>
            <td class="row-name">
                <div class="process-info">
                    <div class="process-avatar" style="background: ${getAvatarColor(p.pid)}">${getInitials(p.name)}</div>
                    <div class="process-details">
                        <h4>${p.name}</h4>
                        <span>${p.user}</span>
                    </div>
                </div>
            </td>
            <td><span class="pid-badge">${p.pid}</span></td>
            <td>
                <div class="cpu-display">
                    <div class="cpu-bar"><div class="cpu-fill ${getCpuClass(p.cpu)}" style="width: ${Math.min(p.cpu, 100)}%"></div></div>
                    <span class="cpu-value ${getCpuClass(p.cpu)}">${formatNumber(p.cpu)}%</span>
                </div>
            </td>
            <td><span class="memory-value">${formatNumber(p.memory)}%</span></td>
            <td>
                <span class="status-badge ${p.status}">
                    <span class="status-dot"></span>
                    ${p.status === 'running' ? '运行中' : '空闲'}
                </span>
            </td>
            <td>
                <button class="kill-btn" data-pid="${p.pid}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                    终止
                </button>
            </td>
        </tr>
    `).join('');
}

function renderRules() {
    const rulesList = document.getElementById('rulesList');
    if (!rulesList) return;

    if (autoKillRules.length === 0) {
        rulesList.innerHTML = '<div class="no-rules">暂无规则</div>';
        return;
    }
    rulesList.innerHTML = autoKillRules.map(rule => {
        let condition = '';
        if (rule.cpuThreshold > 0 && rule.memThreshold > 0) {
            condition = `CPU>${rule.cpuThreshold}% 或 内存>${rule.memThreshold}%`;
        } else if (rule.cpuThreshold > 0) {
            condition = `CPU > ${rule.cpuThreshold}%`;
        } else if (rule.memThreshold > 0) {
            condition = `内存 > ${rule.memThreshold}%`;
        } else {
            condition = '匹配即终止';
        }
        return `
        <div class="rule-card ${rule.enabled ? '' : 'disabled'}" onclick="window.editRule('${rule.id}')" data-id="${rule.id}">
            <div class="rule-info">
                <div class="rule-name">${rule.name}</div>
                <div class="rule-condition">${condition}</div>
            </div>
            <div class="rule-actions">
                <button class="rule-test" onclick="event.stopPropagation(); window.testRuleMatch('${rule.name}', ${rule.exactMatch})" title="测试匹配">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8"/>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                </button>
                <button class="rule-toggle ${rule.enabled ? 'active' : ''}" onclick="event.stopPropagation(); window.toggleRuleEnabled('${rule.id}', ${!rule.enabled})" title="${rule.enabled ? '禁用' : '启用'}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        ${rule.enabled
                            ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
                            : '<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
                        }
                    </svg>
                </button>
                <button class="rule-delete" onclick="event.stopPropagation(); window.removeRule('${rule.id}')" title="删除">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
        </div>
    `}).join('');
}

function showProcessDetail(process) {
    const panel = document.getElementById('detailPanel');
    const content = document.getElementById('detailContent');
    
    if (!panel || !content) return;
    
    selectedProcess = process;
    
    content.innerHTML = `
        <div class="detail-header">
            <div class="detail-avatar" style="background: ${getAvatarColor(process.pid)}">${getInitials(process.name)}</div>
            <div class="detail-title">
                <h3>${process.name}</h3>
                <span class="detail-pid">PID: ${process.pid}</span>
            </div>
            <button class="detail-close" onclick="window.closeDetail()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        </div>
        <div class="detail-section">
            <h4>基本信息</h4>
            <div class="detail-grid">
                <div class="detail-item">
                    <span class="detail-label">状态</span>
                    <span class="status-badge ${process.status}">
                        <span class="status-dot"></span>
                        ${process.status === 'running' ? '运行中' : '空闲'}
                    </span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">用户</span>
                    <span class="detail-value">${process.user}</span>
                </div>
            </div>
        </div>
        <div class="detail-section">
            <h4>资源使用</h4>
            <div class="detail-metrics">
                <div class="metric-card">
                    <div class="metric-label">CPU</div>
                    <div class="metric-value ${getCpuClass(process.cpu)}">${formatNumber(process.cpu)}%</div>
                    <div class="metric-bar">
                        <div class="metric-fill ${getCpuClass(process.cpu)}" style="width: ${Math.min(process.cpu, 100)}%"></div>
                    </div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">内存</div>
                    <div class="metric-value">${formatNumber(process.memory)}%</div>
                    <div class="metric-bar">
                        <div class="metric-fill memory" style="width: ${Math.min(process.memory, 100)}%"></div>
                    </div>
                </div>
            </div>
        </div>
        ${process.command ? `
        <div class="detail-section">
            <h4>命令行</h4>
            <div class="detail-command">${process.command}</div>
        </div>
        ` : ''}
        <div class="detail-actions">
            <button class="btn btn-danger" onclick="window.killProcess(${process.pid}); window.closeDetail();">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="15" y1="9" x2="9" y2="15"/>
                    <line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
                终止进程
            </button>
            <button class="btn btn-secondary" onclick="window.createRuleFromProcess('${process.name}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                添加规则
            </button>
        </div>
    `;
    
    panel.classList.add('active');
}

async function runAutoKill() {
    if (!autoKillEnabled) return;

    try {
        const killed = await CheckAutoKillRules();
        if (killed && killed.length > 0) {
            killed.forEach(p => {
                showNotification('进程已自动终止', `${p.name} (PID: ${p.pid})`);
            });
            await loadProcesses();
            await loadStats();
        }
    } catch (err) {
        console.error('Auto-kill error:', err);
        showNotification('自动终止出错', err.message || String(err));
    }
}

window.selectProcessRow = function(event, pid) {
    const process = processes.find(p => p.pid === pid);
    if (process) {
        showProcessDetail(process);
    }
};

window.closeDetail = function() {
    const panel = document.getElementById('detailPanel');
    if (panel) panel.classList.remove('active');
    selectedProcess = null;
};

window.createRuleFromProcess = function(name) {
    document.getElementById('ruleName').value = name;
    window.showModal();
};

window.toggleProcess = function(pid) {
    if (selectedProcesses.has(pid)) {
        selectedProcesses.delete(pid);
    } else {
        selectedProcesses.add(pid);
    }
    renderCurrentView();
};

window.toggleSelectAll = function() {
    const selectAll = document.getElementById('selectAll').checked;
    const filtered = getFilteredProcesses();
    
    if (selectAll) {
        filtered.forEach(p => selectedProcesses.add(p.pid));
    } else {
        selectedProcesses.clear();
    }
    renderCurrentView();
};

window.killProcess = async function(pid) {
    const process = processes.find(p => p.pid === pid);
    const name = process ? process.name : `PID ${pid}`;
    
    const confirmed = await ConfirmKill(name, pid);
    if (!confirmed) return;
    
    try {
        await KillProcess(pid);
        showNotification('进程已终止', `${name} (PID: ${pid})`);
        selectedProcesses.delete(pid);
        await loadProcesses();
        await loadStats();
    } catch (err) {
        alert('终止进程失败: ' + err);
    }
};

window.killSelected = async function() {
    if (selectedProcesses.size === 0) {
        alert('请先选择要终止的进程');
        return;
    }
    
    const confirmed = await ConfirmKillSelected(selectedProcesses.size);
    if (!confirmed) return;
    
    try {
        const pids = Array.from(selectedProcesses);
        await KillProcesses(pids);
        showNotification('进程已终止', `${pids.length} 个进程`);
        selectedProcesses.clear();
        const selectAllEl = document.getElementById('selectAll');
        if (selectAllEl) selectAllEl.checked = false;
        await loadProcesses();
        await loadStats();
    } catch (err) {
        alert('终止进程失败: ' + err);
    }
};

window.refreshProcesses = async function() {
    await loadProcesses();
    await loadStats();
    const lastRefreshEl = document.getElementById('lastRefresh');
    if (lastRefreshEl) lastRefreshEl.textContent = '刚刚';
};

window.updateCpuThreshold = function() {
    const value = document.getElementById('cpuThreshold').value;
    const valueEl = document.getElementById('cpuThresholdValue');
    const fillEl = document.getElementById('cpuFill');
    
    if (valueEl) valueEl.textContent = value + '%';
    if (fillEl) fillEl.style.width = value + '%';
    currentPage = 1;
    renderCurrentView();
};

window.updateMemoryThreshold = function() {
    const value = document.getElementById('memoryThreshold').value;
    const valueEl = document.getElementById('memoryThresholdValue');
    const fillEl = document.getElementById('memoryFill');
    
    if (valueEl) valueEl.textContent = value === '0' ? '不限制' : value + '%';
    if (fillEl) fillEl.style.width = value + '%';
    currentPage = 1;
    renderCurrentView();
};

window.toggleHideSystem = function() {
    hideSystem = !hideSystem;
    const toggleEl = document.getElementById('hideSystemToggle');
    if (toggleEl) toggleEl.classList.toggle('active', hideSystem);
    currentPage = 1;
    renderCurrentView();
};

window.toggleAutoKill = function() {
    autoKillEnabled = !autoKillEnabled;
    const toggleEl = document.getElementById('autoKillToggle');
    if (toggleEl) toggleEl.classList.toggle('active', autoKillEnabled);
    
    if (autoKillEnabled) {
        autoKillInterval = setInterval(runAutoKill, 5000);
        showNotification('自动终止已启用', '将按照规则自动终止进程');
    } else {
        if (autoKillInterval) {
            clearInterval(autoKillInterval);
            autoKillInterval = null;
        }
        showNotification('自动终止已禁用', '');
    }
};

window.toggleNotifications = function() {
    showNotifications = !showNotifications;
    const toggleEl = document.getElementById('showNotificationsToggle');
    if (toggleEl) toggleEl.classList.toggle('active', showNotifications);
};

window.toggleRuleEnabled = async function(id, enabled) {
    try {
        await ToggleAutoKillRule(id, enabled);
        await loadRules();
    } catch (err) {
        console.error('Failed to toggle rule:', err);
    }
};

window.testRuleMatch = async function(ruleName, exactMatch) {
    try {
        const matched = await TestAutoKillRule(ruleName, exactMatch);
        if (matched && matched.length > 0) {
            const names = matched.map(p => `${p.name} (CPU: ${p.cpu.toFixed(1)}%)`).join('\n');
            showNotification(`匹配到 ${matched.length} 个进程`, names.substring(0, 100));
        } else {
            showNotification('没有匹配到进程', '请检查规则名称是否正确');
        }
    } catch (err) {
        console.error('Failed to test rule:', err);
        showNotification('测试失败', err.message || String(err));
    }
};

window.showModal = function() {
    editingRuleId = null;
    const modalEl = document.getElementById('modalOverlay');
    const titleEl = document.getElementById('modalTitle');
    const submitBtn = document.getElementById('modalSubmitBtn');

    if (modalEl) {
        modalEl.classList.add('active');
        if (titleEl) titleEl.textContent = '添加自动终止规则';
        if (submitBtn) submitBtn.textContent = '添加';

        // 清空表单
        const nameInput = document.getElementById('ruleName');
        const cpuInput = document.getElementById('ruleCpu');
        const memInput = document.getElementById('ruleMemory');
        const exactInput = document.getElementById('ruleExact');
        if (nameInput) { nameInput.value = ''; nameInput.focus(); }
        if (cpuInput) cpuInput.value = '50';
        if (memInput) memInput.value = '0';
        if (exactInput) exactInput.checked = false;
    }
};

window.editRule = function(id) {
    const rule = autoKillRules.find(r => r.id === id);
    if (!rule) return;

    editingRuleId = id;
    const modalEl = document.getElementById('modalOverlay');
    const titleEl = document.getElementById('modalTitle');
    const submitBtn = document.getElementById('modalSubmitBtn');

    if (modalEl) {
        modalEl.classList.add('active');
        if (titleEl) titleEl.textContent = '编辑规则';
        if (submitBtn) submitBtn.textContent = '保存';

        // 填充表单
        const nameInput = document.getElementById('ruleName');
        const cpuInput = document.getElementById('ruleCpu');
        const memInput = document.getElementById('ruleMemory');
        const exactInput = document.getElementById('ruleExact');
        if (nameInput) { nameInput.value = rule.name; nameInput.focus(); }
        if (cpuInput) cpuInput.value = rule.cpuThreshold || '0';
        if (memInput) memInput.value = rule.memThreshold || '0';
        if (exactInput) exactInput.checked = rule.exactMatch;
    }
};

window.hideModal = function(e) {
    if (!e || e.target.id === 'modalOverlay') {
        const modalEl = document.getElementById('modalOverlay');
        if (modalEl) modalEl.classList.remove('active');
    }
};

window.addRule = async function() {
    const nameEl = document.getElementById('ruleName');
    const cpuEl = document.getElementById('ruleCpu');
    const memEl = document.getElementById('ruleMemory');
    const exactEl = document.getElementById('ruleExact');

    const name = nameEl?.value?.trim() || '';
    const cpu = parseFloat(cpuEl?.value) || 0;
    const mem = parseFloat(memEl?.value) || 0;
    const exactMatch = exactEl?.checked || false;

    if (!name) {
        alert('请输入进程名称');
        return;
    }

    try {
        if (editingRuleId) {
            // 编辑模式
            await UpdateAutoKillRule(editingRuleId, name, cpu, mem, exactMatch);
            await loadRules();
            showNotification('规则已更新', name);
        } else {
            // 添加模式
            await AddAutoKillRule(name, cpu, mem, exactMatch);
            await loadRules();
            showNotification('规则已添加', name);
        }
        window.hideModal();
    } catch (err) {
        alert(editingRuleId ? '更新规则失败: ' + err : '添加规则失败: ' + err);
    }
};

window.removeRule = async function(id) {
    try {
        await RemoveAutoKillRule(id);
        await loadRules();
        showNotification('规则已删除', '');
    } catch (err) {
        console.error('Failed to remove rule:', err);
        showNotification('删除失败', err.message || String(err));
    }
};

window.sortBy = function(field) {
    if (sortField === field) {
        sortAsc = !sortAsc;
    } else {
        sortField = field;
        sortAsc = false;
    }
    
    document.querySelectorAll('.process-table th.sortable').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
    });
    
    const headerMap = { name: 1, pid: 2, cpu: 3, memory: 4 };
    const index = headerMap[field];
    if (index) {
        const th = document.querySelector(`.process-table th:nth-child(${index + 1})`);
        if (th) th.classList.add(sortAsc ? 'sort-asc' : 'sort-desc');
    }
    
    renderCurrentView();
};

document.addEventListener('DOMContentLoaded', async () => {
    document.querySelector('#app').innerHTML = `
        <div class="bg-decoration">
            <div class="blob blob-1"></div>
            <div class="blob blob-2"></div>
            <div class="blob blob-3"></div>
        </div>

        <div id="notification-container"></div>

        <div class="main-content">
            <aside class="sidebar">
                <section class="sidebar-section">
                    <h2 class="section-title">系统状态</h2>
                    <div class="stats-grid">
                        <div class="stat-card hot">
                            <div class="stat-value" id="totalProcesses">-</div>
                            <div class="stat-label">总进程</div>
                        </div>
                        <div class="stat-card pink">
                            <div class="stat-value" id="highCpuCount">-</div>
                            <div class="stat-label">高CPU</div>
                        </div>
                        <div class="stat-card cool">
                            <div class="stat-value" id="avgCpu">-%</div>
                            <div class="stat-label">平均CPU</div>
                        </div>
                        <div class="stat-card blue">
                            <div class="stat-value" id="avgMemory">-%</div>
                            <div class="stat-label">平均内存</div>
                        </div>
                    </div>
                </section>

                <section class="sidebar-section">
                    <h2 class="section-title">过滤条件</h2>
                    <div class="filter-group">
                        <div class="filter-label">
                            <span>CPU 阈值</span>
                            <span class="filter-value" id="cpuThresholdValue">0%</span>
                        </div>
                        <div class="slider-track">
                            <div class="slider-fill" id="cpuFill" style="width: 0%"></div>
                            <input type="range" class="slider-input" id="cpuThreshold" min="0" max="100" value="0" oninput="window.updateCpuThreshold()">
                        </div>
                    </div>
                    <div class="filter-group">
                        <div class="filter-label">
                            <span>内存阈值</span>
                            <span class="filter-value" id="memoryThresholdValue">不限制</span>
                        </div>
                        <div class="slider-track">
                            <div class="slider-fill" id="memoryFill" style="width: 0%"></div>
                            <input type="range" class="slider-input" id="memoryThreshold" min="0" max="100" value="0" oninput="window.updateMemoryThreshold()">
                        </div>
                    </div>
                    <div class="toggle-row">
                        <span class="toggle-label">隐藏系统进程</span>
                        <div class="toggle-switch" id="hideSystemToggle"></div>
                    </div>
                </section>

                <section class="sidebar-section">
                    <h2 class="section-title">自动终止</h2>
                    <div class="toggle-row">
                        <span class="toggle-label">启用自动终止</span>
                        <div class="toggle-switch" id="autoKillToggle"></div>
                    </div>
                    <div class="toggle-row">
                        <span class="toggle-label">显示通知</span>
                        <div class="toggle-switch active" id="showNotificationsToggle"></div>
                    </div>
                    <div class="rules-list" id="rulesList"></div>
                    <button class="add-rule-btn" onclick="window.showModal()">+ 添加规则</button>
                </section>
            </aside>

            <main class="content-area">
                <div class="toolbar">
                    <button class="btn btn-primary" onclick="window.refreshProcesses()">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                        </svg>
                        刷新
                    </button>
                    <button class="btn btn-danger" onclick="window.killSelected()">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="15" y1="9" x2="9" y2="15"/>
                            <line x1="9" y1="9" x2="15" y2="15"/>
                        </svg>
                        终止选中
                    </button>
                    <div class="toolbar-spacer"></div>
                    <div class="search-container">
                        <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"/>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                        <input type="text" class="search-input" placeholder="搜索进程..." id="searchInput" oninput="window.handleSearch()">
                    </div>
                </div>

                <div class="table-wrapper">
                    <table class="process-table">
                        <thead>
                            <tr>
                                <th style="width: 50px;">
                                    <input type="checkbox" id="selectAll" onchange="window.toggleSelectAll()">
                                </th>
                                <th class="sortable" onclick="window.sortBy('name')">进程名称 <span class="sort-icon"></span></th>
                                <th class="sortable" onclick="window.sortBy('pid')" style="width: 100px;">PID <span class="sort-icon"></span></th>
                                <th class="sortable sort-desc" onclick="window.sortBy('cpu')" style="width: 150px;">CPU <span class="sort-icon"></span></th>
                                <th class="sortable" onclick="window.sortBy('memory')" style="width: 100px;">内存 <span class="sort-icon"></span></th>
                                <th style="width: 100px;">状态</th>
                                <th style="width: 80px;">操作</th>
                            </tr>
                        </thead>
                        <tbody id="processTableBody">
                            <tr>
                                <td colspan="7">
                                    <div class="loading-spinner"></div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div class="pagination" id="pagination"></div>
            </main>

            <aside class="detail-panel" id="detailPanel">
                <div class="detail-content" id="detailContent"></div>
            </aside>
        </div>

        <footer class="statusbar">
            <div class="status-item">
                <span class="status-live"></span>
                <span>监控中</span>
            </div>
            <div class="status-item">
                上次刷新: <span class="status-highlight" id="lastRefresh">刚刚</span>
            </div>
            <div class="status-item">
                刷新间隔: <span class="status-highlight">5秒</span>
            </div>
            <div class="status-spacer"></div>
            <div class="status-item">
                显示 <span class="status-highlight" id="processCount">0</span> 个进程
            </div>
        </footer>

        <div class="modal-overlay" id="modalOverlay" onclick="window.hideModal(event)">
            <div class="modal" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h3 class="modal-title" id="modalTitle">添加自动终止规则</h3>
                    <button class="modal-close" onclick="window.hideModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-field">
                        <label class="form-label">进程名称（支持通配符 *）</label>
                        <input type="text" class="form-input" id="ruleName" placeholder="例如: *helper*">
                    </div>
                    <div class="form-row">
                        <div class="form-field">
                            <label class="form-label">CPU 阈值 (%)</label>
                            <input type="number" class="form-input" id="ruleCpu" value="50" min="0" max="100">
                        </div>
                        <div class="form-field">
                            <label class="form-label">内存阈值 (%)</label>
                            <input type="number" class="form-input" id="ruleMemory" value="0" min="0" max="100">
                        </div>
                    </div>
                    <div class="form-hint">CPU 或内存任一超过阈值即终止，设为 0 则不限制</div>
                    <label class="checkbox-field">
                        <input type="checkbox" id="ruleExact">
                        <span>精确匹配进程名（不勾选则支持通配符）</span>
                    </label>
                </div>
                <div class="modal-footer">
                    <button class="btn-cancel" onclick="window.hideModal()">取消</button>
                    <button class="btn-submit" id="modalSubmitBtn" onclick="window.addRule()">添加</button>
                </div>
            </div>
        </div>
    `;

    await loadProcesses();
    await loadStats();
    await loadRules();
    
    document.getElementById('hideSystemToggle')?.addEventListener('click', window.toggleHideSystem);
    document.getElementById('autoKillToggle')?.addEventListener('click', window.toggleAutoKill);
    document.getElementById('showNotificationsToggle')?.addEventListener('click', window.toggleNotifications);
    
    document.getElementById('processTableBody')?.addEventListener('click', function(e) {
        const killBtn = e.target.closest('.kill-btn');
        if (killBtn) {
            e.preventDefault();
            e.stopPropagation();
            const pid = parseInt(killBtn.dataset.pid);
            window.killProcess(pid);
            return;
        }
        
        const checkbox = e.target.closest('.row-checkbox');
        if (checkbox) {
            e.stopPropagation();
            const pid = parseInt(checkbox.dataset.pid);
            window.toggleProcess(pid);
            return;
        }
        
        const row = e.target.closest('.process-row');
        if (row) {
            const pid = parseInt(row.dataset.pid);
            const process = processes.find(p => p.pid === pid);
            if (process) {
                showProcessDetail(process);
            }
        }
    });
    
    refreshInterval = setInterval(async () => {
        await loadProcesses();
        await loadStats();
        const lastRefreshEl = document.getElementById('lastRefresh');
        if (lastRefreshEl) lastRefreshEl.textContent = '刚刚';
    }, 5000);
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        window.hideModal();
        window.closeDetail();
    }
});