import { exec as nativeExec } from "child_process";
import os from "os";
import { mkdir, appendFile, writeFile, access, constants } from "fs/promises";
import path from "path";

export enum LogLevel {
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
  DEBUG = "DEBUG",
}

const levelColor = {
  [LogLevel.INFO]: "[INFO]",
  [LogLevel.WARN]: "[WARN]",
  [LogLevel.ERROR]: "[ERROR]",
  [LogLevel.DEBUG]: "[DEBUG]",
};

export const logToFile = async (
  filePath: string,
  message: string,
  level: LogLevel = LogLevel.INFO
): Promise<void> => {
  const timestamp = new Date().toISOString();
  const logMessage = `${levelColor[level]} [${timestamp}] ${message}\n`;

  try {
    // Check if the file exists
    await access(filePath, constants.F_OK);
  } catch (error) {
    // File does not exist, create parent directories if they don't exist
    const dirName = path.dirname(filePath);
    await mkdir(dirName, { recursive: true });
    // Create file with the logMessage
    await writeFile(filePath, logMessage, "utf8");
    return;
  }

  // If the file exists, append the log message
  try {
    await appendFile(filePath, logMessage, "utf8");
  } catch (err) {
    console.error("Failed to write to log file:", err);
  }
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
