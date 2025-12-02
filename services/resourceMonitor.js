/**
 * System Resource Monitor
 * Tracks CPU, memory, disk usage and alerts on thresholds
 */

import os from 'os';
import fs from 'fs';

class ResourceMonitor {
  constructor() {
    this.metrics = {
      memory: { used: 0, total: 0, percentage: 0 },
      cpu: { usage: 0 },
      uptime: 0,
      alerts: []
    };
    this.thresholds = {
      memory: 80,
      cpu: 80,
      disk: 90
    };
  }

  /**
   * Get system memory usage
   * @returns {object} Memory stats
   */
  getMemoryUsage() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const percentage = (usedMem / totalMem) * 100;

    this.metrics.memory = {
      used: Math.round(usedMem / 1024 / 1024),
      total: Math.round(totalMem / 1024 / 1024),
      percentage: Math.round(percentage),
      status: percentage > this.thresholds.memory ? 'warning' : 'healthy'
    };

    return this.metrics.memory;
  }

  /**
   * Get system CPU information
   * @returns {object} CPU stats
   */
  getCPUUsage() {
    const cpus = os.cpus();
    const usage = {
      cores: cpus.length,
      model: cpus[0]?.model || 'Unknown',
      status: 'healthy'
    };

    this.metrics.cpu = usage;
    return usage;
  }

  /**
   * Get system uptime
   * @returns {object} Uptime stats
   */
  getUptime() {
    const uptimeSeconds = os.uptime();
    const uptime = {
      seconds: Math.floor(uptimeSeconds),
      minutes: Math.floor(uptimeSeconds / 60),
      hours: Math.floor(uptimeSeconds / 3600),
      days: Math.floor(uptimeSeconds / 86400)
    };

    this.metrics.uptime = uptime;
    return uptime;
  }

  /**
   * Check database file size
   * @param {string} dbPath - Path to database file
   * @returns {object} Database size info
   */
  checkDatabaseSize(dbPath) {
    try {
      const stats = fs.statSync(dbPath);
      const sizeBytes = stats.size;
      const sizeMB = (sizeBytes / 1024 / 1024).toFixed(2);

      return {
        bytes: sizeBytes,
        megabytes: parseFloat(sizeMB),
        status: sizeBytes > 100 * 1024 * 1024 ? 'warning' : 'healthy'
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Generate system health report
   * @param {string} dbPath - Path to database file
   * @returns {object} Complete health report
   */
  getHealthReport(dbPath) {
    const memory = this.getMemoryUsage();
    const cpu = this.getCPUUsage();
    const uptime = this.getUptime();
    const dbSize = this.checkDatabaseSize(dbPath);

    const alerts = [];
    if (memory.percentage > this.thresholds.memory) {
      alerts.push({
        level: 'warning',
        component: 'memory',
        message: `Memory usage at ${memory.percentage}% (threshold: ${this.thresholds.memory}%)`
      });
    }

    if (dbSize.megabytes && dbSize.megabytes > 500) {
      alerts.push({
        level: 'warning',
        component: 'database',
        message: `Database size is ${dbSize.megabytes}MB. Consider cleanup.`
      });
    }

    return {
      timestamp: new Date().toISOString(),
      memory,
      cpu,
      uptime,
      database: dbSize,
      alerts,
      status: alerts.length > 0 ? 'degraded' : 'healthy'
    };
  }

  /**
   * Get resource recommendation
   * @returns {array} Recommendations
   */
  getRecommendations() {
    const recommendations = [];
    const memory = this.getMemoryUsage();

    if (memory.percentage > this.thresholds.memory) {
      recommendations.push({
        priority: 'high',
        action: 'Reduce memory usage',
        suggestion: 'Check for memory leaks or reduce concurrent operations'
      });
    }

    return recommendations;
  }
}

const resourceMonitor = new ResourceMonitor();
export default resourceMonitor;
