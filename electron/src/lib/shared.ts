import { appendFile } from "fs";
import { exec as nativeExec } from "child_process";
import os from "os";

export enum LogLevel {
  INFO = "INFO",
  ERROR = "ERROR",
  DEBUG = "DEBUG",
}

export const logToFile = (
  path: string,
  message: string,
  level: LogLevel = LogLevel.INFO
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

export const exec: (command: string, callback: (error: any) => void) => void = (
  command,
  callback
) => {
  nativeExec(command, (error, stdout, stderr) => {
    if (error) {
      callback(error);
      return;
    }
    // You can also handle `stdout` and `stderr` if needed
  });
};

export const homedir: () => string = () => {
  return os.homedir();
};
