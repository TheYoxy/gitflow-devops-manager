import * as winston from 'winston';

const logFile = new winston.transports.File(
  {
    dirname: 'logs',
    filename: 'out.log',
    level: 'debug',
    maxsize: 5242880, // 5MB
    maxFiles: 5,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.metadata({fillExcept: ['message', 'level', 'timestamp', 'label']}),
      winston.format.printf(
        ({level, message, timestamp, label, metadata}) => {
          let s = `[${timestamp}] ${level}`;
          if (label) {
            s += ` {${label}}`;
          }
          s += `: ${message}`;
          if (metadata) {
            s += ` ${JSON.stringify(metadata)}`;
          }
          return s;
        })
    ),
  });

const jsonLogFile = new winston.transports.File(
  {
    dirname: 'logs',
    filename: 'out.json.log',
    level: 'debug',
    maxsize: 5242880, // 5MB
    maxFiles: 5,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.metadata(),
      winston.format.prettyPrint({depth: 10, colorize: false})
    ),
  });

export const logging = winston.createLogger(
  {
    transports: [logFile, jsonLogFile],
    exceptionHandlers: [logFile],
  });

if (process.env.NODE_ENV === 'test') {
  logging.add(new winston.transports.Console({format: winston.format.simple(),}));
}
