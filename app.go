package main

import (
	"context"
	"encoding/json"
	"fmt"
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
	procs, err := process.Processes()
	if err != nil {
		return []ProcessInfo{}
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

	return processes
}

func (a *App) GetSystemStats() SystemStats {
	procs := a.GetProcesses()

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

	procs := a.GetProcesses()

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

	procs := a.GetProcesses()

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
