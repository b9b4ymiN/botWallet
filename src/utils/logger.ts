import winston from 'winston';

const level = process.env.LOG_LEVEL || 'info';

const logger = winston.createLogger({
  level,
  format: winston.format.combine(
    winston.format.colorize({ all: true }),
    winston.format.errors({ stack: true }),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
      const metaKeys = Object.keys(meta || {});
      const extra = metaKeys.length ? ' ' + JSON.stringify(meta) : '';
      return `${timestamp} ${level}: ${stack || message}${extra}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
  ],
});

export default logger;
