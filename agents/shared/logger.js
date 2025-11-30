const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

const LEVEL_COLORS = {
  DEBUG: '\x1b[36m',
  INFO: '\x1b[32m',
  WARN: '\x1b[33m',
  ERROR: '\x1b[31m'
};

const RESET = '\x1b[0m';

export class AgentLogger {
  constructor(agentName, db = null, minLevel = 'INFO') {
    this.agentName = agentName;
    this.db = db;
    this.minLevel = LOG_LEVELS[minLevel] || LOG_LEVELS.INFO;
  }
  
  setDatabase(db) {
    this.db = db;
  }
  
  async log(level, message, details = null) {
    const levelNum = LOG_LEVELS[level] || LOG_LEVELS.INFO;
    if (levelNum < this.minLevel) return;
    
    const timestamp = new Date().toISOString();
    const color = LEVEL_COLORS[level] || '';
    const prefix = `[${timestamp}] ${color}[${level}]${RESET} [${this.agentName}]`;
    
    console.log(`${prefix} ${message}`);
    if (details) {
      console.log(`  └─ ${JSON.stringify(details)}`);
    }
    
    if (this.db) {
      try {
        await this.db.run(
          'INSERT INTO agent_logs (agent_name, level, message, details, created_at) VALUES (?, ?, ?, ?, ?)',
          [this.agentName, level, message, details ? JSON.stringify(details) : null, Date.now()]
        );
      } catch (e) {
      }
    }
  }
  
  debug(message, details = null) {
    return this.log('DEBUG', message, details);
  }
  
  info(message, details = null) {
    return this.log('INFO', message, details);
  }
  
  warn(message, details = null) {
    return this.log('WARN', message, details);
  }
  
  error(message, details = null) {
    return this.log('ERROR', message, details);
  }
}

export function createLogger(agentName, db = null) {
  return new AgentLogger(agentName, db, process.env.LOG_LEVEL || 'INFO');
}
