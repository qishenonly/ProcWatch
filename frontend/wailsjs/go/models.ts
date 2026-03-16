export namespace main {
	
	export class AutoKillRule {
	    id: string;
	    name: string;
	    cpuThreshold: number;
	    memThreshold: number;
	    exactMatch: boolean;
	    enabled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AutoKillRule(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.cpuThreshold = source["cpuThreshold"];
	        this.memThreshold = source["memThreshold"];
	        this.exactMatch = source["exactMatch"];
	        this.enabled = source["enabled"];
	    }
	}
	export class ProcessInfo {
	    pid: number;
	    name: string;
	    cpu: number;
	    memory: number;
	    status: string;
	    user: string;
	    command: string;
	
	    static createFrom(source: any = {}) {
	        return new ProcessInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pid = source["pid"];
	        this.name = source["name"];
	        this.cpu = source["cpu"];
	        this.memory = source["memory"];
	        this.status = source["status"];
	        this.user = source["user"];
	        this.command = source["command"];
	    }
	}
	export class SystemStats {
	    totalProcesses: number;
	    highCpuCount: number;
	    avgCpu: number;
	    avgMemory: number;
	
	    static createFrom(source: any = {}) {
	        return new SystemStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.totalProcesses = source["totalProcesses"];
	        this.highCpuCount = source["highCpuCount"];
	        this.avgCpu = source["avgCpu"];
	        this.avgMemory = source["avgMemory"];
	    }
	}
	export class UpdateCheckResult {
	    hasUpdate: boolean;
	    currentVer: string;
	    latestVer: string;
	    downloadUrl: string;
	    releaseNotes: string;
	    releaseUrl: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateCheckResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hasUpdate = source["hasUpdate"];
	        this.currentVer = source["currentVer"];
	        this.latestVer = source["latestVer"];
	        this.downloadUrl = source["downloadUrl"];
	        this.releaseNotes = source["releaseNotes"];
	        this.releaseUrl = source["releaseUrl"];
	        this.error = source["error"];
	    }
	}

}

