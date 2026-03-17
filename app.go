package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/shirou/gopsutil/v3/process"
)

// 版本信息，构建时可通过 ldflags 注入
var (
	AppVersion = "1.1.0"
	BuildTime  = "unknown"
	GitCommit  = "unknown"
	GitHubRepo = "NexusToolsLab/ProcWatch"
)

type ProcessInfo struct {
	PID     int32   `json:"pid"`
	Name    string  `json:"name"`
	CPU     float64 `json:"cpu"`
	Memory  float64 `json:"memory"`
	Status  string  `json:"status"`
	User    string  `json:"user"`
	Command string  `json:"command"`
}

type AutoKillRule struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	CPUThreshold float64 `json:"cpuThreshold"`
	MemThreshold float64 `json:"memThreshold"`
	ExactMatch   bool    `json:"exactMatch"`
	Enabled      bool    `json:"enabled"`
}

type SystemStats struct {
	TotalProcesses int     `json:"totalProcesses"`
	HighCPUCount   int     `json:"highCpuCount"`
	AvgCPU         float64 `json:"avgCpu"`
	AvgMemory      float64 `json:"avgMemory"`
}

type cpuSample struct {
	cpuTime  float64
	sampTime time.Time
}

type App struct {
	ctx           context.Context
	autoKillRules []AutoKillRule
	cpuSamples    map[int32]cpuSample
	samplesMutex  sync.Mutex
	rulesFile     string
	// 缓存进程数据，避免重复获取
	cachedProcesses []ProcessInfo
	cacheMutex      sync.RWMutex
	lastCacheTime   time.Time
}

func NewApp() *App {
	homeDir, _ := os.UserHomeDir()
	rulesFile := filepath.Join(homeDir, ".procwatch_rules.json")

	app := &App{
		autoKillRules: make([]AutoKillRule, 0),
		cpuSamples:    make(map[int32]cpuSample),
		rulesFile:     rulesFile,
	}
	app.loadRulesFromFile()
	return app
}

func (a *App) loadRulesFromFile() {
	data, err := os.ReadFile(a.rulesFile)
	if err != nil {
		return
	}
	json.Unmarshal(data, &a.autoKillRules)
}

func (a *App) saveRulesToFile() {
	data, err := json.MarshalIndent(a.autoKillRules, "", "  ")
	if err != nil {
		return
	}
	os.WriteFile(a.rulesFile, data, 0644)
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) GetProcesses() []ProcessInfo {
	// 使用缓存：如果距离上次获取不到1秒，直接返回缓存数据
	a.cacheMutex.RLock()
	if time.Since(a.lastCacheTime) < time.Second && a.cachedProcesses != nil {
		a.cacheMutex.RUnlock()
		return a.cachedProcesses
	}
	a.cacheMutex.RUnlock()

	procs, err := process.Processes()
	if err != nil {
		return a.cachedProcesses // 返回旧缓存
	}

	a.samplesMutex.Lock()
	defer a.samplesMutex.Unlock()

	now := time.Now()
	var processes []ProcessInfo

	for _, p := range procs {
		info := ProcessInfo{PID: p.Pid}

		if name, err := p.Name(); err == nil {
			info.Name = name
		}

		times, err := p.Times()
		if err == nil {
			totalTime := times.User + times.System
			if prev, exists := a.cpuSamples[p.Pid]; exists {
				timeDiff := now.Sub(prev.sampTime).Seconds()
				if timeDiff > 0 {
					cpuDiff := totalTime - prev.cpuTime
					cpuPercent := (cpuDiff / timeDiff) * 100
					if cpuPercent >= 0 {
						info.CPU = cpuPercent
					}
				}
			}
			a.cpuSamples[p.Pid] = cpuSample{
				cpuTime:  totalTime,
				sampTime: now,
			}
		}

		if mem, err := p.MemoryPercent(); err == nil {
			info.Memory = float64(mem)
		}

		if status, err := p.Status(); err == nil {
			if len(status) > 0 {
				info.Status = strings.ToLower(string(status[0]))
				if info.Status == "r" {
					info.Status = "running"
				} else {
					if info.CPU > 5 {
						info.Status = "running"
					} else {
						info.Status = "idle"
					}
				}
			}
		} else {
			if info.CPU > 5 {
				info.Status = "running"
			} else {
				info.Status = "idle"
			}
		}

		if username, err := p.Username(); err == nil {
			parts := strings.Split(username, "\\")
			if len(parts) > 1 {
				info.User = parts[len(parts)-1]
			} else {
				parts := strings.Split(username, "/")
				if len(parts) > 1 {
					info.User = parts[len(parts)-1]
				} else {
					info.User = username
				}
			}
		}

		if cmdline, err := p.Cmdline(); err == nil {
			if len(cmdline) > 100 {
				info.Command = cmdline[:100] + "..."
			} else {
				info.Command = cmdline
			}
		}

		processes = append(processes, info)
	}

	activePids := make(map[int32]bool)
	for _, p := range processes {
		activePids[p.PID] = true
	}
	for pid := range a.cpuSamples {
		if !activePids[pid] {
			delete(a.cpuSamples, pid)
		}
	}

	// 更新缓存
	a.cacheMutex.Lock()
	a.cachedProcesses = processes
	a.lastCacheTime = now
	a.cacheMutex.Unlock()

	return processes
}

func (a *App) GetSystemStats() SystemStats {
	// 使用缓存的进程数据
	a.cacheMutex.RLock()
	procs := a.cachedProcesses
	a.cacheMutex.RUnlock()

	if procs == nil {
		procs = a.GetProcesses()
	}

	var totalCPU, totalMem float64
	var highCPUCount int

	for _, p := range procs {
		totalCPU += p.CPU
		totalMem += p.Memory
		if p.CPU >= 50 {
			highCPUCount++
		}
	}

	count := len(procs)
	if count == 0 {
		count = 1
	}

	return SystemStats{
		TotalProcesses: len(procs),
		HighCPUCount:   highCPUCount,
		AvgCPU:         totalCPU / float64(count),
		AvgMemory:      totalMem / float64(count),
	}
}

func (a *App) KillProcess(pid int32) error {
	p, err := process.NewProcess(pid)
	if err != nil {
		return err
	}
	return p.Kill()
}

func (a *App) ConfirmKill(name string, pid int32) bool {
	if a.ctx == nil {
		return true
	}
	result, _ := runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
		Type:          runtime.QuestionDialog,
		Title:         "确认终止进程",
		Message:       fmt.Sprintf("确定要终止进程 \"%s\" (PID: %d) 吗？", name, pid),
		Buttons:       []string{"取消", "确定"},
		DefaultButton: "取消",
	})
	return result == "确定"
}

func (a *App) ConfirmKillSelected(count int) bool {
	if a.ctx == nil {
		return true
	}
	result, _ := runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
		Type:          runtime.QuestionDialog,
		Title:         "确认终止进程",
		Message:       fmt.Sprintf("确定要终止选中的 %d 个进程吗？", count),
		Buttons:       []string{"取消", "确定"},
		DefaultButton: "取消",
	})
	return result == "确定"
}

func (a *App) KillProcesses(pids []int32) map[int32]string {
	results := make(map[int32]string)
	for _, pid := range pids {
		if err := a.KillProcess(pid); err != nil {
			results[pid] = err.Error()
		} else {
			results[pid] = "success"
		}
	}
	return results
}

func (a *App) AddAutoKillRule(name string, cpuThreshold, memThreshold float64, exactMatch bool) AutoKillRule {
	rule := AutoKillRule{
		ID:           fmt.Sprintf("rule_%d", time.Now().UnixNano()),
		Name:         name,
		CPUThreshold: cpuThreshold,
		MemThreshold: memThreshold,
		ExactMatch:   exactMatch,
		Enabled:      true,
	}
	a.autoKillRules = append(a.autoKillRules, rule)
	a.saveRulesToFile()
	return rule
}

func (a *App) RemoveAutoKillRule(id string) bool {
	for i, rule := range a.autoKillRules {
		if rule.ID == id {
			a.autoKillRules = append(a.autoKillRules[:i], a.autoKillRules[i+1:]...)
			a.saveRulesToFile()
			return true
		}
	}
	return false
}

func (a *App) GetAutoKillRules() []AutoKillRule {
	return a.autoKillRules
}

func (a *App) ToggleAutoKillRule(id string, enabled bool) bool {
	for i := range a.autoKillRules {
		if a.autoKillRules[i].ID == id {
			a.autoKillRules[i].Enabled = enabled
			a.saveRulesToFile()
			return true
		}
	}
	return false
}

func (a *App) UpdateAutoKillRule(id, name string, cpuThreshold, memThreshold float64, exactMatch bool) bool {
	for i := range a.autoKillRules {
		if a.autoKillRules[i].ID == id {
			a.autoKillRules[i].Name = name
			a.autoKillRules[i].CPUThreshold = cpuThreshold
			a.autoKillRules[i].MemThreshold = memThreshold
			a.autoKillRules[i].ExactMatch = exactMatch
			a.saveRulesToFile()
			return true
		}
	}
	return false
}

func (a *App) CheckAutoKillRules() []ProcessInfo {
	var killed []ProcessInfo

	if len(a.autoKillRules) == 0 {
		return killed
	}

	// 使用缓存的进程数据
	a.cacheMutex.RLock()
	procs := a.cachedProcesses
	a.cacheMutex.RUnlock()

	if procs == nil {
		procs = a.GetProcesses()
	}

	for _, rule := range a.autoKillRules {
		if !rule.Enabled {
			continue
		}

		for _, proc := range procs {
			matched := false
			if rule.ExactMatch {
				matched = proc.Name == rule.Name
			} else {
				// 支持通配符 * 匹配
				pattern := strings.ReplaceAll(regexp.QuoteMeta(rule.Name), "\\*", ".*")
				matched, _ = regexp.MatchString("^"+pattern+"$", proc.Name)
			}

			if matched {
				shouldKill := false
				// CPU 或内存任一超过阈值即终止
				if rule.CPUThreshold > 0 && proc.CPU >= rule.CPUThreshold {
					shouldKill = true
				}
				if rule.MemThreshold > 0 && proc.Memory >= rule.MemThreshold {
					shouldKill = true
				}

				// 如果 CPU 和内存阈值都为 0，只要匹配进程名就终止
				if rule.CPUThreshold == 0 && rule.MemThreshold == 0 {
					shouldKill = true
				}

				if shouldKill {
					if err := a.KillProcess(proc.PID); err == nil {
						killed = append(killed, proc)
					}
				}
			}
		}
	}

	return killed
}

// TestAutoKillRule 测试规则是否能匹配到进程（用于调试）
func (a *App) TestAutoKillRule(ruleName string, exactMatch bool) []ProcessInfo {
	var matched []ProcessInfo

	// 使用缓存的进程数据
	a.cacheMutex.RLock()
	procs := a.cachedProcesses
	a.cacheMutex.RUnlock()

	if procs == nil {
		procs = a.GetProcesses()
	}

	for _, proc := range procs {
		isMatched := false
		if exactMatch {
			isMatched = proc.Name == ruleName
		} else {
			// 支持通配符 * 匹配
			pattern := strings.ReplaceAll(regexp.QuoteMeta(ruleName), "\\*", ".*")
			isMatched, _ = regexp.MatchString("^"+pattern+"$", proc.Name)
		}

		if isMatched {
			matched = append(matched, proc)
		}
	}

	return matched
}

func (a *App) SearchProcesses(query string) []ProcessInfo {
	procs := a.GetProcesses()
	if query == "" {
		return procs
	}

	var results []ProcessInfo
	query = strings.ToLower(query)

	for _, p := range procs {
		if strings.Contains(strings.ToLower(p.Name), query) ||
			strings.Contains(strconv.Itoa(int(p.PID)), query) ||
			strings.Contains(strings.ToLower(p.User), query) ||
			strings.Contains(strings.ToLower(p.Command), query) {
			results = append(results, p)
		}
	}

	return results
}

func (a *App) FilterProcesses(minCPU, minMem float64, hideSystem bool) []ProcessInfo {
	procs := a.GetProcesses()
	var results []ProcessInfo

	for _, p := range procs {
		if minCPU > 0 && p.CPU < minCPU {
			continue
		}
		if minMem > 0 && p.Memory < minMem {
			continue
		}
		if hideSystem && (p.User == "root" || p.User == "SYSTEM" || p.User == "_windowserver") {
			continue
		}
		results = append(results, p)
	}

	return results
}

// ========== 自动更新相关 ==========

type ReleaseInfo struct {
	TagName     string `json:"tag_name"`
	Name        string `json:"name"`
	Body        string `json:"body"`
	HtmlUrl     string `json:"html_url"`
	PublishedAt string `json:"published_at"`
	Assets      []struct {
		Name               string `json:"name"`
		BrowserDownloadUrl string `json:"browser_download_url"`
	} `json:"assets"`
}

type UpdateCheckResult struct {
	HasUpdate    bool   `json:"hasUpdate"`
	CurrentVer   string `json:"currentVer"`
	LatestVer    string `json:"latestVer"`
	DownloadUrl  string `json:"downloadUrl"`
	ReleaseNotes string `json:"releaseNotes"`
	ReleaseUrl   string `json:"releaseUrl"`
	Error        string `json:"error,omitempty"`
}

// GetAppVersion 获取当前应用版本
func (a *App) GetAppVersion() map[string]string {
	return map[string]string{
		"version":   AppVersion,
		"buildTime": BuildTime,
		"gitCommit": GitCommit,
	}
}

// CheckForUpdate 检查是否有新版本
func (a *App) CheckForUpdate() UpdateCheckResult {
	result := UpdateCheckResult{
		CurrentVer: AppVersion,
	}

	// 获取 GitHub 最新 Release
	url := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", GitHubRepo)

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		result.Error = "创建请求失败: " + err.Error()
		return result
	}
	// GitHub API 要求设置 User-Agent
	req.Header.Set("User-Agent", fmt.Sprintf("ProcWatch/%s", AppVersion))

	resp, err := client.Do(req)
	if err != nil {
		result.Error = "无法连接更新服务器: " + err.Error()
		return result
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		result.Error = fmt.Sprintf("更新服务器返回错误: %d", resp.StatusCode)
		return result
	}

	var release ReleaseInfo
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		result.Error = "解析更新信息失败"
		return result
	}

	// 解析版本号
	latestVer := strings.TrimPrefix(release.TagName, "v")
	result.LatestVer = latestVer
	result.ReleaseNotes = release.Body
	result.ReleaseUrl = release.HtmlUrl

	// 比较版本
	if a.compareVersions(AppVersion, latestVer) < 0 {
		result.HasUpdate = true
		// 根据平台选择下载链接
		result.DownloadUrl = a.getDownloadUrl(release.Assets)
	}

	return result
}

// compareVersions 比较版本号，返回 -1, 0, 1
func (a *App) compareVersions(v1, v2 string) int {
	parts1 := strings.Split(v1, ".")
	parts2 := strings.Split(v2, ".")

	maxLen := len(parts1)
	if len(parts2) > maxLen {
		maxLen = len(parts2)
	}

	for i := 0; i < maxLen; i++ {
		var n1, n2 int
		if i < len(parts1) {
			n1, _ = strconv.Atoi(parts1[i])
		}
		if i < len(parts2) {
			n2, _ = strconv.Atoi(parts2[i])
		}

		if n1 < n2 {
			return -1
		} else if n1 > n2 {
			return 1
		}
	}
	return 0
}

// getDownloadUrl 根据当前平台获取下载链接
func (a *App) getDownloadUrl(assets []struct {
	Name               string `json:"name"`
	BrowserDownloadUrl string `json:"browser_download_url"`
}) string {
	var target string

	// 检测当前平台
	goos := runtime.Environment(a.ctx).Platform
	arch := runtime.Environment(a.ctx).Arch

	switch goos {
	case "darwin":
		if arch == "arm64" {
			target = "darwin-arm64"
		} else {
			target = "darwin-amd64"
		}
		// 优先选择 DMG
		for _, asset := range assets {
			if strings.Contains(asset.Name, target) && strings.HasSuffix(asset.Name, ".dmg") {
				return asset.BrowserDownloadUrl
			}
		}
	case "windows":
		for _, asset := range assets {
			if strings.Contains(asset.Name, "windows") && (strings.HasSuffix(asset.Name, ".exe") || strings.HasSuffix(asset.Name, ".zip")) {
				return asset.BrowserDownloadUrl
			}
		}
	}

	// 返回 Release 页面
	return fmt.Sprintf("https://github.com/%s/releases/latest", GitHubRepo)
}

// OpenDownloadPage 打开下载页面
func (a *App) OpenDownloadPage(url string) {
	runtime.BrowserOpenURL(a.ctx, url)
}
