import { appendFile } from "fs";

export enum LogLevel {
  INFO = "INFO",
  ERROR = "ERROR",
  DEBUG = "DEBUG",
}

export const logToFile = (
  path: string,
  message: string,
  level: LogLevel = LogLevel.INFO,

): void => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}\n`;

  // Append the log message to the file
  appendFile(path, logMessage, "utf8", (err) => {
    if (err) {
      console.error("Failed to write to log file:", err);
    }
  });
};
